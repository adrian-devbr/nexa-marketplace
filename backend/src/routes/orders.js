import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { calculateFeeCents } from "../fees.js";
import { canTransitionOrder } from "../order-workflow.js";
import { requireAuth } from "../auth.js";
import { asyncRoute, HttpError, notify } from "../errors.js";

const router = Router();
const statusLabels = {
    pending: "Pendente",
    accepted: "Aceito",
    paid: "Pago",
    in_progress: "Em andamento",
    ready: "Disponível",
    completed: "Concluído",
    cancelled: "Cancelado",
    rejected: "Recusado"
};
router.use(requireAuth);

router.post("/", asyncRoute(async (request, response) => {
    const input = z.object({
        listingId: z.string().uuid(),
        quantity: z.number().int().min(1).max(1000)
    }).parse(request.body);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const listing = await client.query(
            `SELECT l.id, l.owner_id, l.title, l.type, l.price_cents
             FROM listings l JOIN users u ON u.id = l.owner_id
             WHERE l.id = $1 AND l.status = 'published' AND u.blocked_at IS NULL
             FOR UPDATE OF l`,
            [input.listingId]
        );
        if (!listing.rowCount) throw new HttpError(404, "Anúncio não encontrado.");
        const item = listing.rows[0];
        if (item.owner_id === request.userId) {
            throw new HttpError(400, "Você não pode fazer um pedido no seu próprio anúncio.");
        }
        const id = randomUUID();
        const total = Number(item.price_cents) * input.quantity;
        if (!Number.isSafeInteger(total)) throw new HttpError(400, "Quantidade inválida.");
        const feeTier = await client.query(
            `SELECT id, rate_basis_points
             FROM platform_fee_tiers
             WHERE min_cents <= $1 AND (max_cents IS NULL OR max_cents >= $1)
               AND (listing_type IS NULL OR listing_type = $2)
               AND (seller_id IS NULL OR seller_id = $3)
               AND (starts_at IS NULL OR starts_at <= NOW())
               AND (ends_at IS NULL OR ends_at > NOW())
             ORDER BY (seller_id IS NOT NULL) DESC,
                      (listing_type IS NOT NULL) DESC,
                      starts_at DESC NULLS LAST
             LIMIT 1
             FOR KEY SHARE`,
            [total, item.type, item.owner_id]
        );
        if (!feeTier.rowCount) {
            throw new HttpError(503, "Não há uma faixa de taxa configurada para este pedido.");
        }
        const platformFeeRate = Number(feeTier.rows[0].rate_basis_points);
        const platformFee = calculateFeeCents(total, platformFeeRate);
        await client.query(
            `INSERT INTO orders
                (id, listing_id, buyer_id, seller_id, quantity, unit_price_cents,
                 total_cents, fee_tier_id, platform_fee_rate_basis_points,
                 platform_fee_cents, seller_net_cents)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)`,
            [id, item.id, request.userId, item.owner_id, input.quantity,
                item.price_cents, total, feeTier.rows[0].id, platformFeeRate, platformFee]
        );
        await client.query(
            `INSERT INTO order_status_history (id, order_id, status, actor_id, details)
             VALUES ($1, $2, 'pending', $3, 'Pedido criado; aguardando resposta do vendedor.')`,
            [randomUUID(), id, request.userId]
        );
        await notify(client, {
            userId: item.owner_id, type: "new_order", title: "Novo pedido recebido",
            body: `Você recebeu um pedido de “${item.title}”.`,
            resourceType: "order", resourceId: id
        });
        await client.query("COMMIT");
        response.status(201).json({
            order: {
                id, status: "pending", quantity: input.quantity, totalCents: total,
                platformFeeCents: platformFee,
                platformFeeRateBasisPoints: platformFeeRate,
                sellerNetBeforeProviderFeeCents: total - platformFee
            }
        });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}));

router.get("/", asyncRoute(async (request, response) => {
    const result = await pool.query(
        `SELECT o.id, o.order_number AS "orderNumber", o.status, o.quantity,
                o.unit_price_cents / 100.0 AS "unitPrice",
                o.total_cents / 100.0 AS total, o.created_at AS "createdAt",
                l.id AS "listingId", l.title AS "listingTitle",
                o.platform_fee_rate_basis_points / 100.0 AS "platformFeeRate",
                o.platform_fee_cents / 100.0 AS "platformFee",
                o.provider_fee_cents / 100.0 AS "providerFee",
                o.seller_net_cents / 100.0 AS "sellerNet",
                buyer.id = $1 AS "isBuyer",
                other.id AS "otherUserId", other.name AS "otherUserName",
                p.status AS "paymentStatus"
         FROM orders o JOIN listings l ON l.id = o.listing_id
         JOIN users other ON other.id = CASE WHEN o.buyer_id = $1 THEN o.seller_id ELSE o.buyer_id END
         JOIN users buyer ON buyer.id = o.buyer_id
         LEFT JOIN payments p ON p.order_id = o.id
         WHERE o.buyer_id = $1 OR o.seller_id = $1
         ORDER BY o.created_at DESC`,
        [request.userId]
    );
    response.json({ orders: result.rows });
}));

router.get("/:id", asyncRoute(async (request, response) => {
    z.string().uuid().parse(request.params.id);
    const result = await pool.query(
        `SELECT o.id, o.order_number AS "orderNumber", o.status, o.quantity,
                o.unit_price_cents / 100.0 AS "unitPrice",
                o.total_cents / 100.0 AS total, o.created_at AS "createdAt",
                o.updated_at AS "updatedAt", o.buyer_id AS "buyerId",
                o.seller_id AS "sellerId", l.id AS "listingId",
                l.title AS "listingTitle", l.image_url AS "listingImage",
                o.platform_fee_rate_basis_points / 100.0 AS "platformFeeRate",
                o.platform_fee_cents / 100.0 AS "platformFee",
                o.provider_fee_cents / 100.0 AS "providerFee",
                o.seller_net_cents / 100.0 AS "sellerNet",
                buyer.name AS "buyerName", seller.name AS "sellerName",
                p.id AS "paymentId", p.status AS "paymentStatus",
                p.checkout_url AS "checkoutUrl",
                p.amount_cents / 100.0 AS "paymentAmount",
                own_review.id AS "ownReviewId"
         FROM orders o JOIN listings l ON l.id = o.listing_id
         JOIN users buyer ON buyer.id = o.buyer_id
         JOIN users seller ON seller.id = o.seller_id
         LEFT JOIN payments p ON p.order_id = o.id
         LEFT JOIN reviews own_review ON own_review.order_id = o.id
            AND own_review.reviewer_id = $2
         WHERE o.id = $1 AND (o.buyer_id = $2 OR o.seller_id = $2)`,
        [request.params.id, request.userId]
    );
    if (!result.rowCount) throw new HttpError(404, "Pedido não encontrado.");
    response.json({ order: result.rows[0] });
}));

router.get("/:id/history", asyncRoute(async (request, response) => {
    z.string().uuid().parse(request.params.id);
    const order = await pool.query(
        "SELECT id FROM orders WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)",
        [request.params.id, request.userId]
    );
    if (!order.rowCount) throw new HttpError(404, "Pedido não encontrado.");
    const history = await pool.query(
        `SELECT status, details, created_at AS "createdAt"
         FROM order_status_history WHERE order_id = $1
         ORDER BY created_at ASC, event_number ASC`,
        [request.params.id]
    );
    response.json({ history: history.rows });
}));

router.patch("/:id/status", asyncRoute(async (request, response) => {
    z.string().uuid().parse(request.params.id);
    const input = z.object({
        status: z.enum(["accepted", "in_progress", "ready", "completed", "cancelled", "rejected"])
    }).parse(request.body);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const current = await client.query(
            `SELECT o.*, l.title, p.status AS payment_status
             FROM orders o JOIN listings l ON l.id = o.listing_id
             LEFT JOIN payments p ON p.order_id = o.id
             WHERE o.id = $1 AND (o.buyer_id = $2 OR o.seller_id = $2)
             FOR UPDATE OF o`,
            [request.params.id, request.userId]
        );
        if (!current.rowCount) throw new HttpError(404, "Pedido não encontrado.");
        const order = current.rows[0];
        const seller = order.seller_id === request.userId;
        if (!canTransitionOrder({
            isSeller: seller,
            currentStatus: order.status,
            nextStatus: input.status,
            paymentStatus: order.payment_status
        })) {
            throw new HttpError(409, "Essa alteração não é permitida para este pedido.");
        }
        const result = await client.query(
            `UPDATE orders SET status = $2, updated_at = NOW()
             WHERE id = $1 RETURNING id, status`,
            [order.id, input.status]
        );
        if (input.status === "accepted") {
            await client.query(
                `INSERT INTO order_status_history (id, order_id, status, actor_id, details)
                 VALUES
                    ($1, $2, 'accepted', $3, 'Vendedor aceitou o pedido.'),
                    ($4, $2, 'awaiting_payment', $3, 'Aguardando o comprador pagar pelo Mercado Pago.')`,
                [randomUUID(), order.id, request.userId, randomUUID()]
            );
        } else {
            const details = input.status === "rejected"
                ? "O vendedor recusou o pedido."
                : input.status === "cancelled"
                    ? "O pedido foi cancelado."
                    : input.status === "in_progress"
                        ? "O vendedor iniciou o atendimento após a confirmação do pagamento."
                        : input.status === "ready"
                            ? "O vendedor marcou o pedido como disponível."
                            : "O pedido foi concluído.";
            await client.query(
                `INSERT INTO order_status_history (id, order_id, status, actor_id, details)
                 VALUES ($1, $2, $3, $4, $5)`,
                [randomUUID(), order.id, input.status, request.userId, details]
            );
        }
        const recipientId = seller ? order.buyer_id : order.seller_id;
        const label = statusLabels[input.status];
        await notify(client, {
            userId: recipientId, type: "order_updated",
            title: input.status === "accepted" ? "Pedido aceito — aguardando pagamento" : `Pedido ${label.toLocaleLowerCase("pt-BR")}`,
            body: input.status === "accepted"
                ? `O vendedor aceitou “${order.title}”. Agora você pode pagar pelo Mercado Pago.`
                : input.status === "rejected"
                    ? `O vendedor recusou o pedido de “${order.title}”. Nenhuma cobrança foi feita.`
                    : input.status === "in_progress"
                        ? `O vendedor iniciou o atendimento do pedido “${order.title}”.`
                        : `O pedido de “${order.title}” foi atualizado para ${label.toLocaleLowerCase("pt-BR")}.`,
            resourceType: "order", resourceId: order.id
        });
        await client.query("COMMIT");
        response.json({ order: result.rows[0] });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}));

router.post("/:id/reviews", asyncRoute(async (request, response) => {
    z.string().uuid().parse(request.params.id);
    const input = z.object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().trim().max(1000).default("")
    }).parse(request.body);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const orderResult = await client.query(
            `SELECT * FROM orders WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)
             FOR UPDATE`,
            [request.params.id, request.userId]
        );
        if (!orderResult.rowCount) throw new HttpError(404, "Pedido não encontrado.");
        const order = orderResult.rows[0];
        if (order.status !== "completed") {
            throw new HttpError(409, "Só é possível avaliar depois da conclusão do pedido.");
        }
        const subjectId = order.buyer_id === request.userId
            ? order.seller_id
            : order.buyer_id;
        const id = randomUUID();
        await client.query(
            `INSERT INTO reviews (id, order_id, reviewer_id, subject_id, rating, comment)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, order.id, request.userId, subjectId, input.rating, input.comment]
        );
        await notify(client, {
            userId: subjectId, type: "review_received",
            title: "Você recebeu uma avaliação",
            body: `Uma nova avaliação de ${input.rating} estrela${input.rating === 1 ? "" : "s"} foi publicada.`,
            resourceType: "order", resourceId: order.id
        });
        await client.query("COMMIT");
        response.status(201).json({ id });
    } catch (error) {
        await client.query("ROLLBACK");
        if (error.code === "23505") {
            throw new HttpError(409, "Você já avaliou este pedido.");
        }
        throw error;
    } finally {
        client.release();
    }
}));

router.post("/reviews/:id/report", asyncRoute(async (request, response) => {
    const result = await pool.query(
        `UPDATE reviews SET reported_at = COALESCE(reported_at, NOW())
         WHERE id = $1 AND reported_at IS NULL RETURNING id`,
        [request.params.id]
    );
    if (!result.rowCount) throw new HttpError(404, "Avaliação não encontrada.");
    const admins = await pool.query("SELECT id FROM users WHERE role = 'admin' AND blocked_at IS NULL");
    await Promise.all(admins.rows.map((admin) => notify(pool, {
        userId: admin.id, type: "review_reported",
        title: "Avaliação denunciada",
        body: "Uma avaliação foi denunciada e precisa de análise.",
        resourceType: "review", resourceId: request.params.id
    })));
    response.status(204).end();
}));

export default router;
