import { Router, Response, NextFunction } from 'express';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import * as consumptionService from '../services/consumption.service';

const router = Router();

// Consume route requires authentication
router.use(authMiddleware);

/**
 * POST /api/consume
 * Consume units for a user.
 * Requires: user_id, units (positive integer), request_id (idempotency key).
 */
router.post(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await consumptionService.consumeUnits(
        req.account!.id,
        req.body
      );

      const statusCode = result.accepted ? 200 : 403;
      res.status(statusCode).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
