import type { Config } from "drizzle-kit";
import { config } from "dotenv";

// drizzle-kit runs outside Next.js and only reads .env by default — load .env.local explicitly
config({ path: ".env.local" });

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
