import { pool } from '../db/pool';
import {
  NotFoundError,
  ValidationError,
  ConflictError,
} from '../utils/errors';

export interface User {
  id: string;
  account_id: string;
  external_id: string;
  name: string;
  user_plan_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserInput {
  external_id: string;
  name: string;
  plan_id?: string;
}

export async function createUser(
  accountId: string,
  input: CreateUserInput
): Promise<User> {
  const { external_id, name, plan_id } = input;

  if (!external_id || external_id.trim().length === 0) {
    throw new ValidationError('User external_id is required');
  }

  if (!name || name.trim().length === 0) {
    throw new ValidationError('User name is required');
  }

  // Validate plan if provided
  if (plan_id) {
    const planResult = await pool.query(
      "SELECT id FROM plans WHERE id = $1 AND type = 'user' AND (is_predefined = TRUE OR account_id = $2)",
      [plan_id, accountId]
    );
    if (planResult.rows.length === 0) {
      throw new ValidationError(
        `Plan '${plan_id}' is not a valid user plan accessible to this account`
      );
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO users (account_id, external_id, name, user_plan_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [accountId, external_id.trim(), name.trim(), plan_id || null]
    );

    return result.rows[0];
  } catch (err: any) {
    if (err.code === '23505') {
      // unique violation
      throw new ConflictError(
        `User with external_id '${external_id}' already exists in this account`
      );
    }
    throw err;
  }
}

export interface UserWithPlan extends User {
  plan?: {
    id: string;
    name: string;
    monthly_allowance: number;
    max_per_request: number;
    is_predefined: boolean;
  } | null;
}

export async function listUsers(
  accountId: string,
  limit = 50,
  offset = 0
): Promise<{ users: UserWithPlan[]; total: number }> {
  const countResult = await pool.query(
    'SELECT COUNT(*) as total FROM users WHERE account_id = $1',
    [accountId]
  );

  const result = await pool.query(
    `SELECT u.*,
            p.name as plan_name,
            p.monthly_allowance,
            p.max_per_request,
            p.is_predefined
     FROM users u
     LEFT JOIN plans p ON u.user_plan_id = p.id
     WHERE u.account_id = $1
     ORDER BY u.created_at DESC
     LIMIT $2 OFFSET $3`,
    [accountId, limit, offset]
  );

  const users: UserWithPlan[] = result.rows.map((row) => ({
    id: row.id,
    account_id: row.account_id,
    external_id: row.external_id,
    name: row.name,
    user_plan_id: row.user_plan_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    plan: row.user_plan_id
      ? {
          id: row.user_plan_id,
          name: row.plan_name,
          monthly_allowance: row.monthly_allowance,
          max_per_request: row.max_per_request,
          is_predefined: row.is_predefined,
        }
      : null,
  }));

  return {
    users,
    total: parseInt(countResult.rows[0].total, 10),
  };
}

export async function getUserById(
  accountId: string,
  userId: string
): Promise<UserWithPlan> {
  const result = await pool.query(
    `SELECT u.*,
            p.name as plan_name,
            p.monthly_allowance,
            p.max_per_request,
            p.is_predefined
     FROM users u
     LEFT JOIN plans p ON u.user_plan_id = p.id
     WHERE u.id = $1 AND u.account_id = $2`,
    [userId, accountId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('User', userId);
  }

  const row = result.rows[0];
  return {
    id: row.id,
    account_id: row.account_id,
    external_id: row.external_id,
    name: row.name,
    user_plan_id: row.user_plan_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    plan: row.user_plan_id
      ? {
          id: row.user_plan_id,
          name: row.plan_name,
          monthly_allowance: row.monthly_allowance,
          max_per_request: row.max_per_request,
          is_predefined: row.is_predefined,
        }
      : null,
  };
}

export async function assignUserPlan(
  accountId: string,
  userId: string,
  planId: string
): Promise<User> {
  // Validate plan exists, is a user plan, and is accessible
  const planResult = await pool.query(
    "SELECT id FROM plans WHERE id = $1 AND type = 'user' AND (is_predefined = TRUE OR account_id = $2)",
    [planId, accountId]
  );

  if (planResult.rows.length === 0) {
    throw new ValidationError(
      `Plan '${planId}' is not a valid user plan accessible to this account`
    );
  }

  const result = await pool.query(
    `UPDATE users
     SET user_plan_id = $1, updated_at = NOW()
     WHERE id = $2 AND account_id = $3
     RETURNING *`,
    [planId, userId, accountId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('User', userId);
  }

  return result.rows[0];
}
