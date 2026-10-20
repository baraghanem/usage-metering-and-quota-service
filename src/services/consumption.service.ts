import { pool } from '../db/pool';
import { ValidationError, NotFoundError } from '../utils/errors';
import { getCurrentMonth } from '../utils/month';
import { evaluateRules } from './rules.engine';

export interface ConsumeInput {
  user_id: string;
  units: number;
  request_id: string;
}

export interface ConsumeResult {
  accepted: boolean;
  request_id: string;
  units_requested: number;
  rejection?: {
    reason: string;
    level: 'account' | 'user';
    rule: 'monthly_allowance' | 'max_per_request';
  };
  account_usage?: {
    consumed: number;
    remaining: number;
    monthly_allowance: number;
  };
  user_usage?: {
    consumed: number;
    remaining: number;
    monthly_allowance: number;
  };
}

/**
 * Core consumption logic. Uses a serializable transaction with row-level
 * locks to ensure correctness under concurrent access.
 *
 * Steps:
 * 1. Check idempotency (return cached result if request_id already exists)
 * 2. Validate user belongs to account and both have plans
 * 3. Check max_per_request rules (user then account)
 * 4. Lock and check monthly allowance (user then account)
 * 5. If all pass, increment usage and log acceptance
 * 6. If any fail, log rejection (nothing consumed)
 */
export async function consumeUnits(
  accountId: string,
  input: ConsumeInput
): Promise<ConsumeResult> {
  const { user_id, units, request_id } = input;

  // Input validation
  if (!user_id) {
    throw new ValidationError('user_id is required');
  }
  if (!request_id || request_id.trim().length === 0) {
    throw new ValidationError('request_id is required');
  }
  if (!Number.isInteger(units) || units <= 0) {
    throw new ValidationError('units must be a positive integer');
  }

  const month = getCurrentMonth();

  // Check idempotency outside transaction for fast path
  const existingRequest = await pool.query(
    'SELECT * FROM request_log WHERE account_id = $1 AND request_id = $2',
    [accountId, request_id]
  );

  if (existingRequest.rows.length > 0) {
    const existing = existingRequest.rows[0];
    return buildResultFromLog(existing, accountId, user_id, month);
  }

  // Run the consumption in a transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Re-check idempotency inside transaction (race condition guard)
    const existingInTx = await client.query(
      'SELECT * FROM request_log WHERE account_id = $1 AND request_id = $2 FOR UPDATE',
      [accountId, request_id]
    );

    if (existingInTx.rows.length > 0) {
      await client.query('COMMIT');
      return buildResultFromLog(existingInTx.rows[0], accountId, user_id, month);
    }

    // Verify user belongs to account and get their plan
    const userResult = await client.query(
      'SELECT u.*, p.monthly_allowance as user_monthly_allowance, p.max_per_request as user_max_per_request FROM users u LEFT JOIN plans p ON u.user_plan_id = p.id WHERE u.id = $1 AND u.account_id = $2',
      [user_id, accountId]
    );

    if (userResult.rows.length === 0) {
      throw new NotFoundError('User', user_id);
    }

    const user = userResult.rows[0];

    if (!user.user_plan_id) {
      throw new ValidationError(
        'User does not have a plan assigned. Assign a plan before consuming units.'
      );
    }

    // Get account plan
    const accountResult = await client.query(
      'SELECT a.*, p.monthly_allowance as account_monthly_allowance, p.max_per_request as account_max_per_request FROM accounts a LEFT JOIN plans p ON a.account_plan_id = p.id WHERE a.id = $1',
      [accountId]
    );

    const account = accountResult.rows[0];

    if (!account.account_plan_id) {
      throw new ValidationError(
        'Account does not have a plan assigned. Assign a plan before consuming units.'
      );
    }

    const userMonthlyAllowance = user.user_monthly_allowance;
    const userMaxPerRequest = user.user_max_per_request;
    const accountMonthlyAllowance = account.account_monthly_allowance;
    const accountMaxPerRequest = account.account_max_per_request;

    // 1. Lock user and account usage rows
    const userUsage = await getOrCreateUsageWithLock(
      client, accountId, user_id, month
    );
    const accountUsage = await getOrCreateUsageWithLock(
      client, accountId, null, month
    );

    const userConsumed = Number(userUsage.units_consumed);
    const accountConsumed = Number(accountUsage.units_consumed);

    // 2. Evaluate all rules
    const evaluation = evaluateRules({
      units,
      userRules: {
        monthly_allowance: userMonthlyAllowance,
        max_per_request: userMaxPerRequest,
      },
      accountRules: {
        monthly_allowance: accountMonthlyAllowance,
        max_per_request: accountMaxPerRequest,
      },
      userConsumed,
      accountConsumed,
    });

    if (!evaluation.allowed && evaluation.rejection) {
      const result = await logRejection(
        client, accountId, user_id, request_id, units, month,
        evaluation.rejection.reason,
        evaluation.rejection.level,
        evaluation.rejection.rule
      );
      await client.query('COMMIT');
      return {
        ...result,
        account_usage: {
          consumed: accountConsumed,
          remaining: Math.max(0, accountMonthlyAllowance - accountConsumed),
          monthly_allowance: accountMonthlyAllowance,
        },
        user_usage: {
          consumed: userConsumed,
          remaining: Math.max(0, userMonthlyAllowance - userConsumed),
          monthly_allowance: userMonthlyAllowance,
        },
      };
    }

    // ---- All checks passed — consume ----

    // Increment user usage
    await client.query(
      'UPDATE usage_monthly SET units_consumed = units_consumed + $1, updated_at = NOW() WHERE id = $2',
      [units, userUsage.id]
    );

    // Increment account usage
    await client.query(
      'UPDATE usage_monthly SET units_consumed = units_consumed + $1, updated_at = NOW() WHERE id = $2',
      [units, accountUsage.id]
    );

    // Log acceptance
    await client.query(
      `INSERT INTO request_log (account_id, user_id, request_id, units_requested, accepted, month)
       VALUES ($1, $2, $3, $4, TRUE, $5)`,
      [accountId, user_id, request_id, units, month]
    );

    await client.query('COMMIT');

    return {
      accepted: true,
      request_id,
      units_requested: units,
      account_usage: {
        consumed: accountConsumed + units,
        remaining: Math.max(0, accountMonthlyAllowance - accountConsumed - units),
        monthly_allowance: accountMonthlyAllowance,
      },
      user_usage: {
        consumed: userConsumed + units,
        remaining: Math.max(0, userMonthlyAllowance - userConsumed - units),
        monthly_allowance: userMonthlyAllowance,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get or insert a usage_monthly row with a row lock for the transaction.
 */
async function getOrCreateUsageWithLock(
  client: any,
  accountId: string,
  userId: string | null,
  month: string
): Promise<{ id: string; units_consumed: number }> {
  // Try to lock existing row
  let result;
  if (userId) {
    result = await client.query(
      'SELECT id, units_consumed FROM usage_monthly WHERE account_id = $1 AND user_id = $2 AND month = $3 FOR UPDATE',
      [accountId, userId, month]
    );
  } else {
    result = await client.query(
      'SELECT id, units_consumed FROM usage_monthly WHERE account_id = $1 AND user_id IS NULL AND month = $2 FOR UPDATE',
      [accountId, month]
    );
  }

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  // Insert new row (with conflict handling for race conditions)
  try {
    if (userId) {
      result = await client.query(
        `INSERT INTO usage_monthly (account_id, user_id, month, units_consumed)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (account_id, user_id, month) DO UPDATE SET updated_at = NOW()
         RETURNING id, units_consumed`,
        [accountId, userId, month]
      );
    } else {
      result = await client.query(
        `INSERT INTO usage_monthly (account_id, user_id, month, units_consumed)
         VALUES ($1, NULL, $2, 0)
         ON CONFLICT (account_id, month) WHERE user_id IS NULL DO UPDATE SET updated_at = NOW()
         RETURNING id, units_consumed`,
        [accountId, month]
      );
    }
    return result.rows[0];
  } catch (err: any) {
    // If conflict, re-fetch with lock
    if (userId) {
      result = await client.query(
        'SELECT id, units_consumed FROM usage_monthly WHERE account_id = $1 AND user_id = $2 AND month = $3 FOR UPDATE',
        [accountId, userId, month]
      );
    } else {
      result = await client.query(
        'SELECT id, units_consumed FROM usage_monthly WHERE account_id = $1 AND user_id IS NULL AND month = $2 FOR UPDATE',
        [accountId, month]
      );
    }
    return result.rows[0];
  }
}

/**
 * Log a rejection and return the result.
 */
async function logRejection(
  client: any,
  accountId: string,
  userId: string,
  requestId: string,
  units: number,
  month: string,
  reason: string,
  level: 'account' | 'user',
  rule: 'monthly_allowance' | 'max_per_request'
): Promise<ConsumeResult> {
  await client.query(
    `INSERT INTO request_log (account_id, user_id, request_id, units_requested, accepted, rejection_reason, rejection_level, rejection_rule, month)
     VALUES ($1, $2, $3, $4, FALSE, $5, $6, $7, $8)`,
    [accountId, userId, requestId, units, reason, level, rule, month]
  );

  return {
    accepted: false,
    request_id: requestId,
    units_requested: units,
    rejection: { reason, level, rule },
  };
}

/**
 * Build a ConsumeResult from an existing request_log entry (for idempotency).
 */
async function buildResultFromLog(
  log: any,
  accountId: string,
  userId: string,
  month: string
): Promise<ConsumeResult> {
  const result: ConsumeResult = {
    accepted: log.accepted,
    request_id: log.request_id,
    units_requested: log.units_requested,
  };

  if (!log.accepted) {
    result.rejection = {
      reason: log.rejection_reason,
      level: log.rejection_level,
      rule: log.rejection_rule,
    };
  }

  return result;
}

/**
 * Helper to get usage snapshot for response (outside transaction).
 */
async function getUsageSnapshot(
  accountId: string,
  userId: string | null,
  month: string,
  monthlyAllowance: number
): Promise<{ consumed: number; remaining: number; monthly_allowance: number }> {
  let result;
  if (userId) {
    result = await pool.query(
      'SELECT units_consumed FROM usage_monthly WHERE account_id = $1 AND user_id = $2 AND month = $3',
      [accountId, userId, month]
    );
  } else {
    result = await pool.query(
      'SELECT units_consumed FROM usage_monthly WHERE account_id = $1 AND user_id IS NULL AND month = $2',
      [accountId, month]
    );
  }

  const consumed = result.rows.length > 0 ? Number(result.rows[0].units_consumed) : 0;
  return {
    consumed,
    remaining: Math.max(0, monthlyAllowance - consumed),
    monthly_allowance: monthlyAllowance,
  };
}
