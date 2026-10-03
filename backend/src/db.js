import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: true }
        : undefined
});

pool.on("error", (error) => {
    console.error("Erro inesperado no pool do PostgreSQL:", error);
});
