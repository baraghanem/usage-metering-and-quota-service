import { Router, Response, NextFunction } from 'express';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import * as planService from '../services/plan.service';

const router = Router();

// All plan routes require authentication
router.use(authMiddleware);

/**
 * GET /api/plans
 * List available plans (predefined + account's custom plans).
 * Optional query param: type=account|user
 */
router.get(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const plans = await planService.listPlans(
        req.account!.id,
        req.query.type as string | undefined
      );
      res.json({ plans });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/plans
 * Create a custom plan for the authenticated account.
 */
router.post(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const plan = await planService.createPlan(req.account!.id, req.body);
      res.status(201).json({ plan });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/plans/:planId
 * Get plan details.
 */
router.get(
  '/:planId',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const plan = await planService.getPlanById(
        req.account!.id,
        req.params.planId
      );
      res.json({ plan });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/plans/:planId
 * Update a custom plan. Predefined plans are read-only.
 */
router.patch(
  '/:planId',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const plan = await planService.updatePlan(
        req.account!.id,
        req.params.planId,
        req.body
      );
      res.json({
        message: 'Plan updated successfully',
        plan,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
