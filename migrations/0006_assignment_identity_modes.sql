ALTER TABLE assignments ADD COLUMN identity_mode TEXT NOT NULL DEFAULT 'full' CHECK (identity_mode IN ('full', 'name_only', 'anonymous'));
UPDATE assignments SET identity_mode = CASE WHEN anonymous = 1 THEN 'anonymous' ELSE 'full' END;
CREATE INDEX idx_assignments_identity_mode ON assignments(identity_mode, created_at);
