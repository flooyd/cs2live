// Only used by `yarn auth:schema` to generate src/lib/server/db/auth.schema.ts.
// The real auth config (src/lib/server/auth.ts) imports SvelteKit-only modules, which the
// better-auth CLI cannot load, so this mirrors the options that affect the schema.
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/postgres-js';

export const auth = betterAuth({
	database: drizzleAdapter(drizzle.mock(), { provider: 'pg' }),
	emailAndPassword: { enabled: true }
});
