import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ─── Custom Metrics ──────────────────────────────────────────
const consumeLatency = new Trend('consume_latency', true);
const consumeAccepted = new Counter('consume_accepted');
const consumeRejected = new Counter('consume_rejected');
const consumeErrors = new Counter('consume_errors');
const consumeSuccessRate = new Rate('consume_success_rate');

// ─── Configuration ───────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Plan IDs (from seed data)
const STARTER_PLAN_ID = 'a0000000-0000-0000-0000-000000000001';
const PRO_PLAN_ID = 'a0000000-0000-0000-0000-000000000002';
const BASIC_PLAN_ID = 'b0000000-0000-0000-0000-000000000001';
const PREMIUM_PLAN_ID = 'b0000000-0000-0000-0000-000000000002';

export const options = {
  scenarios: {
    // Scenario 1: Ramp-up load test
    load_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 20 },   // Ramp up to 20 VUs
        { duration: '30s', target: 20 },   // Stay at 20 VUs
        { duration: '15s', target: 50 },   // Ramp up to 50
        { duration: '30s', target: 50 },   // Stay at 50
        { duration: '15s', target: 0 },    // Ramp down
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    consume_success_rate: ['rate>0.9'],
    consume_latency: ['p(95)<300'],
  },
};

// ─── Setup: Create test accounts and users ───────────────────
export function setup() {
  console.log('Setting up test data...');

  // Create account with Pro plan (large limits for load testing)
  const accountRes = http.post(
    `${BASE_URL}/api/accounts`,
    JSON.stringify({ name: 'Load Test Account', plan_id: PRO_PLAN_ID }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(accountRes, { 'account created': (r) => r.status === 201 });

  const account = JSON.parse(accountRes.body).account;
  const apiKey = account.api_key;

  // Create 10 test users with Premium plan
  const userIds = [];
  for (let i = 0; i < 10; i++) {
    const userRes = http.post(
      `${BASE_URL}/api/users`,
      JSON.stringify({
        external_id: `perf-user-${i}`,
        name: `Perf User ${i}`,
        plan_id: PREMIUM_PLAN_ID,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
      }
    );

    check(userRes, { 'user created': (r) => r.status === 201 });
    userIds.push(JSON.parse(userRes.body).user.id);
  }

  console.log(`Created account with ${userIds.length} users`);
  return { apiKey, userIds };
}

// ─── Main Test Function ──────────────────────────────────────
export default function (data) {
  const { apiKey, userIds } = data;

  // Pick a random user
  const userId = userIds[Math.floor(Math.random() * userIds.length)];

  // Generate unique request ID
  const requestId = `perf-${__VU}-${__ITER}-${Date.now()}`;

  // Random units (1-50)
  const units = Math.floor(Math.random() * 50) + 1;

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
  };

  // ─── Consume Units ─────────────────────────────────────────
  const consumeRes = http.post(
    `${BASE_URL}/api/consume`,
    JSON.stringify({
      user_id: userId,
      units: units,
      request_id: requestId,
    }),
    { headers, tags: { name: 'consume' } }
  );

  consumeLatency.add(consumeRes.timings.duration);

  if (consumeRes.status === 200) {
    consumeAccepted.add(1);
    consumeSuccessRate.add(1);

    check(consumeRes, {
      'consume accepted': (r) => JSON.parse(r.body).accepted === true,
    });
  } else if (consumeRes.status === 403) {
    consumeRejected.add(1);
    consumeSuccessRate.add(1); // Rejection is still a correct response

    check(consumeRes, {
      'consume rejected with reason': (r) => {
        const body = JSON.parse(r.body);
        return body.rejection && body.rejection.reason;
      },
    });
  } else {
    consumeErrors.add(1);
    consumeSuccessRate.add(0);
    console.error(`Unexpected status ${consumeRes.status}: ${consumeRes.body}`);
  }

  // ─── Check Usage (less frequently) ─────────────────────────
  if (__ITER % 5 === 0) {
    const usageRes = http.get(`${BASE_URL}/api/usage/account`, {
      headers,
      tags: { name: 'usage' },
    });

    check(usageRes, {
      'usage returns 200': (r) => r.status === 200,
    });
  }

  // ─── Idempotent Retry (occasionally) ───────────────────────
  if (__ITER % 10 === 0) {
    const retryRes = http.post(
      `${BASE_URL}/api/consume`,
      JSON.stringify({
        user_id: userId,
        units: units,
        request_id: requestId,  // Same request_id
      }),
      { headers, tags: { name: 'retry' } }
    );

    check(retryRes, {
      'retry returns same result': (r) => r.status === 200 || r.status === 403,
    });
  }

  sleep(0.1); // Small pause between iterations
}

// ─── Teardown ────────────────────────────────────────────────
export function teardown(data) {
  console.log('Load test complete.');
}
