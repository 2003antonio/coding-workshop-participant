-- Deliverables of a project, and the dependencies between them.
-- Cycles are refused by the projects service. Plain DDL only (see 001_init.sql).

CREATE TABLE IF NOT EXISTS deliverables (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects (id),
    name text NOT NULL CHECK (btrim(name) <> ''),
    description text NOT NULL DEFAULT '',
    start_date date NOT NULL,
    due_date date NOT NULL,
    status text NOT NULL DEFAULT 'not_started'
        CHECK (status IN ('not_started', 'in_progress', 'done')),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    CHECK (start_date <= due_date),
    -- completed_at is set exactly while the deliverable is done.
    CHECK ((status = 'done') = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_deliverables_project ON deliverables (project_id);

-- deliverable_id depends on depends_on_id: it cannot start until that one is done.
CREATE TABLE IF NOT EXISTS deliverable_dependencies (
    deliverable_id uuid NOT NULL REFERENCES deliverables (id),
    depends_on_id uuid NOT NULL REFERENCES deliverables (id),
    PRIMARY KEY (deliverable_id, depends_on_id),
    CHECK (deliverable_id <> depends_on_id)
);

CREATE INDEX IF NOT EXISTS ix_dependencies_depends_on ON deliverable_dependencies (depends_on_id);
