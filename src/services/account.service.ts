import { pool } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { NotFoundError, ValidationError } from '../utils/errors';

export interface Account {
  id: string;
  name: string;
  api_key: string;
  account_plan_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAccountInput {
  name: string;
  plan_id?: string;
}

/**
 * Generate a secure random API key.
 */
function generateApiKey(): string {
  return `mk_${crypto.randomBytes(32).toString('hex')}`;
}

export async function createAccount(
  input: CreateAccountInput
): Promise<Account & { api_key: string }> {
  const { name, plan_id } = input;

  if (!name || name.trim().length === 0) {
    throw new ValidationError('Account name is required');
  }

  // Validate plan if provided
  if (plan_id) {
    const planResult = await pool.query(
      "SELECT id, type FROM plans WHERE id = $1 AND type = 'account'",
      [plan_id]
    );
    if (planResult.rows.length === 0) {
      throw new ValidationError(
        `Plan '${plan_id}' is not a valid account plan`
      );
    }
  }

  const apiKey = generateApiKey();
  const result = await pool.query(
    `INSERT INTO accounts (name, api_key, account_plan_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name.trim(), apiKey, plan_id || null]
  );

  return result.rows[0];
}

export interface AccountWithPlan extends Account {
  plan?: {
    id: string;
    name: string;
    monthly_allowance: number;
    max_per_request: number;
    is_predefined: boolean;
  } | null;
}

export async function getAccountById(id: string): Promise<AccountWithPlan> {
  const result = await pool.query(
    `SELECT a.*,
            p.name as plan_name,
            p.monthly_allowance,
            p.max_per_request,
            p.is_predefined
     FROM accounts a
     LEFT JOIN plans p ON a.account_plan_id = p.id
     WHERE a.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Account', id);
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    account_plan_id: row.account_plan_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    plan: row.account_plan_id
      ? {
          id: row.account_plan_id,
          name: row.plan_name,
          monthly_allowance: row.monthly_allowance,
          max_per_request: row.max_per_request,
          is_predefined: row.is_predefined,
        }
      : null,
  };
}

export async function assignAccountPlan(
  accountId: string,
  planId: string
): Promise<Account> {
  // Validate plan exists and is an account plan
  const planResult = await pool.query(
    "SELECT id, type FROM plans WHERE id = $1 AND type = 'account'",
    [planId]
  );

  if (planResult.rows.length === 0) {
    throw new ValidationError(
      `Plan '${planId}' is not a valid account plan`
    );
  }

  // Also verify the plan is either predefined or belongs to this account
  const plan = await pool.query(
    'SELECT id FROM plans WHERE id = $1 AND (is_predefined = TRUE OR account_id = $2)',
    [planId, accountId]
  );

  if (plan.rows.length === 0) {
    throw new ValidationError(
      `Plan '${planId}' is not accessible to this account`
    );
  }

  const result = await pool.query(
    `UPDATE accounts
     SET account_plan_id = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [planId, accountId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Account', accountId);
  }

  return result.rows[0];
}
