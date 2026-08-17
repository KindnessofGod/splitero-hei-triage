/**
 * Layer 3 of hermetic enforcement.
 *
 * A test must be unable to reach a live model even with real credentials present.
 * This asserts that. If someone weakens vitest.setup.ts, these go red.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import net from 'node:net';

describe('hermetic test environment', () => {
  beforeAll(() => {
    // Credentials present and plausible. They must not help.
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-not-a-real-key';
    process.env['DATABASE_URL'] = 'postgres://user:pw@example.com:5432/db';
  });

  // The block throws synchronously rather than returning a rejected promise: a sync
  // throw cannot be swallowed by an unawaited call, which a rejection can.
  it('blocks fetch even with an API key set', () => {
    expect(process.env['ANTHROPIC_API_KEY']).toBeTruthy();
    expect(() => fetch('https://api.anthropic.com/v1/messages')).toThrow(
      /Hermetic test violation/,
    );
  });

  it('blocks raw socket connections', () => {
    expect(() => new net.Socket().connect(443, 'api.anthropic.com')).toThrow(
      /Hermetic test violation/,
    );
  });

  it('blocks net.createConnection', () => {
    expect(() => net.createConnection({ port: 443, host: 'example.com' })).toThrow(
      /Hermetic test violation/,
    );
  });

  it('names the remedy in the error, not just the prohibition', () => {
    expect(() => fetch('https://example.com')).toThrow(/Inject a fake adapter/);
  });
});
