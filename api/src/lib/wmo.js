// Códigos WMO de Open-Meteo -> etiqueta, icono (emoji) y categoría de tema.
const T = (label, day, night, category) => ({ label, day, night, category });

const TABLE = {
  0: T('Despejado', '☀️', '🌙', 'clear'),
  1: T('Mayormente despejado', '🌤️', '🌙', 'clear'),
  2: T('Parcialmente nublado', '⛅', '☁️', 'cloudy'),
  3: T('Nublado', '☁️', '☁️', 'cloudy'),
  45: T('Niebla', '🌫️', '🌫️', 'fog'),
  48: T('Niebla con escarcha', '🌫️', '🌫️', 'fog'),
  51: T('Llovizna ligera', '🌦️', '🌧️', 'rain'),
  53: T('Llovizna', '🌦️', '🌧️', 'rain'),
  55: T('Llovizna intensa', '🌧️', '🌧️', 'rain'),
  56: T('Llovizna helada', '🌧️', '🌧️', 'rain'),
  57: T('Llovizna helada intensa', '🌧️', '🌧️', 'rain'),
  61: T('Lluvia débil', '🌦️', '🌧️', 'rain'),
  63: T('Lluvia', '🌧️', '🌧️', 'rain'),
  65: T('Lluvia fuerte', '🌧️', '🌧️', 'rain'),
  66: T('Lluvia helada', '🌨️', '🌨️', 'snow'),
  67: T('Lluvia helada fuerte', '🌨️', '🌨️', 'snow'),
  71: T('Nevada débil', '🌨️', '🌨️', 'snow'),
  73: T('Nevada', '❄️', '❄️', 'snow'),
  75: T('Nevada fuerte', '❄️', '❄️', 'snow'),
  77: T('Granos de nieve', '❄️', '❄️', 'snow'),
  80: T('Chubascos débiles', '🌦️', '🌧️', 'rain'),
  81: T('Chubascos', '🌧️', '🌧️', 'rain'),
  82: T('Chubascos violentos', '🌧️', '🌧️', 'rain'),
  85: T('Chubascos de nieve', '🌨️', '🌨️', 'snow'),
  86: T('Chubascos de nieve fuertes', '🌨️', '🌨️', 'snow'),
  95: T('Tormenta', '⛈️', '⛈️', 'storm'),
  96: T('Tormenta con granizo', '⛈️', '⛈️', 'storm'),
  99: T('Tormenta con granizo fuerte', '⛈️', '⛈️', 'storm')
};

export function describeWeather(code, isDay) {
  const e = TABLE[code] || T('Tiempo variable', '⛅', '☁️', 'cloudy');
  return {
    label: e.label,
    icon: isDay ? e.day : e.night,
    theme: `${isDay ? 'day' : 'night'}-${e.category}`
  };
}
