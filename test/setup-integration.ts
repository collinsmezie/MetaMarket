import { config as loadEnv } from 'dotenv';

/**
 * Integration-test bootstrap.
 *
 * Integration tests run against the real Postgres and Redis from docker-compose
 * (Execution.md §4.2), because the behaviour under test — distributed locking, transactional
 * persistence, pgvector similarity — cannot be verified against in-memory fakes.
 *
 * LLM providers and outbound channels remain faked: asserting on a live model's output would
 * make the suite non-deterministic and cost money per run, and a real send would message a
 * real phone.
 */
process.env.NODE_ENV = 'test';

// Loaded here rather than relying on ConfigModule: this file runs before Nest boots, and
// `.env.test` points at a throwaway database so the suite can truncate freely.
loadEnv({ path: '.env.test' });
loadEnv({ path: '.env' });

// Real containers, real migrations: these tests are legitimately slower than unit tests.
jest.setTimeout(60_000);

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Integration tests need DATABASE_URL. Start dependencies with `npm run infra:up`, then create .env.test (see .env.example).',
  );
}

if (!process.env.REDIS_URL) {
  throw new Error(
    'Integration tests need REDIS_URL. Start dependencies with `npm run infra:up`, then create .env.test (see .env.example).',
  );
}

if (!/_test(\?|$)/.test(process.env.DATABASE_URL)) {
  // These tests truncate every table. Refusing to run against a database whose name does not
  // end in `_test` is the difference between a fast suite and a wiped development database.
  throw new Error(
    `Refusing to run integration tests against "${process.env.DATABASE_URL.replace(/\/\/[^@]*@/, '//<redacted>@')}". ` +
      'The suite truncates all tables, so the database name must end in "_test".',
  );
}
