/**
 * npm run replay <correlation_id> [--verbose]
 *
 * Prints the complete decision chain for one case as a readable narrative, and exits
 * non-zero if the chain fails integrity checks. This is the demo: it proves the trace
 * is real rather than decorative.
 *
 * With no DATABASE_URL it reads the built-in fixture chain, so a stranger can clone the
 * repo and see a genuine replay without standing anything up.
 */
import { InMemoryAuditStore, checkIntegrity, narrate } from '../packages/audit/src/index.js';
import type { AuditReader, CorrelationId } from '../packages/audit/src/index.js';
import { FIXTURE_CASE_ID, declineChain } from '../packages/audit/src/fixtures/chains.js';

async function resolveReader(): Promise<{ reader: AuditReader; source: string }> {
  if (process.env['DATABASE_URL']) {
    throw new Error(
      'Postgres audit reader is not implemented yet — slice 1b. Unset DATABASE_URL to ' +
        'replay the built-in fixture chain.',
    );
  }
  return { reader: new InMemoryAuditStore(declineChain), source: 'built-in fixture' };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const correlationId = (args.find((a) => !a.startsWith('--')) ?? FIXTURE_CASE_ID) as CorrelationId;

  const { reader, source } = await resolveReader();
  const records = await reader.read(correlationId);

  if (records.length === 0) {
    process.stderr.write(`No records for correlation id "${correlationId}" (source: ${source}).\n`);
    return 2;
  }

  process.stdout.write(narrate(records, { verbose }) + '\n');

  const integrity = checkIntegrity(records);
  if (!integrity.ok) {
    process.stderr.write(`Chain integrity FAILED:\n  ${integrity.problems.join('\n  ')}\n`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  },
);
