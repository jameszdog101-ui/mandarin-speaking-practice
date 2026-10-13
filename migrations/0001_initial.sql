PRAGMA foreign_keys = ON;

CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  admin_key_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  max_attempts INTEGER NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 10),
  created_at TEXT NOT NULL
);

CREATE TABLE sentences (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  pinyin TEXT NOT NULL DEFAULT '',
  UNIQUE (assignment_id, position)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  name TEXT,
  student_id TEXT,
  anonymous_id TEXT,
  device_test_confirmed_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE answers (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sentence_id TEXT NOT NULL REFERENCES sentences(id),
  accepted_attempt INTEGER,
  PRIMARY KEY (session_id, sentence_id)
);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sentence_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id, sentence_id) REFERENCES answers(session_id, sentence_id) ON DELETE CASCADE,
  UNIQUE (session_id, sentence_id, attempt_number)
);

CREATE INDEX idx_assignments_code ON assignments(code);
CREATE INDEX idx_sentences_assignment ON sentences(assignment_id, position);
CREATE INDEX idx_sessions_assignment ON sessions(assignment_id, started_at);
CREATE INDEX idx_attempts_answer ON attempts(session_id, sentence_id, attempt_number);
