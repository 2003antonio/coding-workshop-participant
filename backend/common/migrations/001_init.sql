-- Initial schema for the ACME project tracking app: accounts, sessions, audit.
-- Projects and deliverables arrive in their own later migrations.
-- Plain DDL only (no dollar-quoted bodies, no semicolons inside strings),
-- because runner.py splits this file on ';' to run one statement at a time
-- (pg8000 does not allow multiple statements per execute).

-- gen_random_uuid() is built into PostgreSQL 13+, so no extension is needed.

-- 1) employees: every account. UUID id used as PK and in all logs.
CREATE TABLE IF NOT EXISTS employees (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    name text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'manager', 'employee')),
    password_hash text NOT NULL,
    job_title text NOT NULL CHECK (btrim(job_title) <> ''),
    salary numeric(12, 2) NOT NULL CHECK (salary >= 0),
    failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

-- Case-insensitive uniqueness on email.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_email_lower ON employees (lower(email));

-- 2) refresh_tokens: single-use refresh tokens. Only the SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES employees (id),
    token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    replaced_by uuid REFERENCES refresh_tokens (id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_refresh_token_hash ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS ix_refresh_employee ON refresh_tokens (employee_id);
CREATE INDEX IF NOT EXISTS ix_refresh_replaced_by ON refresh_tokens (replaced_by);

-- 3) audit_log: who did what, when. actor_id is null for anonymous/system
-- actions and has no FK, so audit rows outlive the records they describe.
CREATE TABLE IF NOT EXISTS audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid,
    action text NOT NULL,
    entity_type text,
    entity_id uuid,
    details jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log (created_at);
