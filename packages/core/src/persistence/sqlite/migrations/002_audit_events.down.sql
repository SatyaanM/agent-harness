-- Reversible down migration for audit events
DROP INDEX IF EXISTS idx_audit_events_timestamp;
DROP INDEX IF EXISTS idx_audit_events_actor_id;
DROP INDEX IF EXISTS idx_audit_events_actor;
DROP INDEX IF EXISTS idx_audit_events_resource;
DROP INDEX IF EXISTS idx_audit_events_action_ts;
DROP INDEX IF EXISTS idx_audit_events_current_hash;
DROP TABLE IF EXISTS audit_events;
