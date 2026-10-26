// Tema de cielo, partículas y unidades de temperatura.
const THEME_COLORS = {
  day: { clear: '#3b9cf5', cloudy: '#7aa6c9', rain: '#4f6f8f', storm: '#3a4560', snow: '#9fc1dd', fog: '#a7b4be' },
  night: { clear: '#14204a', cloudy: '#232d4a', rain: '#1c2740', storm: '#161c33', snow: '#2a3a5c', fog: '#2b3445' }
};
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function applyTheme(theme = 'day-clear') {
  const [tod, cat] = theme.split('-');
  const safe = THEME_COLORS[tod]?.[cat] ? theme : 'day-clear';
  document.body.dataset.theme = safe;
  const [t, c] = safe.split('-');
  document.getElementById('meta-theme')?.setAttribute('content', THEME_COLORS[t][c]);
  buildParticles(c === 'rain' ? 'rain' : c === 'storm' ? 'storm' : c === 'snow' ? 'snow' : null);
}

function buildParticles(kind) {
  const box = document.getElementById('particles');
  box.replaceChildren();
  box.dataset.kind = kind ?? '';
  if (!kind || reduceMotion()) return;
  const n = kind === 'snow' ? 46 : 70;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.setProperty('--x', `${Math.random() * 100}%`);
    p.style.setProperty('--d', `${(Math.random() * 4).toFixed(2)}s`);
    p.style.setProperty('--t', `${(kind === 'snow' ? 5 + Math.random() * 6 : 0.7 + Math.random() * 0.7).toFixed(2)}s`);
    p.style.setProperty('--s', `${(0.6 + Math.random() * 0.9).toFixed(2)}`);
    frag.append(p);
  }
  box.append(frag);
}

// Re-evalúa partículas si el usuario cambia la preferencia de movimiento.
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () =>
  applyTheme(document.body.dataset.theme)
);

const KEY = 'pw_unit';
export function getUnit() {
  try {
    return localStorage.getItem(KEY) === 'F' ? 'F' : 'C';
  } catch {
    return 'C';
  }
}
export function setUnit(u) {
  try {
    localStorage.setItem(KEY, u);
  } catch {
    /* almacenamiento no disponible */
  }
}
export function formatTemp(c, unit) {
  if (typeof c !== 'number') return '–';
  const v = unit === 'F' ? (c * 9) / 5 + 32 : c;
  return `${Math.round(v)}°`;
}
