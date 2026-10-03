import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? process.env.DATABASE_SSL_MODE === "require"
            ? { rejectUnauthorized: false }
            : { rejectUnauthorized: true }
        : undefined
});

pool.on("error", (error) => {
    console.error("Erro inesperado no pool do PostgreSQL:", error);
});
