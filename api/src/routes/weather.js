import { forecast } from '../services/openMeteo.js';
import { chooseCompanion } from '../services/companion.js';
import { describeWeather } from '../lib/wmo.js';
import { schemas } from '../lib/validate.js';

export default async function weatherRoutes(app) {
  app.get('/api/weather', { schema: { querystring: schemas.weatherQuery } }, async (request) => {
    const { lat, lon, reroll } = request.query;
    const name = (request.query.name ?? '').trim();
    const f = await forecast(lat, lon, request.budget);
    const desc = describeWeather(f.current.code, f.current.isDay);
    const companion = await chooseCompanion({
      lat,
      lon,
      localDate: f.localTime.slice(0, 10),
      current: f.current,
      reroll,
      signal: request.budget
    });
    return {
      location: { name, lat: Number(lat.toFixed(2)), lon: Number(lon.toFixed(2)), timezone: f.timezone },
      current: { ...f.current, label: desc.label, icon: desc.icon, theme: desc.theme },
      daily: f.daily,
      companion: { reason: companion.reason, type: companion.type, pokemon: companion.pokemon },
      attribution: {
        weather: 'Datos meteorológicos de Open-Meteo.com (CC BY 4.0)',
        weatherUrl: 'https://open-meteo.com/',
        pokemon: 'Datos de Pokémon de PokéAPI',
        pokemonUrl: 'https://pokeapi.co/'
      }
    };
  });
}
