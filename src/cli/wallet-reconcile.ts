import { PrismaClient } from '@prisma/client';

/**
 * Finds debits that took a vendor's money without delivering the visibility they paid for
 * (Konnet Credits Recharge TDR §25.6).
 *
 * The residual crash window the debit path cannot close: a debit commits, then the process dies
 * before the delivery row is written or the responder is marked revealed. The fee is gone and
 * nothing was shown. The TDR is explicit that the debit path must not ship without this query,
 * and the reason is that the alternative is a silent, unbounded, unnoticed liability.
 *
 * Read-only. Refunding is deliberately not automated — see §25.1.
 *
 * Usage:
 *   node dist/cli/wallet-reconcile.js
 *   node dist/cli/wallet-reconcile.js --since 2026-08-01
 */

interface OrphanedDebit {
  transaction_id: string;
  wallet_id: string;
  user_id: string;
  amount_credits: number;
  reason: string;
  provider_reference: string;
  created_at: Date;
  request_id: string | null;
  vendor_id: string | null;
  problem: string;
}

function parseSince(argv: readonly string[]): Date {
  const index = argv.indexOf('--since');
  if (index === -1) return new Date(0);

  const parsed = new Date(argv[index + 1] ?? '');
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`--since expects an ISO date, got "${argv[index + 1]}"`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const since = parseSince(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    // Both debit references embed the request and vendor (`delivery:<req>:<vendor>` and
    // `response:<req>:<vendor>`), so the ledger alone is enough to find what it should match.
    const orphans = await prisma.$queryRaw<OrphanedDebit[]>`
      WITH debits AS (
        SELECT
          t.id                        AS transaction_id,
          t.wallet_id,
          w.user_id,
          t.amount_credits,
          t.reason,
          t.provider_reference,
          t.created_at,
          split_part(t.provider_reference, ':', 1) AS kind,
          NULLIF(split_part(t.provider_reference, ':', 2), '') AS request_id,
          NULLIF(split_part(t.provider_reference, ':', 3), '') AS vendor_id
        FROM credit_transactions t
        JOIN credit_wallets w ON w.id = t.wallet_id
        WHERE t.type = 'debit' AND t.created_at >= ${since}
      )
      SELECT
        d.transaction_id, d.wallet_id, d.user_id, d.amount_credits, d.reason,
        d.provider_reference, d.created_at, d.request_id, d.vendor_id,
        CASE
          WHEN rd.id IS NULL THEN 'no delivery row for this debit'
          WHEN rd.revealed_to_customer = false THEN 'delivery exists but the vendor was never revealed'
          ELSE 'delivery exists but is not marked as billed'
        END AS problem
      FROM debits d
      LEFT JOIN request_deliveries rd
        ON rd.request_id = d.request_id::uuid AND rd.vendor_id = d.vendor_id::uuid
      WHERE d.kind IN ('delivery', 'response')
        AND (rd.id IS NULL OR rd.revealed_to_customer = false OR rd.credit_deducted = false)
      ORDER BY d.created_at DESC
    `;

    if (orphans.length === 0) {
      process.stdout.write(
        `No orphaned debits since ${since.toISOString()}. Every charged vendor was shown to a customer.\n`,
      );
      return;
    }

    const credits = orphans.reduce((total, row) => total + row.amount_credits, 0);

    process.stdout.write(
      `${orphans.length} orphaned debit(s) since ${since.toISOString()}, ${credits} credit(s) total.\n` +
        'These vendors paid the visibility fee without being shown. Refunds are manual (TDR §25.1).\n\n',
    );

    for (const row of orphans) {
      process.stdout.write(
        [
          `  ${row.created_at.toISOString()}  ${row.provider_reference}`,
          `    vendor=${row.vendor_id ?? '?'} user=${row.user_id} credits=${row.amount_credits}`,
          `    ${row.problem}`,
          '',
        ].join('\n'),
      );
    }

    // Non-zero so a scheduled run can alert rather than scroll past.
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Reconciliation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
