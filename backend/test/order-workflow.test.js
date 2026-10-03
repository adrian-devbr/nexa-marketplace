import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canTransitionOrder } from "../src/order-workflow.js";

describe("fluxo de status dos pedidos", () => {
    it("permite ao vendedor aceitar ou recusar antes do pagamento", () => {
        assert.equal(canTransitionOrder({
            isSeller: true, currentStatus: "pending", nextStatus: "accepted",
            paymentStatus: null
        }), true);
        assert.equal(canTransitionOrder({
            isSeller: true, currentStatus: "pending", nextStatus: "rejected",
            paymentStatus: null
        }), true);
    });

    it("só permite iniciar a entrega depois da confirmação do pagamento", () => {
        assert.equal(canTransitionOrder({
            isSeller: true, currentStatus: "paid", nextStatus: "in_progress",
            paymentStatus: "approved"
        }), true);
        assert.equal(canTransitionOrder({
            isSeller: true, currentStatus: "paid", nextStatus: "in_progress",
            paymentStatus: "pending"
        }), false);
        assert.equal(canTransitionOrder({
            isSeller: true, currentStatus: "in_progress", nextStatus: "ready",
            paymentStatus: "approved"
        }), true);
    });

    it("impede o comprador de cancelar uma cobrança pendente", () => {
        assert.equal(canTransitionOrder({
            isSeller: false, currentStatus: "accepted", nextStatus: "cancelled",
            paymentStatus: "pending"
        }), false);
        assert.equal(canTransitionOrder({
            isSeller: false, currentStatus: "accepted", nextStatus: "cancelled",
            paymentStatus: null
        }), true);
    });
});
