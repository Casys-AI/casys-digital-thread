/**
 * Server-owned isolated CalculiX input identities.
 *
 * The registry binding is still named `geometry`, but the plan resolver
 * requires a STEP Thread artifact (`kind: step`, `model/step`). Binding the
 * sibling `cad-model` capture is the lookalike that fails after queue. These
 * helpers name that refusal before an agent copies a wrong id into a proposal.
 *
 * There is no `fea.run.*` grammar. Numbers stay in the sealed proof document.
 * The run admits thread-entity bindings only. Product run is isolated `@3`.
 */

import { fingerprintsEqual } from "../../kernel/deterministic-json.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
} from "../../project/engineering-project.ts";
import type { ThreadArtifact, ThreadSnapshot } from "../../thread/thread-snapshot.ts";
import type { FeaProofCaseCapture } from "../seal-case/fea-proof-case-capture.ts";
import { VERIFY_SEAL_PROOF_CASE_OPERATION } from "../seal-case/fea-proof-proposal.ts";

/**
 * Isolated CalculiX identity for the review surface. Historical MCP `@1`/`@2`
 * are not registered. This constant is only so the review cannot emit another
 * version.
 */
export const ISOLATED_CALCULIX_RUN_OPERATION = {
  id: "verify.run-fea-static-proof",
  version: "3",
} as const;

export const ISOLATED_CALCULIX_PROOF_KIND = "document" as const;
export const ISOLATED_CALCULIX_PROOF_MEDIA_TYPE = "application/json" as const;
export const ISOLATED_CALCULIX_GEOMETRY_KIND = "step" as const;
export const ISOLATED_CALCULIX_GEOMETRY_MEDIA_TYPE = "model/step" as const;

export type IsolatedCalculixBindingDiagnosticCode =
  | "basis-latest"
  | "basis-mismatch"
  | "basis-absent"
  | "basis-ambiguous"
  | "proof-not-document"
  | "proof-absent"
  | "proof-ambiguous"
  | "geometry-is-cad-model"
  | "geometry-not-step"
  | "step-absent"
  | "step-mismatch"
  | "project-state-unavailable"
  | "project-state-mismatch"
  | "basis-not-current"
  | "compiled-identities-conflict"
  | "queue-admission-rejected"
  | "activity-foreign"
  | "activity-leaf-ambiguous"
  | "activity-leaf-not-ready"
  | "activity-leaf-not-agent-owned"
  | "activity-leaf-has-evidence"
  | "activity-leaf-reconciled"
  | "activity-attempt-missing"
  | "activity-attempt-ambiguous"
  | "activity-run-not-failed"
  | "activity-run-uncertain"
  | "activity-failure-code-mismatch"
  | "activity-run-has-result"
  | "activity-operation-mismatch";

export interface IsolatedCalculixBindingDiagnostic {
  readonly code: IsolatedCalculixBindingDiagnosticCode;
  readonly artifactId: string | null;
  readonly artifactKind: string | null;
  readonly message: string;
}

export interface IsolatedCalculixResolvedBindings {
  readonly operation: EngineeringOperationRef;
  readonly proofArtifact: ThreadArtifact;
  readonly stepArtifact: ThreadArtifact;
  readonly bindings: readonly EngineeringOperationInputBinding[];
  readonly rejectedLookalikes: readonly IsolatedCalculixBindingDiagnostic[];
}

/**
 * Human-facing restatement of the compiled isolated-run bindings. This is not
 * a `fea.run.*` grammar: the executor admits the thread-entity bindings, not
 * these keys. They exist so `project_decision_propose` (min one parameter)
 * does not invent solver numbers.
 */
export function isolatedCalculixReviewProposal(
  proofArtifactId: string,
  stepArtifactId: string,
): {
  readonly summary: string;
  readonly parameters: readonly EngineeringDecisionProposalParameter[];
} {
  return {
    summary: `Queue verify.run-fea-static-proof@3 on sealed proof ${proofArtifactId} ` +
      `and canonical part STEP ${stepArtifactId}. Do not bind a cad-model.`,
    parameters: [
      {
        key: "review.proofArtifactId",
        label: "Sealed proof-case document (work-item binding proofCase)",
        value: proofArtifactId,
      },
      {
        key: "review.stepArtifactId",
        label: "Canonical part STEP for geometry binding (not cad-model)",
        value: stepArtifactId,
      },
    ],
  };
}

export function isolatedCalculixBindingRejectionMessage(input: {
  readonly proofKind: string;
  readonly proofMediaType: string | undefined;
  readonly geometryKind: string;
  readonly geometryMediaType: string | undefined;
}): string {
  const geometryHint = input.geometryKind === "cad-model"
    ? " Bound geometry is a cad-model capture; isolated CalculiX requires the canonical part STEP (kind: step, mediaType: model/step), not the assembly cad-model."
    : "";
  return (
    "Isolated CalculiX inputs must be an exact proof JSON document and STEP Thread artifact. " +
    `Bound proofCase is kind=${input.proofKind} mediaType=${
      input.proofMediaType ?? "absent"
    }; bound geometry is kind=${input.geometryKind} mediaType=${
      input.geometryMediaType ?? "absent"
    }.${geometryHint}`
  );
}

export function diagnoseIsolatedCalculixProofArtifact(
  artifact: Pick<ThreadArtifact, "id" | "kind" | "mediaType">,
): IsolatedCalculixBindingDiagnostic | undefined {
  if (
    artifact.kind === ISOLATED_CALCULIX_PROOF_KIND &&
    artifact.mediaType === ISOLATED_CALCULIX_PROOF_MEDIA_TYPE
  ) {
    return undefined;
  }
  return {
    code: "proof-not-document",
    artifactId: artifact.id,
    artifactKind: artifact.kind,
    message: `proofCase binding "${artifact.id}" is kind=${artifact.kind} ` +
      `mediaType=${artifact.mediaType ?? "absent"}; isolated CalculiX requires ` +
      `a JSON document (kind: document, mediaType: application/json).`,
  };
}

export function diagnoseIsolatedCalculixGeometryArtifact(
  artifact: Pick<ThreadArtifact, "id" | "kind" | "mediaType">,
): IsolatedCalculixBindingDiagnostic | undefined {
  if (
    artifact.kind === ISOLATED_CALCULIX_GEOMETRY_KIND &&
    artifact.mediaType === ISOLATED_CALCULIX_GEOMETRY_MEDIA_TYPE
  ) {
    return undefined;
  }
  if (artifact.kind === "cad-model") {
    return {
      code: "geometry-is-cad-model",
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      message: `geometry binding "${artifact.id}" is a cad-model capture. ` +
        "Isolated CalculiX binds the canonical part STEP (kind: step), never the assembly cad-model.",
    };
  }
  return {
    code: "geometry-not-step",
    artifactId: artifact.id,
    artifactKind: artifact.kind,
    message: `geometry binding "${artifact.id}" is kind=${artifact.kind} ` +
      `mediaType=${artifact.mediaType ?? "absent"}; isolated CalculiX requires ` +
      `kind: step and mediaType: model/step.`,
  };
}

export function selectSealedFeaProofArtifact(
  snapshot: ThreadSnapshot,
  artifactId?: string,
):
  | { readonly status: "ok"; readonly artifact: ThreadArtifact }
  | {
    readonly status: "unresolved";
    readonly diagnostics: readonly IsolatedCalculixBindingDiagnostic[];
  } {
  if (artifactId) {
    const matches = snapshot.artifacts.filter((artifact) =>
      artifact.id === artifactId && artifact.freshness.status === "fresh"
    );
    if (matches.length !== 1) {
      return {
        status: "unresolved",
        diagnostics: [{
          code: "proof-absent",
          artifactId,
          artifactKind: null,
          message:
            `Sealed FEA proof artifact "${artifactId}" is absent or stale on the named basis.`,
        }],
      };
    }
    return { status: "ok", artifact: matches[0]! };
  }
  const seals = snapshot.artifacts.filter((artifact) =>
    artifact.kind === ISOLATED_CALCULIX_PROOF_KIND &&
    artifact.freshness.status === "fresh" &&
    // The same seal may also publish a sensitivity-catalog-offer document.
    artifact.id.startsWith("fea-proof-") &&
    artifact.producer.tool ===
      `${VERIFY_SEAL_PROOF_CASE_OPERATION.id}@${VERIFY_SEAL_PROOF_CASE_OPERATION.version}`
  );
  if (seals.length === 1) return { status: "ok", artifact: seals[0]! };
  if (seals.length === 0) {
    return {
      status: "unresolved",
      diagnostics: [{
        code: "proof-absent",
        artifactId: null,
        artifactKind: null,
        message:
          "The named basis has no fresh sealed verify.seal-proof-case@1 document. Name proofArtifactId after the seal, or seal first.",
      }],
    };
  }
  return {
    status: "unresolved",
    diagnostics: [{
      code: "proof-ambiguous",
      artifactId: null,
      artifactKind: "document",
      message:
        `The named basis has ${seals.length} sealed proof documents. Name the exact proofArtifactId.`,
    }],
  };
}

/**
 * Choose the exact STEP named by a sealed proof capture. Cad-model siblings
 * are listed as rejected lookalikes; they are never emitted as the geometry
 * binding.
 */
export function resolveIsolatedCalculixRunBindings(
  snapshot: ThreadSnapshot,
  proofArtifact: ThreadArtifact,
  capture: FeaProofCaseCapture,
):
  | { readonly status: "resolved"; readonly resolved: IsolatedCalculixResolvedBindings }
  | {
    readonly status: "unresolved";
    readonly diagnostics: readonly IsolatedCalculixBindingDiagnostic[];
  } {
  const diagnostics: IsolatedCalculixBindingDiagnostic[] = [];
  const proofDiag = diagnoseIsolatedCalculixProofArtifact(proofArtifact);
  if (proofDiag) diagnostics.push(proofDiag);

  const step = snapshot.artifacts.find((artifact) =>
    artifact.id === capture.stepArtifact.id
  );
  if (!step) {
    diagnostics.push({
      code: "step-absent",
      artifactId: capture.stepArtifact.id,
      artifactKind: null,
      message:
        `Sealed proof names STEP "${capture.stepArtifact.id}", which is absent from the named Thread basis.`,
    });
  } else {
    const geometryDiag = diagnoseIsolatedCalculixGeometryArtifact(step);
    if (geometryDiag) diagnostics.push(geometryDiag);
    if (
      !fingerprintsEqual(step.fingerprint, capture.stepArtifact.fingerprint) ||
      step.producer.runId !== capture.stepArtifact.producerRunId ||
      capture.proofCase.expectedCadArtifact.sha256 !== step.fingerprint.digest ||
      capture.proofCase.expectedCadArtifact.bytes !== capture.stepArtifact.bytes
    ) {
      diagnostics.push({
        code: "step-mismatch",
        artifactId: step.id,
        artifactKind: step.kind,
        message:
          "The Thread STEP identity does not match the sealed proof capture step artifact.",
      });
    }
  }

  if (diagnostics.length > 0 || !step) {
    return { status: "unresolved", diagnostics };
  }

  const rejectedLookalikes = rejectCadModelGeometryLookalikes(snapshot, step);

  const bindings: readonly EngineeringOperationInputBinding[] = [
    threadEntityBinding("proofCase", snapshot, proofArtifact.id),
    threadEntityBinding("geometry", snapshot, step.id),
  ];

  return {
    status: "resolved",
    resolved: {
      operation: {
        id: ISOLATED_CALCULIX_RUN_OPERATION.id,
        version: ISOLATED_CALCULIX_RUN_OPERATION.version,
        bindings,
      },
      proofArtifact,
      stepArtifact: step,
      bindings,
      rejectedLookalikes,
    },
  };
}

/** One diagnostic for every cad-model sibling, not one copy per artifact. */
export function rejectCadModelGeometryLookalikes(
  snapshot: ThreadSnapshot,
  step: Pick<ThreadArtifact, "id">,
): readonly IsolatedCalculixBindingDiagnostic[] {
  const cadModels = snapshot.artifacts.filter((artifact) =>
    artifact.id !== step.id && artifact.kind === "cad-model"
  );
  if (cadModels.length === 0) return [];
  const primary = cadModels.find((artifact) =>
    artifact.id.startsWith("geometry-") ||
    artifact.uri?.startsWith("casys://geometry-capture/")
  ) ?? cadModels[0]!;
  const others = cadModels.filter((artifact) => artifact.id !== primary.id);
  const also = others.length === 0
    ? ""
    : ` Also cad-model: ${others.map((item) => item.id).join(", ")}.`;
  return [{
    code: "geometry-is-cad-model",
    artifactId: primary.id,
    artifactKind: "cad-model",
    message:
      `Isolated CalculiX geometry must be the canonical part STEP, never a cad-model. ` +
      `Primary lookalike "${primary.id}" is a cad-model capture.${also}`,
  }];
}

function threadEntityBinding(
  name: string,
  snapshot: ThreadSnapshot,
  artifactId: string,
): EngineeringOperationInputBinding {
  return {
    name,
    source: {
      kind: "thread-entity",
      reference: {
        snapshotId: snapshot.id,
        snapshotRevision: snapshot.revision,
        kind: "artifact",
        id: artifactId,
      },
    },
  };
}
