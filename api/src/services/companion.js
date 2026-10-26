import { createHash } from 'node:crypto';
import { idsForType, getPokemon } from './pokeApi.js';

const REASONS = {
  electric: 'Hay tormenta → tipo Eléctrico',
  ice: 'Hace frío y nieva o hiela → tipo Hielo',
  water: 'Llueve → tipo Agua',
  ghost: 'Hay niebla → tipo Fantasma',
  flying: 'Sopla viento fuerte → tipo Volador',
  fire: 'Hace mucho calor → tipo Fuego',
  grass: 'Día despejado → tipo Planta',
  dark: 'Noche despejada → tipo Siniestro',
  normal: 'Cielo nublado → tipo Normal'
};

const inRange = (c, a, b) => c >= a && c <= b;

// Función pura: clima -> tipo Pokémon (orden de prioridad del diseño).
export function typeForWeather({ code, isDay, tempC, windKmh }) {
  let type;
  if (inRange(code, 95, 99)) type = 'electric';
  else if (inRange(code, 71, 77) || inRange(code, 85, 86) || inRange(code, 66, 67)) type = 'ice';
  else if (inRange(code, 51, 65) || inRange(code, 80, 82)) type = 'water';
  else if (inRange(code, 45, 48)) type = 'ghost';
  else if (windKmh >= 40) type = 'flying';
  else if (inRange(code, 0, 1) && isDay && tempC >= 28) type = 'fire';
  else if (inRange(code, 0, 1) && isDay) type = 'grass';
  else if (inRange(code, 0, 1)) type = 'dark';
  else type = 'normal';
  return { type, reason: REASONS[type] };
}

// Elección determinista por hash(lat, lon, fecha local[, reroll]).
export function pickPokemonId(ids, lat, lon, localDate, reroll = 0) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${localDate}${reroll > 0 ? `|${reroll}` : ''}`;
  const n = createHash('sha256').update(key).digest().readUInt32BE(0);
  return ids[n % ids.length];
}

export async function chooseCompanion({ lat, lon, localDate, current, reroll = 0, signal }) {
  const { type, reason } = typeForWeather(current);
  const ids = await idsForType(type, signal);
  const id = pickPokemonId(ids, lat, lon, localDate, reroll);
  const pokemon = await getPokemon(id, signal);
  return { type, reason, pokemon };
}
