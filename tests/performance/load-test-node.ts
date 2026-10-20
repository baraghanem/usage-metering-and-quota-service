/**
 * Standalone Node.js Load Testing Script for Usage Metering Service.
 *
 * Runs concurrent workers simulating real-world consumption,
 * retries (idempotency), limit checks, and usage inspections.
 * Outputs latency distributions (p50, p95, p99), throughput (RPS),
 * and success/rejection counts.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '20', 10);
const DURATION_SECONDS = parseInt(process.env.DURATION || '15', 10);

const PRO_PLAN_ID = 'a0000000-0000-0000-0000-000000000002';
const PREMIUM_PLAN_ID = 'b0000000-0000-0000-0000-000000000002';

interface Metrics {
  totalRequests: number;
  accepted: number;
  rejected: number;
  errors: number;
  latencies: number[];
}

const metrics: Metrics = {
  totalRequests: 0,
  accepted: 0,
  rejected: 0,
  errors: 0,
  latencies: [],
};

async function post(url: string, body: any, headers: Record<string, string> = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const latency = Date.now() - start;
    const json = await res.json();
    return { status: res.status, json, latency };
  } catch (err) {
    const latency = Date.now() - start;
    return { status: 0, json: null, latency, error: err };
  }
}

async function get(url: string, headers: Record<string, string> = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
    });
    const latency = Date.now() - start;
    const json = await res.json();
    return { status: res.status, json, latency };
  } catch (err) {
    const latency = Date.now() - start;
    return { status: 0, json: null, latency, error: err };
  }
}

async function setup() {
  console.log('--- Setting up Performance Test Environment ---');
  // 1. Create account
  const acctRes = await post(`${BASE_URL}/api/accounts`, {
    name: 'Node Perf Account',
    plan_id: PRO_PLAN_ID,
  });

  if (acctRes.status !== 201) {
    throw new Error(`Failed to create account: ${JSON.stringify(acctRes)}`);
  }

  const apiKey = acctRes.json.account.api_key;
  console.log(`Created account with API key: ${apiKey.substring(0, 10)}...`);

  // 2. Create 10 users
  const userIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const uRes = await post(
      `${BASE_URL}/api/users`,
      {
        external_id: `perf-usr-${i}-${Date.now()}`,
        name: `Perf Worker ${i}`,
        plan_id: PREMIUM_PLAN_ID,
      },
      { 'X-API-Key': apiKey }
    );
    if (uRes.status !== 201) {
      throw new Error(`Failed to create user ${i}: ${JSON.stringify(uRes)}`);
    }
    userIds.push(uRes.json.user.id);
  }
  console.log(`Created ${userIds.length} test users`);

  return { apiKey, userIds };
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const index = Math.floor((percentile / 100) * values.length);
  return values[Math.min(index, values.length - 1)];
}

async function runWorker(
  workerId: number,
  apiKey: string,
  userIds: string[],
  stopTime: number
) {
  let iter = 0;
  while (Date.now() < stopTime) {
    iter++;
    const userId = userIds[Math.floor(Math.random() * userIds.length)];
    const requestId = `worker-${workerId}-iter-${iter}-${Date.now()}`;
    const units = Math.floor(Math.random() * 25) + 1;

    const res = await post(
      `${BASE_URL}/api/consume`,
      { user_id: userId, units, request_id: requestId },
      { 'X-API-Key': apiKey }
    );

    metrics.totalRequests++;
    metrics.latencies.push(res.latency);

    if (res.status === 200) {
      metrics.accepted++;
    } else if (res.status === 403) {
      metrics.rejected++;
    } else {
      metrics.errors++;
    }

    // Occasional idempotent retry check
    if (iter % 15 === 0) {
      const retryRes = await post(
        `${BASE_URL}/api/consume`,
        { user_id: userId, units, request_id: requestId },
        { 'X-API-Key': apiKey }
      );
      metrics.totalRequests++;
      metrics.latencies.push(retryRes.latency);
      if (retryRes.status === res.status) {
        if (res.status === 200) metrics.accepted++;
        else metrics.rejected++;
      } else {
        metrics.errors++;
      }
    }

    // Occasional usage query
    if (iter % 20 === 0) {
      await get(`${BASE_URL}/api/usage/account`, { 'X-API-Key': apiKey });
    }
  }
}

async function main() {
  console.log(`\n=================================================`);
  console.log(`  USAGE METERING SERVICE - LOAD & CONCURRENCY TEST`);
  console.log(`=================================================`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Concurrency: ${CONCURRENCY} workers`);
  console.log(`Duration: ${DURATION_SECONDS} seconds\n`);

  const { apiKey, userIds } = await setup();

  console.log(`\nStarting load generation for ${DURATION_SECONDS} seconds...`);
  const startTime = Date.now();
  const stopTime = startTime + DURATION_SECONDS * 1000;

  const workers: Promise<void>[] = [];
  for (let w = 0; w < CONCURRENCY; w++) {
    workers.push(runWorker(w, apiKey, userIds, stopTime));
  }

  await Promise.all(workers);
  const elapsedSeconds = (Date.now() - startTime) / 1000;

  metrics.latencies.sort((a, b) => a - b);

  const rps = (metrics.totalRequests / elapsedSeconds).toFixed(1);
  const p50 = calculatePercentile(metrics.latencies, 50);
  const p90 = calculatePercentile(metrics.latencies, 90);
  const p95 = calculatePercentile(metrics.latencies, 95);
  const p99 = calculatePercentile(metrics.latencies, 99);
  const min = metrics.latencies.length > 0 ? metrics.latencies[0] : 0;
  const max = metrics.latencies.length > 0 ? metrics.latencies[metrics.latencies.length - 1] : 0;

  console.log(`\n=================================================`);
  console.log(`               TEST RESULTS SUMMARY              `);
  console.log(`=================================================`);
  console.log(`Total Requests Sent : ${metrics.totalRequests}`);
  console.log(`Elapsed Time        : ${elapsedSeconds.toFixed(2)}s`);
  console.log(`Throughput (RPS)    : ${rps} req/sec`);
  console.log(`Accepted Requests   : ${metrics.accepted}`);
  console.log(`Rejected (Quota)    : ${metrics.rejected}`);
  console.log(`Errors (5xx / Fail) : ${metrics.errors}`);
  console.log(`-------------------------------------------------`);
  console.log(`Latency Distribution:`);
  console.log(`  Min               : ${min} ms`);
  console.log(`  p50 (Median)      : ${p50} ms`);
  console.log(`  p90               : ${p90} ms`);
  console.log(`  p95               : ${p95} ms`);
  console.log(`  p99               : ${p99} ms`);
  console.log(`  Max               : ${max} ms`);
  console.log(`=================================================\n`);
}

main().catch((err) => {
  console.error('Performance test failed:', err);
  process.exit(1);
});
