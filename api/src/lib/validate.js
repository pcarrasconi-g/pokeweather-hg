// Esquemas JSON (additionalProperties:false) y validación de apodo.
export const NICKNAME_RE = /^[\p{L}\p{N} _'.-]+$/u;
export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_RE = /[\p{Cc}\p{Cf}\p{Cs}]/u;

export function normalizeNickname(value) {
  if (typeof value !== 'string') return { ok: false };
  const v = value.normalize('NFC').trim();
  if (v.length < 1 || [...v].length > 24 || !NICKNAME_RE.test(v)) return { ok: false };
  return { ok: true, value: v };
}

export function normalizeLocation(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const v = value.normalize('NFC').trim();
  if ([...v].length > 80 || CONTROL_RE.test(v)) return { ok: false };
  return { ok: true, value: v === '' ? null : v };
}

export const schemas = {
  geocodeQuery: {
    type: 'object',
    required: ['q'],
    additionalProperties: false,
    properties: {
      q: { type: 'string', minLength: 2, maxLength: 80 },
      count: { type: 'integer', minimum: 1, maximum: 8, default: 5 }
    }
  },
  weatherQuery: {
    type: 'object',
    required: ['lat', 'lon'],
    additionalProperties: false,
    properties: {
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lon: { type: 'number', minimum: -180, maximum: 180 },
      name: { type: 'string', maxLength: 80 },
      reroll: { type: 'integer', minimum: 0, maximum: 20, default: 0 }
    }
  },
  pokemonParams: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'integer', minimum: 1, maximum: 386 } }
  },
  friendBody: {
    type: 'object',
    required: ['pokemonId', 'nickname'],
    additionalProperties: false,
    properties: {
      pokemonId: { type: 'integer', minimum: 1, maximum: 386 },
      nickname: { type: 'string', minLength: 1, maxLength: 24 },
      caughtLocation: { type: ['string', 'null'], maxLength: 120 }
    }
  }
};
