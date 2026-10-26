import { getPokemon } from '../services/pokeApi.js';
import { schemas } from '../lib/validate.js';

export default async function pokemonRoutes(app) {
  app.get('/api/pokemon/:id', { schema: { params: schemas.pokemonParams } }, async (request) =>
    getPokemon(request.params.id, request.budget)
  );
}
