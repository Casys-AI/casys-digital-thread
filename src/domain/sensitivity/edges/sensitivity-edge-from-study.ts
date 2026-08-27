/**
 * Server-fixed SensitivityEdge construction from a reviewed study and its
 * finite-difference result. Agents never supply SysML attribute names.
 *
 * Naming follows the historical R16 scheme as a schema only. It does not
 * replay retired CM-01 evidence.
 */

import type { SensitivityStudyResult } from "../study/sensitivity-study-result.ts";
import {
  SENSITIVITY_EDGE_SCHEMA,
  type SensitivityEdge,
  validateSensitivityEdgeSet,
} from "./sensitivity-edge.ts";
import { computeSensitivities } from "../study/sensitivity-study.ts";
import type { SensitivityStudyCaseV2 } from "../study/sensitivity-study-v2.ts";
import type { SensitivityMetricMeasurement } from "../study/sensitivity-study.ts";

export interface SensitivityEdgeStudyProvenance {
  readonly runId: string;
  readonly capturedAt: string;
}

export function sensitivityEdgesFromStudy(
  studyCase: SensitivityStudyCaseV2,
  baseMetrics: ReadonlyMap<string, SensitivityMetricMeasurement>,
  steppedMetrics: ReadonlyMap<string, SensitivityMetricMeasurement>,
  provenance: SensitivityEdgeStudyProvenance,
): readonly SensitivityEdge[] {
  const derivatives = computeSensitivities(studyCase, baseMetrics, steppedMetrics);
  const parameterAtBase = studyCase.baseValue.value;
  const parameterAtPerturbed = parameterAtBase + studyCase.step.value;
  const lower = Math.min(parameterAtBase, parameterAtPerturbed);
  const upper = Math.max(parameterAtBase, parameterAtPerturbed);
  const driverUnit = studyCase.baseValue.unit;
  const driverStem = toCamelIdent(studyCase.target.semanticKey);

  const edges = derivatives.derivatives.map((derivative) => {
    const responseToken = unitToToken(derivative.unit);
    return {
      schemaVersion: SENSITIVITY_EDGE_SCHEMA,
      driver: {
        sysmlAttrName: `${driverStem}_for_${derivative.metric}`,
        unit: driverUnit,
        basePoint: {
          value: studyCase.baseValue.value,
          unit: driverUnit,
        },
        validityNeighborhood: {
          lower: { value: lower, unit: driverUnit },
          upper: { value: upper, unit: driverUnit },
          lowerConstraintName: `${derivative.metric}_validity_lower`,
          upperConstraintName: `${derivative.metric}_validity_upper`,
        },
      },
      response: {
        metric: derivative.metric,
        sysmlAttrName: `d_${derivative.metric}_${responseToken}`,
        unit: derivative.unit,
      },
      derivative: {
        value: derivative.value,
        unit: derivative.unit,
      },
      provenance,
    };
  });
  return validateSensitivityEdgeSet(edges);
}

export function sensitivityPartDefName(caseId: string): string {
  const ident = toPascalIdent(caseId);
  return ident.endsWith("Edges") ? ident : `${ident}Edges`;
}

function unitToToken(unit: string): string {
  return unit.replaceAll("/", "_per_");
}

function toCamelIdent(value: string): string {
  const parts = splitIdent(value);
  if (parts.length === 0) {
    throw new TypeError(
      `cannot derive a SysML identifier from ${JSON.stringify(value)}.`,
    );
  }
  return parts[0]!.toLowerCase() + parts.slice(1).map(capitalize).join("");
}

function toPascalIdent(value: string): string {
  const parts = splitIdent(value);
  if (parts.length === 0) {
    throw new TypeError(
      `cannot derive a SysML identifier from ${JSON.stringify(value)}.`,
    );
  }
  return parts.map(capitalize).join("");
}

function splitIdent(value: string): readonly string[] {
  return value
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

/**
 * Deterministically rebuild the sealed edge set from a study capture — the
 * same reconstruction the executor performs, exposed for review surfaces so
 * no adapter import is needed above the application layer.
 */
export function reconstructSensitivityEdgesFromStudyCapture(
  capture: SensitivityStudyResult,
): readonly SensitivityEdge[] {
  return sensitivityEdgesFromStudy(
    capture.studyCase,
    new Map(capture.measurements.base.map((item) => [item.metric, item])),
    new Map(capture.measurements.stepped.map((item) => [item.metric, item])),
    { runId: capture.trustedRunId, capturedAt: capture.capturedAt },
  );
}
