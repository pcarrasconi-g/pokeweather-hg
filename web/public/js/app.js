import * as api from './api.js';
import { applyTheme, getUnit, setUnit } from './theme.js';
import {
  announce, clearInlineError, renderFriend, renderWeather, setBusy, setImage, show, showError, showInlineError, userMessage
} from './ui.js';

const $ = (id) => document.getElementById(id);
const NICK_RE = /^[\p{L}\p{N} _'.-]+$/u;
const state = { place: null, data: null, reroll: 0, friend: null, unit: getUnit(), dialogMode: 'create', lastAction: null };
let weatherCtl = null;

/* ---------- Unidades ---------- */
function paintUnit() {
  $('unit-c').setAttribute('aria-pressed', String(state.unit === 'C'));
  $('unit-f').setAttribute('aria-pressed', String(state.unit === 'F'));
}
for (const u of ['C', 'F']) {
  $(`unit-${u.toLowerCase()}`).addEventListener('click', () => {
    state.unit = u;
    setUnit(u);
    paintUnit();
    if (state.data) renderWeather(state.data, state.unit);
    announce(`Unidad: grados ${u === 'C' ? 'Celsius' : 'Fahrenheit'}`);
  });
}
paintUnit();

/* ---------- Errores y reintento ---------- */
// Con resultado previo el error es en línea (junto al buscador) y no oculta nada.
function fail(err, fallback) {
  if (state.data) showInlineError(err, fallback);
  else showError(err, fallback);
}
function retry() {
  clearInlineError();
  if (state.lastAction) state.lastAction();
  else show('welcome');
}
$('retry').addEventListener('click', retry);
$('inline-retry').addEventListener('click', retry);

/* ---------- Carga del clima ---------- */
async function loadWeather(place, { reroll = 0, companionOnly = false } = {}) {
  state.lastAction = () => loadWeather(place, { reroll, companionOnly });
  clearInlineError();
  weatherCtl?.abort();
  const ctl = (weatherCtl = new AbortController());
  state.place = place;
  state.reroll = reroll;
  // Sincroniza el buscador con el lugar mostrado (y descarta resultados previos del combobox).
  if (!companionOnly) {
    $('q').value = place.name === 'Mi ubicación' ? '' : place.name;
    combo.resultsFor = null;
    setOpen(false);
  }
  if (companionOnly) setBusy({ companion: true });
  else if (state.data) setBusy({ result: true });
  else show('loading');
  announce(companionOnly ? 'Buscando otro compañero…' : `Cargando el clima de ${place.name}…`);
  try {
    const data = await api.weather({ lat: place.lat, lon: place.lon, name: place.name, reroll }, ctl.signal);
    if (ctl.signal.aborted) return;
    state.data = data;
    applyTheme(data.current.theme);
    renderWeather(data, state.unit);
    setBusy({});
    show('result');
    // Reroll mantiene el foco en su botón; el resto lo mueve al título del resultado.
    if (!companionOnly) $('loc-name').focus();
    announce(`${data.location.name || place.name}: ${data.current.label}, ${Math.round(data.current.tempC)} grados. Tu compañero es ${data.companion.pokemon.displayName}. ${data.companion.reason}`);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    setBusy({});
    fail(err);
  }
}

$('reroll').addEventListener('click', () => {
  if ($('reroll').getAttribute('aria-disabled') === 'true' || !state.place) return;
  loadWeather(state.place, { reroll: (state.reroll + 1) % 21, companionOnly: true });
});
for (const b of document.querySelectorAll('.chip-btn')) {
  b.addEventListener('click', () =>
    loadWeather({ lat: Number(b.dataset.lat), lon: Number(b.dataset.lon), name: b.dataset.name })
  );
}

/* ---------- Geolocalización (solo por acción explícita; no se persiste) ---------- */
function useMyLocation() {
  state.lastAction = useMyLocation;
  clearInlineError();
  if (!('geolocation' in navigator)) {
    fail(null, 'Tu navegador no permite obtener la ubicación. Busca un lugar manualmente.');
    return;
  }
  announce('Obteniendo tu ubicación…');
  navigator.geolocation.getCurrentPosition(
    (pos) => loadWeather({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'Mi ubicación' }),
    (err) => {
      fail(null, err.code === 1
        ? 'No diste permiso de ubicación. Puedes buscar un lugar manualmente.'
        : 'No pudimos obtener tu ubicación. Busca un lugar manualmente.');
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
  );
}
$('geo').addEventListener('click', useMyLocation);

/* ---------- Combobox de búsqueda ---------- */
const input = $('q');
const list = $('results');
const combo = { items: [], active: -1, timer: null, ctl: null, resultsFor: null, inflight: false };
const spinner = $('search-spinner');
// Los resultados solo son válidos si corresponden al texto actual y no hay búsqueda pendiente.
const isFresh = () => !combo.timer && !combo.inflight && combo.resultsFor === input.value.trim();

function setOpen(open) {
  list.hidden = !open;
  input.setAttribute('aria-expanded', String(open));
  if (!open) {
    combo.active = -1;
    input.setAttribute('aria-activedescendant', '');
  }
}
function setActive(i) {
  const opts = list.querySelectorAll('[role="option"]');
  opts.forEach((o, idx) => o.setAttribute('aria-selected', String(idx === i)));
  combo.active = i;
  input.setAttribute('aria-activedescendant', i >= 0 ? `opt-${i}` : '');
  if (i >= 0) opts[i].scrollIntoView({ block: 'nearest' });
}
function placeName(r) {
  return [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : null, r.country].filter(Boolean).join(', ');
}
function renderOptions(results) {
  combo.items = results;
  list.replaceChildren(
    ...results.map((r, i) => {
      const li = document.createElement('li');
      li.id = `opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      const main = document.createElement('span');
      main.className = 'opt-main';
      main.textContent = r.name;
      const sub = document.createElement('span');
      sub.className = 'opt-sub';
      sub.textContent = [r.admin1, r.country].filter(Boolean).join(', ');
      li.append(main, sub);
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => choose(i));
      return li;
    })
  );
  if (results.length === 0) {
    const li = document.createElement('li');
    li.className = 'opt-empty';
    li.setAttribute('role', 'presentation');
    li.textContent = 'Sin resultados. Prueba con otro nombre.';
    list.replaceChildren(li);
  }
  setOpen(true);
  announce(results.length ? `${results.length} resultados. Usa las flechas para elegir.` : 'Sin resultados');
}
function choose(i) {
  const r = combo.items[i];
  if (!r) return;
  input.value = placeName(r);
  setOpen(false);
  loadWeather({ lat: r.lat, lon: r.lon, name: placeName(r) });
}
async function search(q, { autoPick = false } = {}) {
  state.lastAction = () => search(q, { autoPick });
  clearInlineError();
  combo.ctl?.abort();
  const ctl = (combo.ctl = new AbortController());
  combo.inflight = true;
  spinner.hidden = false;
  input.setAttribute('aria-busy', 'true');
  try {
    const { results } = await api.geocode(q, ctl.signal);
    if (ctl.signal.aborted) return;
    combo.resultsFor = q;
    renderOptions(results);
    if (autoPick && results.length) choose(0);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    setOpen(false);
    fail(err);
  } finally {
    if (combo.ctl === ctl) {
      combo.inflight = false;
      spinner.hidden = true;
      input.removeAttribute('aria-busy');
    }
  }
}
input.addEventListener('input', () => {
  clearTimeout(combo.timer);
  combo.timer = null;
  const q = input.value.trim();
  if (q.length < 2) {
    combo.ctl?.abort();
    combo.inflight = false;
    spinner.hidden = true;
    combo.resultsFor = null;
    setOpen(false);
    return;
  }
  combo.timer = setTimeout(() => {
    combo.timer = null;
    search(q);
  }, 300);
});
input.addEventListener('keydown', (e) => {
  const n = combo.items.length;
  const open = !list.hidden && n > 0 && isFresh();
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!open) return !combo.timer && !combo.inflight && input.value.trim().length >= 2 && search(input.value.trim());
    setActive((combo.active + 1) % n);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (open) setActive(combo.active <= 0 ? n - 1 : combo.active - 1);
  } else if (e.key === 'Home' && open) {
    e.preventDefault();
    setActive(0);
  } else if (e.key === 'End' && open) {
    e.preventDefault();
    setActive(n - 1);
  } else if (e.key === 'Escape') {
    if (!list.hidden) {
      e.preventDefault();
      setOpen(false);
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    // Nunca elige resultados obsoletos: si el texto cambió o hay búsqueda pendiente, relanza y elige el primero nuevo.
    clearTimeout(combo.timer);
    combo.timer = null;
    if (open) choose(combo.active >= 0 ? combo.active : 0);
    else if (input.value.trim().length >= 2) search(input.value.trim(), { autoPick: true });
  }
});
input.addEventListener('blur', () => setTimeout(() => setOpen(false), 120));
$('search-form').addEventListener('submit', (e) => e.preventDefault());

/* ---------- Diálogos ---------- */
function trapTab(dialog, e) {
  if (e.key !== 'Tab') return;
  const f = [...dialog.querySelectorAll('button, input')].filter((x) => !x.disabled);
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
// Cierra con clic en el fondo SOLO si mousedown y click ocurren fuera del rectángulo real del diálogo
// (un clic en el padding del <dialog> tiene target===dialog pero está dentro del rect).
const outside = (d, e) => {
  const r = d.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
};
for (const d of [$('friend-dialog'), $('confirm-dialog')]) {
  let downOutside = false;
  d.addEventListener('keydown', (e) => trapTab(d, e));
  d.addEventListener('mousedown', (e) => {
    downOutside = e.target === d && outside(d, e);
  });
  d.addEventListener('click', (e) => {
    if (downOutside && e.target === d && outside(d, e)) d.close();
    downOutside = false;
  });
}

const nick = $('nick');
function validateNick() {
  const v = nick.value.normalize('NFC').trim();
  let err = '';
  if (v.length === 0) err = 'Escribe un apodo.';
  else if ([...v].length > 24) err = 'Máximo 24 caracteres.';
  else if (!NICK_RE.test(v)) err = "Solo letras, números, espacios y - _ ' .";
  $('nick-err').textContent = err;
  nick.setAttribute('aria-invalid', String(Boolean(err)));
  $('nick-count').textContent = `${[...nick.value].length}/24`;
  return err ? null : v;
}
nick.addEventListener('input', validateNick);

function openFriendDialog(mode) {
  state.dialogMode = mode;
  const src = mode === 'edit' ? state.friend : state.data?.companion.pokemon;
  if (!src) return;
  const d = $('friend-dialog');
  $('fd-title').textContent = mode === 'edit' ? 'Editar apodo' : 'Ponle un apodo';
  $('fd-desc').textContent =
    mode === 'edit' ? `Tu ${src.displayName} se llama ahora…` : `${src.displayName} será tu amigo. ¿Cómo lo llamarás?`;
  setImage($('fd-img'), [src.artworkUrl, src.spriteUrl], '');
  nick.value = mode === 'edit' ? state.friend.nickname : '';
  $('nick-err').textContent = '';
  nick.setAttribute('aria-invalid', 'false');
  $('nick-count').textContent = `${[...nick.value].length}/24`;
  $('fd-save').disabled = false;
  d.showModal();
  nick.focus();
  nick.select();
}
$('befriend').addEventListener('click', () => openFriendDialog('create'));
$('friend-edit').addEventListener('click', () => openFriendDialog('edit'));
$('fd-cancel').addEventListener('click', () => $('friend-dialog').close());

$('friend-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = validateNick();
  if (!v) return nick.focus();
  const payload = state.dialogMode === 'edit'
    ? { pokemonId: state.friend.pokemonId, nickname: v, ...(state.friend.caughtLocation ? { caughtLocation: state.friend.caughtLocation } : {}) }
    : { pokemonId: state.data.companion.pokemon.id, nickname: v, ...(state.data.location.name && state.data.location.name !== 'Mi ubicación' ? { caughtLocation: state.data.location.name.slice(0, 80) } : {}) };
  $('fd-save').disabled = true;
  try {
    const { friend } = await api.saveFriend(payload);
    state.friend = friend;
    renderFriend(friend);
    $('friend-dialog').close();
    announce(`${friend.nickname} es ahora tu amigo.`);
    $('friend-card').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  } catch (err) {
    $('nick-err').textContent = userMessage(err);
    nick.setAttribute('aria-invalid', 'true');
    $('fd-save').disabled = false;
    nick.focus();
  }
});

$('friend-release').addEventListener('click', () => {
  $('cd-text').textContent = `${state.friend.nickname} volverá a su hábitat. Esta acción no se puede deshacer.`;
  $('cd-err').textContent = '';
  $('confirm-dialog').showModal();
  $('cd-cancel').focus();
});
$('cd-cancel').addEventListener('click', () => $('confirm-dialog').close());
$('confirm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api.releaseFriend();
    const name = state.friend?.nickname;
    state.friend = null;
    renderFriend(null);
    $('confirm-dialog').close();
    announce(`${name} fue liberado.`);
    $('q').focus();
  } catch (err) {
    $('cd-err').textContent = userMessage(err); // región role=alert; el aviso de irreversibilidad se conserva
  }
});

/* ---------- Inicio ---------- */
(async function init() {
  applyTheme('day-clear');
  show('welcome');
  try {
    const { friend } = await api.getFriend();
    state.friend = friend;
    renderFriend(friend);
  } catch {
    /* sin amigo cargado: la app funciona igualmente */
  }
})();
