import { defineConfig } from 'drizzle-kit';

// drizzle-kit does not read .env on its own.
try {
	process.loadEnvFile('.env');
} catch {
	// No .env file; rely on the real environment.
}

// Migrations should run over Neon's *direct* (unpooled) endpoint: PgBouncer's transaction mode
// on the pooled endpoint breaks session-level features migrations can rely on. Neon's Vercel
// integration exposes the direct URL as DATABASE_URL_UNPOOLED; fall back to DATABASE_URL.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url },
	verbose: true,
	strict: true
});
