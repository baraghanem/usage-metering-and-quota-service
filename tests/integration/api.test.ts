import { Pool } from 'pg';
import supertest from 'supertest';
import { createApp } from '../../src/app';
import * as fs from 'fs';
import * as path from 'path';

// Use test database
const TEST_DB = process.env.TEST_DB_NAME || 'metering_test';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
const DB_USER = process.env.DB_USER || 'metering';
const DB_PASSWORD = process.env.DB_PASSWORD || 'metering_pass';

let pool: Pool;
let app: ReturnType<typeof createApp>;
let request: supertest.SuperTest<supertest.Test>;

// Predefined plan IDs (from migration seed)
const STARTER_PLAN_ID = 'a0000000-0000-0000-0000-000000000001';
const PRO_PLAN_ID = 'a0000000-0000-0000-0000-000000000002';
const BASIC_PLAN_ID = 'b0000000-0000-0000-0000-000000000001';
const PREMIUM_PLAN_ID = 'b0000000-0000-0000-0000-000000000002';

beforeAll(async () => {
  // Create test database pool
  const adminPool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: 'postgres',
  });

  // Create test database if it doesn't exist
  try {
    await adminPool.query(`CREATE DATABASE ${TEST_DB}`);
  } catch (err: any) {
    // 42P04 = database already exists
    if (err.code !== '42P04') throw err;
  }
  await adminPool.end();

  // Setup pool for the test database
  pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: TEST_DB,
  });

  // Override the pool in our modules
  const poolModule = require('../../src/db/pool');
  // Replace the pool used by services
  Object.defineProperty(poolModule, 'pool', {
    value: pool,
    writable: true,
  });

  // Run migration
  const migrationSql = fs.readFileSync(
    path.join(__dirname, '../../src/db/migrations/001_init.sql'),
    'utf-8'
  );
  await pool.query(migrationSql);

  app = createApp();
  request = supertest(app) as any;
});

afterAll(async () => {
  if (pool) await pool.end();
});

// Clean up between tests, but keep predefined plans
beforeEach(async () => {
  await pool.query('DELETE FROM request_log');
  await pool.query('DELETE FROM usage_monthly');
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM accounts');
  await pool.query('DELETE FROM plans WHERE is_predefined = FALSE');
});

// ─── Helper ─────────────────────────────────────────────────

async function createTestAccount(
  name = 'Test Account',
  planId?: string
): Promise<{ id: string; api_key: string }> {
  const body: any = { name };
  if (planId) body.plan_id = planId;
  const res = await request.post('/api/accounts').send(body).expect(201);
  return {
    id: res.body.account.id,
    api_key: res.body.account.api_key,
  };
}

async function createTestUser(
  apiKey: string,
  externalId: string,
  name: string,
  planId?: string
): Promise<string> {
  const body: any = { external_id: externalId, name };
  if (planId) body.plan_id = planId;
  const res = await request
    .post('/api/users')
    .set('X-API-Key', apiKey)
    .send(body)
    .expect(201);
  return res.body.user.id;
}

// ─── Tests ──────────────────────────────────────────────────

describe('Health Check', () => {
  it('returns ok', async () => {
    const res = await request.get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Accounts', () => {
  it('creates an account and returns API key', async () => {
    const res = await request
      .post('/api/accounts')
      .send({ name: 'My Company' })
      .expect(201);

    expect(res.body.account.name).toBe('My Company');
    expect(res.body.account.api_key).toMatch(/^mk_/);
    expect(res.body.account.id).toBeDefined();
  });

  it('creates an account with a plan', async () => {
    const res = await request
      .post('/api/accounts')
      .send({ name: 'With Plan', plan_id: STARTER_PLAN_ID })
      .expect(201);

    expect(res.body.account.account_plan_id).toBe(STARTER_PLAN_ID);
  });

  it('rejects invalid plan type for account', async () => {
    await request
      .post('/api/accounts')
      .send({ name: 'Bad Plan', plan_id: BASIC_PLAN_ID }) // BASIC is a user plan
      .expect(400);
  });

  it('gets account details with API key and inspects plan limits', async () => {
    const account = await createTestAccount('Acme', STARTER_PLAN_ID);
    const res = await request
      .get('/api/accounts/me')
      .set('X-API-Key', account.api_key)
      .expect(200);

    expect(res.body.account.id).toBe(account.id);
    expect(res.body.account.api_key_prefix).toMatch(/^mk_/);
    expect(res.body.account.plan).toBeDefined();
    expect(res.body.account.plan.name).toBe('Starter');
    expect(res.body.account.plan.monthly_allowance).toBe(10000);
    expect(res.body.account.plan.max_per_request).toBe(100);
  });

  it('assigns a plan to account', async () => {
    const account = await createTestAccount();
    const res = await request
      .patch('/api/accounts/me/plan')
      .set('X-API-Key', account.api_key)
      .send({ plan_id: STARTER_PLAN_ID })
      .expect(200);

    expect(res.body.account.account_plan_id).toBe(STARTER_PLAN_ID);
  });
});

describe('API Key Validation', () => {
  it('rejects requests without API key', async () => {
    const res = await request.get('/api/users').expect(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('rejects requests with invalid API key', async () => {
    const res = await request
      .get('/api/users')
      .set('X-API-Key', 'mk_invalid')
      .expect(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

describe('Account Isolation', () => {
  it('prevents accessing users from another account', async () => {
    const account1 = await createTestAccount('Account 1', STARTER_PLAN_ID);
    const account2 = await createTestAccount('Account 2', STARTER_PLAN_ID);

    const userId = await createTestUser(
      account1.api_key,
      'user1',
      'User One',
      BASIC_PLAN_ID
    );

    // Account2 should not see Account1's user
    const res = await request
      .get(`/api/users/${userId}`)
      .set('X-API-Key', account2.api_key)
      .expect(404);
  });

  it('prevents consuming units for another account user', async () => {
    const account1 = await createTestAccount('Account 1', STARTER_PLAN_ID);
    const account2 = await createTestAccount('Account 2', STARTER_PLAN_ID);

    const userId = await createTestUser(
      account1.api_key,
      'user1',
      'User One',
      BASIC_PLAN_ID
    );

    // Account2 tries to consume for Account1's user
    const res = await request
      .post('/api/consume')
      .set('X-API-Key', account2.api_key)
      .send({ user_id: userId, units: 5, request_id: 'req-1' })
      .expect(404);
  });
});

describe('Users', () => {
  it('creates a user under an account', async () => {
    const account = await createTestAccount();
    const res = await request
      .post('/api/users')
      .set('X-API-Key', account.api_key)
      .send({
        external_id: 'usr-123',
        name: 'Test User',
        plan_id: BASIC_PLAN_ID,
      })
      .expect(201);

    expect(res.body.user.external_id).toBe('usr-123');
    expect(res.body.user.account_id).toBe(account.id);
  });

  it('prevents duplicate external_id within account', async () => {
    const account = await createTestAccount();
    await createTestUser(account.api_key, 'dup', 'First');

    await request
      .post('/api/users')
      .set('X-API-Key', account.api_key)
      .send({ external_id: 'dup', name: 'Second' })
      .expect(409);
  });

  it('allows same external_id in different accounts', async () => {
    const account1 = await createTestAccount('A1');
    const account2 = await createTestAccount('A2');

    await createTestUser(account1.api_key, 'same-id', 'User 1');
    // Should not conflict
    await request
      .post('/api/users')
      .set('X-API-Key', account2.api_key)
      .send({ external_id: 'same-id', name: 'User 2' })
      .expect(201);
  });

  it('lists users', async () => {
    const account = await createTestAccount();
    await createTestUser(account.api_key, 'u1', 'User 1');
    await createTestUser(account.api_key, 'u2', 'User 2');

    const res = await request
      .get('/api/users')
      .set('X-API-Key', account.api_key)
      .expect(200);

    expect(res.body.users).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });

  it('gets user details and inspects assigned plan and limits', async () => {
    const account = await createTestAccount('A1', STARTER_PLAN_ID);
    const userId = await createTestUser(account.api_key, 'u1', 'Alice', BASIC_PLAN_ID);

    const res = await request
      .get(`/api/users/${userId}`)
      .set('X-API-Key', account.api_key)
      .expect(200);

    expect(res.body.user.id).toBe(userId);
    expect(res.body.user.plan).toBeDefined();
    expect(res.body.user.plan.name).toBe('Basic');
    expect(res.body.user.plan.monthly_allowance).toBe(1000);
    expect(res.body.user.plan.max_per_request).toBe(20);
  });
});

describe('Plans', () => {
  it('lists predefined plans', async () => {
    const account = await createTestAccount();
    const res = await request
      .get('/api/plans')
      .set('X-API-Key', account.api_key)
      .expect(200);

    expect(res.body.plans.length).toBeGreaterThanOrEqual(4);
    const names = res.body.plans.map((p: any) => p.name);
    expect(names).toContain('Starter');
    expect(names).toContain('Pro');
    expect(names).toContain('Basic');
    expect(names).toContain('Premium');
  });

  it('filters plans by type', async () => {
    const account = await createTestAccount();
    const res = await request
      .get('/api/plans?type=account')
      .set('X-API-Key', account.api_key)
      .expect(200);

    for (const plan of res.body.plans) {
      expect(plan.type).toBe('account');
    }
  });

  it('creates a custom plan', async () => {
    const account = await createTestAccount();
    const res = await request
      .post('/api/plans')
      .set('X-API-Key', account.api_key)
      .send({
        name: 'Custom Plan',
        type: 'user',
        monthly_allowance: 500,
        max_per_request: 10,
      })
      .expect(201);

    expect(res.body.plan.name).toBe('Custom Plan');
    expect(res.body.plan.is_predefined).toBe(false);
    expect(res.body.plan.account_id).toBe(account.id);
  });

  it('updates a custom plan', async () => {
    const account = await createTestAccount();

    // Create custom plan
    const create = await request
      .post('/api/plans')
      .set('X-API-Key', account.api_key)
      .send({
        name: 'Editable',
        type: 'user',
        monthly_allowance: 100,
        max_per_request: 5,
      })
      .expect(201);

    // Update it
    const res = await request
      .patch(`/api/plans/${create.body.plan.id}`)
      .set('X-API-Key', account.api_key)
      .send({ monthly_allowance: 200 })
      .expect(200);

    expect(res.body.plan.monthly_allowance).toBe(200);
  });

  it('rejects modification of predefined plans', async () => {
    const account = await createTestAccount();

    await request
      .patch(`/api/plans/${STARTER_PLAN_ID}`)
      .set('X-API-Key', account.api_key)
      .send({ monthly_allowance: 999999 })
      .expect(403);
  });

  it('prevents modification of another account custom plan', async () => {
    const account1 = await createTestAccount('A1');
    const account2 = await createTestAccount('A2');

    const create = await request
      .post('/api/plans')
      .set('X-API-Key', account1.api_key)
      .send({
        name: 'Private',
        type: 'user',
        monthly_allowance: 100,
        max_per_request: 5,
      })
      .expect(201);

    await request
      .patch(`/api/plans/${create.body.plan.id}`)
      .set('X-API-Key', account2.api_key)
      .send({ monthly_allowance: 9999 })
      .expect(403);
  });
});

describe('Consumption', () => {
  let account: { id: string; api_key: string };
  let userId: string;

  beforeEach(async () => {
    account = await createTestAccount('Test Co', STARTER_PLAN_ID);
    userId = await createTestUser(
      account.api_key,
      'user1',
      'Test User',
      BASIC_PLAN_ID
    );
  });

  it('accepts a valid consumption request', async () => {
    const res = await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 10, request_id: 'req-1' })
      .expect(200);

    expect(res.body.accepted).toBe(true);
    expect(res.body.user_usage.consumed).toBe(10);
    expect(res.body.account_usage.consumed).toBe(10);
  });

  it('rejects when user max_per_request exceeded', async () => {
    // Basic plan has max_per_request = 20
    const res = await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 25, request_id: 'req-2' })
      .expect(403);

    expect(res.body.accepted).toBe(false);
    expect(res.body.rejection.level).toBe('user');
    expect(res.body.rejection.rule).toBe('max_per_request');
  });

  it('rejects when user monthly allowance exceeded', async () => {
    // Basic plan has monthly_allowance = 1000
    // Consume 990 first
    for (let i = 0; i < 50; i++) {
      await request
        .post('/api/consume')
        .set('X-API-Key', account.api_key)
        .send({
          user_id: userId,
          units: 20,
          request_id: `fill-${i}`,
        });
    }

    // Now try 20 more (total would be 1020 > 1000)
    const res = await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 20, request_id: 'overflow' })
      .expect(403);

    expect(res.body.accepted).toBe(false);
    expect(res.body.rejection.level).toBe('user');
    expect(res.body.rejection.rule).toBe('monthly_allowance');
  });

  it('rejects when account monthly allowance exceeded', async () => {
    // Create a custom tiny account plan
    const planRes = await request
      .post('/api/plans')
      .set('X-API-Key', account.api_key)
      .send({
        name: 'Tiny',
        type: 'account',
        monthly_allowance: 15,
        max_per_request: 100,
      })
      .expect(201);

    // Assign tiny plan
    await request
      .patch('/api/accounts/me/plan')
      .set('X-API-Key', account.api_key)
      .send({ plan_id: planRes.body.plan.id })
      .expect(200);

    // Consume 10
    await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 10, request_id: 'acct-1' })
      .expect(200);

    // Try 10 more (total 20 > 15 allowance)
    const res = await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 10, request_id: 'acct-2' })
      .expect(403);

    expect(res.body.accepted).toBe(false);
    expect(res.body.rejection.level).toBe('account');
    expect(res.body.rejection.rule).toBe('monthly_allowance');
  });

  it('rejects when account max_per_request exceeded', async () => {
    // Starter plan has max_per_request = 100
    // Give user a Premium plan (max_per_request = 200) so user limit doesn't trigger first
    await request
      .patch(`/api/users/${userId}/plan`)
      .set('X-API-Key', account.api_key)
      .send({ plan_id: PREMIUM_PLAN_ID })
      .expect(200);

    const res = await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 150, request_id: 'big-1' })
      .expect(403);

    expect(res.body.accepted).toBe(false);
    expect(res.body.rejection.level).toBe('account');
    expect(res.body.rejection.rule).toBe('max_per_request');
  });

  it('handles idempotent retries', async () => {
    // First request
    const res1 = await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 10, request_id: 'idem-1' })
      .expect(200);

    // Retry with same request_id
    const res2 = await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 10, request_id: 'idem-1' })
      .expect(200);

    expect(res2.body.accepted).toBe(true);
    expect(res2.body.request_id).toBe('idem-1');

    // Check usage didn't double
    const usage = await request
      .get('/api/usage/account')
      .set('X-API-Key', account.api_key)
      .expect(200);

    expect(usage.body.usage.consumed).toBe(10);
  });

  it('requires plan assignment before consuming', async () => {
    // Create user without plan
    const noPlanUser = await createTestUser(
      account.api_key,
      'noplan',
      'No Plan User'
    );

    const res = await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: noPlanUser, units: 5, request_id: 'noplan-1' })
      .expect(400);
  });

  it('validates input: positive units', async () => {
    await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 0, request_id: 'zero-1' })
      .expect(400);

    await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: -5, request_id: 'neg-1' })
      .expect(400);
  });
});

describe('Plan Changes', () => {
  it('preserves consumed units when switching plans', async () => {
    const account = await createTestAccount('Test', STARTER_PLAN_ID);
    const userId = await createTestUser(
      account.api_key,
      'u1',
      'User',
      BASIC_PLAN_ID
    );

    // Consume 15 units
    await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 15, request_id: 'pre-switch' })
      .expect(200);

    // Switch to Premium plan
    await request
      .patch(`/api/users/${userId}/plan`)
      .set('X-API-Key', account.api_key)
      .send({ plan_id: PREMIUM_PLAN_ID })
      .expect(200);

    // Check usage — consumed should still be 15
    const usage = await request
      .get(`/api/usage/users/${userId}`)
      .set('X-API-Key', account.api_key)
      .expect(200);

    expect(usage.body.usage.consumed).toBe(15);
    expect(usage.body.usage.monthly_allowance).toBe(10000); // Premium
    expect(usage.body.usage.remaining).toBe(9985);
  });

  it('shows zero remaining if allowance reduced below consumed', async () => {
    const account = await createTestAccount('Test', STARTER_PLAN_ID);
    const userId = await createTestUser(
      account.api_key,
      'u1',
      'User',
      PREMIUM_PLAN_ID
    );

    // Consume 100 units
    for (let i = 0; i < 10; i++) {
      await request
        .post('/api/consume')
        .set('X-API-Key', account.api_key)
        .send({ user_id: userId, units: 10, request_id: `big-${i}` })
        .expect(200);
    }

    // Create a plan with lower allowance
    const smallPlan = await request
      .post('/api/plans')
      .set('X-API-Key', account.api_key)
      .send({
        name: 'Small',
        type: 'user',
        monthly_allowance: 50,
        max_per_request: 10,
      })
      .expect(201);

    // Assign the small plan
    await request
      .patch(`/api/users/${userId}/plan`)
      .set('X-API-Key', account.api_key)
      .send({ plan_id: smallPlan.body.plan.id })
      .expect(200);

    // Check usage — remaining should be 0
    const usage = await request
      .get(`/api/usage/users/${userId}`)
      .set('X-API-Key', account.api_key)
      .expect(200);

    expect(usage.body.usage.consumed).toBe(100);
    expect(usage.body.usage.remaining).toBe(0);
    expect(usage.body.usage.monthly_allowance).toBe(50);

    // Further consumption should be rejected
    const consume = await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 1, request_id: 'after-shrink' })
      .expect(403);

    expect(consume.body.rejection.level).toBe('user');
    expect(consume.body.rejection.rule).toBe('monthly_allowance');
  });

  it('updating a custom plan affects its assigned users immediately', async () => {
    const account = await createTestAccount('Test', STARTER_PLAN_ID);

    // Create custom plan
    const plan = await request
      .post('/api/plans')
      .set('X-API-Key', account.api_key)
      .send({
        name: 'Custom',
        type: 'user',
        monthly_allowance: 100,
        max_per_request: 5,
      })
      .expect(201);

    const userId = await createTestUser(
      account.api_key,
      'u1',
      'User',
      plan.body.plan.id
    );

    // Can't do 10 per request (max is 5)
    await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 10, request_id: 'pre-update' })
      .expect(403);

    // Update plan max_per_request
    await request
      .patch(`/api/plans/${plan.body.plan.id}`)
      .set('X-API-Key', account.api_key)
      .send({ max_per_request: 20 })
      .expect(200);

    // Now 10 should work
    const res = await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 10, request_id: 'post-update' })
      .expect(200);

    expect(res.body.accepted).toBe(true);
  });
});

describe('Usage and History', () => {
  it('returns account usage', async () => {
    const account = await createTestAccount('Test', STARTER_PLAN_ID);
    const userId = await createTestUser(
      account.api_key,
      'u1',
      'User',
      BASIC_PLAN_ID
    );

    await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 10, request_id: 'usage-1' })
      .expect(200);

    const res = await request
      .get('/api/usage/account')
      .set('X-API-Key', account.api_key)
      .expect(200);

    expect(res.body.usage.consumed).toBe(10);
    expect(res.body.usage.remaining).toBe(9990);
    expect(res.body.usage.plan_name).toBe('Starter');
  });

  it('returns user usage', async () => {
    const account = await createTestAccount('Test', STARTER_PLAN_ID);
    const userId = await createTestUser(
      account.api_key,
      'u1',
      'User',
      BASIC_PLAN_ID
    );

    await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 5, request_id: 'uu-1' })
      .expect(200);

    const res = await request
      .get(`/api/usage/users/${userId}`)
      .set('X-API-Key', account.api_key)
      .expect(200);

    expect(res.body.usage.consumed).toBe(5);
    expect(res.body.usage.plan_name).toBe('Basic');
  });

  it('returns paginated history', async () => {
    const account = await createTestAccount('Test', STARTER_PLAN_ID);
    const userId = await createTestUser(
      account.api_key,
      'u1',
      'User',
      BASIC_PLAN_ID
    );

    // Make several requests
    for (let i = 0; i < 5; i++) {
      await request
        .post('/api/consume')
        .set('X-API-Key', account.api_key)
        .send({ user_id: userId, units: 5, request_id: `hist-${i}` });
    }

    const res = await request
      .get('/api/usage/history?page=1&page_size=3')
      .set('X-API-Key', account.api_key)
      .expect(200);

    expect(res.body.items).toHaveLength(3);
    expect(res.body.total).toBe(5);
    expect(res.body.total_pages).toBe(2);
    expect(res.body.page).toBe(1);
  });

  it('filters history by accepted status', async () => {
    const account = await createTestAccount('Test', STARTER_PLAN_ID);
    const userId = await createTestUser(
      account.api_key,
      'u1',
      'User',
      BASIC_PLAN_ID
    );

    // One accepted
    await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 5, request_id: 'good' })
      .expect(200);

    // One rejected (over per-request limit)
    await request
      .post('/api/consume')
      .set('X-API-Key', account.api_key)
      .send({ user_id: userId, units: 25, request_id: 'bad' })
      .expect(403);

    const rejected = await request
      .get('/api/usage/history?accepted=false')
      .set('X-API-Key', account.api_key)
      .expect(200);

    expect(rejected.body.items).toHaveLength(1);
    expect(rejected.body.items[0].accepted).toBe(false);
  });
});
