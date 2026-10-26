// Configuración leída del entorno. Sin secretos en el código.
export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    host: env.HOST || '0.0.0.0',
    logLevel: env.LOG_LEVEL || 'info',
    migrationsDir: env.MIGRATIONS_DIR || new URL('../migrations', import.meta.url).pathname,
    upstreamTimeoutMs: 5000,
    // Presupuesto total por petición (menor que proxy_read_timeout de nginx = 20s).
    requestBudgetMs: 12000,
    upstreamMaxBytes: 2_000_000,
    maxPokemonId: 386,
    cookieName: 'pw_cid',
    cookieMaxAgeSec: 60 * 60 * 24 * 365,
    rateLimit: { global: 60, geocode: 20, friendWrite: 20 }
  };
}
