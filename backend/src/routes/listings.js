import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";
import { asyncRoute, HttpError, notify } from "../errors.js";

const router = Router();
const imageUrl = z.string().url().max(2000).refine(
    (value) => new URL(value).protocol === "https:",
    "A imagem precisa usar HTTPS."
);
const listingInput = z.object({
    type: z.enum(["produto", "servico"]),
    title: z.string().trim().min(1).max(80),
    category: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(500),
    price: z.number().finite().positive().max(1000000),
    image: z.union([imageUrl, z.literal("")]).optional()
});
const publicFields = `
    l.id, l.type, l.title, l.category, l.description,
    l.price_cents / 100.0 AS price, l.image_url AS image,
    l.owner_id AS "ownerId", u.name AS "ownerName",
    l.created_at AS "createdAt", l.updated_at AS "updatedAt",
    COALESCE(r.rating, 0) AS rating,
    COALESCE(r.review_count, 0) AS "reviewCount"`;
const joins = `
    FROM listings l
    JOIN users u ON u.id = l.owner_id
    LEFT JOIN (
        SELECT subject_id, ROUND(AVG(rating)::numeric, 1) AS rating, COUNT(*) AS review_count
        FROM reviews WHERE reported_at IS NULL GROUP BY subject_id
    ) r ON r.subject_id = l.owner_id`;

router.get("/", asyncRoute(async (request, response) => {
    const type = request.query.type;
    if (type && !["produto", "servico"].includes(type)) {
        throw new HttpError(400, "Filtro de anúncio inválido.");
    }
    const values = [];
    let where = "WHERE l.status = 'published' AND u.blocked_at IS NULL";
    if (type) {
        values.push(type);
        where += ` AND l.type = $${values.length}`;
    }
    const result = await pool.query(
        `SELECT ${publicFields} ${joins} ${where} ORDER BY l.created_at DESC LIMIT 200`,
        values
    );
    response.json({ listings: result.rows });
}));

router.get("/:id", asyncRoute(async (request, response) => {
    const result = await pool.query(
        `SELECT ${publicFields} ${joins}
         WHERE l.id = $1 AND l.status = 'published' AND u.blocked_at IS NULL`,
        [request.params.id]
    );
    if (!result.rowCount) {
        throw new HttpError(404, "Anúncio não encontrado.");
    }
    response.json({ listing: result.rows[0] });
}));

router.post("/", requireAuth, asyncRoute(async (request, response) => {
    const input = listingInput.parse(request.body);
    const id = randomUUID();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `INSERT INTO listings (id, owner_id, type, title, category, description, price_cents, image_url)
             SELECT $1, id, $2, $3, $4, $5, $6, NULLIF($7, '')
             FROM users WHERE id = $8 AND blocked_at IS NULL
             RETURNING id`,
            [id, input.type, input.title, input.category, input.description,
                Math.round(input.price * 100), input.image ?? "", request.userId]
        );
        if (!result.rowCount) throw new HttpError(401, "Esta conta não está disponível.");
        await notify(client, {
            userId: request.userId, type: "listing_submitted",
            title: "Anúncio enviado para análise",
            body: `Seu anúncio “${input.title}” foi enviado para análise.`,
            resourceType: "listing", resourceId: id
        });
        await client.query("COMMIT");
        response.status(201).json({ id, status: "pending" });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}));

router.get("/mine/list", requireAuth, asyncRoute(async (request, response) => {
    const result = await pool.query(
        `SELECT ${publicFields}, l.status
         ${joins} WHERE l.owner_id = $1 ORDER BY l.created_at DESC`,
        [request.userId]
    );
    response.json({ listings: result.rows });
}));

router.put("/:id", requireAuth, asyncRoute(async (request, response) => {
    const input = listingInput.parse(request.body);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE listings SET type = $3, title = $4, category = $5,
                    description = $6, price_cents = $7, image_url = NULLIF($8, ''),
                    status = 'pending', updated_at = NOW()
             WHERE id = $1 AND owner_id = $2 AND status IN ('published', 'pending', 'rejected')
             RETURNING id`,
            [request.params.id, request.userId, input.type, input.title,
                input.category, input.description, Math.round(input.price * 100), input.image ?? ""]
        );
        if (!result.rowCount) {
            throw new HttpError(404, "Anúncio não encontrado ou não pertence a esta conta.");
        }
        await notify(client, {
            userId: request.userId, type: "listing_submitted",
            title: "Anúncio enviado para análise",
            body: `Seu anúncio “${input.title}” foi atualizado e enviado para análise.`,
            resourceType: "listing", resourceId: result.rows[0].id
        });
        await client.query("COMMIT");
        response.json({ id: result.rows[0].id, status: "pending" });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}));

router.delete("/:id", requireAuth, asyncRoute(async (request, response) => {
    const result = await pool.query(
        `UPDATE listings SET status = 'hidden', updated_at = NOW()
         WHERE id = $1 AND owner_id = $2 AND status IN ('published', 'pending', 'rejected')
         RETURNING id`,
        [request.params.id, request.userId]
    );
    if (!result.rowCount) {
        throw new HttpError(404, "Anúncio não encontrado ou não pertence a esta conta.");
    }
    response.status(204).end();
}));

router.get("/:id/reviews", asyncRoute(async (request, response) => {
    const result = await pool.query(
        `SELECT r.id, r.rating, r.comment, r.created_at AS "createdAt",
                u.id AS "reviewerId", u.name AS "reviewerName"
         FROM reviews r JOIN users u ON u.id = r.reviewer_id
         WHERE r.subject_id = (SELECT owner_id FROM listings WHERE id = $1)
           AND r.reported_at IS NULL
         ORDER BY r.created_at DESC LIMIT 100`,
        [request.params.id]
    );
    response.json({ reviews: result.rows });
}));

export default router;
