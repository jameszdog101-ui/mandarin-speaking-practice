ALTER TABLE sessions ADD COLUMN deleted_at TEXT;
ALTER TABLE sessions ADD COLUMN purge_after TEXT;
ALTER TABLE sessions ADD COLUMN deleted_by TEXT REFERENCES teachers(id);
CREATE INDEX idx_session_trash ON sessions(deleted_at, purge_after);
