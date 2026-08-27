/**
 * Canonical failure selection for the SysML architecture ratchet.
 *
 * Rank first, then the full canonical context. Input array order never
 * decides the selected diagnostic. Not a generic graph library.
 */

import { deterministicJson } from "../../kernel/deterministic-json.ts";

export interface RankedContext {
  readonly rank: number;
  readonly context: Readonly<Record<string, unknown>>;
}

export function compareCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function canonicalizeContext(
  context: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return canonicalizeValue(context) as Readonly<Record<string, unknown>>;
}

export function selectRankedFailure<T extends RankedContext>(
  failures: readonly T[],
): T | undefined {
  if (failures.length === 0) return undefined;
  const canonical = failures.map((failure) => ({
    ...failure,
    context: canonicalizeContext(failure.context),
  }));
  let chosen = canonical[0]!;
  for (let i = 1; i < canonical.length; i++) {
    const candidate = canonical[i]!;
    const byRank = candidate.rank - chosen.rank;
    if (byRank > 0) continue;
    if (
      byRank < 0 ||
      compareCodeUnit(
          deterministicJson(candidate.context),
          deterministicJson(chosen.context),
        ) < 0
    ) {
      chosen = candidate;
    }
  }
  return chosen;
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue).toSorted((left, right) =>
      compareCodeUnit(deterministicJson(left), deterministicJson(right))
    );
  }
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(record).toSorted(compareCodeUnit)) {
    if (record[key] === undefined) continue;
    canonical[key] = canonicalizeValue(record[key]);
  }
  return canonical;
}
