import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";
import { asyncRoute, HttpError } from "../errors.js";

const router = Router();
router.use(requireAuth);

router.get("/", asyncRoute(async (request, response) => {
    const result = await pool.query(
        `SELECT id, type, title, body, resource_type AS "resourceType",
                resource_id AS "resourceId", created_at AS "createdAt",
                read_at AS "readAt"
         FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [request.userId]
    );
    const unread = await pool.query(
        "SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL",
        [request.userId]
    );
    response.json({ notifications: result.rows, unreadCount: unread.rows[0].count });
}));

router.patch("/read-all", asyncRoute(async (request, response) => {
    await pool.query(
        "UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL",
        [request.userId]
    );
    response.status(204).end();
}));

router.patch("/:id/read", asyncRoute(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const result = await pool.query(
        `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
         WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, request.userId]
    );
    if (!result.rowCount) throw new HttpError(404, "Notificação não encontrada.");
    response.status(204).end();
}));

export default router;
