import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";
import { asyncRoute, HttpError, notify } from "../errors.js";

const router = Router();
const routerPublic = Router();
const API_URL = "https://api.mercadopago.com";

export function providerFeeCents(payment) {
    if (Array.isArray(payment.fee_details)) {
        let cents = 0;
        for (const detail of payment.fee_details) {
            const amount = Number(detail.amount);
            if (!Number.isFinite(amount) || amount < 0) return null;
            cents += Math.round(amount * 100);
        }
        return Number.isSafeInteger(cents) ? cents : null;
    }
    const netReceived = Number(payment.transaction_details?.net_received_amount);
    const amount = Number(payment.transaction_amount);
    if (!Number.isFinite(netReceived) || !Number.isFinite(amount)) return null;
    const cents = Math.round((amount - netReceived) * 100);
    return cents >= 0 && Number.isSafeInteger(cents) ? cents : null;
}

async function requestProvider(url, options) {
    try {
        return await fetch(url, {
            ...options,
            signal: AbortSignal.timeout(10000)
        });
    } catch (error) {
        console.error("Falha ao comunicar com o Mercado Pago:", error);
        throw new HttpError(
            error.name === "TimeoutError" ? 504 : 502,
            error.name === "TimeoutError"
                ? "O Mercado Pago demorou demais para responder. Tente novamente."
                : "Não foi possível conectar ao Mercado Pago."
        );
    }
}

export function requireSafeProviderToken() {
    if (process.env.NODE_ENV === "production") {
        throw new HttpError(503,
            "Pagamentos reais permanecem bloqueados até a integração e validação do marketplace com divisão e repasse ao vendedor.");
    }
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
        throw new HttpError(503, "Configure MP_ACCESS_TOKEN para habilitar pagamentos.");
    }
    const isTestToken = token.startsWith("TEST-");
    if (!isTestToken) {
        throw new HttpError(503,
            "O ambiente local aceita somente credenciais de teste TEST- do Mercado Pago.");
    }
}

export function validWebhookSignature(request) {
    const secret = process.env.MP_WEBHOOK_SECRET;
    const signature = request.get("x-signature") ?? "";
    const requestId = request.get("x-request-id") ?? "";
    const paymentId = String(request.query["data.id"] ?? request.body?.data?.id ?? "");
    if (!secret || !signature || !requestId || !paymentId) return false;
    const parts = Object.fromEntries(signature.split(",").map((part) => {
        const [key, value] = part.trim().split("=", 2);
        return [key, value];
    }));
    if (!parts.ts || !parts.v1) return false;
    const manifest = `id:${paymentId};request-id:${requestId};ts:${parts.ts};`;
    const expected = createHmac("sha256", secret).update(manifest).digest("hex");
    const received = Buffer.from(parts.v1, "hex");
    const calculated = Buffer.from(expected, "hex");
    return received.length === calculated.length && timingSafeEqual(received, calculated);
}

routerPublic.post("/webhook", asyncRoute(async (request, response) => {
    if (!validWebhookSignature(request)) {
        throw new HttpError(process.env.MP_WEBHOOK_SECRET ? 401 : 503,
            process.env.MP_WEBHOOK_SECRET
                ? "Assinatura do webhook inválida."
                : "Configure MP_WEBHOOK_SECRET para habilitar webhooks.");
    }
    requireSafeProviderToken();
    const paymentId = String(request.query["data.id"] ?? request.body?.data?.id ?? "");
    const eventKey = `${request.get("x-request-id")}:${paymentId}`;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const recorded = await client.query(
            `INSERT INTO payment_events (provider_event_id) VALUES ($1)
             ON CONFLICT DO NOTHING RETURNING provider_event_id`,
            [eventKey]
        );
        if (!recorded.rowCount) {
            await client.query("ROLLBACK");
            response.status(200).json({ received: true, duplicate: true });
            return;
        }
        const providerResponse = await requestProvider(
            `${API_URL}/v1/payments/${encodeURIComponent(paymentId)}`,
            { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
        );
        if (!providerResponse.ok) {
            throw new HttpError(502, "Não foi possível confirmar o pagamento com o provedor.");
        }
        const payment = await providerResponse.json();
        const stored = await client.query(
            `SELECT p.id, p.amount_cents, p.status AS payment_status,
                    o.id AS order_id, o.buyer_id, o.seller_id, o.status AS order_status,
                    o.platform_fee_cents, l.title
             FROM payments p JOIN orders o ON o.id = p.order_id
             JOIN listings l ON l.id = o.listing_id
             WHERE p.order_id = $1 FOR UPDATE OF p, o`,
            [payment.external_reference]
        );
        if (!stored.rowCount) {
            await client.query("COMMIT");
            response.status(200).json({ received: true, ignored: true });
            return;
        }
        const row = stored.rows[0];
        const providerAmount = Math.round(Number(payment.transaction_amount) * 100);
        if (providerAmount !== Number(row.amount_cents) || payment.currency_id !== "BRL") {
            throw new HttpError(409, "O valor confirmado pelo provedor não corresponde ao pedido.");
        }
        const mappedStatus = {
            approved: "approved",
            rejected: "rejected",
            cancelled: "cancelled",
            refunded: "refunded",
            charged_back: "refunded"
        }[payment.status] ?? "pending";
        const statusChanged = mappedStatus !== row.payment_status;
        const actualProviderFee = mappedStatus === "approved"
            ? providerFeeCents(payment)
            : null;
        await client.query(
            `UPDATE payments SET provider_payment_id = $2, status = $3, updated_at = NOW()
             WHERE id = $1`,
            [row.id, String(payment.id), mappedStatus]
        );
        if (statusChanged && mappedStatus !== "approved") {
            await client.query(
                `INSERT INTO order_status_history (id, order_id, status, details)
                 VALUES ($1, $2, $3, $4)`,
                [
                    randomUUID(),
                    row.order_id,
                    `payment_${mappedStatus}`,
                    `O Mercado Pago informou o status de pagamento: ${mappedStatus}.`
                ]
            );
        }
        if (mappedStatus === "approved") {
            await client.query(
                `UPDATE orders
                 SET provider_fee_cents = $2,
                     seller_net_cents = CASE
                         WHEN $2::bigint IS NULL OR total_cents < platform_fee_cents + $2::bigint
                         THEN NULL
                         ELSE total_cents - platform_fee_cents - $2::bigint
                     END,
                     updated_at = NOW()
                 WHERE id = $1`,
                [row.order_id, actualProviderFee]
            );
        }
        if (mappedStatus === "approved" && row.order_status === "accepted") {
            await client.query(
                "UPDATE orders SET status = 'paid', updated_at = NOW() WHERE id = $1",
                [row.order_id]
            );
            await client.query(
                `INSERT INTO order_status_history (id, order_id, status, details)
                 VALUES ($1, $2, 'paid', 'Pagamento confirmado pelo Mercado Pago.')`,
                [randomUUID(), row.order_id]
            );
        } else if (statusChanged && mappedStatus === "approved") {
            await client.query(
                `INSERT INTO order_status_history (id, order_id, status, details)
                 VALUES ($1, $2, 'payment_approved', $3)`,
                [
                    randomUUID(),
                    row.order_id,
                    "Pagamento confirmado após o pedido já ter sido cancelado ou alterado; requer análise."
                ]
            );
        }
        if (statusChanged) {
            const notificationTitle = mappedStatus === "approved"
                ? "Pagamento confirmado"
                : "Pagamento atualizado";
            const notificationBody = mappedStatus === "approved"
                ? row.order_status === "accepted"
                    ? "O Mercado Pago confirmou o pagamento. O vendedor já pode iniciar a entrega."
                    : "O Mercado Pago confirmou o pagamento, mas o pedido não está aguardando pagamento. A equipe precisa analisar a transação."
                : `O pagamento está ${mappedStatus}.`;
            for (const userId of [row.buyer_id, row.seller_id]) {
                await notify(client, {
                    userId, type: "payment_updated",
                    title: notificationTitle,
                    body: notificationBody,
                    resourceType: "order", resourceId: row.order_id
                });
            }
        }
        await client.query("COMMIT");
        response.status(200).json({ received: true });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}));

router.use(requireAuth);
router.get("/history", asyncRoute(async (request, response) => {
    const result = await pool.query(
        `SELECT p.id, p.provider_payment_id AS "providerPaymentId",
                p.status AS "paymentStatus", p.amount_cents / 100.0 AS amount,
                p.created_at AS "createdAt", o.id AS "orderId",
                o.order_number AS "orderNumber", l.title AS "listingTitle",
                o.platform_fee_rate_basis_points / 100.0 AS "platformFeeRate",
                o.platform_fee_cents / 100.0 AS "platformFee",
                o.provider_fee_cents / 100.0 AS "providerFee",
                o.seller_net_cents / 100.0 AS "sellerNet",
                CASE WHEN o.buyer_id = $1 THEN 'purchase' ELSE 'sale' END AS direction
         FROM payments p JOIN orders o ON o.id = p.order_id
         JOIN listings l ON l.id = o.listing_id
         WHERE o.buyer_id = $1 OR o.seller_id = $1
         ORDER BY p.created_at DESC LIMIT 200`,
        [request.userId]
    );
    response.json({ payments: result.rows });
}));

router.post("/:orderId", asyncRoute(async (request, response) => {
    z.string().uuid().parse(request.params.orderId);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `SELECT o.id, o.buyer_id, o.seller_id, o.total_cents, o.status,
                    l.title, l.type, l.price_cents, o.quantity
             FROM orders o JOIN listings l ON l.id = o.listing_id
             WHERE o.id = $1 AND o.buyer_id = $2
             FOR UPDATE OF o`,
            [request.params.orderId, request.userId]
        );
        if (!result.rowCount) throw new HttpError(404, "Pedido não encontrado.");
        const order = result.rows[0];
        if (order.status !== "accepted") {
            throw new HttpError(409, "O vendedor precisa aceitar o pedido antes do pagamento.");
        }
        requireSafeProviderToken();
        const existing = await client.query(
            "SELECT id, status, checkout_url FROM payments WHERE order_id = $1 FOR UPDATE",
            [order.id]
        );
        if (existing.rowCount && ["pending", "approved"].includes(existing.rows[0].status)) {
            await client.query("COMMIT");
            response.json({
                paymentId: existing.rows[0].id,
                status: existing.rows[0].status,
                checkoutUrl: existing.rows[0].checkout_url
            });
            return;
        }
        const baseUrl = process.env.APP_BASE_URL;
        const checkout = await requestProvider(`${API_URL}/checkout/preferences`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                items: [{
                    id: order.id,
                    title: `${order.title} (quantidade: ${order.quantity})`.slice(0, 250),
                    quantity: 1,
                    unit_price: order.total_cents / 100,
                    currency_id: "BRL"
                }],
                external_reference: order.id,
                notification_url: `${baseUrl}/api/payments/webhook`,
                back_urls: {
                    success: `${baseUrl}/pages/pedido.html?id=${order.id}`,
                    pending: `${baseUrl}/pages/pedido.html?id=${order.id}`,
                    failure: `${baseUrl}/pages/pedido.html?id=${order.id}`
                },
                auto_return: "approved",
                payment_methods: {
                    excluded_payment_types: [],
                    installments: 12
                }
            })
        });
        if (!checkout.ok) {
            const details = await checkout.text();
            console.error("Mercado Pago recusou a criação do checkout:", details);
            throw new HttpError(502, "O provedor não conseguiu criar a cobrança. Tente novamente.");
        }
        const preference = await checkout.json();
        const checkoutUrl = process.env.NODE_ENV === "production"
            ? preference.init_point
            : preference.sandbox_init_point;
        let checkoutHost = "";
        try {
            const parsedCheckoutUrl = new URL(checkoutUrl);
            if (parsedCheckoutUrl.protocol === "https:") {
                checkoutHost = parsedCheckoutUrl.hostname;
            }
        } catch {
            checkoutHost = "";
        }
        if (!preference.id ||
            !["www.mercadopago.com.br", "sandbox.mercadopago.com.br"].includes(checkoutHost)) {
            throw new HttpError(502, "O provedor retornou uma cobrança incompleta.");
        }
        const paymentId = existing.rows[0]?.id ?? randomUUID();
        await client.query(
            `INSERT INTO payments (id, order_id, amount_cents, checkout_url, status)
             VALUES ($1, $2, $3, $4, 'pending')
             ON CONFLICT (order_id) DO UPDATE
             SET amount_cents = EXCLUDED.amount_cents,
                 checkout_url = EXCLUDED.checkout_url,
                 provider_payment_id = NULL,
                 status = 'pending',
                 updated_at = NOW()`,
            [paymentId, order.id, order.total_cents, checkoutUrl]
        );
        await client.query("COMMIT");
        response.status(201).json({ paymentId, status: "pending", checkoutUrl });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}));

export { routerPublic as paymentWebhookRouter };
export default router;
