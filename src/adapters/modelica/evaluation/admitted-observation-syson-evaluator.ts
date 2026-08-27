/**
 * Fixed admitted-Modelica evaluator: SysON is the comparator.
 *
 * Identity unit policy only. A unit mismatch is unresolved and is never
 * converted locally. Observation values in the SysON request come from
 * reopened evidence, not from the caller.
 *
 * OracleRequirement.id is the exact SysML RequirementUsage / selection
 * identity. threadRequirementId is the Thread TracedRequirement record id.
 * They are not interchangeable: SysON is keyed by the SysML id; Thread
 * evaluations are keyed by the record id.
 */

import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import {
  buildConstraintAst,
  type OracleRequirement,
} from "../../../domain/kernel/proof-case.ts";
import {
  type AdmittedObservationSelection,
  normalizeAdmittedObservationUnit,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation.ts";
import { VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION } from "../../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  type ParsedOracleResult,
  parseOracleOutcome,
} from "../../shared/syson-constraint-oracle-outcome.ts";
import {
  type AdmittedObservationEvaluationCapture,
  validateAdmittedObservationEvaluationCapture,
} from "./admitted-observation-evaluation-capture.ts";

export interface AdmittedObservationOraclePair {
  readonly selection: AdmittedObservationSelection;
  readonly requirement: OracleRequirement;
  readonly threadRequirementId: string;
  readonly observation: { readonly value: number; readonly unit: string };
}

export interface AdmittedObservationOracleRequest {
  readonly name: "syson_constraint_evaluate";
  readonly arguments: {
    readonly constraints: ReturnType<typeof buildConstraintAst>[];
    readonly values: Record<string, { readonly value: number; readonly unit: string }>;
  };
}

export interface PreparedAdmittedObservationOracleCall {
  readonly request: AdmittedObservationOracleRequest;
  readonly dispatched: readonly AdmittedObservationOraclePair[];
  readonly unresolved: AdmittedObservationEvaluationCapture["unresolved"];
}

export interface AdmittedObservationOracleDispatch {
  readonly capture: AdmittedObservationEvaluationCapture;
  readonly outcomes: ReadonlyMap<string, ParsedOracleResult>;
}

export function prepareAdmittedObservationOracleCall(
  pairs: readonly AdmittedObservationOraclePair[],
): PreparedAdmittedObservationOracleCall {
  if (pairs.length === 0) {
    throw new TypeError("Admitted observation oracle call requires at least one pair.");
  }
  const dispatched: AdmittedObservationOraclePair[] = [];
  const unresolved: Array<
    AdmittedObservationEvaluationCapture["unresolved"][number]
  > = [];
  for (const pair of pairs) {
    if (pair.requirement.id !== pair.selection.requirementElementId) {
      throw new TypeError(
        `Oracle requirement "${pair.requirement.id}" is not the exact selection RequirementUsage.`,
      );
    }
    const declared = normalizeAdmittedObservationUnit(
      pair.selection.declaredUnit,
      pair.observation.unit,
    );
    const limit = normalizeAdmittedObservationUnit(
      pair.selection.declaredUnit,
      pair.requirement.limit.unit,
    );
    if (declared.status !== "matched" || limit.status !== "matched") {
      unresolved.push({
        requirementElementId: pair.selection.requirementElementId,
        reason: "unit-identity-mismatch",
      });
      continue;
    }
    dispatched.push(pair);
  }
  const constraints = dispatched.map((pair) => buildConstraintAst(pair.requirement));
  const values: Record<string, { readonly value: number; readonly unit: string }> = {};
  for (const pair of dispatched) {
    values[pair.requirement.metric] = {
      value: pair.observation.value,
      unit: pair.observation.unit,
    };
  }
  return {
    request: {
      name: "syson_constraint_evaluate",
      arguments: { constraints, values },
    },
    dispatched,
    unresolved,
  };
}

export function parseAdmittedObservationOracleOutcome(
  structuredContent: Readonly<Record<string, unknown>>,
  dispatched: readonly AdmittedObservationOraclePair[],
): ReadonlyMap<string, ParsedOracleResult> {
  return parseOracleOutcome(
    structuredContent,
    dispatched.map((pair) => pair.requirement),
  );
}

export async function callAdmittedObservationConstraintOracle(
  syson: McpToolClient,
  pairs: readonly AdmittedObservationOraclePair[],
): Promise<AdmittedObservationOracleDispatch> {
  const prepared = prepareAdmittedObservationOracleCall(pairs);
  const structuredContent = prepared.dispatched.length === 0
    ? { results: [] }
    : (await syson.callTool({
      name: prepared.request.name,
      arguments: prepared.request.arguments,
    })).structuredContent;
  const outcomes = parseAdmittedObservationOracleOutcome(
    structuredContent,
    prepared.dispatched,
  );
  const capture = validateAdmittedObservationEvaluationCapture({
    schemaVersion: "modelica-admitted-observation-evaluation-capture/1.0",
    kind: "modelica-admitted-observation-evaluation",
    operation: VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
    request: prepared.request,
    response: { structuredContent },
    unresolved: prepared.unresolved,
  });
  return { capture, outcomes };
}
