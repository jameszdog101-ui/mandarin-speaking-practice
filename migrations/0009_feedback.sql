CREATE TABLE feedback (
 session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
 draft_json TEXT NOT NULL DEFAULT '{}', published_json TEXT,
 version INTEGER NOT NULL DEFAULT 0, published_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE feedback_audio (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 r2_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX idx_feedback_audio_session ON feedback_audio(session_id);
