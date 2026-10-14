-- A planned budget typed in per project (not derived from salaries).
-- NULL means no budget has been set. Plain DDL only (see 001_init.sql).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS planned_budget numeric(12, 2)
    CHECK (planned_budget >= 0);
