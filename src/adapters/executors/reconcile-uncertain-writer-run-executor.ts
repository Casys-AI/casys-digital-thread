/**
 * Trusted executor for the human-only `record.reconcile-uncertain-writer@1`
 * operation.
 *
 * WHY HUMAN-ONLY — a terminal uncertain failure means the executor crashed
 * after the provider acknowledged a write but before the ThreadSnapshot was
 * published.  The only way to know whether the provider actually wrote is for
 * a human to inspect the provider directly.  No agent can do this.
 *
 * WHY NO WAL, NO PROVIDER, NO ThreadSnapshot — the reconciliation is a
 * project-level state mutation: it annotates the failed run and completes the
 * reconciliation work item.  No provider call is made, no thread revision is
 * created.  The single atomic write goes through `commands.reconcileAnnotationRun`,
 * which enforces all domain invariants via the normal `apply()` path.
 *
 * SEQUENCE
 *  1. Gate: origin must be "human".
 *  2. requireShape: checks operation id/version on the work item.
 *  3. requireMrtrApproval: finds a human-approved decision in the work item's
 *     decisionIds whose proposal parameters name the exact failedRunId,
 *     failureCode, basisSnapshotId, outcome and providerInspectionAttestation.
 *  4. Validate the target failed run: must be failed, terminal-uncertain (or
 *     geometry), no existing reconciliation, empty evidenceRefs.
 *  5. commands.reconcileAnnotationRun — single atomic write.
 *  6. CAS readback.
 *
 * FAILLE RÉSIDUELLE — a human can sign an MRTR with a fictitious attestation.
 * The protection is the same as for every MRTR mechanism: the attestation is
 * documented in the project's immutable history; an auditor can detect a
 * suspicious sequence.  For "write-effect-accepted", a blocker is opened to
 * force a second conscious decision before any re-run.
 */

import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringAgentRunUncertainWriterReconciliation,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
} from "../../domain/project/engineering-project.ts";
import {
  GEOMETRY_WRITE_OPERATION,
  TERMINAL_THREAD_WRITE_FAILURES,
} from "./thread-write-basis-guard.ts";
import { requireBasis, requireRun } from "./executor-run-helpers.ts";
import { fingerprintsEqual } from "../../domain/kernel/deterministic-json.ts";

// ---------------------------------------------------------------------------
// Public constants — operation identity
// ---------------------------------------------------------------------------

/**
 * The exact reviewed operation this executor is bound to.
 *
 * WHY EXPORTED — server.ts must register the same identity object in the
 * `additional` array of `RegisteredProjectRunExecutor`.
 */
export const RECONCILE_UNCERTAIN_WRITER_OPERATION = {
  id: "record.reconcile-uncertain-writer",
  version: "1",
} as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReconcileUncertainWriterRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface ReconcileUncertainWriterRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly now?: () => string;
}

// ---------------------------------------------------------------------------
// Public: executor
// ---------------------------------------------------------------------------

export class ReconcileUncertainWriterRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #now: () => string;

  constructor(dependencies: ReconcileUncertainWriterRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: ReconcileUncertainWriterRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    // 1. Human-only gate.
    if (origin.kind !== "human") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only a human operator can execute the reconcile-uncertain-writer run.  " +
          "An agent cannot inspect a provider.",
      );
    }

    // 2. Pre-lease shape validation (project read before claim).
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);

    // 3. Extract MRTR-approved decision and resolve the target failed run.
    const workItem = project.workItems.find((item) => item.id === run.workItemId)!;
    const { approval, proposal } = requireMrtrApproval(project, run, workItem);

    const failedRunId = requireProposalParam(proposal, "reconcileRunId");
    const expectedFailureCode = requireProposalParam(proposal, "reconcileFailureCode");
    const expectedBasisSnapshotId = requireProposalParam(
      proposal,
      "reconcileBasisSnapshotId",
    );
    const outcome = requireProposalParam(
      proposal,
      "reconcileOutcome",
    ) as "provider-did-not-write" | "write-effect-accepted";
    if (outcome !== "provider-did-not-write" && outcome !== "write-effect-accepted") {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `MRTR reconcileOutcome must be "provider-did-not-write" or "write-effect-accepted"; ` +
          `got "${outcome}".`,
      );
    }
    const providerInspectionAttestation = requireProposalParam(
      proposal,
      "reconcileAttestation",
    );

    // 4. Validate the target failed run.
    const failedRun = requireRun(project, failedRunId);
    if (failedRun.status !== "failed" || !failedRun.failure) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Target run ${failedRunId} must be in failed status with a structured failure.`,
      );
    }
    if (failedRun.failure.code !== expectedFailureCode) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `MRTR names failure code "${expectedFailureCode}" but the target run has ` +
          `"${failedRun.failure.code}".  The MRTR must name the exact failure code.`,
      );
    }
    if (!isEligibleForReconciliation(project, failedRun, expectedFailureCode)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Target run ${failedRunId} failure code "${failedRun.failure.code}" is not in ` +
          "TERMINAL_THREAD_WRITE_FAILURES and is not the geometry write operation.  " +
          "Only terminal-uncertain failures are eligible for reconciliation.",
      );
    }
    if (failedRun.uncertainWriterReconciliation !== undefined) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Target run ${failedRunId} already has an uncertainWriterReconciliation.  ` +
          "A run can be reconciled only once.",
      );
    }
    if (failedRun.evidenceRefs.length !== 0) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Target run ${failedRunId} has evidence refs; uncertain writer reconciliation ` +
          "is not applicable to runs that produced evidence.",
      );
    }

    // Verify the basis snapshot named in the MRTR matches the failed run's basis.
    const failedRunBasis = requireBasis(failedRun);
    if (failedRunBasis.snapshotId !== expectedBasisSnapshotId) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `MRTR names basis snapshot "${expectedBasisSnapshotId}" but the target run has ` +
          `basis snapshot "${failedRunBasis.snapshotId}".  ` +
          "The MRTR must name the exact basis snapshot.",
      );
    }

    // 5. Build the reconciliation annotation from the approved MRTR.
    const reconciliation: EngineeringAgentRunUncertainWriterReconciliation = {
      kind: "uncertain-writer-resolved",
      outcome,
      reconciledAt: this.#now(),
      reconciledBy: { id: origin.actorId, origin: origin.kind },
      decisionId: approval.decisionId,
      providerInspectionAttestation,
    };

    // 6. Prepare the optional blocker for "write-effect-accepted".
    // phaseId is omitted: the domain derives it from the failed work item,
    // preventing the reconciliation run's phase from being used by accident.
    const openBlocker = outcome === "write-effect-accepted"
      ? {
        id: `blocker:uncertain-write-accepted:${command.runId}`,
        title: "Uncertain provider write accepted — review before re-run",
        description:
          `Run ${failedRunId} was reconciled with outcome "write-effect-accepted": ` +
          "the provider may have produced output that was not captured in the thread.  " +
          "Review the provider state and resolve this blocker before queuing a new run " +
          "from the same basis.",
      }
      : undefined;

    // 7. Single atomic write — no WAL, no ThreadSnapshot.
    await this.#commands.reconcileAnnotationRun(origin, {
      commandId: command.commandId,
      projectId: command.projectId,
      expectedRevision: command.expectedRevision,
      issuedAt: command.issuedAt,
      reconciliationRunId: command.runId,
      failedRunId,
      reconciliation,
      openBlocker,
    });

    // 8. CAS readback.
    const result = await this.#requiredProject(command.projectId);
    assertCompleted(result, command);
    return result;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  async #requiredProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }
}

// ---------------------------------------------------------------------------
// Private: shape validation
// ---------------------------------------------------------------------------

const RECONCILE_OP = RECONCILE_UNCERTAIN_WRITER_OPERATION;

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  if (
    project.schemaVersion !== "3.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== RECONCILE_OP.id ||
    operation.version !== RECONCILE_OP.version
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical record.reconcile-uncertain-writer@1 operation.",
    );
  }
}

// ---------------------------------------------------------------------------
// Private: MRTR approval gate
// ---------------------------------------------------------------------------

interface ApprovedMrtr {
  readonly approval: { readonly decisionId: string };
  readonly proposal: ReadonlyMap<string, string | number | boolean>;
}

/**
 * Finds exactly one human-approved MRTR decision for the reconciliation run.
 *
 * WHY EXACTLY ONE — the reconciliation is a singular audit event.  Multiple
 * matching approvals signal an ambiguous or replayed ceremony; neither is safe.
 *
 * WHY BASIS + FINGERPRINT — the approval must reference the same ThreadSnapshot
 * basis as the reconciliation run (preventing a stale approval from a previous
 * run from being reused) and the same input fingerprint as the decision
 * (preventing proposal substitution).
 */
function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  workItem: { readonly decisionIds: readonly string[] },
): ApprovedMrtr {
  const basis = requireBasis(run);
  const candidates: ApprovedMrtr[] = [];

  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((d) => d.id === decisionId);
    if (!decision || decision.status !== "approved" || !decision.proposal) continue;
    // Decision must be anchored to the same ThreadSnapshot basis as the run.
    if (!sameSnapshotBasis(decision.baseSnapshot, basis)) continue;
    // Decision must carry a fingerprint (unfingerprinted decisions are ineligible).
    if (!decision.inputFingerprint) continue;

    const params = new Map(
      decision.proposal.parameters.map((p) => [p.key, p.value]),
    );
    if (params.get("reconcileAction") !== "resolve-uncertain-writer") continue;
    if (
      params.get("reconcileOperation") !==
        `${RECONCILE_OP.id}@${RECONCILE_OP.version}`
    ) continue;

    // Find exactly one human approval whose basis and fingerprint match the decision.
    const exactHumanApprovals = project.approvals.filter((a) =>
      a.decisionId === decision.id &&
      a.status === "approved" &&
      a.decidedByOrigin === "human" &&
      sameSnapshotBasis(a.baseSnapshot, basis) &&
      fingerprintsEqual(a.inputFingerprint, decision.inputFingerprint)
    );
    if (exactHumanApprovals.length !== 1) continue;

    candidates.push({ approval: { decisionId }, proposal: params });
  }

  if (candidates.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "record.reconcile-uncertain-writer@1 requires exactly one human-approved MRTR decision " +
        "with reconcileAction=resolve-uncertain-writer, reconcileOperation=" +
        `${RECONCILE_OP.id}@${RECONCILE_OP.version}, matching basis snapshot, and matching ` +
        `input fingerprint in the work item's decisionIds; found ${candidates.length}.`,
    );
  }
  return candidates[0]!;
}

function sameSnapshotBasis(
  value: EngineeringThreadSnapshotRef | undefined,
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return value?.snapshotId === basis.snapshotId &&
    value?.revision === basis.revision &&
    value?.subjectId === basis.subjectId;
}

function requireProposalParam(
  params: ReadonlyMap<string, string | number | boolean>,
  key: string,
): string {
  const value = params.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `MRTR proposal is missing a non-empty string parameter "${key}".`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Private: terminal-uncertain eligibility check
// ---------------------------------------------------------------------------

/**
 * A run is eligible for reconciliation when its failure code is in
 * TERMINAL_THREAD_WRITE_FAILURES (post-acknowledgement quarantine) OR the
 * operation is the geometry write (which is conservatively terminal regardless
 * of code).
 */
function isEligibleForReconciliation(
  project: EngineeringProjectSnapshot,
  failedRun: EngineeringAgentRun,
  failureCode: string,
): boolean {
  if (TERMINAL_THREAD_WRITE_FAILURES.has(failureCode)) return true;
  const workItem = project.workItems.find((item) => item.id === failedRun.workItemId);
  const operation = workItem?.operation;
  if (!operation) return false;
  return `${operation.id}@${operation.version}` === GEOMETRY_WRITE_OPERATION;
}

// ---------------------------------------------------------------------------
// Private: CAS readback assertion
// ---------------------------------------------------------------------------

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: ReconcileUncertainWriterRunExecutorCommand,
): void {
  const run = project.agentRuns.find((r) => r.id === command.runId);
  if (!run || run.status !== "completed" || !run.annotationOnly) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Reconciliation run ${command.runId} did not complete as an annotation run ` +
        "through this exact command.",
    );
  }
}
