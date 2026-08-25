/**
 * Shared exact L4 recross for assembly-integrity review and L5 execution.
 *
 * This adapter only reads persisted Thread/CAS evidence. It has no observer,
 * provider, SysON, tolerance, or caller-controlled lookup dependency.
 */

import type {
  AssemblyIntegrityEvaluationCaptureStore,
} from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-evaluation-capture-store.ts";
import { approvedBriefBasisForProject } from "../../../application/use-cases/project/commands/project-planning-transitions.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
  ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA,
  type AssemblyIntegrityEvaluationCapture,
  assemblyIntegrityEvaluationCaptureUri,
  validateAssemblyIntegrityEvaluationCapture,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
  type AssemblyIntegrityEvaluationCloseoutAdmission,
  type AssemblyIntegrityEvaluationCloseoutConsequence,
  isAssemblyIntegrityEvaluationAcceptEligible,
  validateAssemblyIntegrityEvaluationCloseoutAdmission,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import {
  ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
  currentApprovedAssemblyIntegrityVerificationGateIds,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-verification-authority.ts";
import {
  VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import { projectBriefContractVersion } from "../../../domain/project/project-brief.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";

const L4_TOOL =
  `${VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id}@${VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version}`;

export type AssemblyIntegrityCloseoutResolutionCode =
  | "not-found"
  | "ambiguous"
  | "stale"
  | "integrity";

export class AssemblyIntegrityCloseoutResolutionError extends Error {
  constructor(
    readonly code: AssemblyIntegrityCloseoutResolutionCode,
    message: string,
  ) {
    super(message);
    this.name = "AssemblyIntegrityCloseoutResolutionError";
  }
}

export interface AssemblyIntegrityCloseoutEvidenceResolverDependencies {
  readonly evaluationCaptures: Pick<AssemblyIntegrityEvaluationCaptureStore, "read">;
}

export interface AssemblyIntegrityCloseoutResolvedEvidence {
  readonly family: "assembly-integrity";
  readonly projectId: string;
  readonly subjectId: string;
  readonly basis: AssemblyIntegrityEvaluationCloseoutAdmission["basis"];
  readonly l4Run: EngineeringAgentRun;
  readonly evaluationCapture: ThreadArtifact;
  readonly geometryModule: ThreadArtifact;
  readonly assemblyStep: ThreadArtifact;
  readonly observation: ThreadArtifact;
  readonly capture: AssemblyIntegrityEvaluationCapture;
  readonly acceptanceEligible: boolean;
}

/**
 * Exact L5 authorization selected from the current human-approved Brief V2.
 * The review and executor use this same derivation so a caller cannot select a
 * subset, a success criterion, or another verification authority.
 */
export interface AssemblyIntegrityCloseoutAuthorization {
  readonly approvedBriefBasis: AssemblyIntegrityEvaluationCloseoutAdmission[
    "approvedBriefBasis"
  ];
  readonly verificationAuthority: typeof ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY;
  readonly gateClaims: AssemblyIntegrityEvaluationCloseoutAdmission["gateClaims"];
}

export function assemblyIntegrityCloseoutAuthorization(
  project: EngineeringProjectSnapshot,
  consequence: AssemblyIntegrityEvaluationCloseoutConsequence,
): AssemblyIntegrityCloseoutAuthorization {
  const brief = project.framing?.currentBrief;
  if (!brief || projectBriefContractVersion(brief) !== "2.0") {
    throw integrity(
      "Assembly-integrity closeout requires one current human-approved V2 Brief.",
    );
  }
  let approvedBriefBasis: AssemblyIntegrityEvaluationCloseoutAdmission[
    "approvedBriefBasis"
  ];
  try {
    approvedBriefBasis = approvedBriefBasisForProject(project);
  } catch {
    throw integrity(
      "Assembly-integrity closeout requires the exact current human-approved Brief basis.",
    );
  }
  const gateClaims = consequence === "accept"
    ? currentApprovedAssemblyIntegrityVerificationGateIds(project).map((
      gateItemId,
    ) => ({
      gateItemId,
      role: "satisfies" as const,
      status: "current" as const,
    }))
    : [];
  return Object.freeze({
    approvedBriefBasis,
    verificationAuthority: ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
    gateClaims: Object.freeze(gateClaims),
  });
}

export function assemblyIntegrityEvaluationCloseoutAdmission(
  resolved: AssemblyIntegrityCloseoutResolvedEvidence,
  consequence: AssemblyIntegrityEvaluationCloseoutConsequence,
  authorization: AssemblyIntegrityCloseoutAuthorization,
): AssemblyIntegrityEvaluationCloseoutAdmission {
  if (consequence === "accept" && !resolved.acceptanceEligible) {
    throw integrity(
      "An accept assembly-integrity closeout cannot be prepared while any literal L4 criterion is non-pass.",
    );
  }
  const criteria = resolved.capture.evaluation.criteria;
  return validateAssemblyIntegrityEvaluationCloseoutAdmission({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
    consequence,
    rejectionDisposition: consequence === "accept"
      ? "none"
      : resolved.acceptanceEligible
      ? "none"
      : "assembly-integrity-review-required",
    projectId: resolved.projectId,
    subjectId: resolved.subjectId,
    approvedBriefBasis: authorization.approvedBriefBasis,
    verificationAuthority: authorization.verificationAuthority,
    gateClaims: authorization.gateClaims,
    basis: resolved.basis,
    evaluationCapture: identity(resolved.evaluationCapture),
    geometryModule: identity(resolved.geometryModule),
    assemblyStep: identity(resolved.assemblyStep),
    observation: {
      ...identity(resolved.observation),
      observationFingerprint: resolved.capture.observation.observationFingerprint,
    },
    method: {
      schemaVersion: resolved.capture.method.schemaVersion,
      id: resolved.capture.method.id,
      version: resolved.capture.method.version,
      fingerprint: resolved.capture.method.fingerprint,
    },
    criteria,
    limitations: resolved.capture.method.limitations,
  });
}

/** Reopen exactly one fresh L4 whose completed run published the current tip. */
export async function resolveAssemblyIntegrityCloseoutEvidence(
  dependencies: AssemblyIntegrityCloseoutEvidenceResolverDependencies,
  input: {
    readonly project: EngineeringProjectSnapshot;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly snapshot: ThreadSnapshot;
  },
): Promise<AssemblyIntegrityCloseoutResolvedEvidence> {
  const { project, basis, snapshot } = input;
  if (
    project.project.id === "" || project.project.subjectId !== basis.subjectId ||
    snapshot.id !== basis.snapshotId || snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw integrity(
      "The closeout basis is not the exact current project Thread snapshot.",
    );
  }
  if (snapshot.freshness.status !== "fresh") {
    throw stale("The exact current Thread tip is not fresh.");
  }
  const l4Run = selectExactCompletedL4Run(project, basis, snapshot);
  const evaluationCapture = unique(
    snapshot.artifacts.filter((artifact) =>
      artifact.producer.runId === l4Run.id && isL4CaptureArtifact(artifact)
    ),
    "assembly-integrity L4 evaluation capture from the exact completed L4 run",
  );
  assertFresh(snapshot, evaluationCapture, "assembly-integrity L4 evaluation capture");
  assertRunPublishesArtifact(l4Run, snapshot, evaluationCapture);
  const capture = await reopenCapture(dependencies, evaluationCapture);
  assertCaptureMatchesRun(capture, l4Run, basis);
  const geometryModule = exactArtifact(
    snapshot,
    capture.geometryModule.artifactId,
    capture.geometryModule.fingerprint,
    "geometry-module capture",
  );
  const assemblyStep = exactArtifact(
    snapshot,
    capture.assemblyStep.artifactId,
    capture.assemblyStep.fingerprint,
    "canonical assembly STEP",
  );
  const observation = exactArtifact(
    snapshot,
    capture.observation.artifactId,
    capture.observation.fingerprint,
    "assembly-integrity L3 observation",
  );
  assertFresh(snapshot, geometryModule, "geometry-module capture");
  assertFresh(snapshot, assemblyStep, "canonical assembly STEP");
  assertFresh(snapshot, observation, "assembly-integrity L3 observation");
  if (assemblyStep.kind !== "step" || assemblyStep.mediaType !== "model/step") {
    throw integrity(
      "The L4 branch does not bind an exact canonical assembly STEP artifact.",
    );
  }
  const expectedInputs = [geometryModule.id, assemblyStep.id, observation.id];
  if (
    deterministicJson(evaluationCapture.inputArtifactIds) !==
      deterministicJson(expectedInputs)
  ) {
    throw integrity(
      "The L4 capture does not exactly consume its L3 observation, module, and assembly STEP.",
    );
  }
  const fingerprint = await sha256Fingerprint(snapshot);
  return Object.freeze({
    family: "assembly-integrity" as const,
    projectId: project.project.id,
    subjectId: basis.subjectId,
    basis: {
      snapshotId: basis.snapshotId,
      revision: basis.revision,
      fingerprint,
    },
    l4Run,
    evaluationCapture,
    geometryModule,
    assemblyStep,
    observation,
    capture,
    acceptanceEligible: isAssemblyIntegrityEvaluationAcceptEligible(
      capture.evaluation.criteria,
    ),
  });
}

function selectExactCompletedL4Run(
  project: EngineeringProjectSnapshot,
  basis: EngineeringThreadSnapshotBasis,
  snapshot: ThreadSnapshot,
): EngineeringAgentRun {
  const currentResult = {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
  const candidates = project.agentRuns.filter((run) => {
    const work = project.workItems.find((item) => item.id === run.workItemId);
    return run.status === "completed" &&
      work?.operation?.id === VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id &&
      work.operation.version === VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version &&
      deterministicJson(run.resultSnapshot) === deterministicJson(currentResult);
  });
  const run = unique(candidates, "completed assembly-integrity L4 run");
  if (
    run.basis?.kind !== "thread-snapshot" ||
    run.basis.snapshotId === "latest" ||
    run.basis.subjectId !== basis.subjectId
  ) {
    throw integrity("The L4 run does not retain one exact Thread input basis.");
  }
  const work = project.workItems.find((item) => item.id === run.workItemId);
  if (!work || work.status !== "completed") {
    throw integrity("The exact L4 run is not attached to one completed work item.");
  }
  return run;
}

async function reopenCapture(
  dependencies: AssemblyIntegrityCloseoutEvidenceResolverDependencies,
  artifact: ThreadArtifact,
): Promise<AssemblyIntegrityEvaluationCapture> {
  if (
    artifact.id !== `assembly-integrity-evaluation-${artifact.fingerprint.digest}` ||
    artifact.version !== artifact.fingerprint.digest ||
    artifact.uri !==
      assemblyIntegrityEvaluationCaptureUri(artifact.fingerprint.digest) ||
    artifact.kind !== "evidence" || artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== "digital-thread" ||
    artifact.producer.tool !== L4_TOOL
  ) {
    throw integrity(
      "The assembly-integrity L4 artifact identity, URI, media type, or producer is not canonical.",
    );
  }
  let capture: AssemblyIntegrityEvaluationCapture | undefined;
  try {
    capture = await dependencies.evaluationCaptures.read(artifact.fingerprint);
  } catch (error) {
    throw integrity(`The L4 capture CAS read failed: ${describe(error)}`);
  }
  if (!capture) {
    throw notFound("The exact assembly-integrity L4 capture is unavailable.");
  }
  try {
    const validated = await validateAssemblyIntegrityEvaluationCapture(capture);
    if (validated.schemaVersion !== ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA) {
      throw new TypeError("Unexpected L4 schema.");
    }
    const actual = await sha256Fingerprint(validated);
    if (!fingerprintsEqual(actual, artifact.fingerprint)) {
      throw new TypeError(
        "The L4 capture bytes do not match the named Thread artifact fingerprint.",
      );
    }
    return validated;
  } catch (error) {
    throw integrity(
      `The assembly-integrity L4 capture is not canonical: ${describe(error)}`,
    );
  }
}

function assertRunPublishesArtifact(
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): void {
  const expected = {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  } as const;
  const matching = run.evidenceRefs.filter((reference) =>
    deterministicJson(reference) === deterministicJson(expected)
  );
  if (matching.length !== 1) {
    throw integrity(
      "The exact completed L4 run does not retain its one current evaluation capture evidence reference.",
    );
  }
}

function assertCaptureMatchesRun(
  capture: AssemblyIntegrityEvaluationCapture,
  run: EngineeringAgentRun,
  currentBasis: EngineeringThreadSnapshotBasis,
): void {
  if (
    capture.trustedRunId !== run.id ||
    capture.basis.kind !== "thread-snapshot" ||
    run.basis?.kind !== "thread-snapshot" ||
    capture.basis.snapshotId !== run.basis.snapshotId ||
    capture.basis.revision !== run.basis.revision ||
    capture.basis.subjectId !== run.basis.subjectId ||
    capture.basis.subjectId !== currentBasis.subjectId ||
    capture.operation.id !== VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id ||
    capture.operation.version !== VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version
  ) {
    throw integrity(
      "The L4 capture does not bind the completed run and its exact prior Thread basis.",
    );
  }
  if (
    capture.evaluation.criteria.length !==
      ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA.length ||
    capture.evaluation.criteria.some((criterion, index) =>
      criterion.id !== ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA[index]
    )
  ) {
    throw integrity(
      "The L4 capture does not retain all five assembly-integrity criteria in method order.",
    );
  }
}

function exactArtifact(
  snapshot: ThreadSnapshot,
  id: string,
  fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
  label: string,
): ThreadArtifact {
  const artifact = unique(
    snapshot.artifacts.filter((candidate) => candidate.id === id),
    label,
  );
  if (!fingerprintsEqual(artifact.fingerprint, fingerprint)) {
    throw integrity(`The ${label} fingerprint does not match the L4 capture.`);
  }
  return artifact;
}

function assertFresh(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
  label: string,
): void {
  if (
    artifact.freshness.status !== "fresh" ||
    archivedRefKeys(snapshot).has(`artifact:${artifact.id}`)
  ) {
    throw stale(`The ${label} is stale, archived, running, or failed.`);
  }
}

function isL4CaptureArtifact(artifact: ThreadArtifact): boolean {
  return artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === L4_TOOL &&
    artifact.id === `assembly-integrity-evaluation-${artifact.fingerprint.digest}`;
}

function identity(
  artifact: ThreadArtifact,
): { readonly id: string; readonly fingerprint: ThreadArtifact["fingerprint"] } {
  return { id: artifact.id, fingerprint: artifact.fingerprint };
}

function unique<T>(values: readonly T[], label: string): T {
  if (values.length === 0) throw notFound(`No exact ${label} is available.`);
  if (values.length !== 1) throw ambiguous(`More than one ${label} is available.`);
  return values[0]!;
}

function notFound(message: string): AssemblyIntegrityCloseoutResolutionError {
  return new AssemblyIntegrityCloseoutResolutionError("not-found", message);
}

function ambiguous(message: string): AssemblyIntegrityCloseoutResolutionError {
  return new AssemblyIntegrityCloseoutResolutionError("ambiguous", message);
}

function stale(message: string): AssemblyIntegrityCloseoutResolutionError {
  return new AssemblyIntegrityCloseoutResolutionError("stale", message);
}

function integrity(message: string): AssemblyIntegrityCloseoutResolutionError {
  return new AssemblyIntegrityCloseoutResolutionError("integrity", message);
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}
