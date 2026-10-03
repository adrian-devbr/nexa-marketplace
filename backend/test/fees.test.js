import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateFeeCents, validateFeeTierSequence } from "../src/fees.js";
import { providerFeeCents } from "../src/routes/payments.js";

describe("cálculo das taxas", () => {
    it("calcula comissão em centavos com arredondamento monetário", () => {
        assert.equal(calculateFeeCents(5000, 1000), 500);
        assert.equal(calculateFeeCents(5001, 800), 400);
        assert.equal(calculateFeeCents(1, 5000), 1);
    });

    it("rejeita valores e porcentagens inválidos", () => {
        assert.throws(() => calculateFeeCents(-1, 1000), RangeError);
        assert.throws(() => calculateFeeCents(5000, 10001), RangeError);
        assert.throws(() => calculateFeeCents(Number.MAX_SAFE_INTEGER + 1, 100), RangeError);
    });

    it("exige faixas completas, ordenadas e sem lacunas", () => {
        assert.equal(validateFeeTierSequence([
            { minCents: 0, maxCents: 5000, rateBasisPoints: 1000 },
            { minCents: 5001, maxCents: null, rateBasisPoints: 800 }
        ]), true);
        assert.equal(validateFeeTierSequence([
            { minCents: 0, maxCents: 5000, rateBasisPoints: 1000 },
            { minCents: 5002, maxCents: null, rateBasisPoints: 800 }
        ]), false);
        assert.equal(validateFeeTierSequence([
            { minCents: 0, maxCents: null, rateBasisPoints: 1000 },
            { minCents: 5001, maxCents: null, rateBasisPoints: 800 }
        ]), false);
    });

    it("soma as tarifas retornadas pelo Mercado Pago em centavos", () => {
        assert.equal(providerFeeCents({
            fee_details: [{ amount: 2.35 }, { amount: 0.25 }]
        }), 260);
        assert.equal(providerFeeCents({
            transaction_amount: 100,
            transaction_details: { net_received_amount: 95.2 }
        }), 480);
        assert.equal(providerFeeCents({ transaction_amount: 100 }), null);
    });
});
