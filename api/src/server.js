import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { loadConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { AppError } from './lib/http.js';
import healthRoutes from './routes/health.js';
import geocodeRoutes from './routes/geocode.js';
import weatherRoutes from './routes/weather.js';
import pokemonRoutes from './routes/pokemon.js';
import friendRoutes from './routes/friend.js';

const MESSAGES = {
  400: ['bad_request', 'Solicitud inválida'],
  403: ['forbidden', 'Origen no permitido'],
  404: ['not_found', 'Recurso no encontrado'],
  413: ['payload_too_large', 'Cuerpo demasiado grande'],
  415: ['unsupported_media_type', 'Se requiere Content-Type: application/json'],
  429: ['rate_limited', 'Demasiadas solicitudes, inténtalo de nuevo en un momento']
};

export async function buildApp({ config = loadConfig(), db, logger = true } = {}) {
  const app = Fastify({
    logger: logger
      ? {
          level: config.logLevel,
          redact: ['req.headers.cookie', 'req.headers.authorization'],
          // No registrar query string (contiene coordenadas).
          serializers: { req: (r) => ({ method: r.method, url: String(r.url).split('?')[0] }) }
        }
      : false,
    trustProxy: true,
    bodyLimit: 2048,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: true, useDefaults: true, allErrors: false } }
  });
  app.decorate('cfg', config);
  app.decorate('db', db);
  app.decorateRequest('budget', null);

  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    strictTransportSecurity: false, // la API va tras nginx en HTTP; HSTS solo tiene sentido en el borde HTTPS
    xFrameOptions: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' }
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.global,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      retryAfter: Math.max(1, Math.ceil(ctx.ttl / 1000))
    })
  });

  // Presupuesto total de tiempo para llamadas upstream de esta petición.
  app.addHook('onRequest', async (request) => {
    request.budget = AbortSignal.timeout(config.requestBudgetMs);
  });

  // CSRF: Origin debe coincidir con Host y PUT exige application/json.
  app.addHook('onRequest', async (request) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin !== undefined) {
      let ok = false;
      try {
        ok = new URL(origin).host === request.headers.host;
      } catch {
        ok = false;
      }
      if (!ok) throw new AppError(403, 'forbidden', 'Origen no permitido');
    }
    if (request.method === 'PUT' && !String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      throw new AppError(415, 'unsupported_media_type', MESSAGES[415][1]);
    }
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'not_found', message: MESSAGES[404][1] } }));

  app.setErrorHandler((err, request, reply) => {
    let status = 500;
    let code = 'internal_error';
    let message = 'Error interno';
    if (err instanceof AppError) {
      ({ status, code } = err);
      message = err.message;
    } else if (err.validation) {
      status = 400;
      [code, message] = MESSAGES[400];
    } else if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      status = err.statusCode;
      [code, message] = MESSAGES[status] ?? MESSAGES[400];
      if (!MESSAGES[status]) status = 400;
    } else {
      request.log.error({ err: { name: err.name, code: err.code } }, 'error no controlado');
    }
    if (status >= 500 && err instanceof AppError) request.log.warn({ code, status, detail: err.detail }, 'fallo upstream');
    if (status === 429) reply.header('Retry-After', String(err.retryAfter ?? 60));
    return reply.code(status).send({ error: { code, message } });
  });

  await app.register(healthRoutes);
  await app.register(geocodeRoutes);
  await app.register(weatherRoutes);
  await app.register(pokemonRoutes);
  await app.register(friendRoutes);


  return app;
}

async function main() {
  const config = loadConfig();
  const db = createPool();
  const app = await buildApp({ config, db });
  await migrate(db, config.migrationsDir, app.log);
  await app.listen({ port: config.port, host: config.host });
  const stop = async () => {
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('fallo al arrancar:', err?.message);
    process.exit(1);
  });
}
