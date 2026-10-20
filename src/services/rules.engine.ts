/**
 * Rules Engine for Quota & Consumption Evaluation
 *
 * Evaluates whether a requested number of units is permissible
 * under both Account-level and User-level rules.
 */

export interface PlanRules {
  monthly_allowance: number;
  max_per_request: number;
}

export interface RuleEvaluationContext {
  units: number;
  userRules: PlanRules;
  accountRules: PlanRules;
  userConsumed: number;
  accountConsumed: number;
}

export interface RuleEvaluationResult {
  allowed: boolean;
  rejection?: {
    reason: string;
    level: 'account' | 'user';
    rule: 'max_per_request' | 'monthly_allowance';
  };
  userRemaining: number;
  accountRemaining: number;
}

/**
 * Evaluates consumption rules in deterministic order:
 * 1. User max_per_request
 * 2. Account max_per_request
 * 3. User monthly allowance
 * 4. Account monthly allowance
 */
export function evaluateRules(context: RuleEvaluationContext): RuleEvaluationResult {
  const { units, userRules, accountRules, userConsumed, accountConsumed } = context;

  const userRemaining = Math.max(0, userRules.monthly_allowance - userConsumed);
  const accountRemaining = Math.max(0, accountRules.monthly_allowance - accountConsumed);

  // 1. User per-request limit check
  if (units > userRules.max_per_request) {
    return {
      allowed: false,
      userRemaining,
      accountRemaining,
      rejection: {
        level: 'user',
        rule: 'max_per_request',
        reason: `Requested ${units} units exceeds user per-request limit of ${userRules.max_per_request}`,
      },
    };
  }

  // 2. Account per-request limit check
  if (units > accountRules.max_per_request) {
    return {
      allowed: false,
      userRemaining,
      accountRemaining,
      rejection: {
        level: 'account',
        rule: 'max_per_request',
        reason: `Requested ${units} units exceeds account per-request limit of ${accountRules.max_per_request}`,
      },
    };
  }

  // 3. User monthly allowance check
  if (units > userRemaining) {
    return {
      allowed: false,
      userRemaining,
      accountRemaining,
      rejection: {
        level: 'user',
        rule: 'monthly_allowance',
        reason: `Requested ${units} units exceeds user remaining allowance of ${userRemaining} (${userConsumed}/${userRules.monthly_allowance} consumed)`,
      },
    };
  }

  // 4. Account monthly allowance check
  if (units > accountRemaining) {
    return {
      allowed: false,
      userRemaining,
      accountRemaining,
      rejection: {
        level: 'account',
        rule: 'monthly_allowance',
        reason: `Requested ${units} units exceeds account remaining allowance of ${accountRemaining} (${accountConsumed}/${accountRules.monthly_allowance} consumed)`,
      },
    };
  }

  // All rules satisfied
  return {
    allowed: true,
    userRemaining: Math.max(0, userRemaining - units),
    accountRemaining: Math.max(0, accountRemaining - units),
  };
}
