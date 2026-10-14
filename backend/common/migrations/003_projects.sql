-- Projects. Each belongs to one team; its manager is that team's current lead
-- (derived by a join, never stored). Plain DDL only (see 001_init.sql).

CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams (id),
    name text NOT NULL CHECK (btrim(name) <> ''),
    description text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'active', 'on_hold', 'completed')),
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS ix_projects_team ON projects (team_id);
