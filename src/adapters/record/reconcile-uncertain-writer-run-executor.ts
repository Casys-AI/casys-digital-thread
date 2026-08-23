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
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectCommandOrigin,
} from "../../application/ports/in/engineering-project-command-origin.ts";
import {
  type EngineeringProjectRevisionStore,
} from "../../application/ports/out/engineering-project-revision-store.ts";
import type {
  EngineeringAgentRun,
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
} from "../../domain/project/engineering-project.ts";
import {
  GEOMETRY_WRITE_OPERATION,
  TERMINAL_THREAD_WRITE_FAILURES,
} from "../shared/thread-write-basis-guard.ts";
import { requireBasis, requireRun } from "../shared/executor-run-helpers.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  parseReconcileUncertainWriterProposal,
  RECONCILE_UNCERTAIN_WRITER_OPERATION,
} from "../../domain/record/reconcile-uncertain-writer-proposal.ts";

// ---------------------------------------------------------------------------
// Public constants — operation identity
// ---------------------------------------------------------------------------

/**
 * The exact reviewed operation this executor is bound to.
 *
 * WHY EXPORTED — server.ts must register the same identity object in the
 * `additional` array of `RegisteredProjectRunExecutor`.
 */
export { RECONCILE_UNCERTAIN_WRITER_OPERATION };

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
}

// ---------------------------------------------------------------------------
// Public: executor
// ---------------------------------------------------------------------------

export class ReconcileUncertainWriterRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;

  constructor(dependencies: ReconcileUncertainWriterRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
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
    const { approval, proposal } = await requireMrtrApproval(project, run, workItem);

    const parsed = parseApprovedProposal(proposal);
    const {
      failedRunId,
      failureCode: expectedFailureCode,
      basisSnapshotId: expectedBasisSnapshotId,
      outcome,
      providerInspectionAttestation,
    } = parsed;

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
    const failedRunBasis = requireBasis(failedRun);
    if (failedRunBasis.snapshotId !== expectedBasisSnapshotId) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `MRTR names basis snapshot "${expectedBasisSnapshotId}" but the target run has ` +
          `basis snapshot "${failedRunBasis.snapshotId}".  ` +
          "The MRTR must name the exact basis snapshot.",
      );
    }
    if (failedRun.uncertainWriterReconciliation !== undefined) {
      // The command service owns immutable command-id replay.  Re-enter it
      // with the persisted annotation, rather than rejecting before it can
      // inspect its receipt.  A different commandId still fails closed there.
      const replay = await this.#commands.reconcileAnnotationRun(origin, {
        commandId: command.commandId,
        projectId: command.projectId,
        expectedRevision: command.expectedRevision,
        issuedAt: command.issuedAt,
        reconciliationRunId: command.runId,
        failedRunId,
        decisionId: failedRun.uncertainWriterReconciliation.decisionId,
        outcome: failedRun.uncertainWriterReconciliation.outcome,
        providerInspectionAttestation:
          failedRun.uncertainWriterReconciliation.providerInspectionAttestation,
      });
      assertCompleted(replay, command);
      return replay;
    }
    if (failedRun.evidenceRefs.length !== 0) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Target run ${failedRunId} has evidence refs; uncertain writer reconciliation ` +
          "is not applicable to runs that produced evidence.",
      );
    }

    // 5. Single atomic write — no WAL, no ThreadSnapshot. The service stamps
    // the annotation actor/time and creates the server-fixed release
    // blocker/decision when the accepted outcome needs it.
    const result = await this.#commands.reconcileAnnotationRun(origin, {
      commandId: command.commandId,
      projectId: command.projectId,
      expectedRevision: command.expectedRevision,
      issuedAt: command.issuedAt,
      reconciliationRunId: command.runId,
      failedRunId,
      decisionId: approval.decisionId,
      outcome,
      providerInspectionAttestation,
    });
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
    project.schemaVersion !== "4.0" ||
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
  readonly proposal: readonly EngineeringDecisionProposalParameter[];
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
async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  workItem: { readonly decisionIds: readonly string[] },
): Promise<ApprovedMrtr> {
  const basis = requireBasis(run);
  const candidates: ApprovedMrtr[] = [];

  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((d) => d.id === decisionId);
    if (!decision || decision.status !== "approved" || !decision.proposal) continue;
    // Decision must be anchored to the same ThreadSnapshot basis as the run.
    if (!sameSnapshotBasis(decision.baseSnapshot, basis)) continue;
    // Decision must carry a fingerprint (unfingerprinted decisions are ineligible).
    if (!decision.inputFingerprint) continue;
    const expectedFingerprint = await sha256Fingerprint({
      baseSnapshot: decision.baseSnapshot,
      inputEvidenceRefs: decision.inputEvidenceRefs,
      proposal: {
        summary: decision.proposal.summary,
        parameters: decision.proposal.parameters,
      },
    });
    if (!fingerprintsEqual(expectedFingerprint, decision.inputFingerprint)) continue;

    try {
      parseReconcileUncertainWriterProposal(decision.proposal.parameters);
    } catch {
      continue;
    }

    // Find exactly one human approval whose basis and fingerprint match the decision.
    const exactHumanApprovals = project.approvals.filter((a) =>
      a.decisionId === decision.id &&
      a.status === "approved" &&
      a.decidedByOrigin === "human" &&
      decision.approvalIds.includes(a.id) &&
      sameSnapshotBasis(a.baseSnapshot, basis) &&
      fingerprintsEqual(a.inputFingerprint, decision.inputFingerprint)
    );
    if (exactHumanApprovals.length !== 1) continue;

    candidates.push({
      approval: { decisionId },
      proposal: decision.proposal.parameters,
    });
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

function parseApprovedProposal(
  parameters: readonly EngineeringDecisionProposalParameter[],
) {
  try {
    return parseReconcileUncertainWriterProposal(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `MRTR reconciliation proposal is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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
