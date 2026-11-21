-- Doodlechain (draw-telephone) D1 schema
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  round_id TEXT,                 -- current round
  created_at INTEGER NOT NULL,
  active_at INTEGER NOT NULL     -- last write, for cleanup
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  is_host INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS members_group ON members(group_id);
CREATE UNIQUE INDEX IF NOT EXISTS members_tok ON members(token_hash);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | revealed
  reveal_at INTEGER,                      -- unix seconds, or NULL = when everyone has played
  max_steps INTEGER NOT NULL DEFAULT 6,
  created_at INTEGER NOT NULL,
  revealed_at INTEGER
);
CREATE INDEX IF NOT EXISTS rounds_group ON rounds(group_id);
CREATE TABLE IF NOT EXISTS chains (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  starter_id TEXT NOT NULL,
  len INTEGER NOT NULL DEFAULT 0,
  lock_member TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chains_round ON chains(round_id);
CREATE TABLE IF NOT EXISTS steps (
  chain_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- text | draw
  body TEXT NOT NULL,            -- phrase, or stroke JSON
  removed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chain_id, idx)
);
CREATE INDEX IF NOT EXISTS steps_member ON steps(member_id);
CREATE TABLE IF NOT EXISTS rate (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
