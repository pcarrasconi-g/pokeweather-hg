import { AppError, buildUrl, fetchJson } from '../lib/http.js';
import { TtlCache } from './cache.js';

const GEO_BASE = 'https://geocoding-api.open-meteo.com/v1/';
const FORECAST_BASE = 'https://api.open-meteo.com/v1/';

export const geocodeCache = new TtlCache({ max: 500, ttlMs: 24 * 3600_000 });
export const weatherCache = new TtlCache({ max: 500, ttlMs: 10 * 60_000 });

export async function geocode(q, count, signal) {
  const key = `${q.toLowerCase()}|${count}`;
  return geocodeCache.wrap(key, async () => {
    const url = buildUrl(GEO_BASE, 'search', { name: q, count: String(count), language: 'es', format: 'json' });
    const data = await fetchJson(url, { signal });
    const list = Array.isArray(data?.results) ? data.results : [];
    return list
      .filter((r) => Number.isFinite(r?.latitude) && Number.isFinite(r?.longitude))
      .slice(0, count)
      .map((r) => ({
        id: Number(r.id) || 0,
        name: String(r.name ?? ''),
        admin1: r.admin1 ? String(r.admin1) : null,
        country: r.country ? String(r.country) : null,
        countryCode: r.country_code ? String(r.country_code) : null,
        lat: r.latitude,
        lon: r.longitude,
        timezone: r.timezone ? String(r.timezone) : null
      }));
  });
}

// Coordenadas redondeadas a 2 decimales para la caché (y para la consulta).
export async function forecast(lat, lon, signal) {
  const la = lat.toFixed(2);
  const lo = lon.toFixed(2);
  return weatherCache.wrap(`${la},${lo}`, async () => {
    const url = buildUrl(FORECAST_BASE, 'forecast', {
      latitude: la,
      longitude: lo,
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '3',
      wind_speed_unit: 'kmh'
    });
    const d = await fetchJson(url, { signal });
    const c = d?.current;
    const dd = d?.daily;
    if (!c || !dd || !Array.isArray(dd.time) || typeof c.temperature_2m !== 'number') {
      throw new AppError(502, 'upstream_error', 'Respuesta meteorológica inválida');
    }
    return {
      timezone: d.timezone ? String(d.timezone) : null,
      localTime: String(c.time),
      current: {
        tempC: c.temperature_2m,
        apparentC: c.apparent_temperature,
        humidity: c.relative_humidity_2m,
        windKmh: c.wind_speed_10m,
        code: c.weather_code,
        isDay: c.is_day === 1
      },
      daily: dd.time.map((date, i) => ({
        date,
        minC: dd.temperature_2m_min?.[i] ?? null,
        maxC: dd.temperature_2m_max?.[i] ?? null,
        code: dd.weather_code?.[i] ?? 0,
        precipProb: dd.precipitation_probability_max?.[i] ?? null
      }))
    };
  });
}
