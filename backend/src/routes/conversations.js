import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";
import { asyncRoute, HttpError, notify } from "../errors.js";

const router = Router();
const messageInput = z.object({
    body: z.string().trim().min(1).max(2000)
        .transform((value) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""))
        .refine((value) => value.length > 0, "A mensagem está vazia.")
});

router.use(requireAuth);

router.get("/blocked", asyncRoute(async (request, response) => {
    const result = await pool.query(
        `SELECT DISTINCT ON (blocked.id) blocked.id AS "userId",
                blocked.name AS "userName", c.id AS "conversationId"
         FROM blocked_users b
         JOIN users blocked ON blocked.id = b.blocked_id
         JOIN conversations c ON
            (c.buyer_id = b.blocker_id AND c.seller_id = b.blocked_id)
            OR (c.seller_id = b.blocker_id AND c.buyer_id = b.blocked_id)
         WHERE b.blocker_id = $1
         ORDER BY blocked.id, c.updated_at DESC`,
        [request.userId]
    );
    response.json({ blockedUsers: result.rows });
}));

router.get("/", asyncRoute(async (request, response) => {
    const result = await pool.query(
        `SELECT c.id, c.listing_id AS "listingId", l.title AS "listingTitle",
                l.image_url AS "listingImage", l.price_cents / 100.0 AS "listingPrice",
                other.id AS "otherUserId", other.name AS "otherUserName",
                m.body AS "lastMessage", m.created_at AS "lastMessageAt",
                (SELECT COUNT(*)::int FROM messages unread
                 WHERE unread.conversation_id = c.id AND unread.sender_id <> $1
                   AND unread.recipient_id = $1 AND unread.read_at IS NULL) AS "unreadCount"
         FROM conversations c
         JOIN listings l ON l.id = c.listing_id
         JOIN users other ON other.id = CASE WHEN c.buyer_id = $1 THEN c.seller_id ELSE c.buyer_id END
         LEFT JOIN LATERAL (
             SELECT body, created_at FROM messages
             WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
         ) m ON TRUE
         WHERE (c.buyer_id = $1 AND NOT c.deleted_by_buyer)
            OR (c.seller_id = $1 AND NOT c.deleted_by_seller)
         ORDER BY COALESCE(m.created_at, c.created_at) DESC`,
        [request.userId]
    );
    response.json({ conversations: result.rows });
}));

router.post("/", asyncRoute(async (request, response) => {
    const input = z.object({ listingId: z.string().uuid() }).parse(request.body);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const listing = await client.query(
            `SELECT l.id, l.owner_id, l.title FROM listings l
             JOIN users seller ON seller.id = l.owner_id
             WHERE l.id = $1 AND l.status = 'published' AND seller.blocked_at IS NULL`,
            [input.listingId]
        );
        if (!listing.rowCount) throw new HttpError(404, "Anúncio não encontrado.");
        if (listing.rows[0].owner_id === request.userId) {
            throw new HttpError(400, "Você não pode iniciar uma conversa consigo mesmo.");
        }
        const blocked = await client.query(
            `SELECT 1 FROM blocked_users
             WHERE (blocker_id = $1 AND blocked_id = $2)
                OR (blocker_id = $2 AND blocked_id = $1)`,
            [request.userId, listing.rows[0].owner_id]
        );
        if (blocked.rowCount) throw new HttpError(403, "Não é possível conversar com esta pessoa.");
        const id = randomUUID();
        const inserted = await client.query(
            `INSERT INTO conversations (id, listing_id, buyer_id, seller_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (listing_id, buyer_id, seller_id)
             DO UPDATE SET deleted_by_buyer = FALSE, deleted_by_seller = FALSE
             RETURNING id`,
            [id, input.listingId, request.userId, listing.rows[0].owner_id]
        );
        await client.query("COMMIT");
        response.status(201).json({ id: inserted.rows[0].id });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}));

router.get("/:id/messages", asyncRoute(async (request, response) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const conversation = await client.query(
            `SELECT c.id, c.listing_id AS "listingId",
                    l.title AS "listingTitle", l.image_url AS "listingImage",
                    l.price_cents / 100.0 AS "listingPrice",
                    other.id AS "otherUserId", other.name AS "otherUserName",
                    EXISTS (
                        SELECT 1 FROM blocked_users b
                        WHERE (b.blocker_id = $2 AND b.blocked_id = other.id)
                           OR (b.blocker_id = other.id AND b.blocked_id = $2)
                    ) AS "isBlocked"
             FROM conversations c JOIN listings l ON l.id = c.listing_id
             JOIN users other ON other.id = CASE WHEN c.buyer_id = $2 THEN c.seller_id ELSE c.buyer_id END
             WHERE c.id = $1
               AND ((c.buyer_id = $2 AND NOT c.deleted_by_buyer)
                 OR (c.seller_id = $2 AND NOT c.deleted_by_seller))`,
            [request.params.id, request.userId]
        );
        if (!conversation.rowCount) throw new HttpError(404, "Conversa não encontrada.");
        await client.query(
            `UPDATE messages SET read_at = NOW()
             WHERE conversation_id = $1 AND recipient_id = $2 AND read_at IS NULL`,
            [request.params.id, request.userId]
        );
        const messages = await client.query(
            `SELECT id, sender_id AS "senderId", recipient_id AS "recipientId", body,
                    created_at AS "createdAt", read_at AS "readAt"
             FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
            [request.params.id]
        );
        await client.query("COMMIT");
        response.json({ conversation: conversation.rows[0], messages: messages.rows });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}));

router.post("/:id/messages", asyncRoute(async (request, response) => {
    const input = messageInput.parse(request.body);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const conversation = await client.query(
            `SELECT c.id, c.buyer_id, c.seller_id, c.listing_id, l.title,
                    c.deleted_by_buyer, c.deleted_by_seller
             FROM conversations c JOIN listings l ON l.id = c.listing_id
             WHERE c.id = $1 AND (c.buyer_id = $2 OR c.seller_id = $2)
             FOR UPDATE OF c`,
            [request.params.id, request.userId]
        );
        if (!conversation.rowCount) throw new HttpError(404, "Conversa não encontrada.");
        const row = conversation.rows[0];
        const receiverId = row.buyer_id === request.userId ? row.seller_id : row.buyer_id;
        const alreadyDeleted = row.buyer_id === request.userId
            ? row.deleted_by_buyer
            : row.deleted_by_seller;
        if (alreadyDeleted) throw new HttpError(404, "Conversa não encontrada.");
        const blocked = await client.query(
            `SELECT 1 FROM blocked_users
             WHERE (blocker_id = $1 AND blocked_id = $2)
                OR (blocker_id = $2 AND blocked_id = $1)`,
            [request.userId, receiverId]
        );
        if (blocked.rowCount) throw new HttpError(403, "Não é possível enviar mensagens para esta pessoa.");
        const recent = await client.query(
            `SELECT COUNT(*)::int AS count FROM messages
             WHERE sender_id = $1 AND created_at > NOW() - INTERVAL '1 minute'`,
            [request.userId]
        );
        if (recent.rows[0].count >= 20) {
            throw new HttpError(429, "Você enviou mensagens demais. Aguarde um minuto.");
        }
        const id = randomUUID();
        await client.query(
            `INSERT INTO messages (id, conversation_id, sender_id, recipient_id, body)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, request.params.id, request.userId, receiverId, input.body]
        );
        await client.query(
            `UPDATE conversations SET
                deleted_by_buyer = CASE WHEN buyer_id = $2 THEN FALSE ELSE deleted_by_buyer END,
                deleted_by_seller = CASE WHEN seller_id = $2 THEN FALSE ELSE deleted_by_seller END,
                updated_at = NOW()
             WHERE id = $1`,
            [request.params.id, receiverId]
        );
        await notify(client, {
            userId: receiverId, type: "new_message", title: "Nova mensagem",
            body: `Nova mensagem sobre “${row.title}”.`,
            resourceType: "conversation", resourceId: request.params.id
        });
        await client.query("COMMIT");
        response.status(201).json({
            message: {
                id, senderId: request.userId, recipientId: receiverId,
                body: input.body, createdAt: new Date().toISOString()
            }
        });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}));

router.delete("/:id", asyncRoute(async (request, response) => {
    const result = await pool.query(
        `UPDATE conversations SET
            deleted_by_buyer = CASE WHEN buyer_id = $2 THEN TRUE ELSE deleted_by_buyer END,
            deleted_by_seller = CASE WHEN seller_id = $2 THEN TRUE ELSE deleted_by_seller END
         WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)
         RETURNING id`,
        [request.params.id, request.userId]
    );
    if (!result.rowCount) throw new HttpError(404, "Conversa não encontrada.");
    response.status(204).end();
}));

router.post("/:id/block", asyncRoute(async (request, response) => {
    const conversation = await pool.query(
        `SELECT buyer_id, seller_id FROM conversations
         WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)`,
        [request.params.id, request.userId]
    );
    if (!conversation.rowCount) throw new HttpError(404, "Conversa não encontrada.");
    const { buyer_id: buyerId, seller_id: sellerId } = conversation.rows[0];
    const blockedId = buyerId === request.userId ? sellerId : buyerId;
    await pool.query(
        `INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [request.userId, blockedId]
    );
    response.status(204).end();
}));

router.delete("/:id/block", asyncRoute(async (request, response) => {
    const conversation = await pool.query(
        `SELECT buyer_id, seller_id FROM conversations
         WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)`,
        [request.params.id, request.userId]
    );
    if (!conversation.rowCount) throw new HttpError(404, "Conversa não encontrada.");
    const { buyer_id: buyerId, seller_id: sellerId } = conversation.rows[0];
    const blockedId = buyerId === request.userId ? sellerId : buyerId;
    await pool.query(
        "DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2",
        [request.userId, blockedId]
    );
    response.status(204).end();
}));

export default router;
