import { Router } from "express";
import { pool } from "../db.js";
import { asyncRoute, HttpError } from "../errors.js";

const router = Router();

router.get("/:id", asyncRoute(async (request, response) => {
    const user = await pool.query(
        `SELECT u.id, u.name, u.created_at AS "createdAt",
                COALESCE(r.rating, 0) AS rating,
                COALESCE(r.review_count, 0) AS "reviewCount"
         FROM users u
         LEFT JOIN (
             SELECT subject_id, ROUND(AVG(rating)::numeric, 1) AS rating, COUNT(*) AS review_count
             FROM reviews WHERE reported_at IS NULL GROUP BY subject_id
         ) r ON r.subject_id = u.id
         WHERE u.id = $1 AND u.blocked_at IS NULL`,
        [request.params.id]
    );
    if (!user.rowCount) throw new HttpError(404, "Perfil não encontrado.");
    const listings = await pool.query(
        `SELECT id, type, title, category, description, price_cents / 100.0 AS price,
                image_url AS image, created_at AS "createdAt"
         FROM listings WHERE owner_id = $1 AND status = 'published'
         ORDER BY created_at DESC LIMIT 100`,
        [request.params.id]
    );
    const reviews = await pool.query(
        `SELECT r.id, r.rating, r.comment, r.created_at AS "createdAt",
                reviewer.name AS "reviewerName"
         FROM reviews r JOIN users reviewer ON reviewer.id = r.reviewer_id
         WHERE r.subject_id = $1 AND r.reported_at IS NULL
         ORDER BY r.created_at DESC LIMIT 100`,
        [request.params.id]
    );
    response.json({ user: user.rows[0], listings: listings.rows, reviews: reviews.rows });
}));

export default router;
