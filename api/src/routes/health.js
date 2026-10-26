export default async function healthRoutes(app) {
  app.get('/api/health', { config: { rateLimit: false } }, async (request, reply) => {
    try {
      await app.db.query('SELECT 1');
      return { status: 'ok', db: 'up' };
    } catch {
      return reply.code(503).send({ status: 'error', db: 'down' });
    }
  });
}
