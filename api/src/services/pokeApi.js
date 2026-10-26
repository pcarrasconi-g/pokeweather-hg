import { AppError, buildUrl, fetchJson } from '../lib/http.js';
import { TtlCache } from './cache.js';

const BASE = 'https://pokeapi.co/api/v2/';
const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
export const MAX_ID = 386;
export const TYPES = new Set([
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'
]);

export const typeCache = new TtlCache({ max: 50, ttlMs: 24 * 3600_000 });
export const pokemonCache = new TtlCache({ max: 500, ttlMs: 24 * 3600_000 });

// Lista ordenada de ids (<= 386) de un tipo.
export async function idsForType(type, signal) {
  if (!TYPES.has(type)) throw new AppError(400, 'bad_request', 'Tipo inválido');
  return typeCache.wrap(type, async () => {
    const data = await fetchJson(buildUrl(BASE, `type/${type}`), { signal });
    const ids = (data?.pokemon ?? [])
      .map((p) => Number(String(p?.pokemon?.url ?? '').match(/\/pokemon\/(\d+)\/?$/)?.[1]))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_ID);
    const uniq = [...new Set(ids)].sort((a, b) => a - b);
    if (uniq.length === 0) throw new AppError(502, 'upstream_error', 'Respuesta de PokéAPI inválida');
    return uniq;
  });
}

export function displayName(name) {
  return String(name)
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

export async function getPokemon(id, signal) {
  if (!Number.isInteger(id) || id < 1 || id > MAX_ID) throw new AppError(404, 'not_found', 'Pokémon no encontrado');
  return pokemonCache.wrap(String(id), async () => {
    const d = await fetchJson(buildUrl(BASE, `pokemon/${id}`), { signal });
    const types = (d?.types ?? []).map((t) => t?.type?.name).filter((t) => TYPES.has(t));
    if (typeof d?.name !== 'string' || types.length === 0) {
      throw new AppError(502, 'upstream_error', 'Respuesta de PokéAPI inválida');
    }
    return {
      id,
      name: d.name,
      displayName: displayName(d.name),
      types,
      // URLs construidas por nosotros (host fijo), no tomadas de la respuesta.
      spriteUrl: `${SPRITES}${id}.png`,
      artworkUrl: `${SPRITES}other/official-artwork/${id}.png`,
      heightM: Number.isFinite(d.height) ? d.height / 10 : null,
      weightKg: Number.isFinite(d.weight) ? d.weight / 10 : null
    };
  });
}
