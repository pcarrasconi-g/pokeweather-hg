#!/usr/bin/env bash
# Prueba de humo contra el stack levantado. Uso: scripts/smoke.sh [BASE_URL]
set -u
cd "$(dirname "$0")/.."
PORT="$(grep -E '^WEB_PORT=' .env 2>/dev/null | cut -d= -f2)"
BASE="${1:-http://127.0.0.1:${PORT:-8731}}"
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
fail=0
check() { # nombre esperado obtenido
  if [ "$2" = "$3" ]; then echo "PASÓ   $1"; else echo "FALLÓ  $1 (esperado=$2 obtenido=$3)"; fail=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
J='Content-Type: application/json'

check "GET /"                       200 "$(code "$BASE/")"
check "GET /api/health"             200 "$(code "$BASE/api/health")"
check "health body" '{"status":"ok","db":"up"}' "$(curl -s "$BASE/api/health")"
check "geocode Madrid"              200 "$(code "$BASE/api/geocode?q=Madrid")"
check "geocode q corta -> 400"      400 "$(code "$BASE/api/geocode?q=a")"
check "weather Madrid"              200 "$(code "$BASE/api/weather?lat=40.42&lon=-3.70&name=Madrid")"
check "weather lat inválida -> 400" 400 "$(code "$BASE/api/weather?lat=999&lon=0")"
check "pokemon 25"                  200 "$(code "$BASE/api/pokemon/25")"
check "pokemon 387 -> 400"          400 "$(code "$BASE/api/pokemon/387")"
check "ruta inexistente -> 404"     404 "$(code "$BASE/api/nope")"
check "SQLi nickname -> 400"        400 "$(code -X PUT -H "$J" -c "$JAR" -b "$JAR" -d '{"pokemonId":25,"nickname":"x'"'"'; DROP TABLE friends;--"}' "$BASE/api/friend")"
check "XSS nickname -> 400"         400 "$(code -X PUT -H "$J" -c "$JAR" -b "$JAR" -d '{"pokemonId":25,"nickname":"<script>alert(1)</script>"}' "$BASE/api/friend")"
check "SQLi en q no da 5xx" 1 "$([ "$(code -G --data-urlencode "q=' OR 1=1;--" "$BASE/api/geocode")" -lt 500 ] && echo 1 || echo 0)"
check "PUT text/plain -> 415"       415 "$(code -X PUT -H 'Content-Type: text/plain' -d '{"pokemonId":25,"nickname":"Pika"}' "$BASE/api/friend")"
check "Origin ajeno -> 403"         403 "$(code -X PUT -H "$J" -H 'Origin: https://evil.example' -d '{"pokemonId":25,"nickname":"Pika"}' "$BASE/api/friend")"
check "PUT friend"                  200 "$(code -X PUT -H "$J" -c "$JAR" -b "$JAR" -d '{"pokemonId":25,"nickname":"Pika"}' "$BASE/api/friend")"
check "GET friend persistido" Pika "$(curl -s -b "$JAR" "$BASE/api/friend" | sed -n 's/.*"nickname":"\([^"]*\)".*/\1/p')"
check "DELETE friend -> 204"        204 "$(code -X DELETE -b "$JAR" "$BASE/api/friend")"
check "GET friend vacío" '{"friend":null}' "$(curl -s -b "$JAR" "$BASE/api/friend")"
# --- Postgres real (transacción con ROLLBACK: no deja datos) ---
if docker compose ps -q db >/dev/null 2>&1 && [ -n "$(docker compose ps -q db 2>/dev/null)" ]; then
  cid="$(cat /proc/sys/kernel/random/uuid)"
  out="$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atq' <<SQL 2>&1
BEGIN;
INSERT INTO friends (client_id, pokemon_id, pokemon_name, types, sprite_url, nickname) VALUES ('$cid', 25, 'pikachu', ARRAY['electric'], 'x', 'Smoke');
SELECT nickname || ':' || pokemon_id FROM friends WHERE client_id = '$cid';
ROLLBACK;
SQL
)"
  check "Postgres real: insert/select friends" "Smoke:25" "$(echo "$out" | grep -E '^Smoke:' | head -1)"
  bad="$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq' <<SQL 2>&1
INSERT INTO friends (client_id, pokemon_id, pokemon_name, types, sprite_url, nickname) VALUES ('$cid', 999, 'x', ARRAY['x'], 'x', 'ok');
SQL
)"
  check "Postgres real: CHECK pokemon_id 1..386 rechaza 999" 1 "$(echo "$bad" | grep -qi 'violates check constraint' && echo 1 || echo 0)"
  check "Postgres real: schema_migrations 001" 001_init.sql "$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "select version from schema_migrations"' 2>&1 | head -1)"
  nrows="$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "select count(*) from friends"' 2>&1)"
  check "Postgres real: sin datos de prueba residuales" 0 "$nrows"
else
  echo "NO EJECUTADA  comprobaciones contra Postgres real (docker compose no disponible)"
fi
hdr="$(curl -sI "$BASE/")"
for h in "content-security-policy: default-src 'none'" "x-content-type-options: nosniff" "referrer-policy: no-referrer" "permissions-policy: geolocation=(self)"; do
  echo "$hdr" | tr -d '\r' | grep -qi "^$h" && echo "PASÓ   cabecera $h" || { echo "FALLÓ  cabecera $h"; fail=1; }
done
echo "$hdr" | grep -qi '^server: nginx/' && { echo "FALLÓ  server_tokens expone versión"; fail=1; } || echo "PASÓ   server_tokens off"
for p in 5432 3000; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "FALLÓ  puerto $p accesible en host"; fail=1; else echo "PASÓ   puerto $p no accesible en host"; fi
done
# --- 429 de nginx (limit_req): ráfaga a /api/health (exenta del limitador de la API) ---
BURST="$(mktemp -d)"
for i in $(seq 1 80); do curl -s -D "$BURST/h$i" -o "$BURST/b$i" "$BASE/api/health" & done; wait
rl="$(grep -l '^HTTP/[0-9.]* 429' "$BURST"/h* 2>/dev/null | head -1)"
if [ -n "$rl" ]; then
  b="${rl/\/h/\/b}"
  check "429 nginx: Retry-After presente" 1 "$(grep -qi '^retry-after: [0-9]' "$rl" && echo 1 || echo 0)"
  check "429 nginx: cuerpo JSON {error:{code}}" 1 "$(grep -q '"code":"rate_limited"' "$b" && echo 1 || echo 0)"
else
  echo "FALLÓ  no se obtuvo 429 de nginx en la ráfaga"; fail=1
fi
rm -rf "$BURST"
[ "$fail" = 0 ] && echo "SMOKE OK" || echo "SMOKE CON FALLOS"
exit "$fail"
