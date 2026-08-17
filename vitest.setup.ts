/**
 * Hermetic test enforcement — layer 2 of 3.
 *
 * Layer 1 is dependency injection: no adapter self-instantiates, and the composition
 * root is excluded from the test tsconfig, so a test cannot even import it.
 *
 * Layer 2 is this file: the network transports are removed from the test runtime
 * entirely. Real credentials in the environment change nothing, because there is no
 * transport left to carry them.
 *
 * Layer 3 is `packages/audit/src/hermetic.test.ts`, which sets a fake API key, tries to
 * reach out, and asserts HermeticViolation. If someone weakens this file, that test
 * goes red.
 *
 * Deliberately NOT an environment variable. An environment variable is a thing you can
 * set.
 */
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';

export class HermeticViolation extends Error {
  constructor(what: string) {
    super(
      `Hermetic test violation: ${what}. Tests must not touch the network. ` +
        `Inject a fake adapter instead — see docs/TESTING.md.`,
    );
    this.name = 'HermeticViolation';
  }
}

const blocked =
  (what: string) =>
  (..._args: unknown[]): never => {
    throw new HermeticViolation(what);
  };

globalThis.fetch = blocked('fetch()') as unknown as typeof fetch;
net.Socket.prototype.connect = blocked('net.Socket#connect') as never;
(net as unknown as Record<string, unknown>).connect = blocked('net.connect');
(net as unknown as Record<string, unknown>).createConnection = blocked('net.createConnection');
(tls as unknown as Record<string, unknown>).connect = blocked('tls.connect');
(dns as unknown as Record<string, unknown>).lookup = blocked('dns.lookup');
(dns.promises as unknown as Record<string, unknown>).lookup = blocked('dns.promises.lookup');
