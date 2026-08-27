/**
 * Exact server-side L4 input recross.
 *
 * The L4 evaluator consumes neither a CAD provider nor caller-selected facts.
 * It follows the current L4 work item's required L3 leaf, proves that leaf's
 * completed evidence remains fresh on the exact queued head, reopens the
 * original module/STEP bundle and parses the normalized observation against
 * those bytes before applying the fixed method.
 */

import type {
  AssemblyIntegrityEvaluationArtifactInput,
  EvaluateAssemblyIntegrityDiagnostic,
} from "../../../ports/in/cad/assembly-integrity/evaluate-assembly-integrity.ts";
import type { AssemblyIntegrityInputResolver } from "../../../ports/out/cad/assembly-integrity/exact-assembly-integrity-input-resolver.ts";
import type { AssemblyIntegrityObservationCaptureStore } from "../../../ports/out/cad/assembly-integrity/assembly-integrity-observation-capture-store.ts";
import {
  type AssemblyIntegrityEvaluation,
  type AssemblyIntegrityEvaluationMethod,
  assemblyIntegrityEvaluationMethod,
  evaluateAssemblyIntegrity,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import {
  evaluateAssemblyIntegrityWorkItemOperation,
  VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import {
  assemblyIntegrityEvaluationGateClaimIssue,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-gate-policy.ts";
import {
  type AssemblyIntegrityObservationCapture,
  assemblyIntegrityObservationCaptureUri,
  fingerprintAssemblyIntegrityObservationCapture,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-observation-capture.ts";
import {
  parseAssemblyIntegrityObservation,
  VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
  EngineeringWorkItem,
} from "../../../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../../../domain/project/engineering-project-validation.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import {
  resolveExactCompletedDependencyArtifact,
} from "../../project/resolve-exact-completed-dependency-artifact.ts";

export interface AssemblyIntegrityEvaluationRecrossSnapshotStore
  extends Pick<ThreadSnapshotStore, "get"> {
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface AssemblyIntegrityEvaluationRecrossDependencies {
  readonly snapshots: AssemblyIntegrityEvaluationRecrossSnapshotStore;
  readonly observations: AssemblyIntegrityObservationCaptureStore;
  readonly inputs: AssemblyIntegrityInputResolver;
}

export interface AssemblyIntegrityEvaluationRecrossContext {
  readonly project: EngineeringProjectSnapshot;
  readonly head: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly currentWork: EngineeringWorkItem;
  /** Present only when recrossing a registered trusted run. */
  readonly trustedRunId?: string;
}

export type AssemblyIntegrityEvaluationRecrossResult =
  | {
    readonly status: "resolved";
    readonly observationCapture: AssemblyIntegrityObservationCapture;
    readonly evaluation: AssemblyIntegrityEvaluation;
    readonly method: AssemblyIntegrityEvaluationMethod;
    /** Exact ordered module, STEP and L3 capture identities retained by L4. */
    readonly artifactInputs: readonly AssemblyIntegrityEvaluationArtifactInput[];
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostics: readonly EvaluateAssemblyIntegrityDiagnostic[];
  };

/**
 * Recross one already-selected L4 work revision.  It intentionally does not
 * create a Thread snapshot or alter a gate claim; review and executor reuse
 * it with their independently authoritative current-work selection.
 */
export async function recrossAssemblyIntegrityEvaluation(
  dependencies: AssemblyIntegrityEvaluationRecrossDependencies,
  context: AssemblyIntegrityEvaluationRecrossContext,
): Promise<AssemblyIntegrityEvaluationRecrossResult> {
  let project: EngineeringProjectSnapshot;
  let head: ThreadSnapshot;
  try {
    project = validateEngineeringProjectSnapshot(context.project);
    head = validateThreadSnapshot(context.head);
  } catch {
    return unresolved(
      "project-or-thread-invalid",
      "The current engineering project or Thread head failed closed validation.",
    );
  }
  if (
    project.project.id !== context.project.project.id ||
    !sameBasis(head, context.basis) ||
    project.project.subjectId !== context.basis.subjectId
  ) {
    return unresolved(
      "basis-mismatch",
      "The selected L4 basis is not the exact current project Thread head.",
    );
  }

  const currentWork = project.workItems.filter((item) =>
    item.id === context.currentWork.id
  );
  if (currentWork.length !== 1) {
    return unavailable(
      "l4-work-unavailable",
      "The current L4 work revision is not uniquely present in the project.",
    );
  }
  const work = currentWork[0]!;
  const workIssue = validateL4Work(project, work);
  if (workIssue) return unresolved("l4-work-mismatch", workIssue);

  const selected = await resolveExactCompletedDependencyArtifact({
    project,
    trustedRunId: context.trustedRunId,
    currentWork: work,
    head,
    basis: context.basis,
    currentOperation: {
      id: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id,
      version: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version,
      requiresDependsOnOperation: {
        id: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id,
        version: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version,
      },
    },
    expectedDependencyOperation: {
      id: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id,
      version: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version,
    },
    expectedArtifactKind: "evidence",
    expectedProducer: {
      serverId: "digital-thread",
      tool:
        `${VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id}@${VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version}`,
    },
    snapshots: dependencies.snapshots,
  });
  if (selected.status !== "resolved") {
    return selected.status === "unavailable"
      ? unavailable("l3-observation-unavailable", selected.reason)
      : unresolved("l3-observation-mismatch", selected.reason);
  }

  let observationCapture: AssemblyIntegrityObservationCapture | undefined;
  try {
    observationCapture = await dependencies.observations.read(
      selected.artifact.fingerprint,
    );
  } catch {
    return unavailable(
      "l3-capture-unavailable",
      "The exact persisted L3 observation capture could not be reopened.",
    );
  }
  if (!observationCapture) {
    return unavailable(
      "l3-capture-unavailable",
      "The exact persisted L3 observation capture is unavailable.",
    );
  }
  const captureIssue = await recrossExactL3ObservationCaptureBinding({
    capture: observationCapture,
    artifact: selected.artifact,
    producerRun: selected.producerRun,
    resultSnapshot: selected.resultSnapshot,
    dependencyWork: selected.dependencyWork,
  });
  if (captureIssue) return unresolved("l3-capture-mismatch", captureIssue);

  let source: ThreadSnapshot | undefined;
  try {
    source = await readExactSnapshot(
      dependencies.snapshots,
      observationCapture.basis,
    );
  } catch {
    return unavailable(
      "source-basis-unavailable",
      "The exact source Thread basis named by the L3 capture is unavailable.",
    );
  }
  if (!source) {
    return unavailable(
      "source-basis-unavailable",
      "The exact source Thread basis named by the L3 capture is unavailable.",
    );
  }

  let resolved;
  try {
    resolved = await reopenExactL3AssemblyIntegrityInput(
      dependencies.inputs,
      observationCapture,
      source,
    );
  } catch {
    return unavailable(
      "exact-input-unavailable",
      "The exact L3 geometry module, STEP, profile, and packed input bundle could not be reopened.",
    );
  }

  const inputIssue = await validateExactInputBinding({
    source,
    head,
    l3Artifact: selected.artifact,
    capture: observationCapture,
    resolved,
  });
  if (inputIssue) return unresolved("exact-input-mismatch", inputIssue);

  let observation;
  try {
    // This is the mandatory full-byte recross. `validate...` alone is not
    // enough: it would accept a normalized observation from another bundle
    // with the same cardinality.
    observation = parseAssemblyIntegrityObservation(
      observationCapture.observation,
      resolved.inputBundle,
    );
  } catch {
    return unresolved(
      "observation-bundle-mismatch",
      "The persisted L3 normalized observation does not recross the exact reopened input bundle.",
    );
  }
  const observationFingerprint = await sha256Fingerprint(observation);
  if (
    !fingerprintsEqual(
      observationFingerprint,
      observationCapture.observationFingerprint,
    )
  ) {
    return unresolved(
      "observation-fingerprint-mismatch",
      "The L3 normalized observation no longer matches its stored observation fingerprint.",
    );
  }

  const evaluation = await evaluateAssemblyIntegrity({
    observation,
    expectedOccurrenceCount: resolved.inputBundle.manifest.occurrences.length,
  });
  const method = await assemblyIntegrityEvaluationMethod();
  if (deterministicJson(evaluation.method) !== deterministicJson(method)) {
    return unresolved(
      "evaluation-method-mismatch",
      "The derived L4 evaluation did not retain the exact code-owned method identity.",
    );
  }

  return {
    status: "resolved",
    observationCapture,
    evaluation,
    method,
    artifactInputs: [
      {
        id: resolved.primary.id,
        fingerprint: resolved.primary.fingerprint,
      },
      {
        id: resolved.assemblyStep.id,
        fingerprint: resolved.assemblyStep.fingerprint,
      },
      { id: selected.artifact.id, fingerprint: selected.artifact.fingerprint },
    ],
  };
}

/**
 * The L3 capture retains its Thread-basis discriminant. The narrow exact-input
 * port intentionally does not: it accepts only the immutable identity fields.
 */
export async function reopenExactL3AssemblyIntegrityInput(
  inputs: AssemblyIntegrityInputResolver,
  observationCapture: AssemblyIntegrityObservationCapture,
  source: ThreadSnapshot,
) {
  return await inputs.resolve({
    basis: {
      snapshotId: observationCapture.basis.snapshotId,
      revision: observationCapture.basis.revision,
      subjectId: observationCapture.basis.subjectId,
    },
    snapshot: source,
    geometryModule: observationCapture.geometryModule,
    observerProfile: {
      profile: {
        id: observationCapture.profile.id,
        version: observationCapture.profile.version,
      },
      fingerprint: observationCapture.profile.fingerprint,
    },
  });
}

function validateL4Work(
  project: EngineeringProjectSnapshot,
  work: EngineeringWorkItem,
): string | undefined {
  if (
    !work.operation ||
    deterministicJson(work.operation) !==
      deterministicJson(evaluateAssemblyIntegrityWorkItemOperation())
  ) {
    return "The current work revision does not have the exact zero-binding L4 operation.";
  }
  return assemblyIntegrityEvaluationGateClaimIssue(project, work);
}

/**
 * Prove that the dynamically bound L3 work names the exact geometry artifact
 * reopened from its own persisted capture.  This closes the intentional
 * generic-helper omission of dynamic `bindings` equality.
 */
export async function recrossExactL3ObservationCaptureBinding(input: {
  readonly capture: AssemblyIntegrityObservationCapture;
  readonly artifact: ThreadArtifact;
  readonly producerRun: {
    readonly id: string;
    readonly basis?: unknown;
    readonly startedAt?: string;
  };
  readonly resultSnapshot: ThreadSnapshot;
  readonly dependencyWork: EngineeringWorkItem;
}): Promise<string | undefined> {
  const { capture, artifact, producerRun, resultSnapshot, dependencyWork } = input;
  const captureFingerprint = await fingerprintAssemblyIntegrityObservationCapture(
    capture,
  );
  if (
    !fingerprintsEqual(captureFingerprint, artifact.fingerprint) ||
    artifact.id !== `assembly-integrity-observation-${artifact.fingerprint.digest}` ||
    artifact.version !== artifact.fingerprint.digest ||
    artifact.uri !==
      assemblyIntegrityObservationCaptureUri(artifact.fingerprint.digest) ||
    artifact.mediaType !== "application/json" ||
    artifact.freshness.changedAt !== capture.observedAt ||
    capture.trustedRunId !== producerRun.id ||
    capture.observedAt !== producerRun.startedAt
  ) {
    return "The L3 evidence artifact does not exactly bind its persisted capture and completed producer run.";
  }
  if (
    !sameBasisObject(capture.basis, producerRun.basis) ||
    !resultSnapshot.previous ||
    resultSnapshot.previous.snapshotId !== capture.basis.snapshotId ||
    resultSnapshot.previous.revision !== capture.basis.revision ||
    resultSnapshot.subject.id !== capture.basis.subjectId
  ) {
    return "The L3 capture is not anchored on the exact direct predecessor of its completed result.";
  }
  if (
    deterministicJson(artifact.inputArtifactIds) !== deterministicJson([
      capture.geometryModule.artifactId,
      capture.assemblyStep.artifactId,
    ])
  ) {
    return "The L3 evidence artifact does not retain the exact ordered module and STEP inputs.";
  }
  const bindings = dependencyWork.operation?.bindings;
  if (
    !bindings || bindings.length !== 1 ||
    bindings[0]?.name !== "geometryModule" ||
    bindings[0].source.kind !== "thread-entity" ||
    bindings[0].source.reference.kind !== "artifact" ||
    bindings[0].source.reference.snapshotId !== capture.basis.snapshotId ||
    bindings[0].source.reference.snapshotRevision !== capture.basis.revision ||
    bindings[0].source.reference.id !== capture.geometryModule.artifactId
  ) {
    return "The completed L3 work is not bound to the exact geometry module named by its capture.";
  }
  return undefined;
}

async function validateExactInputBinding(input: {
  readonly source: ThreadSnapshot;
  readonly head: ThreadSnapshot;
  readonly l3Artifact: ThreadArtifact;
  readonly capture: AssemblyIntegrityObservationCapture;
  readonly resolved: Awaited<ReturnType<AssemblyIntegrityInputResolver["resolve"]>>;
}): Promise<string | undefined> {
  const { source, head, l3Artifact, capture, resolved } = input;
  const sourcePrimary = exactFreshArtifact(
    source,
    capture.geometryModule.artifactId,
    capture.geometryModule.fingerprint,
  );
  const sourceStep = exactFreshArtifact(
    source,
    capture.assemblyStep.artifactId,
    capture.assemblyStep.fingerprint,
  );
  const headPrimary = exactFreshArtifact(
    head,
    capture.geometryModule.artifactId,
    capture.geometryModule.fingerprint,
  );
  const headStep = exactFreshArtifact(
    head,
    capture.assemblyStep.artifactId,
    capture.assemblyStep.fingerprint,
  );
  if (!sourcePrimary || !sourceStep || !headPrimary || !headStep) {
    return "The exact module or STEP input is absent, archived, stale, ambiguous, or fingerprint-mismatched.";
  }
  if (
    deterministicJson(sourcePrimary) !== deterministicJson(headPrimary) ||
    deterministicJson(sourceStep) !== deterministicJson(headStep) ||
    deterministicJson(sourcePrimary) !== deterministicJson(resolved.primary) ||
    deterministicJson(sourceStep) !== deterministicJson(resolved.assemblyStep) ||
    !sameBasis(source, capture.basis) ||
    resolved.basis.snapshotId !== capture.basis.snapshotId ||
    resolved.basis.revision !== capture.basis.revision ||
    resolved.basis.subjectId !== capture.basis.subjectId ||
    resolved.geometryModule.artifactId !== capture.geometryModule.artifactId ||
    !fingerprintsEqual(
      resolved.geometryModule.fingerprint,
      capture.geometryModule.fingerprint,
    ) ||
    resolved.profile.profile.id !== capture.profile.id ||
    resolved.profile.profile.version !== capture.profile.version ||
    !fingerprintsEqual(
      resolved.profile.profileFingerprint,
      capture.profile.fingerprint,
    ) ||
    deterministicJson(resolved.profile.configuredRuntime) !==
      deterministicJson(capture.profile.configuredRuntime) ||
    resolved.inputBundle.fingerprint.algorithm !==
      capture.inputBundle.fingerprint.algorithm ||
    !fingerprintsEqual(
      resolved.inputBundle.fingerprint,
      capture.inputBundle.fingerprint,
    ) ||
    resolved.inputBundle.bytes.byteLength !== capture.inputBundle.byteCount ||
    resolved.inputBundle.manifest.schemaVersion !== capture.inputBundle.schemaVersion
  ) {
    return "The reopened module, STEP, signed observer profile, or full input bundle diverges from the L3 capture.";
  }
  const captureFingerprint = await sha256Fingerprint(resolved.capture);
  if (!fingerprintsEqual(captureFingerprint, capture.geometryModule.fingerprint)) {
    return "The reopened geometry-module capture does not match the L3 geometry identity.";
  }
  if (
    l3Artifact.id === sourcePrimary.id || l3Artifact.id === sourceStep.id ||
    l3Artifact.id === headPrimary.id || l3Artifact.id === headStep.id
  ) {
    return "The L3 evidence artifact must remain distinct from the exact module and STEP inputs.";
  }
  return undefined;
}

function exactFreshArtifact(
  snapshot: ThreadSnapshot,
  id: string,
  fingerprint: ThreadArtifact["fingerprint"],
): ThreadArtifact | undefined {
  const matches = snapshot.artifacts.filter((artifact) => artifact.id === id);
  if (
    matches.length !== 1 ||
    archivedRefKeys(snapshot).has(`artifact:${id}`) ||
    matches[0]!.freshness.status !== "fresh" ||
    !fingerprintsEqual(matches[0]!.fingerprint, fingerprint)
  ) return undefined;
  return matches[0]!;
}

async function readExactSnapshot(
  snapshots: AssemblyIntegrityEvaluationRecrossSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot | undefined> {
  const raw = snapshots.getFresh
    ? await snapshots.getFresh(basis.snapshotId)
    : await snapshots.get(basis.snapshotId);
  if (!raw) return undefined;
  const snapshot = validateThreadSnapshot(raw);
  return sameBasis(snapshot, basis) ? snapshot : undefined;
}

function sameBasis(
  snapshot: Pick<ThreadSnapshot, "id" | "revision" | "subject">,
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return snapshot.id === basis.snapshotId &&
    snapshot.revision === basis.revision &&
    snapshot.subject.id === basis.subjectId;
}

function sameBasisObject(
  left: EngineeringThreadSnapshotBasis,
  right: unknown,
): boolean {
  if (!right || typeof right !== "object") return false;
  const candidate = right as Partial<EngineeringThreadSnapshotBasis>;
  return candidate.kind === "thread-snapshot" &&
    candidate.snapshotId === left.snapshotId &&
    candidate.revision === left.revision &&
    candidate.subjectId === left.subjectId;
}

function unavailable(
  code: string,
  message: string,
): AssemblyIntegrityEvaluationRecrossResult {
  return { status: "unavailable", diagnostics: [{ code, message }] };
}

function unresolved(
  code: string,
  message: string,
): AssemblyIntegrityEvaluationRecrossResult {
  return { status: "unresolved", diagnostics: [{ code, message }] };
}
