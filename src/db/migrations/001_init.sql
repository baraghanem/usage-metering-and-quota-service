-- ============================================================
-- Usage Metering and Quota Service — Database Schema
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Plans table
-- ============================================================
CREATE TABLE IF NOT EXISTS plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID,                          -- NULL for predefined plans
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('account', 'user')),
  is_predefined BOOLEAN NOT NULL DEFAULT FALSE,
  monthly_allowance   INTEGER NOT NULL CHECK (monthly_allowance > 0),
  max_per_request     INTEGER NOT NULL CHECK (max_per_request > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Accounts table
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  api_key         TEXT NOT NULL UNIQUE,
  account_plan_id UUID REFERENCES plans(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK from plans back to accounts (deferred because of circular dependency)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_plans_account'
  ) THEN
    ALTER TABLE plans
      ADD CONSTRAINT fk_plans_account
      FOREIGN KEY (account_id) REFERENCES accounts(id);
  END IF;
END;
$$;

-- ============================================================
-- Users table
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id),
  external_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  user_plan_id  UUID REFERENCES plans(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_users_account_id ON users(account_id);

-- ============================================================
-- Monthly usage tracking
-- Separate rows for account-level and user-level usage
-- ============================================================
CREATE TABLE IF NOT EXISTS usage_monthly (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id),
  user_id       UUID REFERENCES users(id),   -- NULL for account-level aggregate
  month         TEXT NOT NULL,                -- 'YYYY-MM' format, UTC
  units_consumed BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Note: NULL user_id rows (account-level) are handled by partial index below
  -- The 3-column unique allows multiple NULL user_id per (account_id, month) in PG,
  -- so account-level uniqueness is enforced separately via partial index.
  UNIQUE(account_id, user_id, month)
);

-- Partial unique index for account-level usage (user_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_monthly_account_month
  ON usage_monthly(account_id, month) WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_usage_monthly_user_month
  ON usage_monthly(user_id, month) WHERE user_id IS NOT NULL;

-- ============================================================
-- Request log / history
-- ============================================================
CREATE TABLE IF NOT EXISTS request_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  request_id        TEXT NOT NULL,             -- Client-supplied idempotency key
  units_requested   INTEGER NOT NULL,
  accepted          BOOLEAN NOT NULL,
  rejection_reason  TEXT,                      -- Human-readable reason
  rejection_level   TEXT,                      -- 'account' or 'user'
  rejection_rule    TEXT,                      -- 'monthly_allowance' or 'max_per_request'
  month             TEXT NOT NULL,             -- 'YYYY-MM'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_request_log_account_created
  ON request_log(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_log_user_created
  ON request_log(user_id, created_at DESC);

-- ============================================================
-- Seed: Predefined plans
-- ============================================================

-- Account plans
INSERT INTO plans (id, name, type, is_predefined, monthly_allowance, max_per_request)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Starter', 'account', TRUE, 10000, 100),
  ('a0000000-0000-0000-0000-000000000002', 'Pro',     'account', TRUE, 100000, 1000)
ON CONFLICT (id) DO NOTHING;

-- User plans
INSERT INTO plans (id, name, type, is_predefined, monthly_allowance, max_per_request)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Basic',   'user', TRUE, 1000, 20),
  ('b0000000-0000-0000-0000-000000000002', 'Premium', 'user', TRUE, 10000, 200)
ON CONFLICT (id) DO NOTHING;
