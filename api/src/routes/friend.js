import { randomUUID } from 'node:crypto';
import { getPokemon } from '../services/pokeApi.js';
import { AppError } from '../lib/http.js';
import { normalizeLocation, normalizeNickname, schemas, UUID_V4_RE } from '../lib/validate.js';

const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';

function toFriend(r) {
  return {
    pokemonId: r.pokemon_id,
    name: r.pokemon_name,
    displayName: r.pokemon_name
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' '),
    types: r.types,
    spriteUrl: r.sprite_url,
    artworkUrl: `${SPRITES}other/official-artwork/${r.pokemon_id}.png`,
    nickname: r.nickname,
    caughtLocation: r.caught_location,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at
  };
}

export default async function friendRoutes(app) {
  const { cookieName, cookieMaxAgeSec } = app.cfg;
  const writeLimit = { rateLimit: { max: app.cfg.rateLimit.friendWrite, timeWindow: '1 minute' } };
  const validCid = (request) => {
    const v = request.cookies?.[cookieName];
    return typeof v === 'string' && UUID_V4_RE.test(v) ? v.toLowerCase() : null;
  };

  app.get('/api/friend', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const cid = validCid(request);
    if (!cid) return { friend: null };
    const { rows } = await app.db.query('SELECT * FROM friends WHERE client_id = $1', [cid]);
    return { friend: rows[0] ? toFriend(rows[0]) : null };
  });

  app.put(
    '/api/friend',
    { schema: { body: schemas.friendBody }, config: writeLimit },
    async (request, reply) => {
      const nick = normalizeNickname(request.body.nickname);
      const loc = normalizeLocation(request.body.caughtLocation);
      if (!nick.ok || !loc.ok) throw new AppError(400, 'bad_request', 'Apodo o ubicación inválidos');
      // Solo se confía en pokemonId: nombre, tipos y sprite salen de PokéAPI/caché.
      const p = await getPokemon(request.body.pokemonId, request.budget);
      let cid = validCid(request);
      if (!cid) {
        cid = randomUUID();
        reply.setCookie(cookieName, cid, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: cookieMaxAgeSec,
          secure: request.protocol === 'https'
        });
      }
      const { rows } = await app.db.query(
        `INSERT INTO friends (client_id, pokemon_id, pokemon_name, types, sprite_url, nickname, caught_location)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (client_id) DO UPDATE SET
           pokemon_id = EXCLUDED.pokemon_id, pokemon_name = EXCLUDED.pokemon_name, types = EXCLUDED.types,
           sprite_url = EXCLUDED.sprite_url, nickname = EXCLUDED.nickname,
           caught_location = EXCLUDED.caught_location, updated_at = now()
         RETURNING *`,
        [cid, p.id, p.name, p.types, p.spriteUrl, nick.value, loc.value]
      );
      reply.header('Cache-Control', 'no-store');
      return { friend: toFriend(rows[0]) };
    }
  );

  app.delete('/api/friend', { config: writeLimit }, async (request, reply) => {
    const cid = validCid(request);
    if (cid) await app.db.query('DELETE FROM friends WHERE client_id = $1', [cid]);
    return reply.code(204).send();
  });
}
