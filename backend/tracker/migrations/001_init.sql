-- Initial schema for the ACME project tracking app.
-- Safe to run repeatedly: every object uses IF NOT EXISTS.
-- Plain DDL only (no dollar-quoted bodies, no semicolons inside strings),
-- because runner.py splits this file on ';' to run one statement at a time
-- (pg8000 does not allow multiple statements per execute).

-- gen_random_uuid() is built into PostgreSQL 13+ (local is 18, Aurora is 17.7),
-- so no pgcrypto extension is needed.

-- 1) employees: every account. UUID id used as PK and in all logs.
CREATE TABLE IF NOT EXISTS employees (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    name text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'manager', 'employee')),
    password_hash text NOT NULL,
    failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

-- Case-insensitive uniqueness on email.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_email_lower ON employees (lower(email));

-- 2) projects: exactly one manager per project.
CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    manager_id uuid NOT NULL REFERENCES employees (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_projects_manager ON projects (manager_id);

-- 3) project_members: who is on a project.
CREATE TABLE IF NOT EXISTS project_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects (id),
    employee_id uuid NOT NULL REFERENCES employees (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    UNIQUE (project_id, employee_id)
);

CREATE INDEX IF NOT EXISTS ix_project_members_employee ON project_members (employee_id);

-- 4) milestones: dated work items on a project. end_date must not precede start.
CREATE TABLE IF NOT EXISTS milestones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects (id),
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS ix_milestones_project ON milestones (project_id);

-- 5) milestone_dependencies: a milestone depends on another. No self-dependency.
CREATE TABLE IF NOT EXISTS milestone_dependencies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id uuid NOT NULL REFERENCES milestones (id),
    depends_on_id uuid NOT NULL REFERENCES milestones (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    CHECK (milestone_id <> depends_on_id),
    UNIQUE (milestone_id, depends_on_id)
);

-- 6) milestone_assignments: an employee on a milestone, at <= 40 hours/week.
CREATE TABLE IF NOT EXISTS milestone_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id uuid NOT NULL REFERENCES milestones (id),
    employee_id uuid NOT NULL REFERENCES employees (id),
    hours_per_week integer NOT NULL CHECK (hours_per_week > 0 AND hours_per_week <= 40),
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    UNIQUE (milestone_id, employee_id)
);

CREATE INDEX IF NOT EXISTS ix_assignments_employee ON milestone_assignments (employee_id);

-- 7) audit_log: who did what, when. actor_id null for system actions.
CREATE TABLE IF NOT EXISTS audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid REFERENCES employees (id),
    action text NOT NULL,
    entity_type text,
    entity_id uuid,
    details jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_audit_actor ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log (created_at);

-- 8) refresh_tokens: single-use refresh tokens. Only the hash is stored.
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES employees (id),
    token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    replaced_by uuid REFERENCES refresh_tokens (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_refresh_token_hash ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS ix_refresh_employee ON refresh_tokens (employee_id);
