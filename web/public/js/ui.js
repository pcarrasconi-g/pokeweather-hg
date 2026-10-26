// Render del DOM. SOLO textContent / atributos seguros: nunca innerHTML con datos externos.
import { formatTemp } from './theme.js';

const $ = (id) => document.getElementById(id);
const TYPE_ES = {
  normal: 'Normal', fire: 'Fuego', water: 'Agua', electric: 'Eléctrico', grass: 'Planta', ice: 'Hielo',
  fighting: 'Lucha', poison: 'Veneno', ground: 'Tierra', flying: 'Volador', psychic: 'Psíquico', bug: 'Bicho',
  rock: 'Roca', ghost: 'Fantasma', dragon: 'Dragón', dark: 'Siniestro', steel: 'Acero', fairy: 'Hada'
};
const IMG_HOST = 'https://raw.githubusercontent.com/';
const FALLBACK_IMG = 'assets/pokeball.svg';

export function announce(msg) {
  const live = $('live');
  live.textContent = '';
  // Pequeño retardo para que lectores de pantalla detecten el cambio.
  setTimeout(() => (live.textContent = msg), 50);
}

// Muestra una sección. Si el foco estaba en algo que se oculta, lo reubica (nunca queda en <body>).
export function show(section) {
  const active = document.activeElement;
  const hadFocus = active && active !== document.body && ['welcome', 'loading', 'error', 'result'].some((id) => $(id).contains(active));
  for (const id of ['welcome', 'loading', 'error']) $(id).hidden = id !== section;
  $('result').hidden = section !== 'result';
  $('loading').setAttribute('aria-hidden', String(section !== 'loading'));
  if (hadFocus && active.offsetParent === null) $('main').focus({ preventScroll: true });
}

export function errorText(err, fallback) {
  let title = 'Algo salió mal';
  let msg = fallback ?? 'No pudimos completar la operación. Inténtalo de nuevo.';
  if (err?.status === 429) {
    title = 'Vamos con calma';
    msg = `Hay muchas solicitudes ahora mismo. Espera ${err.retryAfter || 30} s y reintenta.`;
  } else if (err?.status === 0) {
    title = 'Sin conexión';
    msg = 'Parece que no hay conexión. Revisa tu red y reintenta.';
  } else if (err?.status === 504) {
    msg = 'El servicio tardó demasiado en responder. Reintenta en unos segundos.';
  } else if (err?.status === 502) {
    msg = 'Un servicio externo no está disponible. Reintenta en unos segundos.';
  }
  return { title, msg };
}

// Error a pantalla completa (sin resultado previo). #error es role="alert": no se duplica con announce().
export function showError(err, fallback) {
  const { title, msg } = errorText(err, fallback);
  $('error-title').textContent = title;
  $('error-msg').textContent = msg;
  show('error');
  $('error-title').focus();
}

// Error en línea junto al buscador: conserva el resultado previo.
export function showInlineError(err, fallback) {
  const { msg } = errorText(err, fallback);
  $('inline-error-msg').textContent = msg;
  $('inline-error').hidden = false;
}
export function clearInlineError() {
  $('inline-error').hidden = true;
  $('inline-error-msg').textContent = '';
}

export function userMessage(err) {
  if (err?.status === 429) return `Demasiadas solicitudes. Espera ${err.retryAfter || 30} s e inténtalo de nuevo.`;
  if (err?.status === 0) return 'Sin conexión. Inténtalo de nuevo.';
  if (err?.status === 400) return 'Revisa el apodo: solo letras, números, espacios y - _ \' .';
  return 'No se pudo guardar. Inténtalo de nuevo.';
}

// Estado ocupado del compañero / resultado completo.
export function setBusy({ result = false, companion = false } = {}) {
  $('result').setAttribute('aria-busy', String(result));
  document.querySelector('.companion').setAttribute('aria-busy', String(result || companion));
  const r = $('reroll');
  r.setAttribute('aria-disabled', String(result || companion));
}

// Solo permite imágenes del host de sprites; si falla, usa alternativa local.
// `pixel` solo para sprites pixelados, nunca para artwork ni el fallback.
export function setImage(img, urls, alt) {
  const queue = urls.filter((u) => typeof u === 'string' && u.startsWith(IMG_HOST)).map((u) => ({ u, retried: false }));
  const token = String(((Number(img.dataset.token) || 0) + 1));
  img.dataset.token = token;
  let cur = null;
  const load = () => {
    cur = queue[0];
    if (!cur) {
      img.onerror = null;
      img.classList.remove('pixel');
      img.src = FALLBACK_IMG;
      return;
    }
    img.classList.toggle('pixel', !cur.u.includes('/official-artwork/'));
    img.src = cur.retried ? `${cur.u}${cur.u.includes('?') ? '&' : '?'}r=1` : cur.u;
  };
  img.onerror = () => {
    if (img.dataset.token !== token) return; // error de una carga anterior: ignorar
    if (cur && !cur.retried) cur.retried = true; // reintenta la misma imagen una vez
    else queue.shift();
    load();
  };
  img.alt = alt;
  load();
}

export function renderTypes(ul, types) {
  ul.replaceChildren(
    ...types.map((t) => {
      const li = document.createElement('li');
      li.className = `type type-${/^[a-z]+$/.test(t) ? t : 'unknown'}`;
      li.textContent = TYPE_ES[t] ?? t;
      return li;
    })
  );
}

function dayLabel(date, i) {
  if (i === 0) return 'Hoy';
  if (i === 1) return 'Mañana';
  const d = new Date(`${date}T12:00:00`);
  const s = d.toLocaleDateString('es', { weekday: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function codeInfo(code) {
  if (code >= 95) return ['⛈️', 'tormenta'];
  if (code >= 85 || (code >= 66 && code <= 77)) return ['❄️', 'nieve'];
  if ((code >= 51 && code <= 65) || (code >= 80 && code <= 82)) return ['🌧️', 'lluvia'];
  if (code === 45 || code === 48) return ['🌫️', 'niebla'];
  if (code >= 2) return ['☁️', 'nublado'];
  return code === 0 ? ['☀️', 'despejado'] : ['🌤️', 'mayormente despejado'];
}

export function renderWeather(data, unit) {
  const { location, current, daily } = data;
  $('loc-name').textContent = location.name || `${location.lat}, ${location.lon}`;
  $('loc-sub').textContent = location.timezone ? `Zona horaria: ${location.timezone}` : '';
  $('w-icon').textContent = current.icon;
  $('w-temp').textContent = `${formatTemp(current.tempC, unit)}${unit}`;
  $('w-label').textContent = current.label;
  $('w-feels').textContent = `${formatTemp(current.apparentC, unit)}${unit}`;
  $('w-hum').textContent = `${Math.round(current.humidity)} %`;
  $('w-wind').textContent = unit === 'F' ? `${Math.round(current.windKmh * 0.621371)} mph` : `${Math.round(current.windKmh)} km/h`;

  $('forecast').replaceChildren(
    ...daily.slice(0, 3).map((d, i) => {
      const [icon, cond] = codeInfo(d.code);
      const label = dayLabel(d.date, i);
      const li = document.createElement('li');
      const mk = (cls, text) => {
        const s = document.createElement('span');
        s.className = cls;
        s.setAttribute('aria-hidden', 'true'); // la versión para lector de pantalla es el sr-only
        s.textContent = text;
        return s;
      };
      const sr = document.createElement('span');
      sr.className = 'sr-only';
      const deg = unit === 'F' ? 'grados Fahrenheit' : 'grados Celsius';
      const rainTxt = d.precipProb == null ? '' : `, probabilidad de lluvia ${d.precipProb} %`;
      sr.textContent = `${label}: ${cond}, mínima ${formatTemp(d.minC, unit).replace('°', '')} ${deg}, máxima ${formatTemp(d.maxC, unit).replace('°', '')} ${deg}${rainTxt}.`;
      li.append(
        mk('day-name', label),
        mk('day-icon', icon),
        mk('day-temps', `${formatTemp(d.minC, unit)} / ${formatTemp(d.maxC, unit)}`),
        mk('day-rain muted', d.precipProb == null ? '' : `💧 ${d.precipProb} %`),
        sr
      );
      return li;
    })
  );
  renderCompanion(data.companion);
}

export function renderCompanion(c) {
  const p = c.pokemon;
  setImage($('poke-img'), [p.artworkUrl, p.spriteUrl], `${p.displayName}, tu Pokémon compañero`);
  $('poke-name').textContent = `${p.displayName} · #${String(p.id).padStart(3, '0')}`;
  renderTypes($('poke-types'), p.types);
  $('poke-reason').textContent = c.reason;
  const h = typeof p.heightM === 'number' ? `${p.heightM.toFixed(1)} m` : '–';
  const w = typeof p.weightKg === 'number' ? `${p.weightKg.toFixed(1)} kg` : '–';
  $('poke-meta').textContent = `Altura ${h} · Peso ${w}`;
}

export function renderFriend(f) {
  const card = $('friend-card');
  if (!f) {
    card.hidden = true;
    return;
  }
  setImage($('friend-img'), [f.spriteUrl, f.artworkUrl], `${f.displayName}, tu amigo`);
  $('friend-nick').textContent = f.nickname;
  $('friend-species').textContent = `${f.displayName} · #${String(f.pokemonId).padStart(3, '0')}`;
  renderTypes($('friend-types'), f.types);
  $('friend-where').textContent = f.caughtLocation ? `Conocido en ${f.caughtLocation}` : '';
  card.hidden = false;
}
