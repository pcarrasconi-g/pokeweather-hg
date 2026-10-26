// Cliente HTTP saliente: hosts fijos, solo https, timeout y tope de tamaño.
export class AppError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail; // solo para logs internos; nunca se envía al cliente
  }
}

export const UPSTREAM_HOSTS = new Set([
  'geocoding-api.open-meteo.com',
  'api.open-meteo.com',
  'pokeapi.co'
]);

// La entrada del usuario solo entra por URLSearchParams / segmentos validados.
export function buildUrl(base, path, params = {}) {
  const url = new URL(path, base);
  url.search = new URLSearchParams(params).toString();
  return url;
}

// Un reintento (con pausa corta) ante fallos transitorios: red o HTTP 429/5xx. Respeta el presupuesto global.
export async function fetchJson(url, opts = {}) {
  try {
    return await fetchJsonOnce(url, opts);
  } catch (err) {
    if (!(err instanceof AppError) || !err.transient || opts.signal?.aborted) throw err;
    await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 250));
    return fetchJsonOnce(url, opts);
  }
}

async function fetchJsonOnce(url, { timeoutMs = 5000, maxBytes = 2_000_000, signal } = {}) {
  const u = url instanceof URL ? url : new URL(url);
  if (u.protocol !== 'https:' || !UPSTREAM_HOSTS.has(u.hostname)) {
    throw new AppError(502, 'upstream_error', 'Servicio externo no disponible');
  }
  let res;
  try {
    res = await fetch(u, {
      // Timeout por llamada + presupuesto global de la petición (lo que venza antes).
      signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
      redirect: 'error',
      headers: { accept: 'application/json', 'user-agent': 'PokeWeather/1.0 (fan project, non-commercial)' }
    });
    if (!res.ok) {
      await res.body?.cancel?.();
      const e = new AppError(502, 'upstream_error', 'Servicio externo no disponible', `http ${res.status} ${u.hostname}`);
      e.transient = res.status === 429 || res.status >= 500;
      throw e;
    }
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new AppError(502, 'upstream_error', 'Respuesta externa demasiado grande');
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AppError(502, 'upstream_error', 'Respuesta externa demasiado grande');
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new AppError(504, 'upstream_timeout', 'El servicio externo tardó demasiado');
    }
    const e = new AppError(502, 'upstream_error', 'Servicio externo no disponible', `${err?.name ?? 'Error'} ${err?.cause?.code ?? err?.code ?? ''} ${u.hostname}`.trim());
    e.transient = !(err instanceof SyntaxError);
    throw e;
  }
}
