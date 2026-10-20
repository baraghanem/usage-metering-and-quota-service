import { Router, Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import * as accountService from '../services/account.service';

const router = Router();

/**
 * POST /api/accounts
 * Create a new account and receive an API key.
 * This is the only endpoint that does NOT require authentication.
 */
router.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const account = await accountService.createAccount(req.body);
      res.status(201).json({
        message: 'Account created successfully. Store the API key securely — it will not be shown again.',
        account: {
          id: account.id,
          name: account.name,
          api_key: account.api_key,
          account_plan_id: account.account_plan_id,
          created_at: account.created_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/accounts/me
 * Get current account details (identified by API key).
 */
router.get(
  '/me',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const account = await accountService.getAccountById(req.account!.id);
      // Don't return the full API key
      res.json({
        account: {
          id: account.id,
          name: account.name,
          api_key_prefix: account.api_key.substring(0, 10) + '...',
          account_plan_id: account.account_plan_id,
          plan: account.plan,
          created_at: account.created_at,
          updated_at: account.updated_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/accounts/me/plan
 * Assign or change the account's plan.
 */
router.patch(
  '/me/plan',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { plan_id } = req.body;
      if (!plan_id) {
        res.status(400).json({ error: { message: 'plan_id is required' } });
        return;
      }
      const account = await accountService.assignAccountPlan(
        req.account!.id,
        plan_id
      );
      res.json({
        message: 'Account plan updated successfully',
        account: {
          id: account.id,
          name: account.name,
          account_plan_id: account.account_plan_id,
          updated_at: account.updated_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
