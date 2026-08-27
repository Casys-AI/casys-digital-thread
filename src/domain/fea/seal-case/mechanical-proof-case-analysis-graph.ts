/**
 * Declarative graph projection for one sealed CalculiX mechanical proof case.
 *
 * A proof-case capture contains an approved FEA declaration, not native .inp
 * source and not a CalculiX result.  This module therefore makes only the
 * explicit case structure visible: target-to-input incidences and target-to-
 * declared requirement metrics.  It does not assert parameter influence,
 * runtime consumption, or any observed response.
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
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "./mechanical-proof-case.ts";

/** Exact FEA proof-case artifact retained in the ThreadSnapshot. */
export interface MechanicalProofCaseAnalysisGraphEvidenceArtifact {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

export interface MechanicalProofCaseAnalysisGraphInput {
  /** The reviewed mechanical declaration whose exact seal is retained. */
  readonly proofCase: MechanicalProofCase;
  /** Stable digest of the canonical reviewed proof declaration. */
  readonly proofFingerprint: ContentFingerprint;
  /** The single retained proof-case artifact that evidences every assertion. */
  readonly evidence: MechanicalProofCaseAnalysisGraphEvidenceArtifact;
}

/**
 * Promote the exact target, material, mesh, force-load and requirement
 * declarations in a proof case. Supports are retained as declared condition
 * symbols, never as parameters or influential inputs.
 */
export function buildMechanicalProofCaseAnalysisGraph(
  input: MechanicalProofCaseAnalysisGraphInput,
): AnalysisGraph {
  const proofCase = validateMechanicalProofCase(input.proofCase);
  const evidence = validateEvidence(input.evidence);
  const proofFingerprint = validateFingerprint(
    input.proofFingerprint,
    "$input.proofFingerprint",
  );
  const target = targetRef(proofCase);
  const targetNodeId =
    `analysis-node:sysml:component:${proofCase.target.modelElementId}`;
  const nodes: AnalysisGraphNode[] = [{
    id: targetNodeId,
    kind: "component",
    semanticRef: target,
  }];

  const structuralParameters = [
    {
      id: "material-young-modulus",
      rationale:
        "The sealed proof case declares the target material Young modulus; no solver influence is asserted.",
    },
    {
      id: "material-poisson-ratio",
      rationale:
        "The sealed proof case declares the target material Poisson ratio; no solver influence is asserted.",
    },
    {
      id: "mesh-target-size",
      rationale:
        "The sealed proof case declares the target mesh size; no mesh-convergence or response claim is asserted.",
    },
    ...proofCase.analysis.loads.flatMap((load) => [
      {
        id: `force:${load.id}:x`,
        rationale:
          `The sealed proof case declares the x force component of load ${load.id}; no response influence is asserted.`,
      },
      {
        id: `force:${load.id}:y`,
        rationale:
          `The sealed proof case declares the y force component of load ${load.id}; no response influence is asserted.`,
      },
      {
        id: `force:${load.id}:z`,
        rationale:
          `The sealed proof case declares the z force component of load ${load.id}; no response influence is asserted.`,
      },
    ]),
  ];

  const relations = [
    ...structuralParameters.map((parameter, index) => {
      const parameterRef: SemanticRef = {
        domain: "calculix",
        kind: "parameter",
        id: parameter.id,
        basisFingerprint: proofFingerprint,
      };
      const nodeId =
        `analysis-node:calculix:parameter:${proofFingerprint.digest}:${index}`;
      nodes.push({ id: nodeId, kind: "parameter", semanticRef: parameterRef });
      return declaredRelation({
        id: `proof-case-structural-incidence:${evidence.fingerprint.digest}:${index}`,
        relation: "structural-incidence",
        from: target,
        to: parameterRef,
        fromNodeId: targetNodeId,
        toNodeId: nodeId,
        evidence,
        scopeFingerprint: proofFingerprint,
        rationale: parameter.rationale,
      });
    }),
    ...proofCase.analysis.supports.map((support, index) => {
      const supportRef: SemanticRef = {
        domain: "thread",
        kind: "fixed-support",
        id: `${proofCase.id}:fixed-support:${support.id}`,
        basisFingerprint: proofFingerprint,
      };
      const nodeId =
        `analysis-node:thread:fixed-support:${proofFingerprint.digest}:${index}`;
      nodes.push({ id: nodeId, kind: "fixed-support", semanticRef: supportRef });
      return declaredRelation({
        id: `proof-case-fixed-support:${evidence.fingerprint.digest}:${index}`,
        relation: "structural-incidence",
        from: target,
        to: supportRef,
        fromNodeId: targetNodeId,
        toNodeId: nodeId,
        evidence,
        scopeFingerprint: proofFingerprint,
        rationale:
          `The sealed proof case declares fixed support ${support.id} as a boundary condition; it is not a parameter or response influence claim.`,
      });
    }),
    ...proofCase.requirements.flatMap((requirement, index) => {
      const requirementRef: SemanticRef = {
        domain: "thread",
        kind: "proof-requirement",
        id: `${proofCase.id}:${requirement.id}`,
        basisFingerprint: proofFingerprint,
      };
      const requirementNodeId =
        `analysis-node:thread:proof-requirement:${proofFingerprint.digest}:${index}`;
      const metricRef: SemanticRef = {
        domain: "calculix",
        kind: "metric",
        id: requirement.metric,
        basisFingerprint: proofFingerprint,
      };
      const metricNodeId =
        `analysis-node:calculix:metric:${proofFingerprint.digest}:${index}`;
      nodes.push({
        id: requirementNodeId,
        kind: "proof-requirement",
        semanticRef: requirementRef,
      });
      nodes.push({ id: metricNodeId, kind: "metric", semanticRef: metricRef });
      return [
        declaredRelation({
          id: `proof-case-declared-requirement:${evidence.fingerprint.digest}:${index}`,
          relation: "declared-dependency",
          from: target,
          to: requirementRef,
          fromNodeId: targetNodeId,
          toNodeId: requirementNodeId,
          evidence,
          scopeFingerprint: proofFingerprint,
          rationale:
            `The sealed proof case declares requirement ${requirement.id}; it is not an observed result or verdict.`,
        }),
        declaredRelation({
          id: `proof-case-requirement-metric:${evidence.fingerprint.digest}:${index}`,
          relation: "structural-incidence",
          from: requirementRef,
          to: metricRef,
          fromNodeId: requirementNodeId,
          toNodeId: metricNodeId,
          evidence,
          scopeFingerprint: proofFingerprint,
          rationale:
            `The sealed proof case declares requirement ${requirement.id} over metric ${requirement.metric}; it does not state an observed metric value.`,
        }),
      ];
    }),
  ];

  return validateAnalysisGraph({
    schemaVersion: "analysis-graph/1.0",
    nodes,
    relations,
  });
}

function targetRef(
  proofCase: MechanicalProofCase,
): SemanticRef {
  return {
    // The sealed case names a SysML model-element identity.  It does not make
    // that element a provider-owned CalculiX component. Retain its actual
    // representation domain and stable model identity; the proof declaration
    // digest scopes only the declarations made about that component.
    domain: "sysml",
    kind: "component",
    id: proofCase.target.modelElementId,
  };
}

function declaredRelation(input: {
  id: string;
  relation: "structural-incidence" | "declared-dependency";
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
      relation: input.relation,
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
