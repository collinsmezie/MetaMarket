/**
 * Unit-test bootstrap.
 *
 * Unit tests must never reach the network, a database or an LLM provider (Execution.md §4.1),
 * so no real configuration is loaded here and nothing is started.
 */
process.env.NODE_ENV = 'test';

// Keep durations comparable across machines when a test asserts on timing behaviour.
jest.setTimeout(15_000);
