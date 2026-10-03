import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");

describe("esquema do PostgreSQL", () => {
    it("declara todas as entidades principais do marketplace", () => {
        for (const table of [
            "users", "listings", "blocked_users", "conversations", "messages",
            "notifications", "orders", "reviews", "payments", "payment_events"
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
    });
});
