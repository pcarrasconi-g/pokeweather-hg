import test from 'node:test';
import assert from 'node:assert/strict';
import { typeForWeather, pickPokemonId } from '../src/services/companion.js';
import { describeWeather } from '../src/lib/wmo.js';
import { readFileSync, existsSync } from 'node:fs';
import { NICKNAME_RE, normalizeNickname, normalizeLocation } from '../src/lib/validate.js';
import { createPool } from '../src/db.js';
import { TtlCache } from '../src/services/cache.js';

const w = (o) => ({ code: 0, isDay: true, tempC: 20, windKmh: 5, ...o });

test('clima -> tipo: tabla de prioridades', () => {
  const cases = [
    [w({ code: 95 }), 'electric'], [w({ code: 99 }), 'electric'],
    [w({ code: 71 }), 'ice'], [w({ code: 77 }), 'ice'], [w({ code: 85 }), 'ice'], [w({ code: 66 }), 'ice'], [w({ code: 67 }), 'ice'],
    [w({ code: 51 }), 'water'], [w({ code: 65 }), 'water'], [w({ code: 80 }), 'water'], [w({ code: 82 }), 'water'],
    [w({ code: 45 }), 'ghost'], [w({ code: 48 }), 'ghost'],
    [w({ code: 3, windKmh: 40 }), 'flying'], [w({ code: 0, windKmh: 55 }), 'flying'],
    [w({ code: 0, tempC: 28 }), 'fire'], [w({ code: 1, tempC: 35 }), 'fire'],
    [w({ code: 0, tempC: 27.9 }), 'grass'], [w({ code: 1 }), 'grass'],
    [w({ code: 0, isDay: false, tempC: 30 }), 'dark'], [w({ code: 1, isDay: false }), 'dark'],
    [w({ code: 2 }), 'normal'], [w({ code: 3, isDay: false }), 'normal']
  ];
  for (const [input, expected] of cases) assert.equal(typeForWeather(input).type, expected, JSON.stringify(input));
});

test('prioridad: tormenta gana al viento; lluvia gana al viento; viento gana a despejado cálido', () => {
  assert.equal(typeForWeather(w({ code: 96, windKmh: 80 })).type, 'electric');
  assert.equal(typeForWeather(w({ code: 61, windKmh: 80 })).type, 'water');
  assert.equal(typeForWeather(w({ code: 0, tempC: 33, windKmh: 45 })).type, 'flying');
  assert.match(typeForWeather(w({ code: 61 })).reason, /Llueve → tipo Agua/);
});

test('pickPokemonId es determinista y respeta reroll', () => {
  const ids = Array.from({ length: 100 }, (_, i) => i + 1);
  const a = pickPokemonId(ids, 40.4165, -3.7026, '2026-10-26');
  assert.equal(a, pickPokemonId(ids, 40.4165, -3.7026, '2026-10-26'));
  assert.equal(a, pickPokemonId(ids, 40.4199, -3.7001, '2026-10-26')); // mismos 2 decimales
  const rolls = new Set(Array.from({ length: 21 }, (_, r) => pickPokemonId(ids, 40.42, -3.7, '2026-10-26', r)));
  assert.ok(rolls.size > 5);
  assert.ok(ids.includes(a));
});

test('wmo: etiqueta, icono y theme', () => {
  assert.deepEqual(describeWeather(0, true), { label: 'Despejado', icon: '☀️', theme: 'day-clear' });
  assert.equal(describeWeather(95, false).theme, 'night-storm');
  assert.equal(describeWeather(73, true).theme, 'day-snow');
  assert.equal(describeWeather(45, true).theme, 'day-fog');
  assert.equal(describeWeather(61, false).theme, 'night-rain');
  assert.equal(describeWeather(3, true).theme, 'day-cloudy');
  assert.equal(describeWeather(999, true).theme, 'day-cloudy');
});

test('apodo: válidos e inválidos', () => {
  for (const ok of ['Pika', '  Pika  ', "O'Neil-Jr.", 'Ñandú 2', 'a_b']) assert.ok(normalizeNickname(ok).ok, ok);
  assert.equal(normalizeNickname('  Pika  ').value, 'Pika');
  for (const bad of ['', '   ', 'a'.repeat(25), '<script>', "x'; DROP TABLE friends;--", 'a\tb', 'a\nb', '😀', 5, null]) {
    assert.equal(normalizeNickname(bad).ok, false, String(bad));
  }
  assert.ok(normalizeNickname('a'.repeat(24)).ok);
});

test('ubicación capturada: límites y caracteres de control', () => {
  assert.equal(normalizeLocation(undefined).value, null);
  assert.equal(normalizeLocation('  ').value, null);
  assert.equal(normalizeLocation('São Paulo, Brasil').value, 'São Paulo, Brasil');
  assert.equal(normalizeLocation('x'.repeat(81)).ok, false);
  assert.equal(normalizeLocation('a\u0000b').ok, false);
});

test('TtlCache: expira, respeta el tope y deduplica concurrencia', async () => {
  let t = 0;
  const c = new TtlCache({ max: 2, ttlMs: 100, now: () => t });
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  assert.equal(c.get('a'), undefined);
  assert.equal(c.size, 2);
  t = 101;
  assert.equal(c.get('b'), undefined);
  let n = 0;
  const f = async () => { n++; return 7; };
  const [x, y] = await Promise.all([c.wrap('k', f), c.wrap('k', f)]);
  assert.equal(x + y, 14);
  assert.equal(n, 1);
});

test('NICK_RE del cliente es idéntica a la del servidor', { skip: !existsSync(new URL('../../web/public/js/app.js', import.meta.url)) }, () => {
  const src = readFileSync(new URL('../../web/public/js/app.js', import.meta.url), 'utf8');
  const m = src.match(/const NICK_RE = (\/.+\/u);/);
  assert.ok(m, 'NICK_RE no encontrada en app.js');
  assert.equal(m[1], String(NICKNAME_RE));
});

test('pool de pg: statement_timeout y query_timeout de 5 s', async () => {
  const pool = createPool();
  try {
    assert.equal(pool.options.statement_timeout, 5000);
    assert.equal(pool.options.query_timeout, 5000);
  } finally {
    await pool.end();
  }
});
