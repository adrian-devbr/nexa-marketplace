import jwt from "jsonwebtoken";
import { HttpError } from "./errors.js";
import { pool } from "./db.js";

const COOKIE_NAME = "nexa_session";

export function setSessionCookie(response, userId) {
    const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
        expiresIn: "7d",
        issuer: "nexa"
    });
    response.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000
    });
}

export function clearSessionCookie(response) {
    response.clearCookie(COOKIE_NAME, { path: "/", sameSite: "strict" });
}

export function requireAuth(request, response, next) {
    const token = request.cookies[COOKIE_NAME];
    if (!token) {
        return next(new HttpError(401, "Entre na sua conta para continuar."));
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: "nexa" });
        if (typeof payload === "string" || typeof payload.sub !== "string") {
            throw new Error("Token inválido.");
        }
        request.userId = payload.sub;
        next();
    } catch {
        clearSessionCookie(response);
        next(new HttpError(401, "Sua sessão expirou. Entre novamente."));
    }
}

export function requireAdmin(request, response, next) {
    requireAuth(request, response, async (error) => {
        if (error) return next(error);
        try {
            const result = await pool.query(
                "SELECT 1 FROM users WHERE id = $1 AND role = 'admin' AND blocked_at IS NULL",
                [request.userId]
            );
            if (!result.rowCount) {
                return next(new HttpError(403, "Acesso restrito à administração."));
            }
            next();
        } catch (queryError) {
            next(queryError);
        }
    });
}
