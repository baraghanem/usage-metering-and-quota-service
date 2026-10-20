import { pool } from '../db/pool';
import { ValidationError, NotFoundError } from '../utils/errors';
import { getCurrentMonth, isValidMonth } from '../utils/month';

export interface UsageResponse {
  month: string;
  consumed: number;
  remaining: number;
  monthly_allowance: number;
  max_per_request: number;
  plan_name: string;
}

export interface HistoryEntry {
  id: string;
  user_id: string;
  request_id: string;
  units_requested: number;
  accepted: boolean;
  rejection_reason: string | null;
  rejection_level: string | null;
  rejection_rule: string | null;
  month: string;
  created_at: Date;
}

export interface PaginatedHistory {
  items: HistoryEntry[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * Get account-level usage for a given month.
 */
export async function getAccountUsage(
  accountId: string,
  month?: string
): Promise<UsageResponse> {
  const targetMonth = month || getCurrentMonth();

  if (!isValidMonth(targetMonth)) {
    throw new ValidationError(
      `Invalid month format '${targetMonth}'. Use YYYY-MM.`
    );
  }

  // Get account plan
  const accountResult = await pool.query(
    `SELECT a.*, p.name as plan_name, p.monthly_allowance, p.max_per_request
     FROM accounts a
     LEFT JOIN plans p ON a.account_plan_id = p.id
     WHERE a.id = $1`,
    [accountId]
  );

  if (accountResult.rows.length === 0) {
    throw new NotFoundError('Account', accountId);
  }

  const account = accountResult.rows[0];

  if (!account.account_plan_id) {
    throw new ValidationError('Account does not have a plan assigned');
  }

  // Get usage
  const usageResult = await pool.query(
    'SELECT units_consumed FROM usage_monthly WHERE account_id = $1 AND user_id IS NULL AND month = $2',
    [accountId, targetMonth]
  );

  const consumed =
    usageResult.rows.length > 0
      ? Number(usageResult.rows[0].units_consumed)
      : 0;

  return {
    month: targetMonth,
    consumed,
    remaining: Math.max(0, account.monthly_allowance - consumed),
    monthly_allowance: account.monthly_allowance,
    max_per_request: account.max_per_request,
    plan_name: account.plan_name,
  };
}

/**
 * Get user-level usage for a given month.
 */
export async function getUserUsage(
  accountId: string,
  userId: string,
  month?: string
): Promise<UsageResponse> {
  const targetMonth = month || getCurrentMonth();

  if (!isValidMonth(targetMonth)) {
    throw new ValidationError(
      `Invalid month format '${targetMonth}'. Use YYYY-MM.`
    );
  }

  // Get user plan
  const userResult = await pool.query(
    `SELECT u.*, p.name as plan_name, p.monthly_allowance, p.max_per_request
     FROM users u
     LEFT JOIN plans p ON u.user_plan_id = p.id
     WHERE u.id = $1 AND u.account_id = $2`,
    [userId, accountId]
  );

  if (userResult.rows.length === 0) {
    throw new NotFoundError('User', userId);
  }

  const user = userResult.rows[0];

  if (!user.user_plan_id) {
    throw new ValidationError('User does not have a plan assigned');
  }

  // Get usage
  const usageResult = await pool.query(
    'SELECT units_consumed FROM usage_monthly WHERE account_id = $1 AND user_id = $2 AND month = $3',
    [accountId, userId, targetMonth]
  );

  const consumed =
    usageResult.rows.length > 0
      ? Number(usageResult.rows[0].units_consumed)
      : 0;

  return {
    month: targetMonth,
    consumed,
    remaining: Math.max(0, user.monthly_allowance - consumed),
    monthly_allowance: user.monthly_allowance,
    max_per_request: user.max_per_request,
    plan_name: user.plan_name,
  };
}

/**
 * Get request history with pagination.
 */
export async function getHistory(
  accountId: string,
  options: {
    user_id?: string;
    month?: string;
    accepted?: boolean;
    page?: number;
    page_size?: number;
  } = {}
): Promise<PaginatedHistory> {
  const page = Math.max(1, options.page || 1);
  const pageSize = Math.min(100, Math.max(1, options.page_size || 20));
  const offset = (page - 1) * pageSize;

  let whereClause = 'WHERE rl.account_id = $1';
  const params: any[] = [accountId];
  let paramIndex = 2;

  if (options.user_id) {
    whereClause += ` AND rl.user_id = $${paramIndex++}`;
    params.push(options.user_id);
  }

  if (options.month) {
    if (!isValidMonth(options.month)) {
      throw new ValidationError(
        `Invalid month format '${options.month}'. Use YYYY-MM.`
      );
    }
    whereClause += ` AND rl.month = $${paramIndex++}`;
    params.push(options.month);
  }

  if (options.accepted !== undefined) {
    whereClause += ` AND rl.accepted = $${paramIndex++}`;
    params.push(options.accepted);
  }

  // Count total
  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM request_log rl ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Fetch page
  const queryParams = [...params, pageSize, offset];
  const result = await pool.query(
    `SELECT rl.id, rl.user_id, rl.request_id, rl.units_requested,
            rl.accepted, rl.rejection_reason, rl.rejection_level,
            rl.rejection_rule, rl.month, rl.created_at
     FROM request_log rl
     ${whereClause}
     ORDER BY rl.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    queryParams
  );

  return {
    items: result.rows,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  };
}
