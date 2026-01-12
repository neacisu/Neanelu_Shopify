export type BulkMutationLineFailureClass = 'recoverable' | 'permanent';

export type BulkMutationLineFailureDecision = Readonly<{
  classification: BulkMutationLineFailureClass;
  reasons: string[];
}>;

function extractStringsDeep(value: unknown, max = 50): string[] {
  const out: string[] = [];

  const visit = (v: unknown): void => {
    if (out.length >= max) return;
    if (typeof v === 'string') {
      const s = v.trim();
      if (s) out.push(s);
      return;
    }
    if (!v || typeof v !== 'object') return;

    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }

    const obj = v as Record<string, unknown>;
    // Prefer common fields
    if (typeof obj['message'] === 'string') visit(obj['message']);
    if (typeof obj['code'] === 'string') visit(obj['code']);
    if (typeof obj['errorCode'] === 'string') visit(obj['errorCode']);

    // Also scan shallow keys for strings
    for (const key of Object.keys(obj)) {
      if (out.length >= max) break;
      const val = obj[key];
      if (typeof val === 'string') visit(val);
    }
  };

  visit(value);

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of out) {
    if (seen.has(s)) continue;
    seen.add(s);
    deduped.push(s);
  }
  return deduped;
}

function isTransientHint(message: string): boolean {
  return /\b(throttled|too many requests|429|rate limit|timeout|timed out|temporar|try again|internal server error|service unavailable|bad gateway|gateway timeout|econnreset|enotfound|eai_again)\b/i.test(
    message
  );
}

/**
 * Decide if a single bulk-mutation result line should be requeued.
 *
 * Policy:
 * - `userErrors` are assumed PERMANENT (validation/business) unless they clearly look transient.
 * - GraphQL/top-level `errors` can be transient (throttling/timeout/5xx) -> recoverable.
 * - Parse errors are PERMANENT (do not requeue; input is suspect).
 */
export function classifyBulkMutationResultLineFailure(params: {
  parseError?: boolean;
  graphqlErrors?: unknown[];
  userErrors?: unknown[];
}): BulkMutationLineFailureDecision {
  if (params.parseError) {
    return { classification: 'permanent', reasons: ['json_parse_error'] };
  }

  const gqlMsgs = extractStringsDeep(params.graphqlErrors ?? []);
  const userMsgs = extractStringsDeep(params.userErrors ?? []);

  const reasons: string[] = [];

  // GraphQL/top-level errors: treat transient hints as recoverable.
  const gqlTransient = gqlMsgs.some(isTransientHint);
  if ((params.graphqlErrors?.length ?? 0) > 0) {
    reasons.push('graphql_error');
    if (gqlTransient) reasons.push('graphql_transient_hint');
  }

  // userErrors: mostly permanent; allow recoverable only if explicit transient hint.
  const userTransient = userMsgs.some(isTransientHint);
  if ((params.userErrors?.length ?? 0) > 0) {
    reasons.push('user_error');
    if (userTransient) reasons.push('user_transient_hint');
  }

  if (gqlTransient) return { classification: 'recoverable', reasons };

  // If there are only userErrors, default permanent.
  if ((params.userErrors?.length ?? 0) > 0) {
    return {
      classification: userTransient ? 'recoverable' : 'permanent',
      reasons,
    };
  }

  // If there are GraphQL errors but no transient hint, default permanent (conservative).
  if ((params.graphqlErrors?.length ?? 0) > 0) {
    return { classification: 'permanent', reasons };
  }

  return { classification: 'permanent', reasons: ['unknown_failure_shape'] };
}
