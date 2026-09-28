/**
 * The mobile app type-imports the API router from @template/web, so the
 * server modules are type-checked from this package too. Those modules read
 * server-only env vars, declared here by merging into NodeJS.ProcessEnv
 * (the template-managed __env.d.ts covers the client-side ones).
 */
declare namespace NodeJS {
  interface ProcessEnv {
    DATABASE_URL?: string;
    DATABASE_AUTH_TOKEN?: string;
    BETTER_AUTH_SECRET?: string;
    AI_GATEWAY_BASE_URL?: string;
    AI_GATEWAY_API_KEY?: string;
    ADMIN_EMAILS?: string;
    CRON_SECRET?: string;
    DISABLE_CRON?: string;
  }
}
