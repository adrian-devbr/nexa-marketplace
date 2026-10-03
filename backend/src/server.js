import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { asyncRoute } from "./errors.js";
import authRoutes from "./routes/auth.js";
import listingRoutes from "./routes/listings.js";
import conversationRoutes from "./routes/conversations.js";
import notificationRoutes from "./routes/notifications.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes, { paymentWebhookRouter } from "./routes/payments.js";
import userRoutes from "./routes/users.js";
import adminRoutes from "./routes/admin.js";

if (!process.env.APP_BASE_URL && process.env.RENDER_EXTERNAL_URL) {
    process.env.APP_BASE_URL = process.env.RENDER_EXTERNAL_URL;
}

const requiredConfig = ["DATABASE_URL", "JWT_SECRET", "APP_BASE_URL"];
for (const name of requiredConfig) {
    if (!process.env[name]) {
        throw new Error(`A variável de ambiente ${name} é obrigatória.`);
    }
}
if (process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET precisa ter pelo menos 32 caracteres.");
}
const publicBaseUrl = new URL(process.env.APP_BASE_URL);
if (!["http:", "https:"].includes(publicBaseUrl.protocol) ||
    (process.env.NODE_ENV === "production" && publicBaseUrl.protocol !== "https:")) {
    throw new Error("APP_BASE_URL deve usar HTTP local ou HTTPS em produção.");
}

const app = express();
const port = Number(process.env.PORT ?? 3000);
const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frontendDirectory = path.join(rootDirectory, "frontend");

app.disable("x-powered-by");
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", "https:", "data:"],
            styleSrc: ["'self'"],
            scriptSrc: ["'self'"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));
app.use(cookieParser());
app.use("/api", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false
}));
app.use(express.json({ limit: "32kb", type: "application/json" }));
app.use("/api/payments", paymentWebhookRouter);
app.use("/api/auth", authRoutes);
app.use("/api/listings", rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false
}), listingRoutes);
app.use("/api/conversations", rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false
}), conversationRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/orders", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false
}), orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", asyncRoute(async (_request, response) => {
    await pool.query("SELECT 1");
    response.json({ status: "ok" });
}));

app.use(express.static(frontendDirectory, {
    extensions: ["html"],
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0
}));

app.use("/api", (_request, response) => {
    response.status(404).json({ error: "Rota da API não encontrada." });
});

app.use((error, _request, response, _next) => {
    if (error.name === "ZodError") {
        response.status(400).json({
            error: "Os dados enviados são inválidos.",
            details: error.issues.map(({ path, message }) => ({
                field: path.join("."),
                message
            }))
        });
        return;
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error("Erro na API NEXA:", error);
    response.status(status).json({
        error: status >= 500
            ? "Ocorreu um erro interno. Tente novamente."
            : error.message
    });
});

const server = app.listen(port, () => {
    console.log(`NEXA disponível em ${process.env.APP_BASE_URL} (porta ${port}).`);
});

async function shutdown(signal) {
    console.log(`Recebido ${signal}; encerrando o servidor.`);
    server.close(async (error) => {
        if (error) {
            console.error("Erro ao encerrar o servidor:", error);
            process.exitCode = 1;
        }
        await pool.end();
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
