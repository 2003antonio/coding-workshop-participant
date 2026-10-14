-- Allocations: an employee works hours_per_week on a project between two dates.
-- The 40-hour weekly limit is enforced by the allocations service.
-- Plain DDL only (see 001_init.sql).

CREATE TABLE IF NOT EXISTS allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES employees (id),
    project_id uuid NOT NULL REFERENCES projects (id),
    hours_per_week integer NOT NULL CHECK (hours_per_week BETWEEN 1 AND 40),
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_by uuid NOT NULL REFERENCES employees (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS ix_allocations_employee ON allocations (employee_id);
CREATE INDEX IF NOT EXISTS ix_allocations_project ON allocations (project_id);
