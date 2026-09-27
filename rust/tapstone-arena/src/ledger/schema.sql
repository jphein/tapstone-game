-- Ledger schema v1, copied verbatim from the arena spec §8.1 (each table IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS commander (
  key          TEXT PRIMARY KEY,       -- figurine tag UID, 14 lowercase hex (0030 key)
  name_seed    INTEGER NOT NULL,       -- realm-sigil seed for the commander's name
  faction      TEXT NOT NULL,          -- from the castle design the figurine claims with
  xp           INTEGER NOT NULL DEFAULT 0,
  loss_streak  INTEGER NOT NULL DEFAULT 0,  -- consecutive losses, reset by a win (0031 ruling)
  created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory (               -- earned loot only; item cards are not inventory
  commander TEXT NOT NULL REFERENCES commander(key),
  design    INTEGER NOT NULL,          -- item design id (§8.3)
  acquired_match TEXT NOT NULL,        -- match id that dropped it
  PRIMARY KEY (commander, design)      -- a duplicate cannot be stored: it melts
);
CREATE TABLE IF NOT EXISTS loadout (
  commander TEXT NOT NULL REFERENCES commander(key),
  slot      INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 2),  -- weapon, armour, trinket
  source    TEXT NOT NULL CHECK (source IN ('loot','card')),
  design    INTEGER NOT NULL,
  card_uid  TEXT,                      -- set when source = 'card'
  PRIMARY KEY (commander, slot)
);
CREATE TABLE IF NOT EXISTS match (
  id            TEXT PRIMARY KEY,      -- 8 hex
  started_at    INTEGER NOT NULL,
  rules         BLOB NOT NULL,         -- HouseRules::bytes()
  seat0 TEXT, seat1 TEXT,              -- commander keys
  meta          BLOB,                  -- JSON: nodes, decks, figurines, start (for recovery);
                                       -- committed stats live in the ClaimSeat records, once
  state         TEXT NOT NULL,         -- 'playing' | 'over' | 'halted' | 'abandoned'
  final_hash    BLOB, transcript_sha BLOB, winner INTEGER, reason TEXT,
  applied_at    INTEGER                -- when the result was applied to the ledger; NULL = not yet
);
CREATE TABLE IF NOT EXISTS match_records (           -- the journal (D10)
  match TEXT NOT NULL REFERENCES match(id),
  mseq  INTEGER NOT NULL,
  record BLOB NOT NULL,                -- 24 B
  hash  BLOB,                          -- 8 B, NULL for lobby records
  PRIMARY KEY (match, mseq)
);
CREATE TABLE IF NOT EXISTS ledger_event (            -- what the result did, for the station's result screen
  match TEXT NOT NULL, commander TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- 'xp' | 'level' | 'drop' | 'melt'
  value INTEGER NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS outbox (                  -- §10
  id INTEGER PRIMARY KEY, sink TEXT NOT NULL, match TEXT NOT NULL,
  body BLOB NOT NULL, content_type TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, done_at INTEGER
);
CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL);
INSERT INTO schema_version (v) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
