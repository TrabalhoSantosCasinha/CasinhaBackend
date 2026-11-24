// Previsão do tempo pela Open-Meteo (https://open-meteo.com): grátis, sem chave e sem cadastro.
// Só a latitude/longitude da cidade escolhida é enviada.
import { HttpError } from './fiware.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new HttpError(502, `Open-Meteo respondeu ${res.status}`);
  return res.json();
}

// Próximas `hours` horas: probabilidade de chuva (%) e quantidade (mm) por hora, mais o tempo agora.
export async function getForecast(latitude, longitude, hours = 12) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'precipitation,rain,weather_code,temperature_2m',
    hourly: 'precipitation_probability,precipitation,weather_code',
    forecast_hours: String(hours),
    timezone: 'America/Sao_Paulo',
  });
  const data = await getJson(`${FORECAST_URL}?${params}`);
  const h = data.hourly ?? {};
  return {
    current: {
      time: data.current?.time ?? null,
      precipitation: data.current?.precipitation ?? null,
      weatherCode: data.current?.weather_code ?? null,
      temperature: data.current?.temperature_2m ?? null,
    },
    hourly: (h.time ?? []).map((time, i) => ({
      time,
      probability: h.precipitation_probability?.[i] ?? null,
      precipitation: h.precipitation?.[i] ?? null,
      weatherCode: h.weather_code?.[i] ?? null,
    })),
  };
}

// Busca cidades pelo nome (para escolher onde fica a "casa")
export async function searchCities(name) {
  const params = new URLSearchParams({ name, count: '5', language: 'pt', format: 'json' });
  const data = await getJson(`${GEOCODING_URL}?${params}`);
  return (data.results ?? []).map((c) => ({
    name: c.name,
    region: [c.admin1, c.country].filter(Boolean).join(', '),
    latitude: c.latitude,
    longitude: c.longitude,
  }));
}
