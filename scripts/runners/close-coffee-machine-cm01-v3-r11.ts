import { FileEngineeringProjectRevisionStore } from "../../src/adapters/stores/engineering-project-store.ts";
import { ExactThreadReconciliationSnapshotValidator } from "../../src/adapters/validators/engineering-project-completion-evidence-validator.ts";
import { FileThreadSnapshotStore } from "../../src/adapters/stores/file-thread-snapshot-store.ts";
import {
  assertR12RequirementFamilyCloseout,
  CM01_V3_PROJECT_ID,
  CM01_V3_R12_REQUIREMENT_CLOSEOUT_EXTENSION_ID,
  inspectCoffeeMachineCm01V3R11Closeout,
  materializeCoffeeMachineCm01V3R12RequirementCloseout,
} from "../../src/domain/cm01/cm01-v3-r11-closeout.ts";
import {
  deriveEngineeringProjectStatus,
  type EngineeringThreadSnapshotRef,
} from "../../src/domain/project/engineering-project.ts";
import {
  EngineeringProjectCommandService,
} from "../../src/domain/project/engineering-project-command-service.ts";
import { validateThreadSnapshot } from "../../src/domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../src/domain/thread/thread-snapshot-store.ts";

/** Explicit consent for the provider-free, immutable R11 -> R12 closeout. */
export const CM01_V3_R11_CLOSEOUT_ACKNOWLEDGEMENT =
  "CLOSE_CM01_V3_R11_REQUIREMENT_FAMILY" as const;

const PROJECT_DIRECTORY = "state/local/engineering-projects";
const SNAPSHOT_DIRECTORY = "state/local/thread-snapshots";
const APPLIED_AT = "2026-08-03T14:00:00.000Z";
const COMMAND_ID = "cm01-v3-r11-r12-reconcile-failed-r2";
const ACTOR = { kind: "agent" as const, actorId: "script:cm01-v3-r11-closeout" };

export interface CloseCoffeeMachineCm01V3R11Options {
  readonly execute?: boolean;
  readonly acknowledgement?: string;
  readonly projectDirectory?: string;
  readonly snapshotDirectory?: string;
}

export type CloseCoffeeMachineCm01V3R11Result =
  | {
    readonly status: "confirmation-required";
    readonly acknowledgement: typeof CM01_V3_R11_CLOSEOUT_ACKNOWLEDGEMENT;
    readonly note: string;
  }
  | {
    readonly status: "completed" | "already-completed";
    readonly projectRevision: number;
    readonly snapshot: EngineeringThreadSnapshotRef;
    readonly note: string;
  };

/**
 * Close the one retained CM-01 R2 failure without rerunning anything.
 *
 * It reads only the immutable canonical local project/R11 snapshot, creates
 * the deterministic R12 requirement-family extension, saves and rereads it,
 * then appends the project reconciliation revision. No MCP client, provider,
 * network request, or evidence fabrication is involved.
 */
export async function closeCoffeeMachineCm01V3R11(
  options: CloseCoffeeMachineCm01V3R11Options = {},
): Promise<CloseCoffeeMachineCm01V3R11Result> {
  if (!options.execute) {
    return {
      status: "confirmation-required",
      acknowledgement: CM01_V3_R11_CLOSEOUT_ACKNOWLEDGEMENT,
      note:
        "This saves the code-derived R12 requirement-family closeout and reconciles the retained evidence-free R2 failure to the completed R3 successor. It does not run a provider.",
    };
  }
  if (options.acknowledgement !== CM01_V3_R11_CLOSEOUT_ACKNOWLEDGEMENT) {
    throw new Error(
      `Refusing CM-01 R11 closeout without --acknowledge=${CM01_V3_R11_CLOSEOUT_ACKNOWLEDGEMENT}.`,
    );
  }

  const projects = new FileEngineeringProjectRevisionStore(
    options.projectDirectory ?? PROJECT_DIRECTORY,
  );
  const snapshots = new FileThreadSnapshotStore(
    options.snapshotDirectory ?? SNAPSHOT_DIRECTORY,
  );
  const project = await projects.get(CM01_V3_PROJECT_ID);
  if (!project) throw new Error("Canonical CM-01 V3 project is absent.");
  const closeout = inspectCoffeeMachineCm01V3R11Closeout(project);

  if (closeout.status === "closed") {
    const snapshot = await requireExactSnapshot(snapshots, closeout.successorSnapshot);
    assertR12RequirementFamilyCloseout(snapshot);
    assertCompleted(project, closeout.successorSnapshot);
    return {
      status: "already-completed",
      projectRevision: project.revision,
      snapshot: closeout.successorSnapshot,
      note:
        "CM-01 R2 remains failed history; its exact completed R3 successor is already reconciled.",
    };
  }

  const r11 = await requireExactSnapshot(snapshots, closeout.successorRunSnapshot);
  const r12 = materializeCoffeeMachineCm01V3R12RequirementCloseout(r11, APPLIED_AT);
  validateThreadSnapshot(r12);
  assertR12RequirementFamilyCloseout(r12);
  await snapshots.save(r12);
  const r12Reference = {
    snapshotId: r12.id,
    revision: r12.revision,
    subjectId: r12.subject.id,
  };
  await requireExactSnapshot(snapshots, r12Reference);

  const commands = new EngineeringProjectCommandService(
    projects,
    undefined,
    () => APPLIED_AT,
    undefined,
    undefined,
    new ExactThreadReconciliationSnapshotValidator(snapshots),
  );
  const reconciled = await commands.reconcileWorkItemWithSuccessor(ACTOR, {
    commandId: COMMAND_ID,
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: APPLIED_AT,
    failedWorkItemId: closeout.failedWorkItemId,
    failedRunId: closeout.failedRunId,
    successorRunId: closeout.successorRunId,
    successorRunSnapshot: closeout.successorRunSnapshot,
    successorSnapshot: r12Reference,
    successorEvidenceRefs: closeout.successorEvidenceRefs,
    rationale:
      "R2 remains an evidence-free failed attempt. The completed R3 recovery carries the exact durable solve; R12 records the explicit R1/R2/R3 requirement-family closure.",
  });
  const closed = inspectCoffeeMachineCm01V3R11Closeout(reconciled);
  if (closed.status !== "closed") {
    throw new Error("CM-01 R11 closeout did not persist its successor reconciliation.");
  }
  assertCompleted(reconciled, closed.successorSnapshot);
  const storedR12 = await requireExactSnapshot(snapshots, closed.successorSnapshot);
  assertR12RequirementFamilyCloseout(storedR12);
  if (!storedR12.id.includes(CM01_V3_R12_REQUIREMENT_CLOSEOUT_EXTENSION_ID)) {
    throw new Error("CM-01 closeout did not retain the code-owned R12 extension.");
  }
  return {
    status: "completed",
    projectRevision: reconciled.revision,
    snapshot: closed.successorSnapshot,
    note:
      "R2 remains failed history; R12 explicitly connects the fresh R3 evidence to the stale R1 criteria through R2.",
  };
}

async function requireExactSnapshot(
  snapshots: ThreadSnapshotStore,
  reference: EngineeringThreadSnapshotRef,
) {
  const snapshot = await snapshots.get(reference.snapshotId);
  if (
    !snapshot || snapshot.revision !== reference.revision ||
    snapshot.subject.id !== reference.subjectId
  ) {
    throw new Error(`Exact declared ThreadSnapshot ${reference.snapshotId} is absent.`);
  }
  return snapshot;
}

function assertCompleted(
  project: Parameters<typeof deriveEngineeringProjectStatus>[0],
  snapshot: EngineeringThreadSnapshotRef,
): void {
  if (deriveEngineeringProjectStatus(project) !== "completed") {
    throw new Error("CM-01 closeout did not derive a completed engineering project.");
  }
  if (
    !project.threadSnapshots.some((item) =>
      item.snapshotId === snapshot.snapshotId && item.revision === snapshot.revision &&
      item.subjectId === snapshot.subjectId
    )
  ) {
    throw new Error(
      "CM-01 completed project does not declare its R12 closeout snapshot.",
    );
  }
}

if (import.meta.main) {
  const result = await closeCoffeeMachineCm01V3R11({
    execute: Deno.args.includes("--execute"),
    acknowledgement: Deno.args.find((value) => value.startsWith("--acknowledge="))
      ?.slice("--acknowledge=".length),
  });
  console.log(JSON.stringify(result, null, 2));
}
