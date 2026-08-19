import {
  EngineeringProjectCommandError,
  type EngineeringProjectCompletionEvidenceValidator,
  type EngineeringProjectReconciliationSnapshotValidator,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import type {
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
} from "../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { ExactThreadSnapshotReader } from "../shared/stores/engineering-thread-snapshot-resolver.ts";
import { threadSnapshotDescendsFrom } from "../shared/stores/thread-snapshot-lineage.ts";

/** Fail-closed bridge from run completion to exact canonical thread evidence. */
export class ExactThreadCompletionEvidenceValidator
  implements EngineeringProjectCompletionEvidenceValidator {
  constructor(private readonly snapshots: ExactThreadSnapshotReader) {}

  async validate(
    baseReference: EngineeringThreadSnapshotRef,
    resultReference: EngineeringThreadSnapshotRef,
    evidenceRefs: readonly EngineeringThreadEntityRef[],
  ): Promise<void> {
    const [baseSnapshot, resultSnapshot] = await Promise.all([
      this.exactSnapshot("Base", baseReference),
      this.exactSnapshot("Result", resultReference),
    ]);
    if (
      !await threadSnapshotDescendsFrom(
        resultSnapshot,
        baseSnapshot,
        this.snapshots,
      )
    ) {
      invalidEvidence(
        `Result ThreadSnapshot ${resultReference.snapshotId}@${resultReference.revision} does not descend from exact run base ${baseReference.snapshotId}@${baseReference.revision}.`,
      );
    }
    for (const evidence of evidenceRefs) {
      if (
        evidence.snapshotId !== resultReference.snapshotId ||
        evidence.snapshotRevision !== resultReference.revision
      ) {
        invalidEvidence(
          `Completion evidence ${evidence.kind}:${evidence.id} is not bound to exact result ${resultReference.snapshotId}@${resultReference.revision}.`,
        );
      }
      const resultEntity = threadEntity(resultSnapshot, evidence);
      if (resultEntity === undefined) {
        invalidEvidence(
          `Completion evidence ${evidence.kind}:${evidence.id} does not exist in exact ThreadSnapshot ${resultReference.snapshotId}@${resultReference.revision}.`,
        );
      }
      const baseEntity = threadEntity(baseSnapshot, evidence);
      if (
        baseEntity !== undefined &&
        deterministicJson(baseEntity) === deterministicJson(resultEntity)
      ) {
        invalidEvidence(
          `Completion evidence ${evidence.kind}:${evidence.id} is unchanged from run base ${baseReference.snapshotId}@${baseReference.revision}.`,
        );
      }
    }
  }

  private async exactSnapshot(
    label: "Base" | "Result",
    reference: EngineeringThreadSnapshotRef,
  ): Promise<ThreadSnapshot> {
    const snapshot = await this.snapshots.get(reference.snapshotId);
    if (!snapshot) {
      invalidEvidence(
        `${label} ThreadSnapshot ${reference.snapshotId}@${reference.revision} is not readable from the exact snapshot stores.`,
      );
    }
    if (
      snapshot.id !== reference.snapshotId ||
      snapshot.revision !== reference.revision ||
      snapshot.subject.id !== reference.subjectId
    ) {
      invalidEvidence(
        `${label} ThreadSnapshot ${reference.snapshotId} does not match revision ${reference.revision} and subject ${reference.subjectId}.`,
      );
    }
    return snapshot;
  }
}

/**
 * Fail-closed proof for a non-provider reconciliation: the named closeout
 * snapshot must already be persisted and extend the exact completed successor
 * by one immutable revision.  It intentionally does not validate evidence;
 * that evidence was already validated when the successor run completed.
 */
export class ExactThreadReconciliationSnapshotValidator
  implements EngineeringProjectReconciliationSnapshotValidator {
  constructor(private readonly snapshots: ExactThreadSnapshotReader) {}

  async validate(
    successorRunReference: EngineeringThreadSnapshotRef,
    successorReference: EngineeringThreadSnapshotRef,
  ): Promise<void> {
    const [runSnapshot, closeoutSnapshot] = await Promise.all([
      exactSnapshot(this.snapshots, "Successor result", successorRunReference),
      exactSnapshot(this.snapshots, "Closeout", successorReference),
    ]);
    if (
      closeoutSnapshot.previous?.snapshotId !== runSnapshot.id ||
      closeoutSnapshot.previous.revision !== runSnapshot.revision
    ) {
      invalidEvidence(
        `Closeout ThreadSnapshot ${successorReference.snapshotId}@${successorReference.revision} is not the direct child of successor result ${successorRunReference.snapshotId}@${successorRunReference.revision}.`,
      );
    }
  }

  async validateCurrentHeadDescendsFrom(
    currentHeadReference: EngineeringThreadSnapshotRef,
    ancestorReference: EngineeringThreadSnapshotRef,
  ): Promise<void> {
    const [currentHead, ancestor] = await Promise.all([
      exactSnapshot(this.snapshots, "Current project head", currentHeadReference),
      exactSnapshot(this.snapshots, "Successor result", ancestorReference),
    ]);
    if (!await threadSnapshotDescendsFrom(currentHead, ancestor, this.snapshots)) {
      invalidEvidence(
        `Current project head ${currentHeadReference.snapshotId}@${currentHeadReference.revision} does not descend from successor result ${ancestorReference.snapshotId}@${ancestorReference.revision}.`,
      );
    }
  }
}

async function exactSnapshot(
  snapshots: ExactThreadSnapshotReader,
  label: string,
  reference: EngineeringThreadSnapshotRef,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.get(reference.snapshotId);
  if (!snapshot) {
    invalidEvidence(
      `${label} ThreadSnapshot ${reference.snapshotId}@${reference.revision} is not readable from the exact snapshot stores.`,
    );
  }
  if (
    snapshot.id !== reference.snapshotId || snapshot.revision !== reference.revision ||
    snapshot.subject.id !== reference.subjectId
  ) {
    invalidEvidence(
      `${label} ThreadSnapshot ${reference.snapshotId} does not match revision ${reference.revision} and subject ${reference.subjectId}.`,
    );
  }
  return snapshot;
}

function threadEntity(
  snapshot: ThreadSnapshot,
  reference: EngineeringThreadEntityRef,
): unknown | undefined {
  switch (reference.kind) {
    case "artifact":
      return snapshot.artifacts.find((item) => item.id === reference.id);
    case "consumption":
      return snapshot.consumptions.find((item) => item.id === reference.id);
    case "observation":
      return snapshot.observations.find((item) => item.id === reference.id);
    case "requirement":
      return snapshot.requirements.find((item) => item.id === reference.id);
    case "evaluation":
      return snapshot.evaluations.find((item) => item.id === reference.id);
    case "violation":
      return snapshot.violations.find((item) => item.id === reference.id);
    case "change":
      return snapshot.changeSet.changes.find((item) => item.id === reference.id);
    case "action":
      return snapshot.proposedActions.find((item) => item.id === reference.id);
  }
}

function invalidEvidence(message: string): never {
  throw new EngineeringProjectCommandError("invalid_input", message);
}
