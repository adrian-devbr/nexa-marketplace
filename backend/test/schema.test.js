import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");

describe("esquema do PostgreSQL", () => {
    it("declara todas as entidades principais do marketplace", () => {
        for (const table of [
            "users", "listings", "blocked_users", "conversations", "messages",
            "notifications", "platform_fee_tiers", "listing_reports",
            "orders", "order_status_history", "reviews", "payments", "payment_events"
        ]) {
            assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
        }
    });

    it("registra destinatário, remetente e estado de leitura de cada mensagem", () => {
        const messagesTable = schema.match(
            /CREATE TABLE IF NOT EXISTS messages \(([\s\S]*?)\n\);/
        )?.[1];
        assert.ok(messagesTable);
        assert.match(messagesTable, /sender_id UUID NOT NULL/);
        assert.match(messagesTable, /recipient_id UUID NOT NULL/);
        assert.match(messagesTable, /read_at TIMESTAMPTZ/);
        assert.match(schema, /ADD COLUMN IF NOT EXISTS recipient_id UUID REFERENCES users\(id\)/);
        assert.match(schema, /SET recipient_id = CASE/);
    });

    it("armazena preço unitário e total do pedido em centavos", () => {
        const ordersTable = schema.match(
            /CREATE TABLE IF NOT EXISTS orders \(([\s\S]*?)\n\);/
        )?.[1];
        assert.ok(ordersTable);
        assert.match(ordersTable, /unit_price_cents BIGINT NOT NULL/);
        assert.match(ordersTable, /total_cents BIGINT NOT NULL/);
        assert.match(ordersTable, /platform_fee_cents BIGINT NOT NULL/);
        assert.match(ordersTable, /seller_net_cents BIGINT/);
        assert.match(schema, /UPDATE listings SET status = 'published', updated_at = NOW\(\)\s+WHERE status = 'pending'/);
        assert.match(ordersTable, /'paid'/);
        assert.match(schema, /CREATE TABLE IF NOT EXISTS order_status_history/);
        assert.match(schema, /event_number BIGINT GENERATED ALWAYS AS IDENTITY/);
    });

    it("publica anúncios por padrão e preserva a faixa financeira usada no pedido", () => {
        assert.match(schema, /status VARCHAR\(12\) NOT NULL DEFAULT 'published'/);
        assert.match(schema, /INSERT INTO platform_fee_tiers/);
        assert.match(schema, /platform_fee_rate_basis_points INTEGER NOT NULL/);
        assert.match(schema, /provider_fee_cents BIGINT/);
    });
});
