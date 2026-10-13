ALTER TABLE assignments ADD COLUMN deidentify_voice INTEGER NOT NULL DEFAULT 0 CHECK (deidentify_voice IN (0, 1));
ALTER TABLE assignments ADD COLUMN transform_version TEXT;
ALTER TABLE sessions ADD COLUMN voice_profile TEXT CHECK (voice_profile IN ('PROFILE_A_M', 'PROFILE_A_F'));
ALTER TABLE attempts ADD COLUMN transform_profile TEXT;
ALTER TABLE attempts ADD COLUMN transform_version TEXT;

CREATE INDEX idx_assignments_deidentify ON assignments(deidentify_voice, created_at);
