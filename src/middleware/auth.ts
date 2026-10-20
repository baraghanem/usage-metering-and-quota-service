import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { AuthenticationError, ForbiddenError } from '../utils/errors';

export interface AuthenticatedRequest extends Request {
  account?: {
    id: string;
    name: string;
    api_key: string;
    account_plan_id: string | null;
  };
}

/**
 * Middleware that validates the X-API-Key header and attaches the account
 * to the request object.
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = req.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      throw new AuthenticationError('Missing X-API-Key header');
    }

    const result = await pool.query(
      'SELECT id, name, api_key, account_plan_id FROM accounts WHERE api_key = $1',
      [apiKey]
    );

    if (result.rows.length === 0) {
      throw new AuthenticationError('Invalid API key');
    }

    req.account = result.rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Validate that a user belongs to the authenticated account.
 */
export async function validateUserBelongsToAccount(
  accountId: string,
  userId: string
): Promise<void> {
  const result = await pool.query(
    'SELECT id FROM users WHERE id = $1 AND account_id = $2',
    [userId, accountId]
  );

  if (result.rows.length === 0) {
    throw new ForbiddenError(
      `User '${userId}' does not belong to this account`
    );
  }
}
