/**
 * Provider-neutral materialization of measured local sensitivity assertions.
 *
 * This module intentionally starts from the already captured finite-difference
 * facts. It does not claim a sealed CAD-script dependency: the historical
 * sensitivity-study capture proves two solved observations and their STEP handoffs,
 * but not a source-level CAD parameter occurrence.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type AnalysisGraph,
  type AnalysisGraphNode,
  validateAnalysisGraph,
} from "../../thread/analysis-graph.ts";
import type {
  SensitivityFiniteDifferenceCase,
  SensitivityMetricMeasurement,
} from "../study/sensitivity-study.ts";
import { computeSensitivities } from "../study/sensitivity-study.ts";

export interface SensitivityAnalysisGraphEvidence {
  /**
   * The exact sensitivity-study capture which records both measurements, their
   * solved STEP handoffs, and the finite difference. This is deliberately the
   * sole EngineeringEvidence: provider responses were normalized into this
   * persisted capture, not persisted as independent solver-result bytes.
   */
  readonly capture: SensitivityAnalysisGraphEvidenceArtifact;
}

export interface SensitivityAnalysisGraphEvidenceArtifact {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

/**
 * Case fields the graph actually reads. The V3 source identity never enters
 * assertion identity.
 */
export interface SensitivityAnalysisGraphCase extends SensitivityFiniteDifferenceCase {
  readonly id: string;
  readonly target: {
    readonly componentKey: string;
    readonly semanticKey: string;
  };
}

export interface SensitivityAnalysisGraphInput {
  /**
   * Exact reviewed case declaration. Node identities and local scope depend on
   * this seal, never on the run-scoped capture occurrence.
   */
  readonly caseFingerprint: ContentFingerprint;
  readonly sensitivityCase: SensitivityAnalysisGraphCase;
  readonly baseMetrics: ReadonlyMap<string, SensitivityMetricMeasurement>;
  readonly steppedMetrics: ReadonlyMap<string, SensitivityMetricMeasurement>;
  readonly evidence: SensitivityAnalysisGraphEvidence;
}

/**
 * Build one observed `measured-local-sensitivity` assertion per declared
 * response metric. `computeSensitivities` is deliberately re-run here: an
 * AnalysisGraph is only valid when its values, units and finite-difference
 * quotient all agree with the reviewed case and the two captured measurements.
 */
export function buildSensitivityAnalysisGraph(
  input: SensitivityAnalysisGraphInput,
): AnalysisGraph {
  const derivatives = computeSensitivities(
    input.sensitivityCase,
    input.baseMetrics,
    input.steppedMetrics,
  );
  const captureFingerprint = input.evidence.capture.fingerprint;
  const caseFingerprint = input.caseFingerprint;
  const parameterAtBase = input.sensitivityCase.baseValue.value;
  const parameterAtPerturbed = parameterAtBase + input.sensitivityCase.step.value;
  const parameter = {
    domain: "thread" as const,
    kind: "parameter" as const,
    id:
      `sensitivity-parameter:${input.sensitivityCase.id}:${input.sensitivityCase.target.componentKey}:${input.sensitivityCase.target.semanticKey}`,
    basisFingerprint: caseFingerprint,
  };
  const parameterNodeId = `analysis-node:${parameter.id}:${caseFingerprint.digest}`;
  const nodes: AnalysisGraphNode[] = [{
    id: parameterNodeId,
    kind: "parameter" as const,
    semanticRef: parameter,
  }];

  const relations = [
    ...derivatives.derivatives.map((derivative) => {
      const base = input.baseMetrics.get(derivative.metric);
      const stepped = input.steppedMetrics.get(derivative.metric);
      if (!base || !stepped) {
        // computeSensitivities already checks this, but retain the guard so this
        // proof builder has no implicit map access contract.
        throw new TypeError(
          `Sensitivity graph cannot find both captured measurements for ${derivative.metric}.`,
        );
      }
      const response = {
        domain: "calculix" as const,
        kind: "metric" as const,
        id: `sensitivity-response:${input.sensitivityCase.id}:${derivative.metric}`,
        basisFingerprint: caseFingerprint,
      };
      const responseNodeId = `analysis-node:${response.id}:${caseFingerprint.digest}`;
      nodes.push({
        id: responseNodeId,
        kind: "metric" as const,
        semanticRef: response,
      });
      return {
        assertion: {
          schemaVersion: "engineering-assertion/1.0" as const,
          id:
            `measured-local-sensitivity:${captureFingerprint.digest}:${derivative.metric}`,
          relation: "measured-local-sensitivity" as const,
          from: parameter,
          to: response,
          epistemicBasis: "observed" as const,
          assertedBy: {
            kind: "server" as const,
            id: "digital-thread",
            version: "1",
          },
          evidence: [
            input.evidence.capture,
          ],
          scope: {
            kind: "local-neighborhood" as const,
            parameter,
            basisFingerprint: caseFingerprint,
            lower: {
              value: Math.min(parameterAtBase, parameterAtPerturbed),
              unit: input.sensitivityCase.baseValue.unit,
            },
            upper: {
              value: Math.max(parameterAtBase, parameterAtPerturbed),
              unit: input.sensitivityCase.baseValue.unit,
            },
          },
          measurement: {
            method: "forward-finite-difference" as const,
            basePoint: input.sensitivityCase.baseValue,
            perturbationStep: input.sensitivityCase.step,
            responseAtBase: base,
            responseAtPerturbed: stepped,
            derivative: { value: derivative.value, unit: derivative.unit },
          },
          rationale:
            `The reviewed finite-difference case ${input.sensitivityCase.id} measured ${derivative.metric} at the base and one declared perturbation step.`,
        },
        fromNodeId: parameterNodeId,
        toNodeId: responseNodeId,
      };
    }),
  ];

  return validateAnalysisGraph({
    schemaVersion: "analysis-graph/1.0",
    nodes,
    relations,
  });
}
