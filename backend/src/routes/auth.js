import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../db.js";
import { clearSessionCookie, requireAuth, setSessionCookie } from "../auth.js";
import { asyncRoute, HttpError } from "../errors.js";

const router = Router();
const credentialRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false
});
const credentials = z.object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    password: z.string().min(8).max(128)
        .refine((value) => Buffer.byteLength(value, "utf8") <= 72,
            "A senha não pode exceder 72 bytes.")
});

router.post("/register", credentialRateLimit, asyncRoute(async (request, response) => {
    const input = credentials.extend({ name: z.string().trim().min(1).max(60) })
        .parse(request.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
    const role = adminEmails.includes(input.email) ? "admin" : "user";
    const result = await pool.query(
        `INSERT INTO users (id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, name, email, role`,
        [randomUUID(), input.name, input.email, passwordHash, role]
    );

    if (!result.rowCount) {
        throw new HttpError(409, "Já existe uma conta com este e-mail.");
    }

    setSessionCookie(response, result.rows[0].id);
    response.status(201).json({ user: result.rows[0] });
}));

router.post("/login", credentialRateLimit, asyncRoute(async (request, response) => {
    const input = credentials.parse(request.body);
    const result = await pool.query(
        `SELECT id, name, email, role, password_hash, blocked_at
         FROM users WHERE email = $1`,
        [input.email]
    );
    const user = result.rows[0];

    if (!user || user.blocked_at || !(await bcrypt.compare(input.password, user.password_hash))) {
        throw new HttpError(401, "E-mail ou senha incorretos.");
    }

    setSessionCookie(response, user.id);
    response.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

router.post("/logout", (request, response) => {
    clearSessionCookie(response);
    response.status(204).end();
});

router.get("/me", requireAuth, asyncRoute(async (request, response) => {
    const result = await pool.query(
        `SELECT id, name, email, role, created_at FROM users WHERE id = $1 AND blocked_at IS NULL`,
        [request.userId]
    );

    if (!result.rowCount) {
        throw new HttpError(401, "Esta conta não está disponível.");
    }
    response.json({ user: result.rows[0] });
}));

router.patch("/me", requireAuth, asyncRoute(async (request, response) => {
    const input = z.object({ name: z.string().trim().min(1).max(60) }).parse(request.body);
    const result = await pool.query(
        "UPDATE users SET name = $2 WHERE id = $1 AND blocked_at IS NULL RETURNING id, name, email, role",
        [request.userId, input.name]
    );

    if (!result.rowCount) {
        throw new HttpError(404, "Conta não encontrada.");
    }
    response.json({ user: result.rows[0] });
}));

export default router;
