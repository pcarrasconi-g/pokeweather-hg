-- PokeWeather: amigo Pokémon por cliente anónimo (cookie pw_cid).
CREATE TABLE IF NOT EXISTS friends (
  client_id       uuid PRIMARY KEY,
  pokemon_id      integer      NOT NULL CHECK (pokemon_id BETWEEN 1 AND 386),
  pokemon_name    text         NOT NULL,
  types           text[]       NOT NULL,
  sprite_url      text         NOT NULL,
  nickname        varchar(24)  NOT NULL CHECK (char_length(btrim(nickname)) BETWEEN 1 AND 24),
  caught_location varchar(80),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
