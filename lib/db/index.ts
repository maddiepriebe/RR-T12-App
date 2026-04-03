import * as schema from "./schema";

export * from "./schema";

// Lazy-initialize so the module can be imported at build time without DATABASE_URL
let _db: ReturnType<typeof import("drizzle-orm/neon-http").drizzle> | null = null;

export function getDb() {
  if (!_db) {
    const { neon } = require("@neondatabase/serverless");
    const { drizzle } = require("drizzle-orm/neon-http");
    const sql = neon(process.env.DATABASE_URL!);
    _db = drizzle(sql, { schema });
  }
  return _db!;
}

// Convenience re-export for direct usage — only call in route handlers, not at module scope
export { schema };
