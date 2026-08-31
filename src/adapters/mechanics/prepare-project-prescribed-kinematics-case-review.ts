/**
 * Public L1 review combines the pure source/architecture recross with the
 * current project and Thread checks needed to compile one paste-ready route.
 */

import type {
  ProjectPrescribedKinematicsCaseReviewResult,
  ProjectPrescribedKinematicsCaseReviewUseCase,
} from "../../application/ports/in/mechanics/prescribed-kinematics/project-prescribed-kinematics-case-review.ts";
import type {
  ProjectPrescribedKinematicsCaseCaptureUseCase,
} from "../../application/ports/in/mechanics/prescribed-kinematics/project-prescribed-kinematics-case-capture.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import {
  parseProjectPrescribedKinematicsCaseCaptureCommand,
} from "../../application/use-cases/mechanics/prescribed-kinematics/capture-project-prescribed-kinematics-case.ts";
import { prescribedKinematicsNextHop } from "../../application/use-cases/mechanics/prescribed-kinematics/prescribed-kinematics-next-hop.ts";
import { fingerprintsEqual } from "../../domain/kernel/deterministic-json.ts";
import {
  MODEL_WRITE_ARCHITECTURE_OPERATION,
} from "../../domain/architecture/renderer/architecture-proposal.ts";
import {
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
} from "../../domain/mechanism/prescribed-kinematics/operations.ts";
import {
  encodePrescribedKinematicsCaseProposalParameters,
} from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-proposal.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import { selectCurrentThreadTip } from "../../domain/project/thread-tip.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { assertThreadSnapshotLineageIntact } from "../shared/stores/thread-snapshot-lineage.ts";

export interface PrescribedKinematicsCaseReviewSnapshotStore {
  get(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface PrepareProjectPrescribedKinematicsCaseReviewDependencies {
  readonly capture: ProjectPrescribedKinematicsCaseCaptureUseCase;
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: PrescribedKinematicsCaseReviewSnapshotStore;
}

export class PrepareProjectPrescribedKinematicsCaseReview
  implements ProjectPrescribedKinematicsCaseReviewUseCase {
  constructor(
    private readonly dependencies:
      PrepareProjectPrescribedKinematicsCaseReviewDependencies,
  ) {}

  async review(value: unknown): Promise<ProjectPrescribedKinematicsCaseReviewResult> {
    let command;
    try {
      command = parseProjectPrescribedKinematicsCaseCaptureCommand(value);
    } catch {
      return unavailable(
        "invalid_request",
        "The mechanism case request failed exact validation.",
      );
    }
    const captured = await this.dependencies.capture.capture(command);
    if (captured.status !== "resolved") return captured;

    let project: EngineeringProjectSnapshot;
    try {
      const raw = await this.dependencies.projects.get(command.projectId);
      if (!raw) {
        return unavailable(
          "project_not_found",
          "The exact engineering project is unavailable.",
        );
      }
      project = validateEngineeringProjectSnapshot(raw);
    } catch {
      return unresolved(
        "project_invalid",
        "The engineering project failed closed validation.",
      );
    }
    if (project.project.id !== command.projectId) {
      return unresolved(
        "project_mismatch",
        "The project reader returned a foreign project identity.",
      );
    }
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (tip.status !== "ok") {
      return unavailable(tip.diagnostic.code, tip.diagnostic.message);
    }
    if (tip.basis.subjectId !== project.project.subjectId) {
      return unresolved(
        "subject_mismatch",
        "The unique current Thread tip is foreign to the project subject.",
      );
    }
    try {
      const snapshot = await readExactSnapshot(this.dependencies.snapshots, tip.basis);
      await assertThreadSnapshotLineageIntact(snapshot, this.dependencies.snapshots);
      const declaredAgainst =
        captured.sealedCase.sourceClosure.workspace.declaredAgainst;
      if (!sameThreadBasis(declaredAgainst.thread, tip.basis)) {
        return unavailable(
          "basis_not_current",
          "The recrossed mechanism-source attachment declares a historical Thread basis; no paste-ready L1 append is emitted.",
        );
      }
      const predecessorWorkItemId = exactArchitectureProducerWorkItem(
        project,
        snapshot,
        declaredAgainst.architecture.artifactId,
        declaredAgainst.architecture.fingerprint,
      );
      const next = prescribedKinematicsNextHop({
        project,
        basis: tip.basis,
        predecessorWorkItemId,
        operation: VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
        owner: "agent",
        tokenFingerprint: captured.sealedCase.fingerprint.digest,
        phaseName: "Prescribed kinematics case",
        phaseDescription:
          "Seal the exact recrossed prescribed-kinematics workspace and architecture binding.",
        decisionTitle: "Review the prescribed-kinematics case seal",
        decisionQuestion:
          "Approve sealing this exact mechanism-source attachment closure as the prescribed-kinematics case?",
        summary:
          "Seal the displayed exact prescribed-kinematics case from the named workspace attachment.",
        parameters: encodePrescribedKinematicsCaseProposalParameters(command),
      });
      const conflict = nextIdentityConflict(project, next);
      if (conflict) {
        return unresolved(
          "compiled_identities_conflict",
          `The server-compiled L1 append identity already exists (${conflict}); no duplicate route is emitted.`,
        );
      }
      return {
        status: "resolved",
        sealedCase: captured.sealedCase,
        basis: snapshotRef(tip.basis),
        grants: "none",
        next,
      };
    } catch (error) {
      return error instanceof CaseReviewError
        ? unresolved(error.code, error.message)
        : unavailable(
          "snapshot_unavailable",
          error instanceof Error
            ? error.message
            : "The exact current Thread basis could not be reopened.",
        );
    }
  }
}

async function readExactSnapshot(
  snapshots: PrescribedKinematicsCaseReviewSnapshotStore,
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

function exactArchitectureProducerWorkItem(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot,
  artifactId: string,
  fingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  },
): string {
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.id === artifactId &&
    fingerprintsEqual(artifact.fingerprint, fingerprint)
  );
  if (matches.length !== 1) {
    throw new CaseReviewError(
      "architecture_artifact_unresolved",
      "The current Thread tip does not contain one exact declared-against architecture artifact.",
    );
  }
  const artifact = matches[0]!;
  const run = project.agentRuns.find((candidate) =>
    candidate.id === artifact.producer.runId
  );
  const work = run === undefined
    ? undefined
    : project.workItems.find((candidate) => candidate.id === run.workItemId);
  if (
    !run || run.status !== "completed" || !work || work.status !== "completed" ||
    work.operation?.id !== MODEL_WRITE_ARCHITECTURE_OPERATION.id ||
    work.operation.version !== MODEL_WRITE_ARCHITECTURE_OPERATION.version
  ) {
    throw new CaseReviewError(
      "architecture_producer_unresolved",
      "The declared-against architecture artifact has no exact completed model.write-architecture@1 producer work item to preserve as the L1 dependency.",
    );
  }
  return work.id;
}

function nextIdentityConflict(
  project: EngineeringProjectSnapshot,
  next: ReturnType<typeof prescribedKinematicsNextHop>,
): string | undefined {
  const phaseId = next.append.arguments.phases[0]!.id;
  const workItemId = next.append.arguments.workItems[0]!.id;
  const decisionId = next.append.arguments.requiredDecisions[0]!.id;
  if (project.phases.some((phase) => phase.id === phaseId)) return `phase ${phaseId}`;
  if (project.workItems.some((work) => work.id === workItemId)) {
    return `work item ${workItemId}`;
  }
  if (project.decisions.some((decision) => decision.id === decisionId)) {
    return `decision ${decisionId}`;
  }
  return undefined;
}

function sameThreadBasis(
  left: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
  right: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
): boolean {
  return left.snapshotId === right.snapshotId && left.revision === right.revision &&
    left.subjectId === right.subjectId;
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

function unavailable(
  code: string,
  message: string,
): ProjectPrescribedKinematicsCaseReviewResult {
  return { status: "unavailable", diagnostic: { code, message }, grants: "none" };
}

function unresolved(
  code: string,
  message: string,
): ProjectPrescribedKinematicsCaseReviewResult {
  return { status: "unresolved", diagnostic: { code, message }, grants: "none" };
}

class CaseReviewError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CaseReviewError";
  }
}
