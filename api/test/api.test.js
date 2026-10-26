import test from 'node:test';
import assert from 'node:assert/strict';
import { installFetchMock, makeApp } from './helpers.js';
import { weatherCache, geocodeCache } from '../src/services/openMeteo.js';
import { pokemonCache, typeCache } from '../src/services/pokeApi.js';

const CID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const clear = () => [weatherCache, geocodeCache, pokemonCache, typeCache].forEach((c) => c.map.clear());
const json = { 'content-type': 'application/json' };

test('GET /api/health', async () => {
  const { app } = await makeApp();
  const r = await app.inject('/api/health');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { status: 'ok', db: 'up' });
});

test('geocode: ok, cabeceras de seguridad y validación 400', async (t) => {
  clear();
  const m = installFetchMock();
  t.after(m.restore);
  const { app } = await makeApp();
  const r = await app.inject('/api/geocode?q=Madrid');
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().results[0].countryCode, 'ES');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  const up = m.calls[0];
  assert.equal(up.hostname, 'geocoding-api.open-meteo.com');
  assert.equal(up.searchParams.get('language'), 'es');
  for (const q of ['?q=a', '?', `?q=${'x'.repeat(81)}`, '?q=Madrid&count=9', '?q=Madrid&count=0', '?q=Madrid&extra=1', '?q=Madrid&count=abc']) {
    const bad = await app.inject(`/api/geocode${q}`);
    assert.equal(bad.statusCode, 400, q);
    assert.equal(bad.json().error.code, 'bad_request');
  }
});

test('geocode: payloads SQLi/XSS no producen 500 y viajan solo como parámetro', async (t) => {
  clear();
  const m = installFetchMock();
  t.after(m.restore);
  const { app } = await makeApp();
  for (const q of ["'; DROP TABLE friends;--", '<script>alert(1)</script>', '../../etc/passwd', 'a&host=evil.com']) {
    const r = await app.inject({ method: 'GET', url: '/api/geocode', query: { q } });
    assert.ok(r.statusCode < 500, q);
  }
  for (const u of m.calls) assert.equal(u.hostname, 'geocoding-api.open-meteo.com');
});

test('weather: forma de respuesta, tipo Agua con lluvia, cacheado', async (t) => {
  clear();
  const m = installFetchMock();
  t.after(m.restore);
  const { app } = await makeApp();
  const r = await app.inject('/api/weather?lat=40.4165&lon=-3.7026&name=Madrid');
  assert.equal(r.statusCode, 200);
  const b = r.json();
  assert.equal(b.current.theme, 'day-rain');
  assert.equal(b.current.isDay, true);
  assert.ok(b.daily.length >= 3);
  assert.match(b.companion.reason, /Agua/);
  assert.equal(b.companion.pokemon.types[0], 'water');
  assert.ok([7, 54].includes(b.companion.pokemon.id)); // 10050 y 501 filtrados
  assert.match(b.companion.pokemon.spriteUrl, /^https:\/\/raw\.githubusercontent\.com\//);
  assert.ok(b.attribution.weather.includes('CC BY 4.0'));
  const forecasts = () => m.calls.filter((u) => u.pathname.endsWith('/forecast')).length;
  await app.inject('/api/weather?lat=40.4199&lon=-3.7001&name=Madrid&reroll=3');
  assert.equal(forecasts(), 1); // coords a 2 decimales -> misma entrada de caché
});

test('weather: validación', async (t) => {
  clear();
  t.after(installFetchMock().restore);
  const { app } = await makeApp();
  for (const q of ['', '?lat=91&lon=0', '?lat=0&lon=181', '?lat=abc&lon=0', '?lat=1&lon=1&reroll=21', '?lat=1&lon=1&reroll=-1', '?lat=1&lon=1&x=1', `?lat=1&lon=1&name=${'x'.repeat(81)}`]) {
    assert.equal((await app.inject(`/api/weather${q}`)).statusCode, 400, q);
  }
});

test('weather: errores upstream -> 502 y 504 sin filtrar internos', async (t) => {
  clear();
  t.after(installFetchMock({
    'api.open-meteo.com/v1/forecast': () => new Response('boom secret-host.internal', { status: 500 })
  }).restore);
  const { app } = await makeApp();
  const r = await app.inject('/api/weather?lat=1&lon=1');
  assert.equal(r.statusCode, 502);
  assert.ok(!JSON.stringify(r.json()).includes('secret'));
  assert.equal(r.json().error.code, 'upstream_error');
});

test('weather: timeout upstream -> 504', async (t) => {
  clear();
  t.after(installFetchMock({
    'api.open-meteo.com/v1/forecast': () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }
  }).restore);
  const { app } = await makeApp();
  const r = await app.inject('/api/weather?lat=2&lon=2');
  assert.equal(r.statusCode, 504);
});

test('pokemon: id válido, fuera de rango y no numérico', async (t) => {
  clear();
  t.after(installFetchMock().restore);
  const { app } = await makeApp();
  const ok = await app.inject('/api/pokemon/7');
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().heightM, 0.5);
  assert.equal(ok.json().weightKg, 9);
  for (const id of ['0', '387', 'abc', '1.5', '-1']) assert.equal((await app.inject(`/api/pokemon/${id}`)).statusCode, 400, id);
  assert.equal((await app.inject('/api/nope')).statusCode, 404);
});

test('friend: ciclo completo con cookie, upsert y delete', async (t) => {
  clear();
  t.after(installFetchMock().restore);
  const { app, db } = await makeApp();
  assert.deepEqual((await app.inject('/api/friend')).json(), { friend: null });

  const put = await app.inject({ method: 'PUT', url: '/api/friend', headers: json, payload: { pokemonId: 7, nickname: '  Squirt  ', caughtLocation: 'Madrid, España' } });
  assert.equal(put.statusCode, 200);
  const setCookie = put.headers['set-cookie'];
  assert.match(setCookie, /pw_cid=[0-9a-f-]{36}/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//);
  assert.doesNotMatch(setCookie, /Secure/i);
  const cid = /pw_cid=([^;]+)/.exec(setCookie)[1];
  assert.match(cid, /^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  assert.equal(put.json().friend.nickname, 'Squirt');
  assert.equal(put.json().friend.name, 'squirtle');

  const get = await app.inject({ method: 'GET', url: '/api/friend', cookies: { pw_cid: cid } });
  assert.equal(get.json().friend.nickname, 'Squirt');

  const up = await app.inject({ method: 'PUT', url: '/api/friend', headers: json, cookies: { pw_cid: cid }, payload: { pokemonId: 54, nickname: 'Psy' } });
  assert.equal(up.statusCode, 200);
  assert.equal(up.headers['set-cookie'], undefined);
  assert.equal(db.rows.size, 1);
  assert.equal(up.json().friend.caughtLocation, null);

  const del = await app.inject({ method: 'DELETE', url: '/api/friend', cookies: { pw_cid: cid } });
  assert.equal(del.statusCode, 204);
  assert.equal(db.rows.size, 0);
});

test('friend: el servidor ignora/rechaza nombre, tipos y sprite del cliente', async (t) => {
  clear();
  t.after(installFetchMock().restore);
  const { app, db } = await makeApp();
  const r = await app.inject({ method: 'PUT', url: '/api/friend', headers: json, payload: { pokemonId: 7, nickname: 'Ok', name: 'hack', types: ['x'], spriteUrl: 'https://evil' } });
  assert.equal(r.statusCode, 400);
  assert.equal(db.rows.size, 0);
});

test('friend: validación (SQLi/XSS/rango/formato) -> 400 y nunca 500', async (t) => {
  clear();
  t.after(installFetchMock().restore);
  const { app, db } = await makeApp();
  const bodies = [
    { pokemonId: 7, nickname: "x'; DROP TABLE friends;--" },
    { pokemonId: 7, nickname: '<img src=x onerror=alert(1)>' },
    { pokemonId: 7, nickname: '' },
    { pokemonId: 7, nickname: '   ' },
    { pokemonId: 7, nickname: 'a'.repeat(25) },
    { pokemonId: 0, nickname: 'Ok' },
    { pokemonId: 387, nickname: 'Ok' },
    { pokemonId: 7.5, nickname: 'Ok' },
    { pokemonId: 7 },
    { nickname: 'Ok' },
    { pokemonId: 7, nickname: 'Ok', caughtLocation: 'x'.repeat(81) },
    { pokemonId: 7, nickname: 'Ok', caughtLocation: 'a\u0000b' },
    { pokemonId: 7, nickname: ['a'] },
    {}
  ];
  for (const payload of bodies) {
    const r = await app.inject({ method: 'PUT', url: '/api/friend', headers: json, payload });
    assert.equal(r.statusCode, 400, JSON.stringify(payload));
    assert.equal(r.json().error.code, 'bad_request');
  }
  const bad = await app.inject({ method: 'PUT', url: '/api/friend', headers: json, payload: '{"pokemonId":' });
  assert.equal(bad.statusCode, 400);
  assert.equal(db.rows.size, 0);
});

test('friend: 415 sin application/json y 403 con Origin ajeno', async (t) => {
  clear();
  t.after(installFetchMock().restore);
  const { app } = await makeApp();
  const r415 = await app.inject({ method: 'PUT', url: '/api/friend', headers: { 'content-type': 'text/plain' }, payload: '{"pokemonId":7,"nickname":"Ok"}' });
  assert.equal(r415.statusCode, 415);
  assert.equal(r415.json().error.code, 'unsupported_media_type');
  const r415b = await app.inject({ method: 'PUT', url: '/api/friend', payload: '{"pokemonId":7,"nickname":"Ok"}' });
  assert.equal(r415b.statusCode, 415);
  const r403 = await app.inject({ method: 'PUT', url: '/api/friend', headers: { ...json, origin: 'https://evil.example', host: 'pokeweather.local' }, payload: { pokemonId: 7, nickname: 'Ok' } });
  assert.equal(r403.statusCode, 403);
  const del403 = await app.inject({ method: 'DELETE', url: '/api/friend', headers: { origin: 'https://evil.example', host: 'pokeweather.local' } });
  assert.equal(del403.statusCode, 403);
  const same = await app.inject({ method: 'PUT', url: '/api/friend', headers: { ...json, origin: 'http://pokeweather.local', host: 'pokeweather.local' }, payload: { pokemonId: 7, nickname: 'Ok' } });
  assert.equal(same.statusCode, 200);
});

test('friend: cookie inválida se ignora; Secure con https', async (t) => {
  clear();
  t.after(installFetchMock().restore);
  const { app } = await makeApp();
  const g = await app.inject({ method: 'GET', url: '/api/friend', cookies: { pw_cid: "'; DROP TABLE friends;--" } });
  assert.equal(g.statusCode, 200);
  const r = await app.inject({ method: 'PUT', url: '/api/friend', headers: { ...json, 'x-forwarded-proto': 'https' }, cookies: { pw_cid: 'not-a-uuid' }, payload: { pokemonId: 7, nickname: 'Ok' } });
  assert.match(r.headers['set-cookie'], /Secure/i);
  assert.notEqual(/pw_cid=([^;]+)/.exec(r.headers['set-cookie'])[1], 'not-a-uuid');
});

test('rate limit: 429 con Retry-After y formato de error', async (t) => {
  clear();
  t.after(installFetchMock().restore);
  const { app } = await makeApp({ rateLimit: { global: 100, geocode: 2, friendWrite: 100 } });
  const codes = [];
  let last;
  for (let i = 0; i < 4; i++) {
    last = await app.inject('/api/geocode?q=Madrid');
    codes.push(last.statusCode);
  }
  assert.deepEqual(codes, [200, 200, 429, 429]);
  assert.ok(Number(last.headers['retry-after']) >= 1);
  assert.equal(last.json().error.code, 'rate_limited');
});

test('presupuesto global: upstream colgado -> 504 upstream_timeout en JSON antes del timeout de nginx', async (t) => {
  clear();
  // El upstream nunca responde; solo termina cuando se aborta la señal que le pasa la API.
  t.after(installFetchMock({
    'api.open-meteo.com/v1/forecast': (_u, _j, init) =>
      new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)))
  }).restore);
  const { app } = await makeApp({ requestBudgetMs: 200 });
  const t0 = Date.now();
  const r = await app.inject('/api/weather?lat=7&lon=7');
  assert.equal(r.statusCode, 504);
  assert.equal(r.json().error.code, 'upstream_timeout');
  assert.ok(Date.now() - t0 < 2000, 'debe cortar por presupuesto (200 ms), no por el timeout por llamada (5 s)');
});

test('presupuesto global: llamadas encadenadas lentas no superan el presupuesto', async (t) => {
  clear();
  const base = installFetchMock();
  const ok = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    await new Promise((res, rej) => {
      const id = setTimeout(res, 120);
      init.signal.addEventListener('abort', () => { clearTimeout(id); rej(init.signal.reason); });
    });
    return ok(url, init);
  };
  t.after(base.restore);
  const { app } = await makeApp({ requestBudgetMs: 250 }); // forecast(120)+type(120)+pokemon(120) > 250
  const t0 = Date.now();
  const r = await app.inject('/api/weather?lat=8&lon=8');
  assert.equal(r.statusCode, 504);
  assert.equal(r.json().error.code, 'upstream_timeout');
  assert.ok(Date.now() - t0 < 1500);
});

test('cabeceras de /api: CSP estricta, sin HSTS, X-Frame-Options DENY, sin duplicados', async (t) => {
  clear();
  t.after(installFetchMock().restore);
  const { app } = await makeApp();
  const r = await app.inject('/api/health');
  assert.equal(r.headers['content-security-policy'], "default-src 'none';frame-ancestors 'none'");
  assert.equal(r.headers['strict-transport-security'], undefined);
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('apodo de 25 caracteres rechazado por el esquema (maxLength 24), 24 aceptado, comillas dobles rechazadas', async (t) => {
  clear();
  t.after(installFetchMock().restore);
  const { app } = await makeApp();
  const put = (nickname) => app.inject({ method: 'PUT', url: '/api/friend', headers: json, payload: { pokemonId: 7, nickname } });
  assert.equal((await put('a'.repeat(25))).statusCode, 400);
  assert.equal((await put('a'.repeat(24))).statusCode, 200);
  assert.equal((await put('Say "hi"')).statusCode, 400);
  assert.equal((await put("O'Neil")).statusCode, 200);
});

test('upstream: un fallo transitorio (500) se reintenta una vez y se recupera', async (t) => {
  clear();
  let n = 0;
  t.after(installFetchMock({
    'geocoding-api.open-meteo.com/v1/search': (_u, json) => (++n === 1 ? new Response('x', { status: 500 }) : json({ results: [] }))
  }).restore);
  const { app } = await makeApp();
  const r = await app.inject('/api/geocode?q=Retry');
  assert.equal(r.statusCode, 200);
  assert.equal(n, 2);
});

test('upstream: 404 no transitorio no se reintenta y no filtra detalle', async (t) => {
  clear();
  let n = 0;
  t.after(installFetchMock({
    'geocoding-api.open-meteo.com/v1/search': () => { n++; return new Response('x', { status: 400 }); }
  }).restore);
  const { app } = await makeApp();
  const r = await app.inject('/api/geocode?q=NoRetry');
  assert.equal(r.statusCode, 502);
  assert.equal(n, 1);
  assert.ok(!JSON.stringify(r.json()).includes('http 400'));
});
