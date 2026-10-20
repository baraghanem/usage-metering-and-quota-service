import { getCurrentMonth, isValidMonth } from '../../src/utils/month';
import {
  AppError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  ForbiddenError,
  ConflictError,
} from '../../src/utils/errors';

describe('Month Utils Unit Tests', () => {
  it('returns valid UTC month in YYYY-MM format', () => {
    const month = getCurrentMonth();
    expect(month).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });

  it('validates YYYY-MM month format', () => {
    expect(isValidMonth('2026-01')).toBe(true);
    expect(isValidMonth('2026-12')).toBe(true);
    expect(isValidMonth('2026-00')).toBe(false);
    expect(isValidMonth('2026-13')).toBe(false);
    expect(isValidMonth('2026-1')).toBe(false);
    expect(isValidMonth('invalid')).toBe(false);
    expect(isValidMonth('2026-05-01')).toBe(false);
  });
});

describe('Error Classes Unit Tests', () => {
  it('creates AppError with correct status code and code', () => {
    const err = new AppError(418, "I'm a teapot", 'TEAPOT');
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe('TEAPOT');
    expect(err.message).toBe("I'm a teapot");
  });

  it('creates NotFoundError with 404', () => {
    const err = new NotFoundError('Plan', 'plan-123');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain("Plan 'plan-123' not found");
  });

  it('creates ValidationError with 400', () => {
    const err = new ValidationError('Invalid input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('creates AuthenticationError with 401', () => {
    const err = new AuthenticationError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('AUTHENTICATION_ERROR');
  });

  it('creates ForbiddenError with 403', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('creates ConflictError with 409', () => {
    const err = new ConflictError('Already exists');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
  });
});
