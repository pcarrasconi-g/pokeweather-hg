import { geocode } from '../services/openMeteo.js';
import { schemas } from '../lib/validate.js';
import { AppError } from '../lib/http.js';

export default async function geocodeRoutes(app) {
  app.get(
    '/api/geocode',
    { schema: { querystring: schemas.geocodeQuery }, config: { rateLimit: { max: app.cfg.rateLimit.geocode, timeWindow: '1 minute' } } },
    async (request) => {
      const q = request.query.q.trim();
      if (q.length < 2) throw new AppError(400, 'bad_request', 'Parámetros inválidos');
      return { results: await geocode(q, request.query.count, request.budget) };
    }
  );
}
