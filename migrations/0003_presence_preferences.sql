-- Private owner preferences only. Existing presence remains off by default.
ALTER TABLE presence_state ADD COLUMN manual_label TEXT;
ALTER TABLE presence_state ADD COLUMN public_projects_json TEXT;
