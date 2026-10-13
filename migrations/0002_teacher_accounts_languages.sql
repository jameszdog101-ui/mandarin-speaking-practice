CREATE TABLE teachers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE teacher_sessions (
  token_hash TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE assignments ADD COLUMN teacher_id TEXT REFERENCES teachers(id);
ALTER TABLE assignments ADD COLUMN language TEXT NOT NULL DEFAULT 'zh-TW';
CREATE INDEX idx_assignments_teacher_language ON assignments(teacher_id, language, created_at);
CREATE INDEX idx_teacher_sessions_teacher ON teacher_sessions(teacher_id, expires_at);
