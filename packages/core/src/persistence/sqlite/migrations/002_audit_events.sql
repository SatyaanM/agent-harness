-- Migration 002: Tamper-Evident Cryptographic Audit Ledger Table
CREATE TABLE IF NOT EXISTS audit_events (
  seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
  prev_hash TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  signature TEXT,
  CONSTRAINT chk_audit_seq_id_positive CHECK (seq_id > 0),
  CONSTRAINT chk_audit_prev_hash_len CHECK (length(prev_hash) = 64),
  CONSTRAINT chk_audit_current_hash_len CHECK (length(current_hash) = 64),
  CONSTRAINT chk_audit_actor_id_nonempty CHECK (length(actor_id) > 0),
  CONSTRAINT chk_audit_action_nonempty CHECK (length(action) > 0),
  CONSTRAINT chk_audit_resource_type_nonempty CHECK (length(resource_type) > 0),
  CONSTRAINT chk_audit_resource_id_nonempty CHECK (length(resource_id) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_current_hash ON audit_events(current_hash);
CREATE INDEX IF NOT EXISTS idx_audit_events_action_ts ON audit_events(action, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON audit_events(resource_type, resource_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_type, actor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor_id ON audit_events(actor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp DESC);
