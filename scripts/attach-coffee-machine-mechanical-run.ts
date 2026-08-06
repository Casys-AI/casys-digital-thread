import { parseArgs, stableId } from "./cli.ts";
import { FileLiveThreadUpdateStore } from "../src/adapters/stores/live-thread-update-store.ts";
import type { LiveThreadUpdateJournal } from "../src/adapters/stores/live-thread-update-store.ts";
import { FileThreadSnapshotStore } from "../src/adapters/stores/file-thread-snapshot-store.ts";
import { threadSnapshotDescendsFrom } from "../src/adapters/stores/thread-snapshot-lineage.ts";
import { FileEngineeringProjectRevisionStore } from "../src/adapters/stores/engineering-project-store.ts";
import {
  COFFEE_MACHINE_MECHANICAL_SUBJECT_ID,
  materializeCoffeeMachineMechanicalRunExtension,
} from "../src/adapters/historical/coffee-machine-mechanical-run-extension.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../src/domain/kernel/deterministic-json.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
} from "../src/domain/project/engineering-project.ts";
import type { ThreadSnapshotStore } from "../src/domain/thread-snapshot-store.ts";
import type { ThreadSnapshot } from "../src/domain/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../src/domain/thread-snapshot-extension.ts";

type MechanicalMaterializer = typeof materializeCoffeeMachineMechanicalRunExtension;

const DECISION_ID = "review-mechanical-proof-case";
const WORK_ITEM_ID = "verify-current-mechanical-design";
const SHA256 = /^[a-f0-9]{64}$/;

export interface MechanicalPublicationSnapshotStore extends ThreadSnapshotStore {
  pathFor(snapshotId: string): string;
}

export interface MechanicalPublicationProjectStore {
  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined>;
}

export interface AttachCoffeeMachineMechanicalOptions {
  readonly runId: string;
  readonly capturePath?: string;
  readonly snapshotDirectory?: string;
  readonly projectDirectory?: string;
  readonly liveUpdateDirectory?: string;
  readonly subjectId?: string;
  readonly now?: () => Date;
  /** Test seam; production uses the immutable file snapshot store. */
  readonly snapshotStore?: MechanicalPublicationSnapshotStore;
  /** Test seam; production resolves the exact immutable project revision. */
  readonly projectStore?: MechanicalPublicationProjectStore;
  /** Test seam; production reads the deterministic persisted run capture. */
  readonly readCapture?: (path: string) => Promise<string>;
  /** Test seam; production always uses the strict capture materializer. */
  readonly materialize?: MechanicalMaterializer;
  /** Test seam; production reconciles the file-backed live journal. */
  readonly liveUpdates?: LiveThreadUpdateJournal;
}

export interface AttachCoffeeMachineMechanicalResult {
  readonly runId: string;
  readonly applied: boolean;
  readonly snapshot: ThreadSnapshot;
  readonly resultSnapshot: EngineeringThreadSnapshotRef;
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly path: string;
}

/**
 * Publish one reviewed CM-01 mechanical capture into the canonical thread.
 *
 * The canonical snapshot is saved and read back before the provisional live
 * feed is reconciled. Project run publication/completion deliberately remains
 * a separate, human-visible MCP command owned by the project control plane.
 */
export async function attachCoffeeMachineMechanicalRun(
  options: AttachCoffeeMachineMechanicalOptions,
): Promise<AttachCoffeeMachineMechanicalResult> {
  const runId = stableId(options.runId, "runId");
  const subjectId = stableId(
    options.subjectId ?? COFFEE_MACHINE_MECHANICAL_SUBJECT_ID,
    "subjectId",
  );
  if (subjectId !== COFFEE_MACHINE_MECHANICAL_SUBJECT_ID) {
    throw new Error(
      `The coffee-machine mechanical publisher only targets ${COFFEE_MACHINE_MECHANICAL_SUBJECT_ID}.`,
    );
  }
  const capturePath = options.capturePath ??
    `state/local/coffee-machine-mechanical-runs/${runId}.json`;
  const snapshotStore = options.snapshotStore ?? new FileThreadSnapshotStore(
    options.snapshotDirectory ?? "state/local/thread-snapshots",
  );
  const base = await snapshotStore.latest(subjectId);
  if (!base) throw new Error(`No canonical ThreadSnapshot for ${subjectId}.`);

  const capture: unknown = JSON.parse(
    await (options.readCapture ?? Deno.readTextFile)(capturePath),
  );
  const projectStore = options.projectStore ??
    new FileEngineeringProjectRevisionStore(
      options.projectDirectory ?? "state/local/engineering-projects",
    );
  await assertCaptureAuthority(capture, runId, projectStore);
  const extension = await (
    options.materialize ?? materializeCoffeeMachineMechanicalRunExtension
  )(capture, { runId, sourceUri: capturePath });
  const authorizedBase = runBaseReference(capture);
  const exactRunBase = await snapshotStore.get(authorizedBase.snapshotId);
  if (
    !exactRunBase ||
    exactRunBase.id !== authorizedBase.snapshotId ||
    exactRunBase.revision !== authorizedBase.revision ||
    exactRunBase.subject.id !== authorizedBase.subjectId
  ) {
    throw new Error(
      `Authorized run base ${authorizedBase.snapshotId}@${authorizedBase.revision} is not readable exactly.`,
    );
  }
  if (!await threadSnapshotDescendsFrom(base, exactRunBase, snapshotStore)) {
    throw new Error(
      `Current canonical head ${base.id}@${base.revision} does not descend from authorized run base ${exactRunBase.id}@${exactRunBase.revision}.`,
    );
  }

  const result = applyThreadSnapshotExtensionIfNew(base, extension, {
    appliedAt: extension.capturedAt,
  });
  if (result.applied) {
    if (Date.parse(extension.capturedAt) < Date.parse(base.generatedAt)) {
      throw new Error(
        `Mechanical extension ${extension.id} captured at ${extension.capturedAt} predates current canonical head ${base.id} generated at ${base.generatedAt}.`,
      );
    }
    await snapshotStore.save(result.snapshot);
    const persisted = await snapshotStore.get(result.snapshot.id);
    if (
      !persisted || deterministicJson(persisted) !== deterministicJson(result.snapshot)
    ) {
      throw new Error(
        `Canonical ThreadSnapshot ${result.snapshot.id} was not durably readable after save.`,
      );
    }
  } else {
    assertExtensionMatchesSnapshot(result.snapshot, extension);
  }

  // Never retire provisional activity until exact canonical evidence exists.
  const liveUpdates = options.liveUpdates ?? new FileLiveThreadUpdateStore(
    options.liveUpdateDirectory ?? "state/local/live-thread-updates",
  );
  const reconciledAt = validDate(
    (options.now ?? (() => new Date()))(),
    "now",
  ).toISOString();
  await liveUpdates.reconcileRun(subjectId, runId, reconciledAt);

  const resultSnapshot: EngineeringThreadSnapshotRef = {
    snapshotId: result.snapshot.id,
    revision: result.snapshot.revision,
    subjectId: result.snapshot.subject.id,
  };
  return {
    runId,
    applied: result.applied,
    snapshot: result.snapshot,
    resultSnapshot,
    evidenceRefs: extensionEvidenceRefs(result.snapshot, extension),
    path: snapshotStore.pathFor(result.snapshot.id),
  };
}

export function extensionEvidenceRefs(
  snapshot: ThreadSnapshot,
  extension: ThreadSnapshotExtension,
): EngineeringThreadEntityRef[] {
  const reference = (
    kind: EngineeringThreadEntityRef["kind"],
    id: string,
  ): EngineeringThreadEntityRef => ({
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind,
    id,
  });
  return [
    ...extension.artifacts.map((item) => reference("artifact", item.id)),
    ...extension.consumptions.map((item) => reference("consumption", item.id)),
    ...extension.observations.map((item) => reference("observation", item.id)),
    ...extension.requirements.map((item) => reference("requirement", item.id)),
    ...extension.evaluations.map((item) => reference("evaluation", item.id)),
    ...extension.violations.map((item) => reference("violation", item.id)),
    ...extension.proposedActions.map((item) => reference("action", item.id)),
  ];
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const runId = args["run-id"];
  if (!runId) throw new Error("--run-id is required.");
  const result = await attachCoffeeMachineMechanicalRun({
    runId,
    capturePath: args["capture"],
    snapshotDirectory: args["snapshot-dir"],
    projectDirectory: args["project-dir"],
    liveUpdateDirectory: args["live-update-dir"],
    subjectId: args["subject"],
  });
  console.log(JSON.stringify(
    {
      runId: result.runId,
      applied: result.applied,
      resultSnapshot: result.resultSnapshot,
      evidenceRefs: result.evidenceRefs,
      path: result.path,
      projectLifecycleTransitioned: false,
    },
    null,
    2,
  ));
}

async function assertCaptureAuthority(
  value: unknown,
  expectedRunId: string,
  store: MechanicalPublicationProjectStore,
): Promise<void> {
  const capture = record(value, "$capture");
  const projectRef = captureProjectReference(capture.project);
  const project = await store.getRevision(projectRef.projectId, projectRef.revision);
  if (
    !project || project.project.id !== projectRef.projectId ||
    project.id !== projectRef.snapshotId || project.revision !== projectRef.revision
  ) {
    throw new Error(
      `Capture project ${projectRef.projectId}:${projectRef.snapshotId}@${projectRef.revision} is not readable exactly.`,
    );
  }
  const authorization = captureAuthorization(capture.authorization);

  const decisions = project.decisions.filter((item) => item.id === DECISION_ID);
  const decision = decisions[0];
  if (
    decisions.length !== 1 || !decision || decision.status !== "approved" ||
    !decision.proposal || !decision.baseSnapshot || !decision.inputFingerprint
  ) {
    throw new Error(
      "Immutable project has no unique exactly approved mechanical decision.",
    );
  }
  if (
    deterministicJson({
      summary: decision.proposal.summary,
      parameters: decision.proposal.parameters,
    }) !== deterministicJson(authorization.approvedProposal)
  ) {
    throw new Error(
      "Capture approved proposal does not match the immutable project decision.",
    );
  }
  if (
    !fingerprintsEqual(
      decision.inputFingerprint,
      fingerprint(authorization.decisionInputFingerprint),
    )
  ) {
    throw new Error(
      "Capture decision fingerprint does not match the immutable project decision.",
    );
  }
  if (
    deterministicJson(decision.inputEvidenceRefs) !==
      deterministicJson(authorization.inputEvidenceRefs)
  ) {
    throw new Error(
      "Capture input evidence does not match the immutable project decision.",
    );
  }
  if (
    deterministicJson(decision.baseSnapshot) !==
      deterministicJson(authorization.baseSnapshot)
  ) {
    throw new Error(
      "Capture base snapshot does not match the immutable project decision.",
    );
  }
  const recomputedDecision = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal.summary,
      parameters: decision.proposal.parameters,
    },
  });
  if (!fingerprintsEqual(decision.inputFingerprint, recomputedDecision)) {
    throw new Error(
      "Immutable project decision fingerprint does not bind its exact proposal.",
    );
  }

  const approvals = project.approvals.filter((approval) =>
    decision.approvalIds.includes(approval.id) &&
    approval.decisionId === decision.id && approval.status === "approved" &&
    approval.decidedByOrigin === "human" &&
    approval.decidedBy === authorization.approvedBy &&
    fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint) &&
    deterministicJson(approval.baseSnapshot) ===
      deterministicJson(decision.baseSnapshot) &&
    deterministicJson(approval.inputEvidenceRefs) ===
      deterministicJson(decision.inputEvidenceRefs)
  );
  if (approvals.length !== 1) {
    throw new Error(
      "Capture has no unique exact human approval receipt in the immutable project.",
    );
  }

  const workItems = project.workItems.filter((item) => item.id === WORK_ITEM_ID);
  const workItem = workItems[0];
  if (
    workItems.length !== 1 || !workItem || workItem.status !== "in-progress" ||
    deterministicJson(workItem.decisionIds) !== deterministicJson([DECISION_ID])
  ) {
    throw new Error(
      "Immutable project has no unique in-progress mechanical work item bound to the reviewed decision.",
    );
  }

  const runs = project.agentRuns.filter((item) => item.id === expectedRunId);
  const run = runs[0];
  if (
    runs.length !== 1 || !run || run.workItemId !== workItem.id ||
    run.status !== "running" || !run.baseSnapshot || !run.inputFingerprint ||
    !run.claimedAt || !run.claimedBy || run.claimedBy.origin !== "agent" ||
    run.claimedBy.id !== authorization.claimedBy
  ) {
    throw new Error(
      "Capture has no exact running agent claim in the immutable project.",
    );
  }
  if (
    deterministicJson(run.baseSnapshot) !==
      deterministicJson(authorization.baseSnapshot)
  ) {
    throw new Error(
      "Capture run base does not match the immutable project run.",
    );
  }
  if (
    !fingerprintsEqual(
      run.inputFingerprint,
      fingerprint(authorization.runInputFingerprint),
    )
  ) {
    throw new Error(
      "Capture run fingerprint does not match the immutable project run.",
    );
  }
  const recomputedRun = await sha256Fingerprint({
    workItemId: workItem.id,
    baseSnapshot: run.baseSnapshot,
    decisionBindings: [{
      id: decision.id,
      inputFingerprint: decision.inputFingerprint,
    }],
  });
  if (!fingerprintsEqual(run.inputFingerprint, recomputedRun)) {
    throw new Error(
      "Immutable project run fingerprint does not bind the reviewed decision.",
    );
  }
  const queued =
    run.statusHistory?.filter((transition) =>
      transition.status === "queued" && transition.at === run.queuedAt &&
      transition.actor.origin === "human" &&
      transition.actor.id === authorization.queuedBy
    ) ?? [];
  const claimed =
    run.statusHistory?.filter((transition) =>
      transition.status === "running" && transition.at === run.claimedAt &&
      transition.actor.origin === "agent" &&
      transition.actor.id === authorization.claimedBy
    ) ?? [];
  if (queued.length !== 1) {
    throw new Error(
      "Capture queuedBy has no exact human queue receipt in the immutable project.",
    );
  }
  if (claimed.length !== 1) {
    throw new Error(
      "Capture claimedBy has no exact agent claim receipt in the immutable project.",
    );
  }
}

interface CaptureProjectReference {
  projectId: string;
  snapshotId: string;
  revision: number;
}

interface CaptureAuthorization {
  decisionInputFingerprint: string;
  approvedBy: string;
  approvedProposal: Record<string, unknown>;
  inputEvidenceRefs: unknown[];
  runInputFingerprint: string;
  queuedBy: string;
  claimedBy: string;
  baseSnapshot: EngineeringThreadSnapshotRef;
}

function captureProjectReference(value: unknown): CaptureProjectReference {
  const project = record(value, "$capture.project");
  exactKeys(project, ["id", "snapshotId", "revision"], "$capture.project");
  return {
    projectId: nonEmpty(project.id, "$capture.project.id"),
    snapshotId: nonEmpty(project.snapshotId, "$capture.project.snapshotId"),
    revision: positiveInteger(project.revision, "$capture.project.revision"),
  };
}

function captureAuthorization(value: unknown): CaptureAuthorization {
  const authorization = record(value, "$capture.authorization");
  exactKeys(authorization, [
    "decisionId",
    "decisionInputFingerprint",
    "approvedBy",
    "approvedProposal",
    "inputEvidenceRefs",
    "runInputFingerprint",
    "queuedBy",
    "claimedBy",
    "baseSnapshotId",
    "baseSnapshotRevision",
    "baseSnapshotSubjectId",
  ], "$capture.authorization");
  if (authorization.decisionId !== DECISION_ID) {
    throw new Error(`$capture.authorization.decisionId must equal ${DECISION_ID}.`);
  }
  if (!Array.isArray(authorization.inputEvidenceRefs)) {
    throw new TypeError("$capture.authorization.inputEvidenceRefs must be an array.");
  }
  return {
    decisionInputFingerprint: digest(
      authorization.decisionInputFingerprint,
      "$capture.authorization.decisionInputFingerprint",
    ),
    approvedBy: nonEmpty(
      authorization.approvedBy,
      "$capture.authorization.approvedBy",
    ),
    approvedProposal: structuredClone(record(
      authorization.approvedProposal,
      "$capture.authorization.approvedProposal",
    )),
    inputEvidenceRefs: structuredClone(authorization.inputEvidenceRefs),
    runInputFingerprint: digest(
      authorization.runInputFingerprint,
      "$capture.authorization.runInputFingerprint",
    ),
    queuedBy: nonEmpty(
      authorization.queuedBy,
      "$capture.authorization.queuedBy",
    ),
    claimedBy: nonEmpty(
      authorization.claimedBy,
      "$capture.authorization.claimedBy",
    ),
    baseSnapshot: {
      snapshotId: nonEmpty(
        authorization.baseSnapshotId,
        "$capture.authorization.baseSnapshotId",
      ),
      revision: positiveInteger(
        authorization.baseSnapshotRevision,
        "$capture.authorization.baseSnapshotRevision",
      ),
      subjectId: nonEmpty(
        authorization.baseSnapshotSubjectId,
        "$capture.authorization.baseSnapshotSubjectId",
      ),
    },
  };
}

function fingerprint(digest: string) {
  return { algorithm: "sha256" as const, digest };
}

function digest(value: unknown, path: string): string {
  const result = nonEmpty(value, path);
  if (!SHA256.test(result)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return result;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (deterministicJson(actual) !== deterministicJson(wanted)) {
    throw new TypeError(`${path} must contain exactly: ${wanted.join(", ")}.`);
  }
}

function runBaseReference(value: unknown): EngineeringThreadSnapshotRef {
  const capture = record(value, "$capture");
  const authorization = record(capture.authorization, "$capture.authorization");
  return {
    snapshotId: nonEmpty(
      authorization.baseSnapshotId,
      "$capture.authorization.baseSnapshotId",
    ),
    revision: positiveInteger(
      authorization.baseSnapshotRevision,
      "$capture.authorization.baseSnapshotRevision",
    ),
    subjectId: nonEmpty(
      authorization.baseSnapshotSubjectId,
      "$capture.authorization.baseSnapshotSubjectId",
    ),
  };
}

function assertExtensionMatchesSnapshot(
  snapshot: ThreadSnapshot,
  extension: ThreadSnapshotExtension,
): void {
  const expected = [
    ["artifact", extension.artifacts, snapshot.artifacts],
    ["consumption", extension.consumptions, snapshot.consumptions],
    ["observation", extension.observations, snapshot.observations],
    ["requirement", extension.requirements, snapshot.requirements],
    ["evaluation", extension.evaluations, snapshot.evaluations],
    ["violation", extension.violations, snapshot.violations],
    ["provenance", extension.provenance, snapshot.provenance],
    ["action", extension.proposedActions, snapshot.proposedActions],
  ] as const;
  for (const [kind, branch, canonical] of expected) {
    for (const entity of branch) {
      const existing = canonical.find((candidate) => candidate.id === entity.id);
      if (!existing || deterministicJson(existing) !== deterministicJson(entity)) {
        throw new Error(
          `Canonical snapshot contains a missing or different ${kind}:${entity.id} for extension ${extension.id}.`,
        );
      }
    }
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive safe integer.`);
  }
  return Number(value);
}

function validDate(value: Date, label: string): Date {
  if (Number.isNaN(value.valueOf())) throw new TypeError(`${label} is invalid.`);
  return value;
}
