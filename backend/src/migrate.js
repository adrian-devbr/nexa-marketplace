import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./db.js";

const schemaPath = fileURLToPath(new URL("../db/schema.sql", import.meta.url));
try {
    const schema = await readFile(schemaPath, "utf8");
    await pool.query(schema);
    console.log("Esquema do PostgreSQL aplicado com sucesso.");
} catch (error) {
    console.error("Não foi possível aplicar o esquema do PostgreSQL:", error);
    process.exitCode = 1;
} finally {
    await pool.end();
}
