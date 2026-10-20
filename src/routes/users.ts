import { Router, Response, NextFunction } from 'express';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import * as userService from '../services/user.service';

const router = Router();

// All user routes require authentication
router.use(authMiddleware);

/**
 * POST /api/users
 * Register a new user under the authenticated account.
 */
router.post(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = await userService.createUser(req.account!.id, req.body);
      res.status(201).json({ user });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/users
 * List all users for the authenticated account.
 */
router.get(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const result = await userService.listUsers(
        req.account!.id,
        limit,
        offset
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/users/:userId
 * Get details of a specific user.
 */
router.get(
  '/:userId',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = await userService.getUserById(
        req.account!.id,
        req.params.userId
      );
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/users/:userId/plan
 * Assign or change a user's plan.
 */
router.patch(
  '/:userId/plan',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { plan_id } = req.body;
      if (!plan_id) {
        res.status(400).json({ error: { message: 'plan_id is required' } });
        return;
      }
      const user = await userService.assignUserPlan(
        req.account!.id,
        req.params.userId,
        plan_id
      );
      res.json({
        message: 'User plan updated successfully',
        user,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
