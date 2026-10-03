import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAdmin } from "../auth.js";
import { asyncRoute, HttpError, notify } from "../errors.js";

const router = Router();
router.use(requireAdmin);

router.get("/listings", asyncRoute(async (request, response) => {
    const status = request.query.status ?? "pending";
    if (!["pending", "published", "rejected"].includes(status)) {
        throw new HttpError(400, "Filtro de moderação inválido.");
    }
    const result = await pool.query(
        `SELECT l.id, l.type, l.title, l.category, l.description,
                l.price_cents / 100.0 AS price, l.image_url AS image,
                l.status, l.created_at AS "createdAt",
                u.id AS "ownerId", u.name AS "ownerName", u.email AS "ownerEmail"
         FROM listings l JOIN users u ON u.id = l.owner_id
         WHERE l.status = $1 ORDER BY l.created_at ASC LIMIT 200`,
        [status]
    );
    response.json({ listings: result.rows });
}));

router.patch("/listings/:id", asyncRoute(async (request, response) => {
    const input = z.object({ decision: z.enum(["approve", "reject"]) }).parse(request.body);
    const status = input.decision === "approve" ? "published" : "rejected";
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE listings SET status = $2, updated_at = NOW()
             WHERE id = $1 AND status = 'pending'
             RETURNING id, owner_id, title`,
            [request.params.id, status]
        );
        if (!result.rowCount) throw new HttpError(404, "Anúncio pendente não encontrado.");
        const listing = result.rows[0];
        await notify(client, {
            userId: listing.owner_id,
            type: input.decision === "approve" ? "listing_approved" : "listing_rejected",
            title: input.decision === "approve" ? "Anúncio aprovado" : "Anúncio recusado",
            body: input.decision === "approve"
                ? `Seu anúncio “${listing.title}” está publicado.`
                : `Seu anúncio “${listing.title}” não foi aprovado.`,
            resourceType: "listing",
            resourceId: listing.id
        });
        await client.query("COMMIT");
        response.json({ id: listing.id, status });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}));

router.get("/reviews/reported", asyncRoute(async (_request, response) => {
    const result = await pool.query(
        `SELECT r.id, r.rating, r.comment, r.created_at AS "createdAt",
                reviewer.name AS "reviewerName", subject.name AS "subjectName",
                o.order_number AS "orderNumber"
         FROM reviews r JOIN users reviewer ON reviewer.id = r.reviewer_id
         JOIN users subject ON subject.id = r.subject_id
         JOIN orders o ON o.id = r.order_id
         WHERE r.reported_at IS NOT NULL
         ORDER BY r.reported_at ASC LIMIT 200`
    );
    response.json({ reviews: result.rows });
}));

router.patch("/reviews/:id", asyncRoute(async (request, response) => {
    const input = z.object({ decision: z.enum(["dismiss", "remove"]) }).parse(request.body);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const review = await client.query(
            `SELECT id, reviewer_id, subject_id FROM reviews
             WHERE id = $1 AND reported_at IS NOT NULL FOR UPDATE`,
            [request.params.id]
        );
        if (!review.rowCount) throw new HttpError(404, "Denúncia não encontrada.");
        const row = review.rows[0];
        if (input.decision === "remove") {
            await client.query("DELETE FROM reviews WHERE id = $1", [row.id]);
        } else {
            await client.query("UPDATE reviews SET reported_at = NULL WHERE id = $1", [row.id]);
        }
        await notify(client, {
            userId: row.reviewer_id, type: "review_moderated",
            title: input.decision === "remove" ? "Avaliação removida" : "Denúncia analisada",
            body: input.decision === "remove"
                ? "Sua avaliação foi removida após análise."
                : "A denúncia da sua avaliação foi analisada e a avaliação foi mantida.",
            resourceType: null,
            resourceId: null
        });
        await client.query("COMMIT");
        response.status(204).end();
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}));

export default router;
