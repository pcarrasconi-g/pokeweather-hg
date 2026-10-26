// Cliente de la API (mismo origen). Nunca se interpreta contenido como HTML.
export class ApiError extends Error {
  constructor(status, code, message, retryAfter = 0) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function request(path, { method = 'GET', params, body, signal } = {}) {
  const url = new URL(path, window.location.origin);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const init = { method, signal, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Sin conexión con el servidor');
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Error inesperado', Number(res.headers.get('Retry-After')) || 0);
  }
  return data;
}

export const geocode = (q, signal) => request('/api/geocode', { params: { q, count: 5 }, signal });
export const weather = ({ lat, lon, name, reroll = 0 }, signal) =>
  request('/api/weather', { params: { lat, lon, name: name ?? '', reroll }, signal });
export const getFriend = () => request('/api/friend');
export const saveFriend = (body) => request('/api/friend', { method: 'PUT', body });
export const releaseFriend = () => request('/api/friend', { method: 'DELETE' });
