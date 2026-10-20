CREATE TABLE students (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL, student_number TEXT NOT NULL DEFAULT '',
 password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
 must_change_password INTEGER NOT NULL DEFAULT 1,
 disabled_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE teacher_students (
 teacher_id TEXT NOT NULL REFERENCES teachers(id), student_id TEXT NOT NULL REFERENCES students(id),
 PRIMARY KEY(teacher_id,student_id)
);
CREATE TABLE student_logins (
 token_hash TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL
);
CREATE INDEX idx_student_logins ON student_logins(student_id,expires_at);
ALTER TABLE sessions ADD COLUMN student_account_id TEXT REFERENCES students(id);
CREATE INDEX idx_student_history ON sessions(student_account_id,started_at);
CREATE TABLE student_login_limits (key TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL);
