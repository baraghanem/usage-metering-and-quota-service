import { evaluateRules } from '../../src/services/rules.engine';

describe('Rules Engine Unit Tests', () => {
  const defaultUserRules = {
    monthly_allowance: 1000,
    max_per_request: 20,
  };

  const defaultAccountRules = {
    monthly_allowance: 10000,
    max_per_request: 100,
  };

  it('accepts request when within all limits', () => {
    const result = evaluateRules({
      units: 10,
      userRules: defaultUserRules,
      accountRules: defaultAccountRules,
      userConsumed: 100,
      accountConsumed: 500,
    });

    expect(result.allowed).toBe(true);
    expect(result.rejection).toBeUndefined();
    expect(result.userRemaining).toBe(890); // 1000 - 100 - 10
    expect(result.accountRemaining).toBe(9490); // 10000 - 500 - 10
  });

  it('rejects when units exceed user max_per_request', () => {
    const result = evaluateRules({
      units: 25, // limit is 20
      userRules: defaultUserRules,
      accountRules: defaultAccountRules,
      userConsumed: 0,
      accountConsumed: 0,
    });

    expect(result.allowed).toBe(false);
    expect(result.rejection).toEqual({
      level: 'user',
      rule: 'max_per_request',
      reason: 'Requested 25 units exceeds user per-request limit of 20',
    });
  });

  it('rejects when units exceed account max_per_request even if user allows it', () => {
    const highUserRules = {
      monthly_allowance: 50000,
      max_per_request: 500,
    };
    const tightAccountRules = {
      monthly_allowance: 100000,
      max_per_request: 100,
    };

    const result = evaluateRules({
      units: 150, // exceeds account limit of 100
      userRules: highUserRules,
      accountRules: tightAccountRules,
      userConsumed: 0,
      accountConsumed: 0,
    });

    expect(result.allowed).toBe(false);
    expect(result.rejection).toEqual({
      level: 'account',
      rule: 'max_per_request',
      reason: 'Requested 150 units exceeds account per-request limit of 100',
    });
  });

  it('rejects when units exceed user monthly allowance', () => {
    const result = evaluateRules({
      units: 15,
      userRules: defaultUserRules,
      accountRules: defaultAccountRules,
      userConsumed: 990, // only 10 remaining
      accountConsumed: 990, // account has plenty
    });

    expect(result.allowed).toBe(false);
    expect(result.rejection?.level).toBe('user');
    expect(result.rejection?.rule).toBe('monthly_allowance');
    expect(result.userRemaining).toBe(10);
  });

  it('rejects when units exceed account monthly allowance even if user has plenty', () => {
    const result = evaluateRules({
      units: 10,
      userRules: defaultUserRules,
      accountRules: {
        monthly_allowance: 500,
        max_per_request: 100,
      },
      userConsumed: 10, // user has 990 remaining
      accountConsumed: 495, // account has only 5 remaining
    });

    expect(result.allowed).toBe(false);
    expect(result.rejection?.level).toBe('account');
    expect(result.rejection?.rule).toBe('monthly_allowance');
    expect(result.accountRemaining).toBe(5);
  });

  it('handles exact limit boundary consumption', () => {
    const result = evaluateRules({
      units: 20, // exactly max_per_request
      userRules: defaultUserRules,
      accountRules: defaultAccountRules,
      userConsumed: 980, // exactly 20 remaining
      accountConsumed: 9980, // exactly 20 remaining
    });

    expect(result.allowed).toBe(true);
    expect(result.userRemaining).toBe(0);
    expect(result.accountRemaining).toBe(0);
  });

  it('handles plan downgrade where consumed exceeds new allowance (zero remaining)', () => {
    const result = evaluateRules({
      units: 1,
      userRules: {
        monthly_allowance: 50, // reduced to 50
        max_per_request: 10,
      },
      accountRules: defaultAccountRules,
      userConsumed: 100, // already consumed 100
      accountConsumed: 100,
    });

    expect(result.allowed).toBe(false);
    expect(result.userRemaining).toBe(0);
    expect(result.rejection?.level).toBe('user');
    expect(result.rejection?.rule).toBe('monthly_allowance');
  });
});
