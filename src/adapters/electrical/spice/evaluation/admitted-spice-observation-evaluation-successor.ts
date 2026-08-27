/**
 * Deterministic Thread successor for one admitted SPICE L4 evaluation.
 * Documentary requirements are published from the method sheet because SysON
 * 0.5.1 cannot round-trip decimal thresholds.
 */

import type { ElectricalObservationMethodSheet } from "../../../../domain/electrical/observation-method-sheet.ts";
import { spiceObservableSlug } from "../../../../domain/electrical/spice/admitted/documentary-thread-evidence.ts";
import type { SpiceAdmittedObservationEvaluationResult } from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation.ts";
import { VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION } from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  resolveSpiceDocumentaryRequirement,
  spiceDocumentaryRequirementBindings,
} from "../../../../domain/electrical/spice/evaluation/spice-documentary-requirement-binding.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import { requirementEvaluationIdentity } from "../../../../domain/thread/requirement-evaluation-identity.ts";
import type { EngineeringAgentRun } from "../../../../domain/project/engineering-project.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import {
  archivedRefKeys,
  type RequirementEvaluation,
  type ThreadArtifact,
  type ThreadArtifactConsumption,
  type ThreadObservation,
  type ThreadProvenanceLink,
  type ThreadSnapshot,
  type ThreadViolation,
  type TracedRequirement,
} from "../../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import { requiredStart } from "../../../shared/executor-run-helpers.ts";
import { SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX } from "../../../shared/cas/file-capture-store.ts";
import type { AdmittedSpiceEvaluationLineage } from "../../../../domain/electrical/spice/evaluation/lineage.ts";
import type { SpiceAdmittedObservationEvaluationCapture } from "./admitted-spice-observation-evaluation-capture.ts";

export function spiceEvaluationCaptureArtifactId(digest: string): string {
  return `spice-admitted-observation-evaluation-${digest}`;
}

export function buildAdmittedSpiceObservationEvaluationSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly capture: SpiceAdmittedObservationEvaluationCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly sheet: ElectricalObservationMethodSheet;
  readonly methodSheetFingerprint: ContentFingerprint;
  readonly evaluation: SpiceAdmittedObservationEvaluationResult;
  readonly lineage: AdmittedSpiceEvaluationLineage;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId = spiceEvaluationCaptureArtifactId(
    input.captureFingerprint.digest,
  );
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.id}@${VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.version}`,
    runId: input.run.id,
  };
  const freshness = {
    status: "fresh" as const,
    changedAt: sealedAt,
    invalidatedByChangeIds: [] as const,
  };
  const sourceArtifacts = [
    input.lineage.methodSheet,
    input.lineage.spiceCapture,
    input.lineage.evidence,
    input.lineage.result,
  ];
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: "Admitted SPICE observation evaluation",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri:
      `${SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX}sha256/${input.captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: sourceArtifacts.map((item) => item.id),
    freshness,
  };
  const consumptions: ThreadArtifactConsumption[] = sourceArtifacts.map(
    (source) => ({
      id: `consume-${source.id}-by-${artifact.id}`,
      artifactId: source.id,
      consumer: operationRef,
      observedFingerprint: source.fingerprint,
      verifiedAt: sealedAt,
      status: "verified",
    }),
  );
  const publishedRequirements: TracedRequirement[] = [];
  const observations: ThreadObservation[] = [];
  const evaluations: RequirementEvaluation[] = [];
  const violations: ThreadViolation[] = [];
  const archivedRequirementIds = archivedSpiceDocumentaryRequirementIds(
    input.basisSnapshot,
  );
  const methodSheetFingerprint = input.methodSheetFingerprint;
  for (const criterion of input.sheet.criteria) {
    const evaluated = input.evaluation.evaluations.find((item) =>
      item.criterionId === criterion.id
    )!;
    const observationId = evaluated.actual
      ? `spice-derived-${spiceObservableSlug(criterion.id)}-${input.run.id}`
      : undefined;
    if (evaluated.actual && observationId) {
      observations.push({
        id: observationId,
        name: `Derived electrical observation ${criterion.id}`,
        metric: criterion.id,
        quantity: evaluated.actual,
        source: {
          operation: operationRef,
          artifactIds: [artifact.id, input.lineage.result.id],
          capturedAt: sealedAt,
        },
        freshness,
      });
    }
    const bindings = spiceDocumentaryRequirementBindings({
      criterion,
      methodSheetFingerprint,
    });
    for (const binding of bindings) {
      const proposed: TracedRequirement = {
        id: binding.requirementId,
        name: `Electrical observation ${binding.name}`,
        statement:
          `Reviewed brief gate ${criterion.briefItem.id} evaluated by the sealed electrical observation method sheet.`,
        version: methodSheetFingerprint.digest,
        criterion: {
          metric: binding.criterionId,
          operator: binding.operator,
          limit: binding.limit,
        },
        trace: {
          sourceArtifactId: input.lineage.methodSheet.id,
          elementId: criterion.briefItem.id,
          targetArtifactIds: [input.lineage.methodSheet.id],
        },
        freshness,
      };
      const resolved = resolveSpiceDocumentaryRequirement({
        basisRequirements: input.basisSnapshot.requirements,
        archivedRequirementIds,
        proposed,
      });
      if (!resolved.reused) publishedRequirements.push(resolved.requirement);
      const boundStatus = boundEvaluationStatus(evaluated, binding);
      const comparison = evaluated.actual && observationId &&
          (boundStatus === "pass" || boundStatus === "fail")
        ? {
          observationId,
          actual: evaluated.actual,
          operator: binding.operator,
          limit: binding.limit,
          normalizedUnit: binding.limit.unit,
        }
        : undefined;
      const evaluationId = requirementEvaluationIdentity({
        requirementId: resolved.requirement.id,
        evidenceFingerprint: input.captureFingerprint,
      }).id;
      evaluations.push({
        id: evaluationId,
        name: `Evaluate ${binding.name}`,
        requirementId: resolved.requirement.id,
        observationIds: observationId ? [observationId] : [],
        status: boundStatus,
        evaluatedAt: sealedAt,
        evaluator: operationRef,
        ...(comparison ? { comparison } : {}),
        evidenceArtifactIds: [artifact.id],
        message: evaluated.message,
        freshness,
      });
      if (boundStatus === "fail") {
        violations.push({
          id: `${evaluationId}-violation`,
          name: `${binding.name} violation`,
          requirementId: resolved.requirement.id,
          evaluationId,
          severity: "error",
          status: "open",
          detectedAt: sealedAt,
          observationIds: observationId ? [observationId] : [],
          evidenceArtifactIds: [artifact.id],
          summary: evaluated.message,
          freshness,
        });
      }
    }
  }
  const provenance: ThreadProvenanceLink[] = [
    ...sourceArtifacts.map((source) => ({
      id: `derived-from-${source.id}-by-${artifact.id}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: artifact.id },
      to: { kind: "artifact" as const, id: source.id },
      rationale:
        "The admitted SPICE observation evaluation reopened this exact fingerprint-attested source artifact.",
    })),
    ...consumptions.map((entry) => ({
      id: `uses-${entry.id}`,
      relation: "uses" as const,
      from: { kind: "consumption" as const, id: entry.id },
      to: { kind: "artifact" as const, id: entry.artifactId },
      rationale: "Exact bytes were reread and fingerprint-attested.",
    })),
    ...publishedRequirements.map((requirement) => ({
      id: `traces-${requirement.id}-to-${input.lineage.methodSheet.id}`,
      relation: "traces_to" as const,
      from: { kind: "requirement" as const, id: requirement.id },
      to: { kind: "artifact" as const, id: input.lineage.methodSheet.id },
      rationale:
        "The documentary electrical requirement is defined by the sealed observation method sheet.",
    })),
    ...observations.flatMap((observation) =>
      observation.source.artifactIds.map((sourceArtifactId) => ({
        id: `${observation.id}-from-${sourceArtifactId}`,
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: observation.id },
        to: { kind: "artifact" as const, id: sourceArtifactId },
        rationale:
          "The derived observation is computed by the closed electrical comparator from exact native L3 evidence.",
      }))
    ),
    ...evaluations.flatMap((item) => [
      {
        id: `evaluates-${item.id}`,
        relation: "evaluates" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "requirement" as const, id: item.requirementId },
        rationale:
          "The admitted SPICE observation evaluation evaluates the documentary method-sheet requirement.",
      },
      {
        id: `evidences-${item.id}`,
        relation: "evidences" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "artifact" as const, id: artifact.id },
        rationale: "The evaluation is evidenced by the reread closed-method capture.",
      },
      ...item.observationIds.map((observationId) => ({
        id: `${item.id}-uses-${observationId}`,
        relation: "uses" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "observation" as const, id: observationId },
        rationale: "The evaluation uses this exact derived quantity.",
      })),
    ]),
    ...violations.flatMap((item) => [
      {
        id: `caused-by-${item.id}`,
        relation: "caused_by" as const,
        from: { kind: "violation" as const, id: item.id },
        to: { kind: "evaluation" as const, id: item.evaluationId },
        rationale:
          "The named violation is caused by the failing admitted SPICE observation evaluation.",
      },
      ...item.evidenceArtifactIds.map((evidenceArtifactId) => ({
        id: `evidences-${item.id}-${evidenceArtifactId}`,
        relation: "evidences" as const,
        from: { kind: "violation" as const, id: item.id },
        to: { kind: "artifact" as const, id: evidenceArtifactId },
        rationale:
          "The named violation is evidenced by the exact closed-method capture.",
      })),
    ]),
  ];
  const proposedActions = violations.map((violation) => ({
    id: `${violation.id}-review`,
    name: `Review admitted SPICE observation evaluation violation: ${violation.name}`,
    kind: "review" as const,
    readiness: "ready" as const,
    rationale:
      "A human review is required for a failed electrical observation criterion.",
    targets: [{ kind: "artifact" as const, id: artifact.id }],
    addressesViolationIds: [violation.id],
    dependsOnActionIds: [] as const,
  }));
  for (const action of proposedActions) {
    for (const violationId of action.addressesViolationIds) {
      provenance.push({
        id: `addresses-${action.id}`,
        relation: "addresses",
        from: { kind: "action", id: action.id },
        to: { kind: "violation", id: violationId },
        rationale: "The proposed review addresses the named violation.",
      });
    }
  }
  const extension: ThreadSnapshotExtension = {
    id: `verify-evaluate-admitted-spice-observations-${input.run.id}`,
    name: "Evaluate admitted SPICE observations",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions,
    observations,
    requirements: publishedRequirements,
    evaluations,
    violations,
    provenance,
    proposedActions,
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: sealedAt },
  );
  if (!applied.applied) {
    throw new TypeError(
      "This exact admitted SPICE observation evaluation is already present in the basis snapshot.",
    );
  }
  return {
    snapshot: validateThreadSnapshot(applied.snapshot),
    artifact,
  };
}

function archivedSpiceDocumentaryRequirementIds(
  snapshot: ThreadSnapshot,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const key of archivedRefKeys(snapshot)) {
    if (key.startsWith("requirement:")) {
      ids.add(key.slice("requirement:".length));
    }
  }
  return ids;
}

function boundEvaluationStatus(
  evaluated: SpiceAdmittedObservationEvaluationResult["evaluations"][number],
  bound: {
    readonly operator: "<=" | ">=";
    readonly limit: { readonly value: number; readonly unit: string };
  },
): SpiceAdmittedObservationEvaluationResult["evaluations"][number]["status"] {
  if (evaluated.status === "unresolved" || evaluated.status === "error") {
    return evaluated.status;
  }
  if (!evaluated.actual) return evaluated.status;
  const pass = bound.operator === "<="
    ? evaluated.actual.value <= bound.limit.value
    : evaluated.actual.value >= bound.limit.value;
  return pass ? "pass" : "fail";
}
