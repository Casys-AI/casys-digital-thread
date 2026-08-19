/**
 * Declarative graph projection for one sealed Modelica simulation case.
 *
 * The simulation-case artifact is the only available source here.  A case
 * records an approved kit identity, overrides and expected metrics, but does
 * not contain native Modelica text or an AST.  Consequently this projection
 * records only the case-to-declaration incidences; it never invents a model
 * component, a data-flow edge, or a parameter-to-metric influence.
 */

import { exactRecord, literalValue, safeId } from "../../kernel/case-validation.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type AnalysisGraph,
  type AnalysisGraphNode,
  validateAnalysisGraph,
} from "../../thread/analysis-graph.ts";
import type {
  EngineeringEvidence,
  SemanticRef,
} from "../../thread/engineering-assertion.ts";
import { type SimulationCase, validateSimulationCase } from "./simulation-case.ts";
import {
  type SimulationCaseV2,
  validateSimulationCaseV2,
} from "./simulation-case-v2.ts";

type SimulationCaseForGraph = SimulationCase | SimulationCaseV2;

/** Exact simulation-case artifact retained in the ThreadSnapshot. */
export interface SimulationCaseAnalysisGraphEvidenceArtifact {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

export interface SimulationCaseAnalysisGraphInput {
  /** The reviewed declaration whose exact seal is retained as evidence. */
  readonly simulationCase: SimulationCaseForGraph;
  /** Stable digest of the canonical reviewed case declaration. */
  readonly caseFingerprint: ContentFingerprint;
  /** The single retained case artifact that evidences every declaration. */
  readonly evidence: SimulationCaseAnalysisGraphEvidenceArtifact;
}

/**
 * Promote only the declarative surface of a sealed simulation case.
 *
 * Every edge is a declared structural incidence from the case to either an
 * explicit override or an expected metric.  In particular, expected metrics
 * are not observations and no relation says that an override influences one.
 */
export function buildSimulationCaseAnalysisGraph(
  input: SimulationCaseAnalysisGraphInput,
): AnalysisGraph {
  const simulationCase = input.simulationCase.schemaVersion === "simulation-case/2.0"
    ? validateSimulationCaseV2(input.simulationCase)
    : validateSimulationCase(input.simulationCase);
  const evidence = validateEvidence(input.evidence);
  const caseFingerprint = validateFingerprint(
    input.caseFingerprint,
    "$input.caseFingerprint",
  );
  const caseRef = simulationCaseRef(simulationCase, caseFingerprint);
  const caseNodeId = `analysis-node:modelica:simulation-case:${caseFingerprint.digest}`;
  const nodes: AnalysisGraphNode[] = [{
    id: caseNodeId,
    kind: "simulation-case",
    semanticRef: caseRef,
  }];

  const relations = [
    ...simulationCase.parameters.map((parameter, index) => {
      const parameterRef: SemanticRef = {
        domain: "modelica",
        kind: "parameter",
        id: parameter.id,
        basisFingerprint: caseFingerprint,
      };
      const nodeId =
        `analysis-node:modelica:parameter:${caseFingerprint.digest}:${index}`;
      nodes.push({ id: nodeId, kind: "parameter", semanticRef: parameterRef });
      return declaredIncidence({
        id: `simulation-case-parameter:${evidence.fingerprint.digest}:${index}`,
        from: caseRef,
        to: parameterRef,
        fromNodeId: caseNodeId,
        toNodeId: nodeId,
        evidence,
        scopeFingerprint: caseFingerprint,
        rationale:
          `The sealed simulation case declares override ${parameter.id}; no native Modelica source or influence relation is asserted.`,
      });
    }),
    ...simulationCase.expectedMetrics.map((metric, index) => {
      const metricRef: SemanticRef = {
        domain: "modelica",
        kind: "metric",
        id: metric.id,
        basisFingerprint: caseFingerprint,
      };
      const nodeId = `analysis-node:modelica:metric:${caseFingerprint.digest}:${index}`;
      nodes.push({ id: nodeId, kind: "metric", semanticRef: metricRef });
      return declaredIncidence({
        id: `simulation-case-expected-metric:${evidence.fingerprint.digest}:${index}`,
        from: caseRef,
        to: metricRef,
        fromNodeId: caseNodeId,
        toNodeId: nodeId,
        evidence,
        scopeFingerprint: caseFingerprint,
        rationale:
          `The sealed simulation case declares expected metric ${metric.id}; it is not an observed simulation result.`,
      });
    }),
  ];

  return validateAnalysisGraph({
    schemaVersion: "analysis-graph/1.0",
    nodes,
    relations,
  });
}

function simulationCaseRef(
  simulationCase: SimulationCaseForGraph,
  basisFingerprint: ContentFingerprint,
): SemanticRef {
  return {
    domain: "modelica",
    kind: "simulation-case",
    // The reviewed declaration is the source of the kit/model identity. Its
    // stable digest scopes this compact case identifier; capture fingerprints
    // remain occurrence evidence and never create pretend Modelica identities.
    id: simulationCase.id,
    basisFingerprint,
  };
}

function declaredIncidence(input: {
  id: string;
  from: SemanticRef;
  to: SemanticRef;
  fromNodeId: string;
  toNodeId: string;
  evidence: EngineeringEvidence;
  scopeFingerprint: ContentFingerprint;
  rationale: string;
}) {
  return {
    assertion: {
      schemaVersion: "engineering-assertion/1.0" as const,
      id: input.id,
      relation: "structural-incidence" as const,
      from: input.from,
      to: input.to,
      epistemicBasis: "declared" as const,
      assertedBy: { kind: "server" as const, id: "digital-thread", version: "1" },
      evidence: [input.evidence],
      scope: { kind: "basis" as const, basisFingerprint: input.scopeFingerprint },
      rationale: input.rationale,
    },
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
  };
}

function validateEvidence(value: unknown): EngineeringEvidence {
  const input = exactRecord(value, ["id", "fingerprint"], "$input.evidence");
  const fingerprint = exactRecord(
    input.fingerprint,
    ["algorithm", "digest"],
    "$input.evidence.fingerprint",
  );
  literalValue(
    fingerprint.algorithm,
    "sha256",
    "$input.evidence.fingerprint.algorithm",
  );
  if (
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(
      "$input.evidence.fingerprint.digest must be a lowercase SHA-256 hex digest.",
    );
  }
  return {
    id: safeId(input.id, "$input.evidence.id"),
    fingerprint: { algorithm: "sha256", digest: fingerprint.digest },
  };
}

function validateFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  if (typeof input.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return { algorithm: "sha256", digest: input.digest };
}
