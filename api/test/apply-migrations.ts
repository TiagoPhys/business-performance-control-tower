import { applyD1Migrations, env } from "cloudflare:test";

// Idempotent: already-applied migrations are skipped.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
