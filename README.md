# PokeWeather

Mira el clima de cualquier lugar y conoce al Pokémon **compañero** que le corresponde (datos de PokéAPI). Puedes hacerlo tu amigo y ponerle apodo; se guarda en PostgreSQL. Estética inspirada en Pokémon GO.

> **Aviso:** Pokémon es marca de Nintendo, Creatures Inc. y GAME FREAK inc. PokeWeather es un **proyecto fan sin fines de lucro**, no afiliado ni respaldado por ellos.

## Arranque

```bash
cp .env.example .env        # edita .env y pon una POSTGRES_PASSWORD real, p. ej. `openssl rand -hex 24`
docker compose up -d --build
docker compose ps           # db, api y web deben estar "healthy"
./scripts/smoke.sh          # prueba de humo (incluye comprobaciones contra Postgres real y el 429 de nginx)
```

Abre <http://127.0.0.1:8731>.

Para confirmar rápidamente que el servicio responde, visita <http://127.0.0.1:8731/api/health>; debe devolver `{"status":"ok","db":"up"}`.

Parar: `docker compose down` (conserva los datos).
**`docker compose down -v` borra el volumen `pgdata` y, con él, todos los amigos guardados.**

## Puertos

| Servicio | Publicado | Notas |
| --- | --- | --- |
| `web` (nginx) | `127.0.0.1:${WEB_PORT:-8731}` → 8080 | único puerto expuesto, solo loopback |
| `api` (Fastify, 3000) | no | solo red interna de compose; nginx hace proxy de `/api` |
| `db` (PostgreSQL 16, 5432) | no | solo red interna; datos en el volumen `pgdata` |

Cambia `WEB_PORT` en `.env` si 8731 está ocupado.

## Tests

```bash
cd api && npm ci && node --test     # node:test con fetch y BD simulados (sin red)
```

## API (JSON, mismo origen)

- `GET /api/health` → `{status:"ok",db:"up"}`
- `GET /api/geocode?q=&count=` · `GET /api/weather?lat=&lon=&name=[&reroll=0..20]` · `GET /api/pokemon/:id` (1..386)
- `GET | PUT | DELETE /api/friend` — identidad por cookie `pw_cid`. `GET` devuelve `{friend:null}` si no hay amigo.
- Errores: `{error:{code,message}}` con 400/403/404/415/429 (`Retry-After`)/502/504.

## Apodo

Hasta **24 caracteres** (tras recortar espacios en los extremos). Se admiten letras Unicode, números, espacios y `- _ ' .`: el **apóstrofo se acepta** (`O'Neil`) y las **comillas dobles se rechazan**, igual que `<`, `>`, `;`, emojis y saltos de línea.

## Privacidad y seguridad

- La cookie `pw_cid` (UUID aleatorio, HttpOnly, SameSite=Lax, 1 año) es una **identidad anónima**: solo sirve para recordar a tu amigo. No hay cuentas ni datos personales.
- La ubicación del navegador solo se usa si pulsas «Usar mi ubicación» y **no se guarda**.
- CSP estricta en nginx (sin inline, sin CDN ni fuentes externas), validación JSON Schema, SQL parametrizado, rate limiting (API y nginx), contenedores `api`/`web` sin root, con sistema de ficheros de solo lectura y `cap_drop: ALL`.
- Uso **no comercial**: la API gratuita de Open-Meteo lo exige.

## Endurecimiento de contenedores y excepciones documentadas

- Redes: `internal` (solo `api` ↔ `db`, sin salida a Internet) y `edge` (`web` ↔ `api`, y salida de `api` hacia Open-Meteo/PokéAPI). `web` no puede alcanzar `db`.
- `api` y `web`: usuario no root, `read_only`, `cap_drop: ALL`, `no-new-privileges`, límites de memoria y pids.
- Imágenes base fijadas a versión concreta + digest (`node 22.23.4`, `postgres 16.15`, `nginx-unprivileged 1.30.6`). Para actualizarlas, cambia tag y digest a la vez.
- **Excepciones de `db`** (imagen oficial de PostgreSQL): sin `read_only` (necesita escribir en su directorio de datos y sockets), `cap_add` mínimos (`CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID`) y el entrypoint arranca como root solo para preparar permisos y luego baja al usuario `postgres`. Sigue con `cap_drop: ALL`, `no-new-privileges` y sin puertos publicados.
- Tiempos: la API corta cada petición a los 12 s en total (presupuesto global sobre las llamadas upstream, 5 s cada una) y nginx espera 20 s, de modo que siempre llega un JSON `{error:{code:"upstream_timeout"}}`. nginx re-resuelve `api` por DNS (`resolver 127.0.0.11`), así que recrear la API no deja 502 permanentes.
- CSP sin `data:` en `img-src`: las imágenes vienen de `self` y de `raw.githubusercontent.com`.

## Atribuciones

- Datos meteorológicos y geocodificación: [Open-Meteo.com](https://open-meteo.com/) — licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Datos e imágenes de Pokémon: [PokéAPI](https://pokeapi.co/) y [PokeAPI/sprites](https://github.com/PokeAPI/sprites).
- Pokémon © Nintendo / Creatures Inc. / GAME FREAK inc.
