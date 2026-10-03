import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import {
    requireSafeProviderToken,
    validWebhookSignature
} from "../src/routes/payments.js";

const originalEnvironment = {
    secret: process.env.MP_WEBHOOK_SECRET,
    accessToken: process.env.MP_ACCESS_TOKEN,
    nodeEnv: process.env.NODE_ENV
};

afterEach(() => {
    if (originalEnvironment.secret === undefined) delete process.env.MP_WEBHOOK_SECRET;
    else process.env.MP_WEBHOOK_SECRET = originalEnvironment.secret;
    if (originalEnvironment.accessToken === undefined) delete process.env.MP_ACCESS_TOKEN;
    else process.env.MP_ACCESS_TOKEN = originalEnvironment.accessToken;
    if (originalEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment.nodeEnv;
});

describe("validação dos pagamentos", () => {
    it("aceita somente assinatura HMAC válida para os dados do webhook", () => {
        process.env.MP_WEBHOOK_SECRET = "segredo-de-teste";
        const id = "payment-test-123";
        const requestId = "request-test-456";
        const timestamp = "1780000000";
        const manifest = `id:${id};request-id:${requestId};ts:${timestamp};`;
        const signature = createHmac("sha256", process.env.MP_WEBHOOK_SECRET)
            .update(manifest)
            .digest("hex");
        const request = {
            query: { "data.id": id },
            body: {},
            get: (name) => ({
                "x-signature": `ts=${timestamp},v1=${signature}`,
                "x-request-id": requestId
            })[name]
        };

        assert.equal(validWebhookSignature(request), true);
        assert.equal(validWebhookSignature({
            ...request,
            query: { "data.id": "different-payment" }
        }), false);
    });

    it("nega webhook quando o segredo de assinatura não está configurado", () => {
        delete process.env.MP_WEBHOOK_SECRET;
        assert.equal(validWebhookSignature({ query: {}, body: {}, get: () => "" }), false);
    });

    it("exige token de teste no ambiente de desenvolvimento", () => {
        process.env.NODE_ENV = "development";
        process.env.MP_ACCESS_TOKEN = "APP_USR-real-token";
        assert.throws(requireSafeProviderToken, { status: 503 });
        process.env.MP_ACCESS_TOKEN = "TEST-token";
        assert.doesNotThrow(requireSafeProviderToken);
    });

    it("explica quando o checkout local não tem credenciais", () => {
        process.env.NODE_ENV = "development";
        delete process.env.MP_ACCESS_TOKEN;
        assert.throws(requireSafeProviderToken, /Configure MP_ACCESS_TOKEN/);
    });

    it("bloqueia pagamentos reais enquanto o repasse de marketplace não estiver integrado", () => {
        process.env.NODE_ENV = "production";
        process.env.MP_ACCESS_TOKEN = "TEST-token";
        assert.throws(requireSafeProviderToken, { status: 503 });
        process.env.MP_ACCESS_TOKEN = "APP_USR-production-token";
        assert.throws(requireSafeProviderToken, /repasse ao vendedor/);
    });
});
