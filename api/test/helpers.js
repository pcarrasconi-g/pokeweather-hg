import { buildApp } from '../src/server.js';

// Fetch simulado de upstream: sin red real en tests.
export function installFetchMock(overrides = {}) {
  const calls = [];
  const original = globalThis.fetch;
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    calls.push(u);
    const key = `${u.hostname}${u.pathname}`;
    if (overrides[key]) return overrides[key](u, json, init);
    if (key === 'geocoding-api.open-meteo.com/v1/search') {
      return json({
        results: [
          { id: 3117735, name: 'Madrid', admin1: 'Madrid', country: 'España', country_code: 'ES', latitude: 40.4165, longitude: -3.7026, timezone: 'Europe/Madrid' }
        ]
      });
    }
    if (key === 'api.open-meteo.com/v1/forecast') {
      return json({
        timezone: 'Europe/Madrid',
        current: { time: '2026-10-26T15:00', temperature_2m: 18.2, apparent_temperature: 17, relative_humidity_2m: 60, weather_code: 61, wind_speed_10m: 10, is_day: 1 },
        daily: {
          time: ['2026-10-26', '2026-10-27', '2026-10-28'],
          weather_code: [61, 3, 0],
          temperature_2m_max: [19, 20, 22],
          temperature_2m_min: [10, 11, 12],
          precipitation_probability_max: [80, 20, 0]
        }
      });
    }
    let m = key.match(/^pokeapi\.co\/api\/v2\/type\/(\w+)$/);
    if (m) {
      return json({
        pokemon: [
          { pokemon: { name: 'squirtle', url: 'https://pokeapi.co/api/v2/pokemon/7/' } },
          { pokemon: { name: 'psyduck', url: 'https://pokeapi.co/api/v2/pokemon/54/' } },
          { pokemon: { name: 'alt-form', url: 'https://pokeapi.co/api/v2/pokemon/10050/' } },
          { pokemon: { name: 'gen5', url: 'https://pokeapi.co/api/v2/pokemon/501/' } }
        ]
      });
    }
    m = key.match(/^pokeapi\.co\/api\/v2\/pokemon\/(\d+)$/);
    if (m) {
      return json({ name: m[1] === '7' ? 'squirtle' : 'psyduck', height: 5, weight: 90, types: [{ type: { name: 'water' } }] });
    }
    return json({}, 404);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

// BD falsa en memoria que entiende las consultas de friend.js / health.
export function fakeDb() {
  const rows = new Map();
  return {
    rows,
    async query(sql, params = []) {
      if (/^SELECT 1/.test(sql)) return { rows: [{ '?column?': 1 }] };
      if (/^SELECT \* FROM friends/.test(sql)) return { rows: rows.has(params[0]) ? [rows.get(params[0])] : [] };
      if (/^INSERT INTO friends/.test(sql)) {
        const [cid, id, name, types, sprite, nick, loc] = params;
        const prev = rows.get(cid);
        const now = new Date();
        const row = { client_id: cid, pokemon_id: id, pokemon_name: name, types, sprite_url: sprite, nickname: nick, caught_location: loc, created_at: prev?.created_at ?? now, updated_at: now };
        rows.set(cid, row);
        return { rows: [row] };
      }
      if (/^DELETE FROM friends/.test(sql)) {
        rows.delete(params[0]);
        return { rows: [] };
      }
      throw new Error(`SQL no esperado: ${sql}`);
    }
  };
}

export async function makeApp(opts = {}) {
  const db = opts.db ?? fakeDb();
  const config = {
    port: 0, host: '127.0.0.1', logLevel: 'silent', upstreamTimeoutMs: 5000, requestBudgetMs: opts.requestBudgetMs ?? 12000, upstreamMaxBytes: 2_000_000,
    maxPokemonId: 386, cookieName: 'pw_cid', cookieMaxAgeSec: 31536000,
    rateLimit: opts.rateLimit ?? { global: 1000, geocode: 1000, friendWrite: 1000 }
  };
  const app = await buildApp({ config, db, logger: false });
  return { app, db };
}
