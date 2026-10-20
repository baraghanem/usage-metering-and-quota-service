/**
 * Demo Client for the Usage Metering and Quota Service
 *
 * This script demonstrates:
 * 1. Creating an account and obtaining an API key
 * 2. Creating users with different plans
 * 3. Accepted consumption
 * 4. Rejection caused by a user limit
 * 5. Rejection caused by an account limit
 * 6. Switching plans and showing changed behavior
 * 7. Viewing usage and history
 */

const SERVICE_URL = process.env.SERVICE_URL || 'http://localhost:3000';

// ─── Helpers ──────────────────────────────────────────────────

async function api(
  method: string,
  path: string,
  body?: any,
  apiKey?: string
): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  const url = `${SERVICE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  return { status: res.status, data };
}

function separator(title: string): void {
  console.log('\n' + '═'.repeat(70));
  console.log(`  ${title}`);
  console.log('═'.repeat(70));
}

function log(label: string, data: any): void {
  console.log(`\n  ▸ ${label}:`);
  console.log(
    JSON.stringify(data, null, 2)
      .split('\n')
      .map((l) => '    ' + l)
      .join('\n')
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wait for service to be ready
async function waitForService(maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${SERVICE_URL}/health`);
      if (res.ok) {
        console.log('✓ Service is ready!');
        return;
      }
    } catch {
      // Service not ready yet
    }
    console.log(`  Waiting for service... (attempt ${i + 1}/${maxRetries})`);
    await sleep(2000);
  }
  throw new Error('Service did not become ready in time');
}

// ─── Main Demo ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n🚀 Usage Metering and Quota Service — Demo Client\n');
  console.log(`  Service URL: ${SERVICE_URL}\n`);

  await waitForService();

  // ──────────────────────────────────────────────────────────
  // STEP 1: Create an account
  // ──────────────────────────────────────────────────────────
  separator('STEP 1: Create an account (DocProcessor Inc.)');

  const createResult = await api('POST', '/api/accounts', {
    name: 'DocProcessor Inc.',
  });
  log('Account created', createResult.data);

  const apiKey = createResult.data.account.api_key;
  const accountId = createResult.data.account.id;
  console.log(`\n  🔑 API Key: ${apiKey}`);

  // ──────────────────────────────────────────────────────────
  // STEP 2: Assign the Starter account plan (10,000 units/month, 100 per request)
  // ──────────────────────────────────────────────────────────
  separator('STEP 2: Assign Starter account plan');

  const plans = await api('GET', '/api/plans', undefined, apiKey);
  log('Available plans', plans.data);

  const starterPlan = plans.data.plans.find(
    (p: any) => p.name === 'Starter' && p.type === 'account'
  );
  const proPlan = plans.data.plans.find(
    (p: any) => p.name === 'Pro' && p.type === 'account'
  );
  const basicPlan = plans.data.plans.find(
    (p: any) => p.name === 'Basic' && p.type === 'user'
  );
  const premiumPlan = plans.data.plans.find(
    (p: any) => p.name === 'Premium' && p.type === 'user'
  );

  const assignAccount = await api(
    'PATCH',
    '/api/accounts/me/plan',
    { plan_id: starterPlan.id },
    apiKey
  );
  log('Account plan assigned', assignAccount.data);
  console.log('  📋 Starter: 10,000 units/month, 100 per request');

  // ──────────────────────────────────────────────────────────
  // STEP 3: Create users with different plans
  // ──────────────────────────────────────────────────────────
  separator('STEP 3: Create users with different plans');

  // Alice gets the Basic plan (1,000 units/month, 20 per request)
  const alice = await api(
    'POST',
    '/api/users',
    { external_id: 'alice', name: 'Alice Johnson', plan_id: basicPlan.id },
    apiKey
  );
  log('Alice (Basic plan) created', alice.data);
  console.log('  📋 Basic: 1,000 units/month, 20 per request');

  // Bob gets the Premium plan (10,000 units/month, 200 per request)
  const bob = await api(
    'POST',
    '/api/users',
    { external_id: 'bob', name: 'Bob Smith', plan_id: premiumPlan.id },
    apiKey
  );
  log('Bob (Premium plan) created', bob.data);
  console.log('  📋 Premium: 10,000 units/month, 200 per request');

  const aliceId = alice.data.user.id;
  const bobId = bob.data.user.id;

  // ──────────────────────────────────────────────────────────
  // STEP 4: Successful consumption
  // ──────────────────────────────────────────────────────────
  separator('STEP 4: Successful consumption — Alice processes 15 units');

  const consume1 = await api(
    'POST',
    '/api/consume',
    { user_id: aliceId, units: 15, request_id: 'doc-001' },
    apiKey
  );
  log('Result (ACCEPTED)', consume1.data);
  console.log('  ✅ 15 units consumed — within both Alice\'s and account limits');

  // ──────────────────────────────────────────────────────────
  // STEP 5: Idempotent retry
  // ──────────────────────────────────────────────────────────
  separator('STEP 5: Idempotent retry — same request_id returns cached result');

  const retryResult = await api(
    'POST',
    '/api/consume',
    { user_id: aliceId, units: 15, request_id: 'doc-001' },
    apiKey
  );
  log('Retry result (same as original)', retryResult.data);
  console.log('  🔄 Same request_id → same result, no double-counting');

  // ──────────────────────────────────────────────────────────
  // STEP 6: Rejection by USER per-request limit
  // ──────────────────────────────────────────────────────────
  separator('STEP 6: Rejection — Alice tries 25 units (exceeds 20 per-request limit)');

  const consume2 = await api(
    'POST',
    '/api/consume',
    { user_id: aliceId, units: 25, request_id: 'doc-002' },
    apiKey
  );
  log('Result (REJECTED by user per-request limit)', consume2.data);
  console.log('  ❌ 25 > 20 max per request for Basic plan');

  // ──────────────────────────────────────────────────────────
  // STEP 7: Rejection by ACCOUNT monthly limit
  // ──────────────────────────────────────────────────────────
  separator('STEP 7: Rejection by account limit — exhaust the account');

  // Create a custom account plan with a very small allowance to demonstrate
  const tinyAccountPlan = await api(
    'POST',
    '/api/plans',
    {
      name: 'Tiny Account Plan',
      type: 'account',
      monthly_allowance: 20,
      max_per_request: 200,
    },
    apiKey
  );
  log('Created tiny account plan', tinyAccountPlan.data);

  // Assign the tiny plan to the account
  await api(
    'PATCH',
    '/api/accounts/me/plan',
    { plan_id: tinyAccountPlan.data.plan.id },
    apiKey
  );
  console.log('  📋 Switched account to Tiny plan: 20 units/month, 200 per request');

  // Account has already consumed 15 (from Alice's doc-001), only 5 remaining
  const consume3 = await api(
    'POST',
    '/api/consume',
    { user_id: bobId, units: 10, request_id: 'doc-003' },
    apiKey
  );
  log('Result (REJECTED by account monthly limit)', consume3.data);
  console.log('  ❌ Account has only 5 remaining, but Bob requested 10');

  // ──────────────────────────────────────────────────────────
  // STEP 8: Switch plan to unlock more capacity
  // ──────────────────────────────────────────────────────────
  separator('STEP 8: Switch account to Pro plan — unlocks capacity');

  await api(
    'PATCH',
    '/api/accounts/me/plan',
    { plan_id: proPlan.id },
    apiKey
  );
  console.log('  📋 Switched to Pro: 100,000 units/month, 1,000 per request');
  console.log('  Note: consumed units (15) are preserved, not reset');

  // Now the same request with a new request_id should succeed
  const consume4 = await api(
    'POST',
    '/api/consume',
    { user_id: bobId, units: 10, request_id: 'doc-004' },
    apiKey
  );
  log('Result after plan switch (ACCEPTED)', consume4.data);
  console.log('  ✅ Same amount now succeeds with the Pro account plan!');

  // ──────────────────────────────────────────────────────────
  // STEP 9: Upgrade Alice's plan and show effect
  // ──────────────────────────────────────────────────────────
  separator("STEP 9: Upgrade Alice's plan — she can now do more");

  // Alice on Basic plan couldn't do 25 units. Upgrade her to Premium.
  await api(
    'PATCH',
    `/api/users/${aliceId}/plan`,
    { plan_id: premiumPlan.id },
    apiKey
  );
  console.log('  📋 Alice upgraded from Basic → Premium (200 per request)');
  console.log('  Note: her consumed 15 units carry over');

  const consume5 = await api(
    'POST',
    '/api/consume',
    { user_id: aliceId, units: 25, request_id: 'doc-005' },
    apiKey
  );
  log('Result after upgrade (ACCEPTED)', consume5.data);
  console.log('  ✅ 25 units now accepted — Premium allows up to 200 per request!');

  // ──────────────────────────────────────────────────────────
  // STEP 10: View usage
  // ──────────────────────────────────────────────────────────
  separator('STEP 10: View current usage');

  const accountUsage = await api(
    'GET',
    '/api/usage/account',
    undefined,
    apiKey
  );
  log('Account usage', accountUsage.data);

  const aliceUsage = await api(
    'GET',
    `/api/usage/users/${aliceId}`,
    undefined,
    apiKey
  );
  log('Alice usage', aliceUsage.data);

  const bobUsage = await api(
    'GET',
    `/api/usage/users/${bobId}`,
    undefined,
    apiKey
  );
  log('Bob usage', bobUsage.data);

  // ──────────────────────────────────────────────────────────
  // STEP 11: View request history
  // ──────────────────────────────────────────────────────────
  separator('STEP 11: View request history');

  const history = await api(
    'GET',
    '/api/usage/history?page=1&page_size=10',
    undefined,
    apiKey
  );
  log('Request history', history.data);

  // ──────────────────────────────────────────────────────────
  // STEP 12: Update custom plan dynamically
  // ──────────────────────────────────────────────────────────
  separator('STEP 12: Update custom plan dynamically');

  const updated = await api(
    'PATCH',
    `/api/plans/${tinyAccountPlan.data.plan.id}`,
    { monthly_allowance: 50000, name: 'Custom Growth Plan' },
    apiKey
  );
  log('Updated custom plan', updated.data);
  console.log('  📝 Plan updated — any users/accounts on this plan see new limits immediately');

  // ──────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────
  separator('DEMO COMPLETE');
  console.log(`
  Summary of demonstrated behaviors:
  ✅ Account creation with API key
  ✅ Users with different plans (Basic vs Premium)
  ✅ Successful consumption
  ✅ Idempotent retry (same request_id)
  ❌ Rejection by user per-request limit
  ❌ Rejection by account monthly limit
  🔄 Plan switching that changes behavior without code changes
  📊 Usage and history viewing
  📝 Dynamic plan updates

  All requests used the same API key and the same client code.
  Plan changes took effect immediately on subsequent requests.
`);
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
