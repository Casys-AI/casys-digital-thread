/**
 * Pure parsing and materialization helpers for SysON constraint-oracle results.
 *
 * This module deliberately contains no provider I/O and names no product. It
 * is the shared boundary for any adapter that consumes
 * `syson_constraint_evaluate` structuredContent.
 */

import type {
  RequirementEvaluation,
  RequirementEvaluationStatus,
  ThreadFreshness,
  ThreadOperationRef,
  TracedRequirement,
} from "../../domain/thread/thread-snapshot.ts";
import type { OracleRequirement } from "../../domain/kernel/proof-case.ts";

/**
 * Parsed verdict for a single constraint from syson_constraint_evaluate.
 *
 * Union type: callers must not read numeric fields when the oracle could not
 * determine a verdict. Merging them into optional fields would silently allow
 * callers to use 0 as a default.
 */
export type ParsedOracleResult =
  | {
    readonly status: "pass" | "fail";
    readonly computedValue: number;
    readonly threshold: number;
    readonly margin: number;
    readonly marginPercent: number;
    /** Normalised unit used by the oracle; equals the declared limit unit. */
    readonly unit: string;
  }
  | { readonly status: "error" | "unresolved" };

/**
 * Build a RequirementEvaluation from an already-obtained oracle verdict.
 *
 * The oracle is the sole authority on the verdict (no local arithmetic). For
 * error / unresolved statuses, comparison is intentionally absent so the
 * resulting Thread snapshot remains valid.
 */
export function evaluationFromOracle(
  requirement: TracedRequirement,
  observation: { id: string; quantity: { value: number; unit: string } },
  oracleResult: ParsedOracleResult,
  evaluator: ThreadOperationRef,
  solveId: string,
  at: string,
  freshness: ThreadFreshness,
): RequirementEvaluation {
  const id = `${requirement.id}-evaluation`;
  const base = {
    id,
    name: `${requirement.name} evaluation`,
    requirementId: requirement.id,
    observationIds: [observation.id],
    status: oracleResult.status as RequirementEvaluationStatus,
    evaluatedAt: at,
    evaluator,
    evidenceArtifactIds: [solveId],
    freshness,
  };
  if (oracleResult.status === "pass" || oracleResult.status === "fail") {
    return {
      ...base,
      comparison: {
        observationId: observation.id,
        actual: { value: oracleResult.computedValue, unit: oracleResult.unit },
        operator: "<=",
        limit: { value: oracleResult.threshold, unit: oracleResult.unit },
        normalizedUnit: oracleResult.unit,
        margin: { value: oracleResult.margin, unit: oracleResult.unit },
      },
      message: oracleResult.status === "pass"
        ? "The observed value is within the reviewed concept limit."
        : "The observed value exceeds the reviewed concept limit.",
    };
  }
  return {
    ...base,
    message: oracleResult.status === "error"
      ? "The oracle returned an error evaluating this limit."
      : "The oracle could not resolve this limit evaluation.",
  };
}

const ORACLE_STATUS_VALUES = new Set<string>([
  "pass",
  "fail",
  "error",
  "unresolved",
]);

/**
 * Parse only the identity/status rows of a `syson_constraint_evaluate`
 * structuredContent. Numeric fields may be present and are ignored here.
 * L5 closeout recrosses them separately through `parseOracleOutcome`.
 *
 * Fail-closed on a missing results array, a non-object row, a missing or
 * duplicate constraintId, or a status outside pass|fail|error|unresolved.
 */
export function parseOracleStatusIdentities(
  content: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, RequirementEvaluationStatus> {
  if (!Array.isArray(content.results)) {
    throw new Error(
      "syson_constraint_evaluate: structuredContent.results must be an array.",
    );
  }
  const map = new Map<string, RequirementEvaluationStatus>();
  for (let i = 0; i < content.results.length; i++) {
    const row = content.results[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`syson_constraint_evaluate: results[${i}] must be an object.`);
    }
    const item = row as Record<string, unknown>;
    const constraintId = item.constraintId;
    if (
      typeof constraintId !== "string" || constraintId.trim() !== constraintId ||
      constraintId.length === 0
    ) {
      throw new Error(
        `syson_constraint_evaluate: results[${i}].constraintId is unknown or missing.`,
      );
    }
    if (map.has(constraintId)) {
      throw new Error(
        `syson_constraint_evaluate: duplicate constraintId "${constraintId}" in results.`,
      );
    }
    const rawStatus = item.status;
    if (typeof rawStatus !== "string" || !ORACLE_STATUS_VALUES.has(rawStatus)) {
      throw new Error(
        `syson_constraint_evaluate: results[${i}].status must be pass|fail|error|unresolved.`,
      );
    }
    map.set(constraintId, rawStatus as RequirementEvaluationStatus);
  }
  return map;
}

/**
 * Parse and validate the structuredContent returned by
 * syson_constraint_evaluate.
 *
 * Fail-closed: any structural deviation, missing constraint, duplicate, unit
 * mismatch (oracle unit != declared limit unit), or non-finite number is a
 * hard rejection before any numeric field is consumed.
 */
export function parseOracleOutcome(
  content: Readonly<Record<string, unknown>>,
  requirements: readonly OracleRequirement[],
): ReadonlyMap<string, ParsedOracleResult> {
  if (!Array.isArray(content.results)) {
    throw new Error(
      "syson_constraint_evaluate: structuredContent.results must be an array.",
    );
  }
  const rows = content.results as unknown[];
  if (rows.length !== requirements.length) {
    throw new Error(
      `syson_constraint_evaluate: expected ${requirements.length} result(s), got ${rows.length}.`,
    );
  }
  const expectedIds = new Map(
    requirements.map((requirement) => [requirement.id, requirement]),
  );
  const map = new Map<string, ParsedOracleResult>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`syson_constraint_evaluate: results[${i}] must be an object.`);
    }
    const item = row as Record<string, unknown>;
    const constraintId = item.constraintId;
    if (typeof constraintId !== "string" || !expectedIds.has(constraintId)) {
      throw new Error(
        `syson_constraint_evaluate: results[${i}].constraintId is unknown or missing.`,
      );
    }
    if (map.has(constraintId)) {
      throw new Error(
        `syson_constraint_evaluate: duplicate constraintId "${constraintId}" in results.`,
      );
    }
    const rawStatus = item.status;
    if (typeof rawStatus !== "string" || !ORACLE_STATUS_VALUES.has(rawStatus)) {
      throw new Error(
        `syson_constraint_evaluate: results[${i}].status must be pass|fail|error|unresolved.`,
      );
    }
    const status = rawStatus as ParsedOracleResult["status"];
    if (status === "pass" || status === "fail") {
      const requirement = expectedIds.get(constraintId)!;
      if (item.unit !== requirement.limit.unit) {
        throw new Error(
          `syson_constraint_evaluate: results[${i}].unit must equal "${requirement.limit.unit}" ` +
            `(got "${item.unit}").`,
        );
      }
      map.set(constraintId, {
        status,
        computedValue: oracleNumber(item, "computedValue", i),
        threshold: oracleNumber(item, "threshold", i),
        margin: oracleNumber(item, "margin", i),
        marginPercent: oracleNumber(item, "marginPercent", i),
        unit: requirement.limit.unit,
      });
    } else {
      map.set(constraintId, { status });
    }
  }
  for (const id of expectedIds.keys()) {
    if (!map.has(id)) {
      throw new Error(
        `syson_constraint_evaluate: missing result for constraint "${id}".`,
      );
    }
  }
  return map;
}

function oracleNumber(
  item: Record<string, unknown>,
  field: string,
  index: number,
): number {
  const value = item[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `syson_constraint_evaluate: results[${index}].${field} must be a finite number.`,
    );
  }
  return value;
}
