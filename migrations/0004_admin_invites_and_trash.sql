ALTER TABLE teachers ADD COLUMN role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher', 'super_admin'));
ALTER TABLE teachers ADD COLUMN active_from TEXT;
ALTER TABLE teachers ADD COLUMN active_until TEXT;
ALTER TABLE teachers ADD COLUMN disabled_at TEXT;
UPDATE teachers SET role = 'super_admin' WHERE lower(email) = 'jameszdog101@gmail.com';

CREATE TABLE teacher_invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active_from TEXT,
  active_until TEXT,
  invited_by TEXT NOT NULL REFERENCES teachers(id),
  created_at TEXT NOT NULL,
  used_at TEXT
);

ALTER TABLE assignments ADD COLUMN deleted_at TEXT;
ALTER TABLE assignments ADD COLUMN purge_after TEXT;
ALTER TABLE assignments ADD COLUMN deleted_by TEXT;
ALTER TABLE attempts ADD COLUMN deleted_at TEXT;
ALTER TABLE attempts ADD COLUMN purge_after TEXT;

CREATE INDEX idx_invites_email ON teacher_invites(email, used_at);
CREATE INDEX idx_assignments_trash ON assignments(deleted_at, purge_after);
CREATE INDEX idx_attempts_trash ON attempts(deleted_at, purge_after);
