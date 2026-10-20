import { pool } from '../db/pool';
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} from '../utils/errors';

export interface Plan {
  id: string;
  account_id: string | null;
  name: string;
  type: 'account' | 'user';
  is_predefined: boolean;
  monthly_allowance: number;
  max_per_request: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePlanInput {
  name: string;
  type: 'account' | 'user';
  monthly_allowance: number;
  max_per_request: number;
}

export interface UpdatePlanInput {
  name?: string;
  monthly_allowance?: number;
  max_per_request?: number;
}

export async function listPlans(
  accountId: string,
  typeFilter?: string
): Promise<Plan[]> {
  let query = `
    SELECT * FROM plans
    WHERE (is_predefined = TRUE OR account_id = $1)
  `;
  const params: any[] = [accountId];

  if (typeFilter && (typeFilter === 'account' || typeFilter === 'user')) {
    query += ' AND type = $2';
    params.push(typeFilter);
  }

  query += ' ORDER BY is_predefined DESC, name ASC';

  const result = await pool.query(query, params);
  return result.rows;
}

export async function getPlanById(
  accountId: string,
  planId: string
): Promise<Plan> {
  const result = await pool.query(
    'SELECT * FROM plans WHERE id = $1 AND (is_predefined = TRUE OR account_id = $2)',
    [planId, accountId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Plan', planId);
  }

  return result.rows[0];
}

export async function createPlan(
  accountId: string,
  input: CreatePlanInput
): Promise<Plan> {
  const { name, type, monthly_allowance, max_per_request } = input;

  if (!name || name.trim().length === 0) {
    throw new ValidationError('Plan name is required');
  }

  if (!type || !['account', 'user'].includes(type)) {
    throw new ValidationError("Plan type must be 'account' or 'user'");
  }

  if (
    !monthly_allowance ||
    !Number.isInteger(monthly_allowance) ||
    monthly_allowance <= 0
  ) {
    throw new ValidationError(
      'monthly_allowance must be a positive integer'
    );
  }

  if (
    !max_per_request ||
    !Number.isInteger(max_per_request) ||
    max_per_request <= 0
  ) {
    throw new ValidationError('max_per_request must be a positive integer');
  }

  const result = await pool.query(
    `INSERT INTO plans (account_id, name, type, is_predefined, monthly_allowance, max_per_request)
     VALUES ($1, $2, $3, FALSE, $4, $5)
     RETURNING *`,
    [accountId, name.trim(), type, monthly_allowance, max_per_request]
  );

  return result.rows[0];
}

export async function updatePlan(
  accountId: string,
  planId: string,
  input: UpdatePlanInput
): Promise<Plan> {
  // Verify plan exists and is editable
  const existing = await pool.query(
    'SELECT * FROM plans WHERE id = $1',
    [planId]
  );

  if (existing.rows.length === 0) {
    throw new NotFoundError('Plan', planId);
  }

  const plan = existing.rows[0] as Plan;

  if (plan.is_predefined) {
    throw new ForbiddenError('Predefined plans cannot be modified');
  }

  if (plan.account_id !== accountId) {
    throw new ForbiddenError('You can only modify your own custom plans');
  }

  // Build update
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    if (input.name.trim().length === 0) {
      throw new ValidationError('Plan name cannot be empty');
    }
    updates.push(`name = $${paramIndex++}`);
    values.push(input.name.trim());
  }

  if (input.monthly_allowance !== undefined) {
    if (
      !Number.isInteger(input.monthly_allowance) ||
      input.monthly_allowance <= 0
    ) {
      throw new ValidationError(
        'monthly_allowance must be a positive integer'
      );
    }
    updates.push(`monthly_allowance = $${paramIndex++}`);
    values.push(input.monthly_allowance);
  }

  if (input.max_per_request !== undefined) {
    if (
      !Number.isInteger(input.max_per_request) ||
      input.max_per_request <= 0
    ) {
      throw new ValidationError(
        'max_per_request must be a positive integer'
      );
    }
    updates.push(`max_per_request = $${paramIndex++}`);
    values.push(input.max_per_request);
  }

  if (updates.length === 0) {
    throw new ValidationError('No fields to update');
  }

  updates.push(`updated_at = NOW()`);
  values.push(planId);

  const result = await pool.query(
    `UPDATE plans SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result.rows[0];
}
