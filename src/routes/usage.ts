import { Router, Response, NextFunction } from 'express';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import * as usageService from '../services/usage.service';

const router = Router();

// All usage routes require authentication
router.use(authMiddleware);

/**
 * GET /api/usage/account
 * Get account-level usage. Optional query param: month=YYYY-MM
 */
router.get(
  '/account',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const usage = await usageService.getAccountUsage(
        req.account!.id,
        req.query.month as string | undefined
      );
      res.json({ usage });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/usage/users/:userId
 * Get user-level usage. Optional query param: month=YYYY-MM
 */
router.get(
  '/users/:userId',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const usage = await usageService.getUserUsage(
        req.account!.id,
        req.params.userId,
        req.query.month as string | undefined
      );
      res.json({ usage });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/history
 * Get request history with pagination.
 * Query params: user_id, month, accepted (true/false), page, page_size
 */
router.get(
  '/history',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const options: any = {};

      if (req.query.user_id) options.user_id = req.query.user_id;
      if (req.query.month) options.month = req.query.month;
      if (req.query.accepted !== undefined) {
        options.accepted = req.query.accepted === 'true';
      }
      if (req.query.page) options.page = parseInt(req.query.page as string, 10);
      if (req.query.page_size) {
        options.page_size = parseInt(req.query.page_size as string, 10);
      }

      const history = await usageService.getHistory(
        req.account!.id,
        options
      );
      res.json(history);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
