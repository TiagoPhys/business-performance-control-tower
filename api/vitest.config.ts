import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(`${root}migrations`),
          // Seed produced by the real pipeline from synthetic data (tests/python/build_api_fixture.py).
          TEST_SEED_SQL: readFileSync(`${root}test/fixtures/seed.sql`, "utf8"),
          ALLOWED_ORIGINS: "https://app.example.com,https://*.preview.example.com",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    // Test files reset or seed the shared database in beforeAll, so run them one at a time.
    fileParallelism: false,
  },
}));
