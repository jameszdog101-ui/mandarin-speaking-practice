ALTER TABLE assignments ADD COLUMN starts_at TEXT;
ALTER TABLE assignments ADD COLUMN ends_at TEXT;
ALTER TABLE sentences ADD COLUMN max_attempts INTEGER CHECK (max_attempts BETWEEN 1 AND 10);
UPDATE sentences SET max_attempts = (SELECT max_attempts FROM assignments WHERE assignments.id = sentences.assignment_id);
CREATE INDEX idx_assignments_teacher_schedule ON assignments(teacher_id, starts_at, ends_at, created_at);
