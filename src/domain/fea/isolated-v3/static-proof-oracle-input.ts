/**
 * Closed static-proof oracle payload and evaluation mapping.
 *
 * Exactly the current two mechanical metrics and their native units. The
 * adapter adds the provider tool envelope and parses the wire response. This
 * module names no MCP client, tool, URL, or provider.
 */

import {
  buildConstraintAst,
  type ConstraintAst,
  type OracleRequirement,
} from "../../kernel/proof-case.ts";
import type { MechanicalRequirement } from "../seal-case/mechanical-proof-case.ts";
import { requirementEvaluationIdentity } from "../../thread/requirement-evaluation-identity.ts";
import type {
  RequirementEvaluation,
  RequirementEvaluationStatus,
  ThreadFreshness,
  ThreadOperationRef,
} from "../../thread/thread-snapshot.ts";

export const STATIC_PROOF_METRIC_UNITS = Object.freeze(
  {
    "maximum-displacement": "mm",
    "maximum-von-mises-stress": "MPa",
  } as const,
);

export type StaticProofMetric = keyof typeof STATIC_PROOF_METRIC_UNITS;

export interface StaticProofSolverMetrics {
  readonly maximumDisplacement: { readonly value: number; readonly unit: string };
  readonly maximumVonMises: { readonly value: number; readonly unit: string };
}

export interface StaticProofOracleValues {
  readonly [feature: string]: { readonly value: number; readonly unit: string };
}

export interface StaticProofOracleInput {
  readonly constraints: readonly ConstraintAst[];
  readonly values: StaticProofOracleValues;
}

export type StaticProofOracleOutcome =
  | {
    readonly status: "pass" | "fail";
    readonly computedValue: number;
    readonly threshold: number;
    readonly margin: number;
    readonly unit: string;
  }
  | { readonly status: "error" | "unresolved" };

export interface StaticProofEvaluationContext {
  readonly verdictCaptureFp: string;
  readonly evaluatedAt: string;
  readonly evidenceArtifactId: string;
  readonly observationIds: readonly string[];
  readonly threadRequirementIds: ReadonlyMap<string, string>;
  readonly evaluator: ThreadOperationRef;
}

const RESULT_FIELD = Object.freeze(
  {
    "maximum-displacement": "maximumDisplacement",
    "maximum-von-mises-stress": "maximumVonMises",
  } as const satisfies Record<StaticProofMetric, keyof StaticProofSolverMetrics>,
);

export function projectStaticProofRequirement(
  requirement: MechanicalRequirement,
): OracleRequirement {
  return {
    id: requirement.id,
    name: requirement.name,
    metric: requirement.feature,
    operator: requirement.operator,
    limit: requirement.limit,
  };
}

export function buildStaticProofOracleValues(
  metrics: StaticProofSolverMetrics,
  requirements: readonly MechanicalRequirement[],
): StaticProofOracleValues {
  const values: Record<string, { readonly value: number; readonly unit: string }> = {};
  for (const requirement of requirements) {
    const unit = STATIC_PROOF_METRIC_UNITS[requirement.metric as StaticProofMetric];
    const field = RESULT_FIELD[requirement.metric as StaticProofMetric];
    if (unit === undefined || field === undefined) {
      throw new Error(
        `unsupported metric "${requirement.metric}" — only ${
          Object.keys(STATIC_PROOF_METRIC_UNITS).join(", ")
        } are supported.`,
      );
    }
    values[requirement.feature] = {
      value: metrics[field].value,
      unit,
    };
  }
  return values;
}

export function buildStaticProofOracleInput(
  metrics: StaticProofSolverMetrics,
  requirements: readonly MechanicalRequirement[],
): StaticProofOracleInput {
  return {
    constraints: requirements.map((requirement) =>
      buildConstraintAst(projectStaticProofRequirement(requirement))
    ),
    values: buildStaticProofOracleValues(metrics, requirements),
  };
}

export function evaluationsFromStaticProofOracle(
  outcomes: ReadonlyMap<string, StaticProofOracleOutcome>,
  requirements: readonly MechanicalRequirement[],
  context: StaticProofEvaluationContext,
): RequirementEvaluation[] {
  const {
    verdictCaptureFp,
    evaluatedAt,
    evidenceArtifactId,
    observationIds,
    threadRequirementIds,
    evaluator,
  } = context;

  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: evaluatedAt,
    invalidatedByChangeIds: [],
  };

  return requirements.map((requirement, index) => {
    const observationId = observationIds[index];
    if (observationId === undefined) {
      throw new Error(
        `fea-oracle-adapter: observationIds[${index}] is missing` +
          ` for requirement "${requirement.id}".`,
      );
    }
    const oracleResult = outcomes.get(requirement.id);
    if (oracleResult === undefined) {
      throw new Error(
        `fea-oracle-adapter: oracle outcome missing for requirement id "${requirement.id}".`,
      );
    }

    const threadRequirementId = threadRequirementIds.get(requirement.id);
    if (threadRequirementId === undefined) {
      throw new Error(
        `fea-oracle-adapter: no thread requirement resolved for proof-case` +
          ` requirement id "${requirement.id}".`,
      );
    }
    const id = requirementEvaluationIdentity({
      requirementId: threadRequirementId,
      evidenceFingerprint: { algorithm: "sha256", digest: verdictCaptureFp },
    }).id;

    const status = oracleResult.status as RequirementEvaluationStatus;
    const base: RequirementEvaluation = {
      id,
      name: `${requirement.name} evaluation`,
      requirementId: threadRequirementId,
      observationIds: [observationId],
      status,
      evaluatedAt,
      evaluator,
      evidenceArtifactIds: [evidenceArtifactId],
      message: evaluationMessage(oracleResult),
      freshness,
    };

    if (oracleResult.status === "pass" || oracleResult.status === "fail") {
      return {
        ...base,
        comparison: {
          observationId,
          actual: { value: oracleResult.computedValue, unit: oracleResult.unit },
          operator: requirement.operator,
          limit: { value: oracleResult.threshold, unit: oracleResult.unit },
          normalizedUnit: oracleResult.unit,
          margin: { value: oracleResult.margin, unit: oracleResult.unit },
        },
      };
    }
    return base;
  });
}

function evaluationMessage(result: StaticProofOracleOutcome): string {
  switch (result.status) {
    case "pass":
      return "The observed value is within the reviewed concept limit.";
    case "fail":
      return "The observed value exceeds the reviewed concept limit.";
    case "error":
      return "The oracle returned an error evaluating this limit.";
    case "unresolved":
      return "The oracle could not resolve this limit evaluation.";
  }
}
