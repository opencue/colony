/**
 * Mirror of the production shellQuote rule (packages/queen/src/sweep.ts,
 * apps/cli/src/commands/health.ts, apps/cli/src/lib/gitguardex.ts) so path
 * expectations stay correct on every OS: Windows temp paths contain `\` and
 * `~`, which fall outside the safe charset and get single-quoted.
 */
export function shellQuoteForTest(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
