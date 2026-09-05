/**
 * Provider-free discovery of the next registered prescribed-kinematics step.
 *
 * This adapter rereads durable evidence only. It never starts Chrono, opens a
 * runtime, seals a method, evaluates an L4 result, or records an L5 outcome.
 * Each returned mutation envelope is merely a human-reviewable route to the
 * existing project commands and operations.
 */

import type {
  PrescribedKinematicsNextHopStage,
  ProjectPrescribedKinematicsNextHopEvidenceRef,
  ProjectPrescribedKinematicsNextHopReviewRequest,
  ProjectPrescribedKinematicsNextHopReviewResult,
  ProjectPrescribedKinematicsNextHopReviewUseCase,
} from "../../application/ports/in/mechanics/prescribed-kinematics/project-prescribed-kinematics-next-hop-review.ts";
import { prescribedKinematicsNextHop } from "../../application/use-cases/mechanics/prescribed-kinematics/prescribed-kinematics-next-hop.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { PrescribedKinematicsCaptureStore } from "../../application/ports/out/mechanics/prescribed-kinematics-capture-store.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { prescribedKinematicsEvaluationCloseoutCandidates } from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-evaluation-closeout.ts";
import {
  DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
} from "../../domain/mechanism/prescribed-kinematics/operations.ts";
import { fingerprintPrescribedKinematicsObservation } from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-observation.ts";
import { encodePrescribedKinematicsRunProposalParameters } from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-proposal.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../domain/project/engineering-project.ts";
import { selectCurrentThreadTip } from "../../domain/project/thread-tip.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import {
  JSON_SOURCE_ACCEPTED_MIME_TYPES,
  parseAgentResourceReference,
} from "../../domain/resource/agent-resource-reference.ts";
import {
  canonicalizePrescribedKinematicsMethodSheetSource,
  validatePrescribedKinematicsMethodSheetSourceAgainstEvidence,
} from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-method-sheet.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { PrescribedKinematicsCase } from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import type { PrescribedKinematicsObservation } from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-observation.ts";
import type { AgentResourceReference } from "../../domain/resource/agent-resource-capture.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type { ReopenAgentResource } from "../../application/use-cases/resource/reopen-agent-resource.ts";
import { assertThreadSnapshotLineageIntact } from "../shared/stores/thread-snapshot-lineage.ts";

type ExactOperation =
  | typeof VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION
  | typeof VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION
  | typeof VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION
  | typeof VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION
  | typeof DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION
  | typeof DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION;

export interface PrescribedKinematicsNextHopReviewSnapshotStore
  extends ThreadSnapshotStore {
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface PrepareProjectPrescribedKinematicsNextHopReviewDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: PrescribedKinematicsNextHopReviewSnapshotStore;
  readonly captures: PrescribedKinematicsCaptureStore;
  readonly resources: ReopenAgentResource;
}

/**
 * Reconstruct one exact current evidence branch and prepare its next existing
 * operation. The review has no dependency on the Chrono runtime, so it cannot
 * accidentally qualify, configure, or dispatch it.
 */
export class PrepareProjectPrescribedKinematicsNextHopReview
  implements ProjectPrescribedKinematicsNextHopReviewUseCase {
  constructor(
    private readonly dependencies:
      PrepareProjectPrescribedKinematicsNextHopReviewDependencies,
  ) {}

  async review(
    stage: PrescribedKinematicsNextHopStage,
    value: unknown,
  ): Promise<ProjectPrescribedKinematicsNextHopReviewResult> {
    let request: ProjectPrescribedKinematicsNextHopReviewRequest;
    try {
      request = parseRequest(stage, value);
    } catch {
      return unavailable(
        stage,
        "invalid_request",
        "The prescribed-kinematics next-hop review request failed exact validation.",
      );
    }
    let project: EngineeringProjectSnapshot;
    try {
      const rawProject = await this.dependencies.projects.get(request.projectId);
      if (!rawProject) {
        return unavailable(
          stage,
          "project_not_found",
          "The exact engineering project is unavailable.",
        );
      }
      project = validateEngineeringProjectSnapshot(rawProject);
    } catch {
      return unresolved(
        stage,
        "project_invalid",
        "The engineering project failed closed validation.",
      );
    }
    if (project.project.id !== request.projectId) {
      return unresolved(
        stage,
        "project_mismatch",
        "The project reader returned a foreign project identity.",
      );
    }
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (tip.status !== "ok") {
      return unavailable(stage, tip.diagnostic.code, tip.diagnostic.message);
    }
    if (tip.basis.subjectId !== project.project.subjectId) {
      return unresolved(
        stage,
        "subject_mismatch",
        "The unique current Thread tip is foreign to the project subject.",
      );
    }
    let snapshot: ThreadSnapshot;
    try {
      snapshot = await readExactSnapshot(this.dependencies.snapshots, tip.basis);
      await assertThreadSnapshotLineageIntact(snapshot, this.dependencies.snapshots);
    } catch (error) {
      return unavailable(stage, "snapshot_unavailable", message(error));
    }

    try {
      const evidence = await resolveEvidence(
        stage,
        project,
        snapshot,
        this.dependencies.captures,
      );
      if (stage === "run") {
        return deepFreeze({
          status: "resolved" as const,
          selected: {
            stage,
            basis: snapshotRef(tip.basis),
            evidence: { sealedCase: evidence.case.ref },
            caseFingerprint: evidence.case.value.fingerprint,
            next: prescribedKinematicsNextHop({
              project,
              basis: tip.basis,
              predecessorWorkItemId: evidence.case.workItemId,
              operation: VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
              owner: "agent",
              tokenFingerprint: evidence.case.value.fingerprint.digest,
              phaseName: "Prescribed kinematics observation",
              phaseDescription:
                "Run the registered prescribed-kinematics observation against the exact current L1 case.",
              decisionTitle: "Review the prescribed-kinematics L3 observation",
              decisionQuestion:
                "Approve the exact registered prescribed-kinematics observation of the current L1 case?",
              summary:
                "Queue the registered prescribed-kinematics observation against the displayed exact L1 case.",
              parameters: encodePrescribedKinematicsRunProposalParameters(
                evidence.case.value.fingerprint,
              ),
            }),
          },
        });
      }
      if (stage === "method") {
        const preparedMethodSheet = {
          caseFingerprint: evidence.case.value.fingerprint,
          observationFingerprint: await fingerprintPrescribedKinematicsObservation(
            evidence.observation!.value.observation,
            evidence.case.value,
          ),
        };
        const resourceRef = "methodResourceRef" in request
          ? request.methodResourceRef
          : undefined;
        if (resourceRef === undefined) {
          return deepFreeze({
            status: "resolved" as const,
            selected: {
              stage,
              mode: "preparation" as const,
              basis: snapshotRef(tip.basis),
              evidence: {
                sealedCase: evidence.case.ref,
                observation: evidence.observation!.ref,
              },
              methodSheet: preparedMethodSheet,
            },
          });
        }
        const validatedMethod = await validateMethodResource({
          resources: this.dependencies.resources,
          resourceRef,
          sealedCase: evidence.case.value,
          observation: evidence.observation!.value.observation,
        });
        return deepFreeze({
          status: "resolved" as const,
          selected: {
            stage,
            mode: "review" as const,
            basis: snapshotRef(tip.basis),
            evidence: {
              sealedCase: evidence.case.ref,
              observation: evidence.observation!.ref,
            },
            methodSheet: validatedMethod,
            methodResourceRef: resourceRef,
            next: prescribedKinematicsNextHop({
              project,
              basis: tip.basis,
              predecessorWorkItemId: evidence.observation!.workItemId,
              operation: VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
              owner: "agent",
              tokenFingerprint: resourceRef.fingerprint.digest,
              phaseName: "Prescribed kinematics method",
              phaseDescription:
                "Seal one human-reviewed prescribed-kinematics method resource against exact existing L1 and L3 evidence.",
              decisionTitle: "Review the prescribed-kinematics method seal",
              decisionQuestion:
                "Approve sealing this exact method resource for the existing prescribed-kinematics case and L3 observation?",
              summary:
                "Seal the displayed exact prescribed-kinematics method resource against the current L1 case and L3 observation.",
              parameters: methodResourceParameters(resourceRef),
            }),
          },
        });
      }
      if (stage === "evaluation") {
        return deepFreeze({
          status: "resolved" as const,
          selected: {
            stage,
            basis: snapshotRef(tip.basis),
            evidence: {
              sealedCase: evidence.case.ref,
              observation: evidence.observation!.ref,
              method: evidence.method!.ref,
            },
            next: prescribedKinematicsNextHop({
              project,
              basis: tip.basis,
              predecessorWorkItemId: evidence.method!.workItemId,
              operation: VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
              owner: "agent",
              tokenFingerprint: evidence.method!.ref.fingerprint.digest,
              phaseName: "Prescribed kinematics evaluation",
              phaseDescription:
                "Evaluate the already sealed prescribed-kinematics method against its exact existing L1 and L3 evidence.",
              decisionTitle: "Review the prescribed-kinematics L4 evaluation",
              decisionQuestion:
                "Approve evaluating this exact sealed prescribed-kinematics method against its existing L1 and L3 evidence?",
              summary:
                "Evaluate the displayed exact prescribed-kinematics method against the current L1 case and L3 observation.",
              parameters: evidenceParameters(evidence, "method"),
            }),
          },
        });
      }
      const candidates = await prescribedKinematicsEvaluationCloseoutCandidates({
        evaluation: evidence.evaluation!.value,
        sealedCase: evidence.case.value,
        observation: evidence.observation!.value.observation,
        method: evidence.method!.value,
      });
      const reject = candidates.find((candidate) => candidate.consequence === "reject");
      if (!reject) {
        throw new NextHopResolutionError(
          "unresolved",
          "closeout_candidate_missing",
          "The exact L4 evidence produced no required human reject candidate.",
        );
      }
      const accept = candidates.find((candidate) => candidate.consequence === "accept");
      const closeout = (candidate: typeof reject) => ({
        candidate,
        next: prescribedKinematicsNextHop({
          project,
          basis: tip.basis,
          predecessorWorkItemId: evidence.evaluation!.workItemId,
          operation: candidate.operation,
          owner: "human",
          tokenFingerprint: evidence.evaluation!.ref.fingerprint.digest,
          phaseName: "Prescribed kinematics closeout",
          phaseDescription:
            "Record one human L5 closeout of the exact current prescribed-kinematics L4 evaluation.",
          decisionTitle: candidate.consequence === "accept"
            ? "Accept the prescribed-kinematics evaluation closeout"
            : "Reject the prescribed-kinematics evaluation closeout",
          decisionQuestion: candidate.consequence === "accept"
            ? "Accept the displayed exact prescribed-kinematics L4 evaluation closeout?"
            : "Reject the displayed exact prescribed-kinematics L4 evaluation closeout?",
          summary: candidate.consequence === "accept"
            ? "Accept the displayed exact prescribed-kinematics L4 evaluation closeout."
            : "Reject the displayed exact prescribed-kinematics L4 evaluation closeout.",
          parameters: [
            parameter(
              "evaluationFingerprint",
              "Exact L4 evaluation SHA-256",
              evidence.evaluation!.ref.fingerprint.digest,
            ),
            parameter(
              "closeoutConsequence",
              "Human L5 closeout consequence",
              candidate.consequence,
            ),
          ],
        }),
      });
      return deepFreeze({
        status: "resolved" as const,
        selected: {
          stage,
          basis: snapshotRef(tip.basis),
          evidence: {
            sealedCase: evidence.case.ref,
            observation: evidence.observation!.ref,
            method: evidence.method!.ref,
            evaluation: evidence.evaluation!.ref,
          },
          ...(accept === undefined ? {} : { accept: closeout(accept) }),
          reject: closeout(reject),
        },
      });
    } catch (error) {
      if (error instanceof NextHopResolutionError) {
        return error.kind === "unavailable"
          ? unavailable(stage, error.code, error.message)
          : unresolved(stage, error.code, error.message);
      }
      return unresolved(stage, "recross_failed", message(error));
    }
  }
}

type ResolvedEvidence = {
  readonly case: {
    readonly ref: ProjectPrescribedKinematicsNextHopEvidenceRef;
    readonly workItemId: string;
    readonly value: NonNullable<
      Awaited<ReturnType<PrescribedKinematicsCaptureStore["readCase"]>>
    >;
  };
  readonly observation?: {
    readonly ref: ProjectPrescribedKinematicsNextHopEvidenceRef;
    readonly workItemId: string;
    readonly value: NonNullable<
      Awaited<ReturnType<PrescribedKinematicsCaptureStore["readObservation"]>>
    >;
  };
  readonly method?: {
    readonly ref: ProjectPrescribedKinematicsNextHopEvidenceRef;
    readonly workItemId: string;
    readonly value: NonNullable<
      Awaited<ReturnType<PrescribedKinematicsCaptureStore["readMethod"]>>
    >;
  };
  readonly evaluation?: {
    readonly ref: ProjectPrescribedKinematicsNextHopEvidenceRef;
    readonly workItemId: string;
    readonly value: NonNullable<
      Awaited<ReturnType<PrescribedKinematicsCaptureStore["readEvaluation"]>>
    >;
  };
};

async function resolveEvidence(
  stage: PrescribedKinematicsNextHopStage,
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot,
  captures: PrescribedKinematicsCaptureStore,
): Promise<ResolvedEvidence> {
  const sealedCase = await captured(
    project,
    snapshot,
    VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
    (artifact) => captures.readCase(artifact.fingerprint),
    "case",
  );
  if (stage === "run") return { case: sealedCase };
  const observation = await captured(
    project,
    snapshot,
    VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
    (artifact) => captures.readObservation(artifact.fingerprint, sealedCase.value),
    "observation",
  );
  if (stage === "method") return { case: sealedCase, observation };
  const method = await captured(
    project,
    snapshot,
    VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
    (artifact) => captures.readMethod(artifact.fingerprint),
    "method",
  );
  if (stage === "evaluation") return { case: sealedCase, observation, method };
  const evaluation = await captured(
    project,
    snapshot,
    VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
    (artifact) => captures.readEvaluation(artifact.fingerprint),
    "evaluation",
  );
  return { case: sealedCase, observation, method, evaluation };
}

async function captured<T>(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot,
  operation: ExactOperation,
  read: (artifact: ThreadArtifact) => Promise<T | undefined>,
  label: string,
): Promise<{
  readonly ref: ProjectPrescribedKinematicsNextHopEvidenceRef;
  readonly workItemId: string;
  readonly value: T;
}> {
  const artifact = exactArtifact(snapshot, operation);
  const workItemId = exactCompletedProducerWorkItem(project, artifact, operation);
  const value = await read(artifact);
  if (!value) {
    throw new NextHopResolutionError(
      "unavailable",
      `${label}_capture_missing`,
      `The exact prescribed-kinematics ${label} capture is unavailable.`,
    );
  }
  return {
    ref: {
      id: artifact.id,
      fingerprint: artifact.fingerprint,
      producerRunId: artifact.producer.runId,
      freshness: "fresh",
    },
    workItemId,
    value,
  };
}

function exactArtifact(
  snapshot: ThreadSnapshot,
  operation: ExactOperation,
): ThreadArtifact {
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.producer.tool === `${operation.id}@${operation.version}`
  );
  if (matches.length !== 1) {
    throw new NextHopResolutionError(
      "unresolved",
      "artifact_ambiguous",
      `The current Thread tip must contain exactly one ${operation.id}@${operation.version} artifact.`,
    );
  }
  const artifact = matches[0]!;
  if (artifact.freshness.status !== "fresh") {
    throw new NextHopResolutionError(
      "unavailable",
      "artifact_stale",
      `The exact prescribed-kinematics ${operation.id}@${operation.version} artifact is not fresh.`,
    );
  }
  return artifact;
}

function exactCompletedProducerWorkItem(
  project: EngineeringProjectSnapshot,
  artifact: ThreadArtifact,
  operation: ExactOperation,
): string {
  const run = project.agentRuns.find((candidate) =>
    candidate.id === artifact.producer.runId
  );
  const work = run === undefined
    ? undefined
    : project.workItems.find((candidate) => candidate.id === run.workItemId);
  if (
    !run || run.status !== "completed" || !work ||
    work.operation?.id !== operation.id || work.operation.version !== operation.version
  ) {
    throw new NextHopResolutionError(
      "unresolved",
      "producer_run_mismatch",
      `The ${operation.id}@${operation.version} artifact does not name one completed exact producer work item.`,
    );
  }
  return work.id;
}

export { prescribedKinematicsNextHop };

function parseRequest(
  stage: PrescribedKinematicsNextHopStage,
  value: unknown,
): ProjectPrescribedKinematicsNextHopReviewRequest {
  const methodResourceNamed = stage === "method" &&
    value !== null && typeof value === "object" && !Array.isArray(value) &&
    "methodResourceRef" in value;
  const root = exactRecord(
    value,
    methodResourceNamed ? ["projectId", "methodResourceRef"] : ["projectId"],
    "$prescribedKinematicsNextHopReview",
  );
  const projectId = safeId(
    root.projectId,
    "$prescribedKinematicsNextHopReview.projectId",
  );
  if (projectId.toLowerCase() === "latest") {
    throw new TypeError("latest is not an exact project identity.");
  }
  return methodResourceNamed
    ? {
      projectId,
      methodResourceRef: parseAgentResourceReference(
        root.methodResourceRef,
        "$prescribedKinematicsNextHopReview.methodResourceRef",
      ),
    }
    : { projectId };
}

async function validateMethodResource(input: {
  readonly resources: ReopenAgentResource;
  readonly resourceRef: AgentResourceReference;
  readonly sealedCase: PrescribedKinematicsCase;
  readonly observation: PrescribedKinematicsObservation;
}): Promise<{
  readonly caseFingerprint: ContentFingerprint;
  readonly observationFingerprint: ContentFingerprint;
}> {
  let text: string;
  try {
    text = (await input.resources.reopenUtf8Text(input.resourceRef, {
      acceptedMimeTypes: JSON_SOURCE_ACCEPTED_MIME_TYPES,
      maxBytes: 262_144,
    })).text;
  } catch {
    throw new NextHopResolutionError(
      "unavailable",
      "method_resource_unavailable",
      "The exact method resource could not be reopened as accepted UTF-8 JSON.",
    );
  }
  let source: ReturnType<
    typeof canonicalizePrescribedKinematicsMethodSheetSource
  >["source"];
  try {
    const canonical = canonicalizePrescribedKinematicsMethodSheetSource(
      JSON.parse(text),
    );
    if (canonical.text !== text) {
      throw new TypeError("The exact method resource bytes are not canonical.");
    }
    source = canonical.source;
  } catch {
    throw new NextHopResolutionError(
      "unresolved",
      "method_resource_invalid",
      "The exact method resource is not canonical prescribed-kinematics method-sheet source JSON.",
    );
  }
  try {
    const recrossed =
      await validatePrescribedKinematicsMethodSheetSourceAgainstEvidence({
        source,
        sealedCase: input.sealedCase,
        observation: input.observation,
      });
    return {
      caseFingerprint: recrossed.sealedCase.fingerprint,
      observationFingerprint: recrossed.observationFingerprint,
    };
  } catch (error) {
    throw new NextHopResolutionError(
      "unresolved",
      "method_evidence_mismatch",
      error instanceof Error
        ? error.message
        : "The method resource does not recross the exact current L1/L3 evidence.",
    );
  }
}

async function readExactSnapshot(
  snapshots: PrescribedKinematicsNextHopReviewSnapshotStore,
  basis: EngineeringThreadSnapshotRef,
): Promise<ThreadSnapshot> {
  const snapshot = snapshots.getFresh === undefined
    ? await snapshots.get(basis.snapshotId)
    : await snapshots.getFresh(basis.snapshotId);
  if (!snapshot) {
    throw new TypeError("The exact current Thread tip cannot be reopened.");
  }
  const validated = validateThreadSnapshot(snapshot);
  if (
    validated.id !== basis.snapshotId || validated.revision !== basis.revision ||
    validated.subject.id !== basis.subjectId
  ) {
    throw new TypeError("The reopened Thread snapshot does not match the project tip.");
  }
  return validated;
}

function snapshotRef(
  basis: EngineeringThreadSnapshotRef,
): EngineeringThreadSnapshotRef {
  return {
    snapshotId: basis.snapshotId,
    revision: basis.revision,
    subjectId: basis.subjectId,
  };
}

function methodResourceParameters(
  resource: AgentResourceReference,
): readonly EngineeringDecisionProposalParameter[] {
  return [
    parameter("methodResourceUri", "Method resource URI", resource.uri),
    parameter("methodResourceName", "Method resource name", resource.name),
    parameter("methodResourceMimeType", "Method resource MIME type", resource.mimeType),
    parameter(
      "methodResourceRepresentation",
      "Method resource representation",
      resource.representation,
    ),
    parameter(
      "methodResourceByteCount",
      "Method resource byte count",
      resource.byteCount,
    ),
    parameter(
      "methodResourceSha256",
      "Method resource SHA-256",
      resource.fingerprint.digest,
    ),
  ];
}

function evidenceParameters(
  evidence: ResolvedEvidence,
  through: "method",
): readonly EngineeringDecisionProposalParameter[] {
  return [
    parameter(
      "caseFingerprint",
      "Exact L1 case SHA-256",
      evidence.case.ref.fingerprint.digest,
    ),
    parameter(
      "observationFingerprint",
      "Exact L3 observation SHA-256",
      evidence.observation!.ref.fingerprint.digest,
    ),
    parameter(
      `${through}Fingerprint`,
      "Exact sealed method SHA-256",
      evidence.method!.ref.fingerprint.digest,
    ),
  ];
}

function parameter(
  key: string,
  label: string,
  value: string | number | boolean,
): EngineeringDecisionProposalParameter {
  return { key, label, value };
}

class NextHopResolutionError extends Error {
  constructor(
    readonly kind: "unavailable" | "unresolved",
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NextHopResolutionError";
  }
}

function unavailable(
  stage: PrescribedKinematicsNextHopStage,
  code: string,
  message: string,
): ProjectPrescribedKinematicsNextHopReviewResult {
  return {
    status: "unavailable",
    family: "prescribed-kinematics",
    stage,
    diagnostic: { code, message },
  };
}

function unresolved(
  stage: PrescribedKinematicsNextHopStage,
  code: string,
  message: string,
): ProjectPrescribedKinematicsNextHopReviewResult {
  return {
    status: "unresolved",
    family: "prescribed-kinematics",
    stage,
    diagnostic: { code, message },
  };
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The exact prescribed-kinematics evidence could not be recrossed.";
}
