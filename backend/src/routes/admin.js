import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { validateFeeTierSequence } from "../fees.js";
import { requireAdmin } from "../auth.js";
import { asyncRoute, HttpError, notify } from "../errors.js";

const router = Router();
router.use(requireAdmin);

const feeTierInput = z.object({
    minCents: z.number().int().min(0).safe(),
    maxCents: z.number().int().min(0).safe().nullable(),
    rateBasisPoints: z.number().int().min(0).max(10000)
});

router.get("/fee-tiers", asyncRoute(async (_request, response) => {
    const result = await pool.query(
        `SELECT id, min_cents AS "minCents", max_cents AS "maxCents",
                rate_basis_points AS "rateBasisPoints"
         FROM platform_fee_tiers
         WHERE listing_type IS NULL AND seller_id IS NULL
           AND starts_at IS NULL AND ends_at IS NULL
         ORDER BY min_cents ASC`
    );
    response.json({ tiers: result.rows });
}));

router.put("/fee-tiers", asyncRoute(async (request, response) => {
    const input = z.object({ tiers: z.array(feeTierInput).min(1).max(20) }).parse(request.body);
    if (!validateFeeTierSequence(input.tiers)) {
        throw new HttpError(400,
            "As faixas precisam começar em R$ 0,00, terminar sem limite e não ter sobreposição nem valores sem taxa.");
    }
    const tiers = input.tiers;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("LOCK TABLE platform_fee_tiers IN SHARE ROW EXCLUSIVE MODE");
        await client.query(
            `DELETE FROM platform_fee_tiers
             WHERE listing_type IS NULL AND seller_id IS NULL
               AND starts_at IS NULL AND ends_at IS NULL`
        );
        for (const tier of tiers) {
            await client.query(
                `INSERT INTO platform_fee_tiers (id, min_cents, max_cents, rate_basis_points)
                 VALUES ($1, $2, $3, $4)`,
                [randomUUID(), tier.minCents, tier.maxCents, tier.rateBasisPoints]
            );
        }
        await client.query("COMMIT");
        response.json({ tiers });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}));

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

router.get("/listing-reports", asyncRoute(async (_request, response) => {
    const result = await pool.query(
        `SELECT r.id AS "reportId", r.reason, r.details,
                r.created_at AS "reportedAt", l.id AS "listingId", l.title,
                l.category, l.description, l.price_cents / 100.0 AS price,
                l.status AS "listingStatus", owner.name AS "ownerName",
                reporter.name AS "reporterName"
         FROM listing_reports r
         JOIN listings l ON l.id = r.listing_id
         JOIN users owner ON owner.id = l.owner_id
         JOIN users reporter ON reporter.id = r.reporter_id
         WHERE r.status = 'open'
         ORDER BY r.created_at ASC LIMIT 200`
    );
    response.json({ reports: result.rows });
}));

router.patch("/listing-reports/:id", asyncRoute(async (request, response) => {
    z.string().uuid().parse(request.params.id);
    const input = z.object({ decision: z.enum(["dismiss", "hide"]) }).parse(request.body);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `SELECT r.id, r.listing_id, r.reporter_id, l.owner_id, l.title
             FROM listing_reports r JOIN listings l ON l.id = r.listing_id
             WHERE r.id = $1 AND r.status = 'open' FOR UPDATE OF r, l`,
            [request.params.id]
        );
        if (!result.rowCount) throw new HttpError(404, "Denúncia não encontrada ou já analisada.");
        const report = result.rows[0];
        const status = input.decision === "hide" ? "hidden" : "dismissed";
        await client.query(
            `UPDATE listing_reports
             SET status = $2, reviewed_at = NOW(), reviewed_by = $3
             WHERE id = $1`,
            [report.id, status, request.userId]
        );
        if (input.decision === "hide") {
            await client.query(
                `UPDATE listings SET status = 'hidden', updated_at = NOW()
                 WHERE id = $1 AND status = 'published'`,
                [report.listing_id]
            );
            await client.query(
                `UPDATE listing_reports
                 SET status = 'hidden', reviewed_at = NOW(), reviewed_by = $2
                 WHERE listing_id = $1 AND status = 'open'`,
                [report.listing_id, request.userId]
            );
            await notify(client, {
                userId: report.owner_id, type: "listing_hidden",
                title: "Anúncio ocultado para análise",
                body: `O anúncio “${report.title}” foi ocultado após análise de uma denúncia.`,
                resourceType: "listing", resourceId: report.listing_id
            });
        }
        await notify(client, {
            userId: report.reporter_id, type: "listing_report_reviewed",
            title: "Denúncia analisada",
            body: input.decision === "hide"
                ? "A denúncia foi analisada e o anúncio foi ocultado."
                : "A denúncia foi analisada; o anúncio foi mantido.",
            resourceType: "listing", resourceId: report.listing_id
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

router.patch("/listings/:id", asyncRoute(async (request, response) => {
    z.string().uuid().parse(request.params.id);
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
    z.string().uuid().parse(request.params.id);
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
