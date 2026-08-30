/**
 * Trusted executor for the generic `model.write-requirements@1` operation.
 *
 * WHY GENERIC — no constant in this module may name a specific product
 * (coffee, drone, …). Every project-specific value is read from the basis
 * snapshot, the seed capture, or the MRTR-approved decision parameters.
 *
 * Sequence:
 *  1.  Agent-only origin gate.
 *  2.  requireShape: operation id/version/binding check.
 *  3.  requireMrtrApproval: find the exact human-approved decision.
 *  4.  parseRequirementsProposalParameters: flat grammar → RequirementsProposal.
 *  5.  Lease + claim.
 *  6.  Load basis snapshot.
 *  7.  D7: assertThreadSnapshotLineageIntact before any cliquet.
 *  8.  Cliquet: assertRequirementsArtifactNotRemoved (for this target component).
 *  9.  Find architecture artifact in basis; parse capture; resolve target
 *      (D5 identification by label — never by exclusion).
 * 10.  Load seed capture from the architecture capture → editingContextId.
 * 11.  Verify the service-owned decision fingerprint, then derive the exact
 *      requirements envelope from its signed basis and proposal.
 * 12.  Find prior requirements artifact for this target (if enrichment).
 * 13.  planRequirementsEnrichment: compute toInsert / adopted / conflicts.
 * 14.  Guard: conflicts → invalid_transition; disappeared → cliquet violation.
 * 15.  Guard: toInsert.length === 0 → invalid_transition (no-op write).
 * 16.  WAL begin (quarantine check before planDigest WAL).
 * 17.  Render native RequirementUsage → insert under target PartDefinition.
 * 18.  providerAcknowledged = true.
 * 19.  Identify RequirementUsage in target children; verify subject typing.
 * 20.  extractAndVerifyOracleRequirements: fail-closed constraint fidelity.
 * 21.  WAL complete with the verified provider element identity.
 * 22.  Build capture record → sha256Fingerprint → save → CAS readback.
 * 23.  Build thread extension → applyThreadSnapshotExtensionIfNew →
 *       validateThreadSnapshot.
 * 24.  Snapshot save + CAS readback.
 * 25.  publishRun + completeRun + assertCompleted.
 */

import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectCommandOrigin,
} from "../../../application/ports/in/engineering-project-command-origin.ts";
import {
  type EngineeringProjectRevisionStore,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { parseSysonModelSeedCapture } from "../../../domain/architecture/seed/syson-model-seed.ts";
import {
  fingerprintRequirementsPlan,
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  parseRequirementsProposalParameters,
  planRequirementsEnrichment,
  requirementEntriesToOracleRequirements,
  type RequirementsProposal,
  type RequirementsTarget,
} from "../../../domain/architecture/requirements/requirements-proposal.ts";
import {
  type OracleRequirement,
  renderTargetedOracleRequirementsSysml,
} from "../../../domain/kernel/proof-case.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadEntityRef,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadProvenanceLink,
  ThreadSnapshot,
  TracedRequirement,
} from "../../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../../domain/thread/thread-snapshot.ts";
import { computeArchiveCascade } from "../../../domain/thread/thread-retirement.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  REQUIREMENTS_CAPTURE_URI_PREFIX,
  selectRequirementsTip,
} from "../../../domain/thread/requirements-tip.ts";
import {
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  type FileCaptureStore,
} from "../../shared/cas/file-capture-store.ts";
import {
  FileRequirementsAttemptStore,
  RequirementsRunQuarantinedError,
  RequirementsWriteOutcomeUnknownError,
} from "./file-requirements-attempt-store.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import {
  assertThreadSnapshotLineageIntact,
  ThreadSnapshotLineageIntegrityError,
} from "../../shared/stores/thread-snapshot-lineage.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../../shared/stores/live-thread-update-store.ts";
import {
  ARCHITECTURE_FEATURE_TYPING_AQL,
} from "../renderer/architecture-structure-extractor.ts";
import {
  extractAndVerifyOracleRequirements,
  RequirementExtractionError,
  type VerifiedConstraintUsageIdentity,
} from "../../extractors/syson-requirements-extractor.ts";
import {
  findArchitectureArtifact,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
} from "../renderer/model-write-architecture-run-executor.ts";
import {
  ARCHITECTURE_CAPTURE_SCHEMA,
  type ExactArchitectureCapture as ParsedArchCapture,
  parseExactArchitectureCapture,
} from "../renderer/architecture-capture.ts";
import {
  requireCurrentArchitectureSourceAnalyses,
  type SysmlSourceAnalysisReader,
} from "../renderer/sysml-source-analysis-capture.ts";
import {
  type ExactRequirementsCapture,
  parseExactRequirementsCapture,
  REQUIREMENTS_CAPTURE_SCHEMA,
  type RequirementsCaptureConstraintUsage,
} from "./requirements-capture.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../shared/thread-write-basis-guard.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  beginConfiguredCapabilityRuntimeSession,
  requireConfiguredOperationalCapability,
  settleCapabilityRuntimeSession,
} from "../../../application/control-plane/capability-runtime-execution-admission.ts";
import {
  type CapabilityRuntimeExecutionSession,
  type CapabilityRuntimeExecutionSessionCoordinator,
  CapabilityRuntimeSessionUnavailableError,
} from "../../../application/control-plane/capability-runtime-execution-session.ts";

// ── Public re-exports ────────────────────────────────────────────────────────

export { MODEL_WRITE_REQUIREMENTS_OPERATION, REQUIREMENTS_CAPTURE_SCHEMA };

// ── Cliquet: requirements artifact removed ───────────────────────────────────

/**
 * Raised when an ancestor ThreadSnapshot carried a requirements artifact for
 * a specific containerComponent but the current basis does not.
 *
 * MONOTONY RATCHET — once a subject's thread carries a requirements artifact
 * for a component, every later revision must also carry it (or carry the
 * explicit archive marker that retired it).
 */
export class RequirementsArtifactRemovedError extends Error {
  constructor(subjectId: string, containerComponent: string) {
    super(
      `requirements_artifact_removed: The thread for "${subjectId}" previously carried a ` +
        `requirements artifact for "${containerComponent}" that is absent from the current ` +
        "basis. This is a monotony-ratchet violation; the artifact must not be removed " +
        "once published.",
    );
    this.name = "RequirementsArtifactRemovedError";
  }
}

// ── Command and dependency types ─────────────────────────────────────────────

export interface ModelWriteRequirementsRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface ModelWriteRequirementsRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  /** Seed captures produced by `architecture.seed-syson-model@2`. */
  readonly seedCaptures: FileCaptureStore<"syson-model-seed">;
  /** Generic architecture captures — read-only for target resolution. */
  readonly architectureCaptures: FileCaptureStore<"architecture-capture">;
  /** Read-only proof port for current SysML source-analysis evidence. */
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisReader;
  readonly captures: FileCaptureStore<"requirements-capture">;
  readonly attempts: FileRequirementsAttemptStore;
  /** Fixed server-owned MCP client. No agent value reaches this boundary. */
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  readonly capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin"
  >;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

// ── Exported: find requirements artifact for a given target ──────────────────

/**
 * Locate the active requirements artifact for a specific containerComponent.
 *
 * Returns undefined if no requirements artifact for this component exists yet,
 * which is the initial-write signal for the executor. Throws on an ambiguous
 * active lineage; ambiguity must never be collapsed into absence.
 */
export function findRequirementsArtifact(
  snapshot: ThreadSnapshot,
  containerComponent: string,
): ThreadArtifact | undefined {
  return requireRequirementsTip(snapshot, containerComponent);
}

/**
 * Resolve the unique active requirements tip used by the write executor.
 * Ambiguity is never an initial-write signal: continuing would fork an
 * append-only requirements lineage and could overwrite an arbitrary SysON
 * element during enrichment.
 */
export function requireRequirementsTip(
  snapshot: ThreadSnapshot,
  containerComponent: string,
): ThreadArtifact | undefined {
  const selected = selectRequirementsTip(snapshot, containerComponent);
  if (selected.kind === "ambiguous") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Ambiguous requirements tip for "${containerComponent}": the basis does not ` +
        "identify one unique active requirements predecessor. Resolve or archive the " +
        "competing tips before writing SysON.",
    );
  }
  return selected.kind === "one" ? selected.artifact : undefined;
}

/** Resolve one component label to its exact reusable PartDefinition identity. */
export function resolveRequirementsPartDefinitionTarget(
  partDefinitions: readonly {
    readonly id: string;
    readonly label: string;
    readonly usages?: readonly unknown[];
  }[],
  containerComponent: string,
): RequirementsTarget {
  const matches = partDefinitions.filter((partDefinition) =>
    partDefinition.label === containerComponent
  );
  if (matches.length === 0) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "requirements_envelope_derivation_mismatch: " +
        `component "${containerComponent}" is not present in the generic ` +
        "architecture capture. Run model.write-architecture@1 to add it first.",
    );
  }
  if (matches.length > 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "requirements_envelope_derivation_mismatch: " +
        `${matches.length} partDefs have label "${containerComponent}" ` +
        "in the architecture capture. The model must have unique part-definition labels.",
    );
  }
  return {
    kind: "part-definition",
    label: matches[0]!.label,
    elementId: matches[0]!.id,
  };
}

/**
 * Assert that the requirements artifact for a given containerComponent has NOT
 * been silently removed from the subject's thread history.
 *
 * Fail-open on snapshot-store resolution errors (same convention as
 * assertArchitectureArtifactNotRemoved). Fail-closed when a FOUND ancestor
 * artifact has a MISSING current artifact.
 */
export async function assertRequirementsArtifactNotRemoved(
  basis: ThreadSnapshot,
  containerComponent: string,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  // An explicit archive is a valid retirement — handled by selectRequirementsTip.
  const uriPrefix = requirementsUriPrefix(containerComponent);
  if (basis.artifacts.some((a) => a.uri?.startsWith(uriPrefix))) return;
  let cursor = basis.previous;
  const visited = new Set<string>();
  while (cursor) {
    const key = `${cursor.snapshotId}\u0000${cursor.revision}`;
    if (visited.has(key)) break;
    visited.add(key);
    let ancestor: ThreadSnapshot | undefined;
    try {
      ancestor = await snapshots.get(cursor.snapshotId);
    } catch {
      break; // fail-open on resolution error
    }
    if (
      !ancestor || ancestor.id !== cursor.snapshotId ||
      ancestor.revision !== cursor.revision ||
      ancestor.subject.id !== basis.subject.id
    ) break;
    if (ancestor.artifacts.some((a) => a.uri?.startsWith(uriPrefix))) {
      throw new RequirementsArtifactRemovedError(
        basis.subject.id,
        containerComponent,
      );
    }
    cursor = ancestor.previous;
  }
}

// ── Main executor class ──────────────────────────────────────────────────────

export class ModelWriteRequirementsRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #seedCaptures: ModelWriteRequirementsRunExecutorDependencies["seedCaptures"];
  readonly #architectureCaptures:
    ModelWriteRequirementsRunExecutorDependencies["architectureCaptures"];
  readonly #sysmlSourceAnalysis: SysmlSourceAnalysisReader;
  readonly #captures: FileCaptureStore<"requirements-capture">;
  readonly #attempts: FileRequirementsAttemptStore;
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #capabilityRuntime: CapabilityRuntimeExecutionEligibility | undefined;
  readonly #capabilityRuntimeSession:
    | Pick<CapabilityRuntimeExecutionSessionCoordinator, "begin">
    | undefined;
  readonly #liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly #now: () => string;

  constructor(deps: ModelWriteRequirementsRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#seedCaptures = deps.seedCaptures;
    this.#architectureCaptures = deps.architectureCaptures;
    this.#sysmlSourceAnalysis = deps.sysmlSourceAnalysis;
    this.#captures = deps.captures;
    this.#attempts = deps.attempts;
    this.#syson = deps.syson;
    this.#lease = deps.lease;
    this.#capabilityRuntime = deps.capabilityRuntime;
    this.#capabilityRuntimeSession = deps.capabilityRuntimeSession;
    this.#liveUpdates = deps.liveUpdates;
    this.#now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * Execute the requirements write operation for the given run.
   *
   * Exactly one SysON insertion is performed per run. Any error after SysON
   * acknowledges the insertion triggers the quarantine path: the run is marked
   * failed and a run-level sentinel blocks any automatic redispatch.
   */
  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: ModelWriteRequirementsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements write executor may only be invoked by an agent origin.",
      );
    }

    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    const { proposal: rawProposal } = await requireMrtrApproval(project, run);
    const proposal = parseRequirementsProposal(rawProposal);

    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, proposal),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: ModelWriteRequirementsRunExecutorCommand,
    proposal: RequirementsProposal,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let providerAcknowledged = false;
    let snapshotPersisted = false;
    let materializedSnapshot: ThreadSnapshot | undefined;
    let capabilitySession: CapabilityRuntimeExecutionSession | undefined;

    try {
      // Post-lease shape re-check.
      const preClaim = await this.#requiredProject(command.projectId);
      requireShape(preClaim, requireRun(preClaim, command.runId));

      // Idempotent path: if already completed by this exact command, return.
      const alreadyCompleted = await this.#completedFor(command, proposal);
      if (alreadyCompleted) {
        await this.#reconcileLive(
          alreadyCompleted.project.subjectId,
          command.runId,
        );
        return alreadyCompleted;
      }

      await assertThreadWriteBasisAvailable(
        preClaim,
        requireRun(preClaim, command.runId),
      );

      await assertNoBlockedRequirementsSibling(
        preClaim,
        requireRun(preClaim, command.runId),
        proposal.containerComponent,
        this.#attempts,
      );
      await this.#runAttemptOrFail(preClaim.project.id, command.runId);
      const preClaimRun = requireRun(preClaim, command.runId);
      const operationalCapability = await this.#requireOperationalCapability(
        preClaim,
        preClaimRun,
      );
      capabilitySession = await beginConfiguredCapabilityRuntimeSession({
        session: this.#capabilityRuntimeSession!,
        project: preClaim,
        runId: command.runId,
        operationalCapability,
        recheck: async () => {
          const fresh = await this.#requiredProject(command.projectId);
          const run = requireRun(fresh, command.runId);
          requireShape(fresh, run);
          return await this.#requireOperationalCapability(fresh, run);
        },
      });

      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the generic model-write-requirements run.",
      });
      claimed = true;

      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);

      if (run.status === "completed") {
        assertCompleted(project, command);
        await this.#assertCompletedEvidenceExact(project, command, proposal);
        await this.#reconcileLive(project.project.subjectId, run.id);
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      const capturedAt = requiredStart(run);
      const basis = requireBasis(run);

      // Step 6: load basis snapshot.
      const base = await exactSnapshot(this.#snapshots, basis);

      // Step 7 (D7): assert lineage intact BEFORE cliquet.
      try {
        await assertThreadSnapshotLineageIntact(base, this.#snapshots);
      } catch (error) {
        if (error instanceof ThreadSnapshotLineageIntegrityError) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `Thread snapshot lineage integrity failure: ${error.message}`,
          );
        }
        throw error;
      }

      // Step 8: cliquet — requirements artifact must not have been silently removed.
      await assertRequirementsArtifactNotRemoved(
        base,
        proposal.containerComponent,
        this.#snapshots,
      );

      // Ambiguity is a lineage error, never an initial-write signal. Resolve
      // it before any WAL entry or provider call can be made.
      const priorArtifact = requireRequirementsTip(
        base,
        proposal.containerComponent,
      );

      // Step 9: find the architecture artifact and resolve the target component.
      const architectureArtifact = findArchitectureArtifact(base);
      if (!architectureArtifact) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "No generic architecture artifact is present in the basis snapshot. " +
            "Run model.write-architecture@1 before authoring requirements.",
        );
      }
      const { archCapture, editingContextId, target } = await this
        .#resolveTargetFromArchitecture(
          base,
          architectureArtifact,
          proposal,
        );

      // Step 11: #resolveTargetFromArchitecture has derived this envelope only
      // from the exact signed basis and proposal: the basis selects the content-
      // addressed architecture capture and the proposal selects one unique
      // PartDefinition identity. Requirements intentionally constrain that
      // reusable type, so root definitions (zero inbound usages) and reused
      // definitions (multiple inbound usages) have the same unambiguous target.
      // Keep the values together here so later publication cannot substitute
      // another derivation.
      const derivedEnvelope = {
        target,
        architectureBasis: {
          snapshotId: basis.snapshotId,
          revision: basis.revision,
          fingerprint: architectureArtifact.fingerprint.digest,
        },
        partDefName: proposal.partDefName,
        requirements: requirementEntriesToOracleRequirements(
          proposal.requirements,
        ),
      };

      // Step 12: read the unique prior requirements artifact (enrichment path).
      const priorCapture = priorArtifact
        ? await this.#readPriorRequirements(
          base,
          priorArtifact,
          proposal,
          target,
        )
        : undefined;

      // Step 13: enrichment plan.
      const oracleRequirements = derivedEnvelope.requirements;
      const enrichmentPlan = planRequirementsEnrichment(
        proposal,
        priorCapture?.requirements,
      );

      // Step 14: conflict + cliquet + empty-plan guards.
      if (enrichmentPlan.disappeared.length > 0) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Requirements cliquet violation: ${enrichmentPlan.disappeared.length} metric(s) ` +
            `present in the prior capture are absent from this proposal: ` +
            enrichmentPlan.disappeared.join(", ") +
            ". A metric may not be silently removed once anchored in SysON.",
        );
      }
      if (enrichmentPlan.conflicts.length > 0) {
        const first = enrichmentPlan.conflicts[0]!;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Requirements threshold conflict for metric "${first.metric}": ` +
            `proposed ${first.proposed.operator} ${first.proposed.value} ${first.proposed.unit}, ` +
            `prior ${first.prior.operator} ${first.prior.value} ${first.prior.unit}. ` +
            "An already-anchored threshold may not be changed without a separate removal operation.",
        );
      }
      if (enrichmentPlan.toInsert.length === 0) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "All proposed requirements are already present and adopted in the SysON model. " +
            "No insertion is needed; this transition would produce no new evidence.",
        );
      }

      // Build the full requirements list to render.
      //
      // syson_element_insert_sysml PROBE (2026-08-08, SysON 0.5.1):
      //   Inserting the same declaration name twice into the same parent
      //   produces TWO distinct elements with the same label — it is a pure
      //   insert, NOT a replace. Enrichment cannot call insert twice; D5
      //   identification would find two matches and fail with ambiguity.
      //
      // ENRICHMENT STRATEGY — delete + reinsert:
      //   Before WAL begin, we locate the prior element by label (below). In the
      //   dispatch path, we delete it with syson_element_delete, then insert a
      //   NEW RequirementUsage containing the full set (toInsert + adopted). After the
      //   insert, D5 finds exactly one element. The verification step
      //   (extractAndVerifyOracleRequirements) confirms all metrics are present.
      //   If delete succeeds but insert fails the WAL is still "dispatched" and
      //   the run quarantines → human review, not silent retry.
      const insertOracleRequirements = requirementEntriesToOracleRequirements(
        enrichmentPlan.toInsert,
      );
      const adoptedOracleRequirements = enrichmentPlan.adopted.length > 0
        ? requirementEntriesToOracleRequirements(enrichmentPlan.adopted)
        : [];
      // renderRequirements = full set: initial mode ⇒ toInsert only;
      // enrichment mode ⇒ toInsert + adopted (re-renders the RequirementUsage).
      const renderRequirements = [
        ...insertOracleRequirements,
        ...adoptedOracleRequirements,
      ];

      const planDigest = await requirementsPlanDigest(
        renderRequirements,
        proposal.partDefName,
        target,
      );
      const existingAttempt = await this.#runAttemptOrFail(
        project.project.id,
        command.runId,
      );
      if (
        existingAttempt?.status === "completed" &&
        existingAttempt.planDigest !== planDigest
      ) {
        throw new RequirementsWriteOutcomeUnknownError();
      }
      const recoveryElementId = existingAttempt?.status === "completed"
        ? existingAttempt.result?.requirementsElementId
        : undefined;
      if (existingAttempt?.status === "completed" && !recoveryElementId) {
        throw new RequirementsWriteOutcomeUnknownError();
      }

      // Pre-WAL lookup runs in every mode. An initial/re-authoring run may not
      // silently create a homonym, while enrichment must prove the exact live
      // predecessor before it is irreversibly deleted.
      const liveRequirementsElementId = await this
        .#findElementByLabelOrUndefined(
          editingContextId,
          target.elementId,
          proposal.partDefName,
        );
      let priorRequirementsElementId: string | undefined;
      if (recoveryElementId !== undefined) {
        providerAcknowledged = true;
        if (liveRequirementsElementId !== recoveryElementId) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `Completed requirements WAL identifies "${recoveryElementId}", but the ` +
              `unique live child is "${String(liveRequirementsElementId)}". ` +
              "Refusing to adopt a homonym during recovery.",
          );
        }
      } else if (!priorCapture) {
        if (liveRequirementsElementId !== undefined) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `foreign_requirements_element: live RequirementUsage ` +
              `"${proposal.partDefName}" (${liveRequirementsElementId}) already exists ` +
              `under target "${target.label}" without an active Thread predecessor. ` +
              "Refusing to create a homonym.",
          );
        }
      } else {
        if (liveRequirementsElementId === undefined) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `prior_requirements_live_mismatch: the predecessor capture records ` +
              `"${proposal.partDefName}" (${priorCapture.requirementsElementId}), but no ` +
              "such live RequirementUsage exists under the target PartDefinition.",
          );
        }
        if (liveRequirementsElementId !== priorCapture.requirementsElementId) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `foreign_requirements_element: element found by label "${proposal.partDefName}" ` +
              `is "${liveRequirementsElementId}" but the prior capture recorded ` +
              `"${priorCapture.requirementsElementId}". A foreign element with the ` +
              "same name must not be deleted without provenance. Manual inspection required.",
          );
        }
        try {
          const priorTargetedConstraintUsageIds = await this
            .#verifyTargetedRequirementUsage(
              editingContextId,
              liveRequirementsElementId,
              proposal.partDefName,
              target,
            );
          const priorLiveReadback = await extractAndVerifyOracleRequirements(
            this.#syson,
            editingContextId,
            liveRequirementsElementId,
            priorCapture.requirements,
          );
          assertConstraintUsageChildBijection(
            priorTargetedConstraintUsageIds,
            priorLiveReadback.constraintUsages,
            "live predecessor",
          );
          assertCapturedConstraintUsageBijection(
            priorCapture.authoritativeConstraintUsages,
            priorLiveReadback.constraintUsages,
          );
          priorRequirementsElementId = liveRequirementsElementId;
        } catch (error) {
          if (error instanceof RequirementsWriteOutcomeUnknownError) {
            throw error;
          }
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `prior_requirements_live_mismatch: the live predecessor no longer ` +
              `matches its trusted capture (${
                error instanceof Error ? error.message : String(error)
              }). Refusing deletion.`,
          );
        }
      }

      let requirementsElementId: string;
      let completeAttemptAfterProof = false;
      if (existingAttempt?.status === "completed") {
        // Recovery is pinned to the provider identity proven before WAL
        // completion. Never rediscover or adopt an element by label here.
        providerAcknowledged = true;
        requirementsElementId = existingAttempt.result!.requirementsElementId;
      } else {
        const walResult = await this.#walBeginOrFail(
          project.project.id,
          command.runId,
          planDigest,
          capturedAt,
        );
        if (walResult.action === "completed") {
          providerAcknowledged = true;
          requirementsElementId = walResult.requirementsElementId;
        } else {
          // Step 17: (enrichment) delete prior element, then insert full set;
          //           (initial) insert directly.
          //
          // For enrichment with adopted metrics: delete the prior RequirementUsage
          // first (irreversible via syson_element_delete) so that re-insertion of
          // the complete set (toInsert + adopted) does not create a duplicate label.
          // The WAL entry is "dispatched" until step 19 (complete); if delete
          // succeeds but insert fails, the dispatched WAL causes quarantine on
          // retry rather than a silent second deletion.
          if (priorRequirementsElementId !== undefined) {
            try {
              await this.#syson.callTool({
                name: "syson_element_delete",
                arguments: {
                  editing_context_id: editingContextId,
                  element_id: priorRequirementsElementId,
                },
              });
              // Deletion is an irreversible provider acknowledgement too. From
              // here, a failed insert or readback must block every sibling run
              // on the same basis instead of inviting a second dispatch.
              providerAcknowledged = true;
            } catch (error) {
              if (!(error instanceof EngineeringProjectCommandError)) {
                throw new RequirementsWriteOutcomeUnknownError();
              }
              throw error;
            }
          }
          const sysmlText = renderTargetedOracleRequirementsSysml(
            proposal.partDefName,
            target.label,
            renderRequirements,
          );
          try {
            const insertResult = await this.#syson.callTool({
              name: "syson_element_insert_sysml",
              arguments: {
                editing_context_id: editingContextId,
                parent_id: target.elementId,
                sysml_text: sysmlText,
              },
            });
            verifyInsertionAck(
              insertResult.structuredContent,
              target.elementId,
            );
            // Step 18: from this point any error takes the post-acknowledgement path.
            providerAcknowledged = true;
          } catch (error) {
            if (!(error instanceof EngineeringProjectCommandError)) {
              throw new RequirementsWriteOutcomeUnknownError();
            }
            throw error;
          }

          // Step 20: identify element by label (D5 — never by exclusion).
          requirementsElementId = await this.#identifyByLabelOrFail(
            editingContextId,
            target.elementId,
            proposal.partDefName,
          );
          completeAttemptAfterProof = true;
        }
      }

      const targetedConstraintUsageIds = await this
        .#verifyTargetedRequirementUsage(
          editingContextId,
          requirementsElementId,
          proposal.partDefName,
          target,
        );

      // Step 21: extractAndVerifyOracleRequirements — fail-closed fidelity check.
      let verifiedRequirements: readonly OracleRequirement[];
      let verifiedConstraintUsages: readonly VerifiedConstraintUsageIdentity[];
      try {
        const verifiedReadback = await extractAndVerifyOracleRequirements(
          this.#syson,
          editingContextId,
          requirementsElementId,
          oracleRequirements,
        );
        verifiedRequirements = verifiedReadback.requirements;
        verifiedConstraintUsages = verifiedReadback.constraintUsages;
        assertConstraintUsageChildBijection(
          targetedConstraintUsageIds,
          verifiedConstraintUsages,
          "inserted RequirementUsage",
        );
      } catch (error) {
        if (error instanceof RequirementExtractionError) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `Requirements fidelity check failed (${error.code}): ${error.message} Recovery: ${error.recovery}`,
          );
        }
        throw error;
      }

      // WAL completion is proof-bearing, not merely provider-ACK-bearing. Keep
      // the attempt dispatched until exact identity, target typing, and every
      // constraint have survived readback.
      if (completeAttemptAfterProof) {
        try {
          await this.#attempts.complete({
            projectId: project.project.id,
            runId: command.runId,
            planDigest,
            requirementsElementId,
          });
        } catch {
          const durable = await this.#runAttemptOrFail(
            project.project.id,
            command.runId,
          );
          if (
            durable?.status !== "completed" ||
            durable.planDigest !== planDigest ||
            durable.result?.requirementsElementId !== requirementsElementId
          ) {
            throw new RequirementsWriteOutcomeUnknownError();
          }
        }
      }

      // Step 22: build + save capture.
      const captureRecord = buildCaptureRecord({
        proposal,
        target: derivedEnvelope.target,
        architectureArtifact,
        architectureBasis: basis,
        archCaptureSchema: archCapture.schemaVersion,
        seedArtifactId: archCapture.seed.artifactId,
        seedFingerprint: archCapture.seed.fingerprint,
        seedProducerRunId: archCapture.seed.producerRunId,
        requirementsElementId,
        requirements: verifiedRequirements,
        constraintUsages: verifiedConstraintUsages,
        runId: run.id,
        capturedAt,
      });
      const captureFp = await sha256Fingerprint(captureRecord);
      const captureText = deterministicJson(captureRecord);

      await this.#captures.save(captureFp, captureText);
      const persistedCapture = await this.#captures.read(captureFp);
      if (persistedCapture !== captureText) {
        throw new Error(
          "Requirements capture was not durably readable after save.",
        );
      }

      // Step 23: build + apply thread extension.
      const captureUri = requirementsUriFor(
        proposal.containerComponent,
        captureFp,
      );
      const extension = buildExtension({
        base,
        proposal,
        architectureArtifact,
        priorRequirementsArtifact: priorArtifact,
        target: derivedEnvelope.target,
        runId: run.id,
        capturedAt,
        captureFp,
        captureUri,
        requirements: verifiedRequirements,
        requirementsElementId,
      });
      const { snapshot: materialized } = applyThreadSnapshotExtensionIfNew(
        base,
        extension,
      );
      materializedSnapshot = materialized;

      try {
        validateThreadSnapshot(materialized);
      } catch (error) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Requirements snapshot failed validation: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      await this.#snapshots.save(materialized);
      const persistedSnapshot = await this.#snapshots.get(materialized.id);
      if (
        !persistedSnapshot || persistedSnapshot.id !== materialized.id ||
        persistedSnapshot.revision !== materialized.revision
      ) {
        throw new Error(
          "Requirements snapshot was not durably readable after save.",
        );
      }
      snapshotPersisted = true;

      // Step 24-25: publish + complete the run.
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the generic SysON requirements evidence.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: "Recorded the generic SysML requirements and their SysON read-back.",
          resultSnapshot: snapshotRef(materialized),
          evidenceRefs: [requirementsArtifactEntityRef(materialized, run.id)],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.#requiredProject(command.projectId);
      assertCompleted(complete, command);
      await this.#assertCompletedEvidenceExact(complete, command, proposal);
      await this.#reconcileLive(complete.project.subjectId, command.runId);
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: { kind: "release" },
      });
      return complete;
    } catch (error) {
      if (snapshotPersisted && materializedSnapshot) {
        const complete = await this.#completedFor(command, proposal);
        if (complete) {
          await settleCapabilityRuntimeSession({
            session: capabilitySession,
            policy: { kind: "release" },
          });
          return complete;
        }
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "retain" },
        });
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Requirements evidence is durable but project attachment did not finish. " +
            "Retry this exact command; it will not insert a second element.",
        );
      }
      if (error instanceof RequirementsWriteOutcomeUnknownError) {
        await this.#recordFailure(origin, command, {
          code: "model-write-requirements-provider-outcome-unknown",
          message:
            "The provider outcome is unknown after a durable dispatch record; automatic redispatch is forbidden pending human reconciliation.",
        }, claimed);
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "retain" },
        });
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The SysON requirements insertion outcome is unknown. An operator must inspect " +
            "SysON before any separately reviewed recovery path.",
        );
      }
      if (error instanceof RequirementsRunQuarantinedError) {
        await this.#recordFailure(origin, command, {
          code: "model-write-requirements-post-acknowledgement-quarantined",
          message:
            "SysON acknowledged a requirements insertion, then structural verification failed; the run is quarantined.",
        });
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "retain" },
        });
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          error.message,
        );
      }
      if (providerAcknowledged) {
        // Any error after an acknowledged mutation is terminal for this basis:
        // the provider can contain a deletion, a partial insertion, or evidence
        // whose publication failed after a successful write.
        try {
          await this.#attempts.quarantine({
            projectId: command.projectId,
            runId: command.runId,
            quarantinedAt: this.#now(),
          });
        } catch {
          if (claimed) {
            await this.#recordFailure(origin, command, {
              code: "model-write-requirements-quarantine-write-failed",
              message:
                "SysON acknowledged a requirements mutation, but the durable quarantine could not be recorded. Automatic retry is forbidden.",
            }, true);
          }
          await settleCapabilityRuntimeSession({
            session: capabilitySession,
            policy: { kind: "retain" },
          });
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            "The acknowledged SysON requirements mutation could not be durably quarantined. " +
              "The run was failed; an operator must inspect SysON before any new run.",
          );
        }
        if (claimed) {
          await this.#recordFailure(origin, command, {
            code: "model-write-requirements-post-acknowledgement-quarantined",
            message:
              "SysON acknowledged a requirements mutation, then evidence publication failed; the run is quarantined.",
          });
        }
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "retain" },
        });
        if (error instanceof EngineeringProjectCommandError) {
          throw error;
        }
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The SysON requirements mutation was acknowledged but evidence was not published; " +
            "the run is quarantined and may not be retried automatically.",
        );
      }
      if (claimed) await this.#recordFailure(origin, command);
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: {
          kind: "release-if-terminal",
          run: await this.#currentRun(command.projectId, command.runId),
        },
      });
      throw error;
    }
  }

  async #requireOperationalCapability(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ) {
    requireShape(project, run);
    const workItem = project.workItems.find((item) => item.id === run.workItemId)!;
    try {
      return await requireConfiguredOperationalCapability({
        runtime: this.#capabilityRuntime,
        session: this.#capabilityRuntimeSession,
        project,
        run,
        workItem,
        unavailableMessage:
          "Generic requirements write requires the configured JIT capability runtime session before a run can be claimed.",
        missingBindingMessage:
          "Generic requirements write requires the sealed model.author-system@1 operational capability before a run can be claimed.",
      });
    } catch (error) {
      if (error instanceof CapabilityRuntimeSessionUnavailableError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          error.message,
        );
      }
      throw error;
    }
  }

  async #currentRun(projectId: string, runId: string) {
    try {
      return requireRun(await this.#requiredProject(projectId), runId);
    } catch {
      return undefined;
    }
  }

  // ── Private: resolve target from architecture capture ─────────────────────

  /**
   * Parse the architecture capture for the given artifact and find the
   * containerComponent's unique PartDefinition identity.
   *
   * D5: identification is by label match, never by exclusion.
   * The target is intentionally type-level: root PartDefinitions and reusable
   * PartDefinitions with multiple usages remain unambiguous.
   */
  async #resolveTargetFromArchitecture(
    base: ThreadSnapshot,
    architectureArtifact: ThreadArtifact,
    proposal: RequirementsProposal,
  ): Promise<{
    readonly archCapture: ParsedArchCapture;
    readonly editingContextId: string;
    readonly target: RequirementsTarget;
  }> {
    // Read the architecture capture.
    const archCaptureText = await this.#architectureCaptures.read(
      architectureArtifact.fingerprint,
    );
    if (!archCaptureText) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The generic architecture capture is not durably readable.",
      );
    }

    let archCapture: ParsedArchCapture;
    try {
      archCapture = parseArchCapture(archCaptureText);
      if (deterministicJson(archCapture) !== archCaptureText) {
        throw new Error("Architecture capture is not canonical JSON.");
      }
      if (
        !fingerprintsEqual(
          await sha256Fingerprint(archCapture),
          architectureArtifact.fingerprint,
        )
      ) {
        throw new Error("Architecture capture fingerprint is not exact.");
      }
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The generic architecture capture is not parseable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (
      architectureArtifact.id !==
        `architecture-${architectureArtifact.fingerprint.digest}` ||
      architectureArtifact.version !==
        architectureArtifact.fingerprint.digest ||
      architectureArtifact.kind !== "sysml-model" ||
      architectureArtifact.uri !==
        `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${architectureArtifact.fingerprint.digest}` ||
      architectureArtifact.mediaType !== "application/json" ||
      architectureArtifact.producer.serverId !== "syson" ||
      architectureArtifact.producer.tool !== "syson_element_insert_sysml" ||
      archCapture.schemaVersion !== ARCHITECTURE_CAPTURE_SCHEMA ||
      archCapture.operation.id !== MODEL_WRITE_ARCHITECTURE_OPERATION.id ||
      archCapture.operation.version !==
        MODEL_WRITE_ARCHITECTURE_OPERATION.version ||
      archCapture.trustedRunId !== architectureArtifact.producer.runId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The generic architecture artifact/capture pair is not exact architecture evidence.",
      );
    }
    try {
      await requireCurrentArchitectureSourceAnalyses(
        archCapture.sourceAnalyses,
        this.#sysmlSourceAnalysis,
        {
          runId: architectureArtifact.producer.runId,
          operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
          packageName: archCapture.packageName,
        },
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Current architecture source-analysis evidence is not exact: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const seedArtifact = base.artifacts.find((artifact) =>
      artifact.id === archCapture.seed.artifactId
    );
    if (
      !seedArtifact ||
      !fingerprintsEqual(
        seedArtifact.fingerprint,
        archCapture.seed.fingerprint,
      ) ||
      seedArtifact.id !==
        `syson-model-seed-${seedArtifact.fingerprint.digest}` ||
      seedArtifact.kind !== "sysml-model" ||
      seedArtifact.uri !==
        `casys://syson-model-seed-capture/sha256/${seedArtifact.fingerprint.digest}` ||
      seedArtifact.mediaType !== "application/json" ||
      seedArtifact.producer.serverId !== "syson" ||
      seedArtifact.producer.tool !== "syson_model_create" ||
      seedArtifact.producer.runId !== archCapture.seed.producerRunId ||
      !architectureArtifact.inputArtifactIds.includes(seedArtifact.id)
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The generic architecture capture is not anchored to its exact SysON seed artifact.",
      );
    }
    const predecessorArtifact = archCapture.predecessor
      ? base.artifacts.find((artifact) =>
        artifact.id === archCapture.predecessor!.artifactId
      )
      : undefined;
    if (
      archCapture.predecessor &&
      (!predecessorArtifact ||
        predecessorArtifact.id !==
          `architecture-${predecessorArtifact.fingerprint.digest}` ||
        predecessorArtifact.kind !== "sysml-model" ||
        predecessorArtifact.uri !==
          `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${predecessorArtifact.fingerprint.digest}` ||
        predecessorArtifact.mediaType !== "application/json" ||
        predecessorArtifact.producer.serverId !== "syson" ||
        predecessorArtifact.producer.tool !== "syson_element_insert_sysml" ||
        !fingerprintsEqual(
          predecessorArtifact.fingerprint,
          archCapture.predecessor.fingerprint,
        ) ||
        predecessorArtifact.producer.runId !==
          archCapture.predecessor.producerRunId)
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The generic architecture capture predecessor is not exact Thread evidence.",
      );
    }
    const expectedArchitectureInputs = [
      seedArtifact.id,
      ...(predecessorArtifact ? [predecessorArtifact.id] : []),
    ];
    if (
      architectureArtifact.inputArtifactIds.length !==
        expectedArchitectureInputs.length ||
      new Set(architectureArtifact.inputArtifactIds).size !==
        architectureArtifact.inputArtifactIds.length ||
      expectedArchitectureInputs.some((id) =>
        !architectureArtifact.inputArtifactIds.includes(id)
      )
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The generic architecture capture predecessor does not match the artifact input lineage.",
      );
    }

    // Find the containerComponent PartDefinition by label (D5). Inbound usage
    // count is deliberately irrelevant because the requirement constrains the
    // reusable type itself.
    const target = resolveRequirementsPartDefinitionTarget(
      archCapture.partDefinitions,
      proposal.containerComponent,
    );

    // Load the seed capture to get editingContextId.
    const seedFp = archCapture.seed.fingerprint;
    const seedCaptureText = await this.#seedCaptures.read(seedFp);
    if (!seedCaptureText) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The SysON seed capture referenced by the architecture capture is not durably readable.",
      );
    }
    let seedCapture: ReturnType<typeof parseSysonModelSeedCapture>;
    try {
      seedCapture = parseSysonModelSeedCapture(JSON.parse(seedCaptureText));
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The SysON seed capture is not a valid canonical seed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (seedCapture.trustedRunId !== seedArtifact.producer.runId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The SysON seed capture trustedRunId does not match its Thread artifact producer.",
      );
    }
    const editingContextId = seedCapture.normalizedResults.project.editingContextId;

    return {
      archCapture,
      editingContextId,
      target,
    };
  }

  // ── Private: read prior requirements ─────────────────────────────────────

  async #readPriorRequirements(
    base: ThreadSnapshot,
    priorArtifact: ThreadArtifact,
    proposal: RequirementsProposal,
    target: RequirementsTarget,
  ): Promise<{
    readonly requirements: readonly OracleRequirement[];
    readonly requirementsElementId: string;
    readonly authoritativeConstraintUsages:
      readonly RequirementsCaptureConstraintUsage[];
  }> {
    const text = await this.#captures.read(priorArtifact.fingerprint);
    if (!text) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The prior requirements capture is not durably readable.",
      );
    }
    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The prior requirements capture is invalid JSON.",
      );
    }
    let priorRecord: ExactRequirementsCapture;
    try {
      priorRecord = parseExactRequirementsCapture(record);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The prior requirements capture is not exact requirements-capture/3.0 evidence: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (
      priorRecord.containerComponent !== proposal.containerComponent ||
      priorRecord.partDefName !== proposal.partDefName
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The prior requirements capture does not match the expected schema or target component.",
      );
    }
    const operation = priorRecord.operation;
    const architecture = priorRecord.architecture;
    const historicalArchitecture = base.artifacts.find((artifact) =>
      artifact.id === architecture.artifactId
    );
    const requirementsInputs = priorArtifact.inputArtifactIds.flatMap((id) => {
      const artifact = base.artifacts.find((candidate) => candidate.id === id);
      return artifact?.uri?.startsWith(
          requirementsUriPrefix(proposal.containerComponent),
        )
        ? [artifact]
        : [];
    });
    const predecessorRequirementsArtifact = requirementsInputs.length === 1
      ? requirementsInputs[0]
      : undefined;
    const architectureBasis = priorRecord.architectureBasis;
    const priorSeed = priorRecord.seed;
    if (
      priorArtifact.id !==
        `requirements-${proposal.containerComponent}-${priorArtifact.fingerprint.digest}` ||
      priorArtifact.kind !== "sysml-model" ||
      priorArtifact.uri !== requirementsUriFor(
          proposal.containerComponent,
          priorArtifact.fingerprint,
        ) ||
      priorArtifact.mediaType !== "application/json" ||
      priorArtifact.producer.serverId !== "syson" ||
      priorArtifact.producer.tool !== "syson_element_insert_sysml" ||
      operation?.id !== MODEL_WRITE_REQUIREMENTS_OPERATION.id ||
      operation.version !== MODEL_WRITE_REQUIREMENTS_OPERATION.version ||
      priorRecord.trustedRunId !== priorArtifact.producer.runId ||
      typeof priorRecord.insertedAt !== "string" ||
      !isExactIsoTimestamp(priorRecord.insertedAt) ||
      !architecture || !historicalArchitecture ||
      historicalArchitecture.id !==
        `architecture-${historicalArchitecture.fingerprint.digest}` ||
      historicalArchitecture.kind !== "sysml-model" ||
      historicalArchitecture.uri !==
        `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${historicalArchitecture.fingerprint.digest}` ||
      historicalArchitecture.mediaType !== "application/json" ||
      historicalArchitecture.producer.serverId !== "syson" ||
      historicalArchitecture.producer.tool !== "syson_element_insert_sysml" ||
      !isContentFingerprint(architecture.fingerprint) ||
      !fingerprintsEqual(
        architecture.fingerprint,
        historicalArchitecture.fingerprint,
      ) ||
      architecture.producerRunId !== historicalArchitecture.producer.runId ||
      new Set(priorArtifact.inputArtifactIds).size !==
        priorArtifact.inputArtifactIds.length ||
      requirementsInputs.length > 1 ||
      priorArtifact.inputArtifactIds.length !==
        1 + (predecessorRequirementsArtifact ? 1 : 0) ||
      !priorArtifact.inputArtifactIds.includes(historicalArchitecture.id) ||
      (predecessorRequirementsArtifact !== undefined &&
        (predecessorRequirementsArtifact.id !==
            `requirements-${proposal.containerComponent}-${predecessorRequirementsArtifact.fingerprint.digest}` ||
          predecessorRequirementsArtifact.kind !== "sysml-model" ||
          predecessorRequirementsArtifact.uri !== requirementsUriFor(
              proposal.containerComponent,
              predecessorRequirementsArtifact.fingerprint,
            ) ||
          predecessorRequirementsArtifact.mediaType !== "application/json" ||
          predecessorRequirementsArtifact.producer.serverId !== "syson" ||
          predecessorRequirementsArtifact.producer.tool !==
            "syson_element_insert_sysml"))
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The prior requirements artifact/capture pair is not exact requirements-capture/3.0 evidence " +
          "anchored to its historical architecture artifact.",
      );
    }
    const derivedInputs = base.provenance.filter((link) =>
      link.relation === "derived_from" && link.from.kind === "artifact" &&
      link.from.id === priorArtifact.id && link.to.kind === "artifact"
    ).map((link) => link.to.id);
    const expectedDerivedInputs = [
      historicalArchitecture.id,
      ...(predecessorRequirementsArtifact ? [predecessorRequirementsArtifact.id] : []),
    ];
    if (
      derivedInputs.length !== expectedDerivedInputs.length ||
      new Set(derivedInputs).size !== derivedInputs.length ||
      expectedDerivedInputs.some((id) => !derivedInputs.includes(id))
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The prior requirements Thread lineage is not a bijective architecture plus " +
          "optional single requirements-predecessor chain.",
      );
    }
    const historicalCaptureText = await this.#architectureCaptures.read(
      historicalArchitecture.fingerprint,
    );
    let historicalCapture: ParsedArchCapture;
    try {
      if (!historicalCaptureText) throw new Error("capture is absent");
      historicalCapture = parseArchCapture(historicalCaptureText);
      if (deterministicJson(historicalCapture) !== historicalCaptureText) {
        throw new Error("capture is not canonical JSON");
      }
      if (
        !fingerprintsEqual(
          await sha256Fingerprint(historicalCapture),
          historicalArchitecture!.fingerprint,
        )
      ) {
        throw new Error("capture fingerprint is not exact");
      }
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The historical architecture capture is not exact architecture-capture/4.0 evidence: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    try {
      await requireCurrentArchitectureSourceAnalyses(
        historicalCapture.sourceAnalyses,
        this.#sysmlSourceAnalysis,
        {
          runId: historicalArchitecture!.producer.runId,
          operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
          packageName: historicalCapture.packageName,
        },
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Historical architecture source-analysis evidence is not exact: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const basisSnapshot = architectureBasis &&
        typeof architectureBasis.snapshotId === "string"
      ? await this.#snapshots.get(architectureBasis.snapshotId)
      : undefined;
    const historicalSeedArtifact = basisSnapshot?.artifacts.find((artifact) =>
      artifact.id === historicalCapture.seed.artifactId
    );
    const historicalPredecessor = historicalCapture.predecessor
      ? basisSnapshot?.artifacts.find((artifact) =>
        artifact.id === historicalCapture.predecessor!.artifactId
      )
      : undefined;
    const expectedHistoricalInputs = historicalSeedArtifact
      ? [
        historicalSeedArtifact.id,
        ...(historicalPredecessor ? [historicalPredecessor.id] : []),
      ]
      : [];
    if (
      !architectureBasis || typeof architectureBasis.snapshotId !== "string" ||
      !Number.isSafeInteger(architectureBasis.revision) ||
      architectureBasis.fingerprint !==
        historicalArchitecture.fingerprint.digest ||
      !basisSnapshot || basisSnapshot.id !== architectureBasis.snapshotId ||
      basisSnapshot.revision !== architectureBasis.revision ||
      basisSnapshot.subject.id !== base.subject.id ||
      !basisSnapshot.artifacts.some((artifact) =>
        artifact.id === historicalArchitecture.id &&
        deterministicJson(artifact) ===
          deterministicJson(historicalArchitecture)
      ) ||
      historicalCapture.trustedRunId !==
        historicalArchitecture.producer.runId ||
      !historicalSeedArtifact ||
      historicalSeedArtifact.id !==
        `syson-model-seed-${historicalSeedArtifact.fingerprint.digest}` ||
      historicalSeedArtifact.kind !== "sysml-model" ||
      historicalSeedArtifact.uri !==
        `casys://syson-model-seed-capture/sha256/${historicalSeedArtifact.fingerprint.digest}` ||
      historicalSeedArtifact.mediaType !== "application/json" ||
      historicalSeedArtifact.producer.serverId !== "syson" ||
      historicalSeedArtifact.producer.tool !== "syson_model_create" ||
      historicalSeedArtifact.producer.runId !==
        historicalCapture.seed.producerRunId ||
      !fingerprintsEqual(
        historicalSeedArtifact.fingerprint,
        historicalCapture.seed.fingerprint,
      ) ||
      (historicalCapture.predecessor !== undefined &&
        (!historicalPredecessor ||
          historicalPredecessor.id !==
            `architecture-${historicalPredecessor.fingerprint.digest}` ||
          historicalPredecessor.kind !== "sysml-model" ||
          historicalPredecessor.uri !==
            `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${historicalPredecessor.fingerprint.digest}` ||
          historicalPredecessor.mediaType !== "application/json" ||
          historicalPredecessor.producer.serverId !== "syson" ||
          historicalPredecessor.producer.tool !==
            "syson_element_insert_sysml" ||
          historicalPredecessor.producer.runId !==
            historicalCapture.predecessor.producerRunId ||
          !fingerprintsEqual(
            historicalPredecessor.fingerprint,
            historicalCapture.predecessor.fingerprint,
          ))) ||
      historicalArchitecture.inputArtifactIds.length !==
        expectedHistoricalInputs.length ||
      new Set(historicalArchitecture.inputArtifactIds).size !==
        historicalArchitecture.inputArtifactIds.length ||
      expectedHistoricalInputs.some((id) =>
        !historicalArchitecture.inputArtifactIds.includes(id)
      ) ||
      !priorSeed || typeof priorSeed.artifactId !== "string" ||
      typeof priorSeed.producerRunId !== "string" ||
      !isContentFingerprint(priorSeed.fingerprint) ||
      priorSeed.artifactId !== historicalCapture.seed.artifactId ||
      priorSeed.producerRunId !== historicalCapture.seed.producerRunId ||
      !fingerprintsEqual(
        priorSeed.fingerprint,
        historicalCapture.seed.fingerprint,
      )
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The prior requirements capture basis or seed anchor diverges from its " +
          "historical architecture evidence.",
      );
    }
    const rawTarget = priorRecord.target;
    if (
      rawTarget.kind !== target.kind || rawTarget.label !== target.label ||
      rawTarget.elementId !== target.elementId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The prior requirements capture targets a different SysON PartDefinition " +
          `than "${target.label}" (${target.elementId}). A target identity change ` +
          "requires an explicit reviewed transition, not in-place enrichment.",
      );
    }
    // BLOQUANT identity anchor: the capture records which SysON element was
    // inserted. The enrichment path uses this to verify the element found by
    // label is the same one — a homonyme must be refused, not silently deleted.
    const rawReqsElementId = priorRecord.requirementsElementId;
    const validated = priorRecord.requirements;

    // The capture and active Thread projection are one indivisible predecessor
    // proof. A valid JSON capture is insufficient if its TracedRequirement set
    // is missing, extra, archived, or points at another architecture/element.
    const archived = archivedRefKeys(base);
    const projected = base.requirements.filter((requirement) =>
      requirement.trace.sourceArtifactId === priorArtifact.id &&
      !archived.has(`requirement:${requirement.id}`)
    );
    const expectedIds = new Set(
      validated.map((requirement) =>
        `requirement-${priorArtifact.fingerprint.digest}-${requirement.id}`
      ),
    );
    if (projected.length !== validated.length) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The active Thread requirements projection is not one-to-one with its prior capture.",
      );
    }
    const projectedById = new Map(projected.map((item) => [item.id, item]));
    const expectedTraceLinks: ThreadProvenanceLink[] = [];
    for (const expected of validated) {
      const expectedId =
        `requirement-${priorArtifact.fingerprint.digest}-${expected.id}`;
      const expectedProjection: TracedRequirement = {
        id: expectedId,
        name: expected.name,
        statement: `${expected.name}: ${expected.metric} ${expected.operator} ` +
          `${expected.limit.value} ${expected.limit.unit}.`,
        version: priorArtifact.fingerprint.digest,
        criterion: {
          metric: expected.metric,
          operator: expected.operator,
          limit: {
            value: expected.limit.value,
            unit: expected.limit.unit,
          },
        },
        trace: {
          sourceArtifactId: priorArtifact.id,
          elementId: rawReqsElementId,
          targetArtifactIds: [historicalArchitecture.id],
        },
        freshness: {
          status: "fresh",
          changedAt: priorRecord.insertedAt as string,
          invalidatedByChangeIds: [],
        },
      };
      const projectedRequirement = projectedById.get(expectedId);
      if (
        !projectedRequirement || !expectedIds.has(projectedRequirement.id) ||
        deterministicJson(projectedRequirement) !==
          deterministicJson(expectedProjection)
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The active Thread requirements projection diverges from its prior capture.",
        );
      }
      expectedTraceLinks.push({
        id: `traces-to-target-${expectedId}`,
        relation: "traces_to",
        from: { kind: "requirement", id: expectedId },
        to: { kind: "artifact", id: historicalArchitecture.id },
        rationale: `The requirement constrains PartDefinition "${target.label}" ` +
          `(${target.elementId}) inside this architecture artifact.`,
      });
    }
    const observedTraceLinks = base.provenance.filter((link) =>
      link.relation === "traces_to" && link.from.kind === "requirement" &&
      expectedIds.has(link.from.id)
    );
    if (
      observedTraceLinks.length !== expectedTraceLinks.length ||
      expectedTraceLinks.some((expected) => {
        const observed = observedTraceLinks.find((link) => link.id === expected.id);
        return !observed ||
          deterministicJson(observed) !== deterministicJson(expected);
      })
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The active Thread requirements trace projection diverges from its prior capture.",
      );
    }

    const expectedConsumptions: ThreadArtifactConsumption[] = [
      {
        id: `consume-${historicalArchitecture.id}-by-${priorArtifact.id}`,
        artifactId: historicalArchitecture.id,
        consumer: priorArtifact.producer,
        observedFingerprint: historicalArchitecture.fingerprint,
        verifiedAt: priorRecord.insertedAt as string,
        status: "verified",
      },
      ...(predecessorRequirementsArtifact
        ? [{
          id: `consume-${predecessorRequirementsArtifact.id}-by-${priorArtifact.id}`,
          artifactId: predecessorRequirementsArtifact.id,
          consumer: priorArtifact.producer,
          observedFingerprint: predecessorRequirementsArtifact.fingerprint,
          verifiedAt: priorRecord.insertedAt as string,
          status: "verified" as const,
        }]
        : []),
    ];
    const observedConsumptions = base.consumptions.filter((consumption) =>
      deterministicJson(consumption.consumer) ===
        deterministicJson(priorArtifact.producer)
    );
    if (
      observedConsumptions.length !== expectedConsumptions.length ||
      expectedConsumptions.some((expected) => {
        const observed = observedConsumptions.find((item) => item.id === expected.id);
        return !observed ||
          deterministicJson(observed) !== deterministicJson(expected);
      })
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The prior requirements consumption projection is not exact.",
      );
    }
    const expectedUses: ThreadProvenanceLink[] = [
      {
        id: `uses-consume-${historicalArchitecture.id}-by-${priorArtifact.id}`,
        relation: "uses",
        from: {
          kind: "consumption",
          id: `consume-${historicalArchitecture.id}-by-${priorArtifact.id}`,
        },
        to: { kind: "artifact", id: historicalArchitecture.id },
        rationale:
          "The executor read the exact architecture capture to resolve the target element.",
      },
      ...(predecessorRequirementsArtifact
        ? [{
          id: `uses-consume-prior-requirements-${priorArtifact.fingerprint.digest}`,
          relation: "uses" as const,
          from: {
            kind: "consumption" as const,
            id: `consume-${predecessorRequirementsArtifact.id}-by-${priorArtifact.id}`,
          },
          to: {
            kind: "artifact" as const,
            id: predecessorRequirementsArtifact.id,
          },
          rationale:
            "The executor read the exact prior requirements capture to plan the enrichment.",
        }]
        : []),
    ];
    const expectedConsumptionIds = new Set(
      expectedConsumptions.map((consumption) => consumption.id),
    );
    const observedUses = base.provenance.filter((link) =>
      link.relation === "uses" && link.from.kind === "consumption" &&
      expectedConsumptionIds.has(link.from.id)
    );
    if (
      observedUses.length !== expectedUses.length ||
      expectedUses.some((expected) => {
        const observed = observedUses.find((link) => link.id === expected.id);
        return !observed ||
          deterministicJson(observed) !== deterministicJson(expected);
      })
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The prior requirements uses provenance is not exact.",
      );
    }
    return {
      requirements: validated,
      requirementsElementId: rawReqsElementId,
      authoritativeConstraintUsages: priorRecord.constraintUsages,
    };
  }

  // ── Private: D5 identification by label ──────────────────────────────────

  /**
   * Return the element id of the first child whose label matches partDefName,
   * or undefined if no match exists.
   *
   * Used in the pre-WAL enrichment lookup: we need the prior element id before
   * entering the WAL dispatch, so that the delete + reinsert pair can be
   * journaled under the same WAL entry. Returns undefined when the element does
   * not yet exist (initial write) or has already been manually removed.
   *
   * Throws RequirementsWriteOutcomeUnknownError when the children call fails
   * (transport error) — the executor cannot safely proceed without knowing
   * whether the prior element exists.
   */
  async #findElementByLabelOrUndefined(
    editingContextId: string,
    parentId: string,
    partDefName: string,
  ): Promise<string | undefined> {
    let children: readonly unknown[];
    try {
      const result = await this.#syson.callTool({
        name: "syson_element_children",
        arguments: {
          editing_context_id: editingContextId,
          element_id: parentId,
        },
      });
      children = parseProviderChildren(result.structuredContent, parentId);
    } catch (error) {
      if (!(error instanceof EngineeringProjectCommandError)) {
        throw new RequirementsWriteOutcomeUnknownError();
      }
      throw error;
    }
    const matches = children.filter(
      (child) =>
        typeof child === "object" && child !== null &&
        (child as Record<string, unknown>).label === partDefName,
    );
    if (matches.length === 0) return undefined;
    if (matches.length > 1) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `D5 ambiguity before enrichment: ${matches.length} elements with label "${partDefName}" ` +
          `under target "${parentId}". Manual inspection required before enrichment.`,
      );
    }
    const match = matches[0] as Record<string, unknown>;
    if (typeof match.id !== "string" || !match.id.trim()) {
      throw new RequirementsWriteOutcomeUnknownError();
    }
    return match.id;
  }

  async #identifyByLabelOrFail(
    editingContextId: string,
    parentId: string,
    partDefName: string,
  ): Promise<string> {
    let children: readonly unknown[];
    try {
      const result = await this.#syson.callTool({
        name: "syson_element_children",
        arguments: {
          editing_context_id: editingContextId,
          element_id: parentId,
        },
      });
      children = parseProviderChildren(result.structuredContent, parentId);
    } catch (error) {
      if (!(error instanceof EngineeringProjectCommandError)) {
        throw new RequirementsWriteOutcomeUnknownError();
      }
      throw error;
    }

    const matches = children.filter(
      (child) =>
        typeof child === "object" && child !== null &&
        (child as Record<string, unknown>).label === partDefName,
    );
    if (matches.length === 0) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `D5 identification failed: element with label "${partDefName}" not found ` +
          `in children of target "${parentId}" after insertion.`,
      );
    }
    if (matches.length > 1) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `D5 identification ambiguous: ${matches.length} elements with label "${partDefName}" ` +
          `in children of target "${parentId}". Manual inspection required.`,
      );
    }
    const match = matches[0] as Record<string, unknown>;
    if (typeof match.id !== "string" || !match.id.trim()) {
      throw new RequirementsWriteOutcomeUnknownError();
    }
    return match.id;
  }

  /**
   * Prove the provider-native target binding after insertion/readback.
   *
   * The declaration must be a RequirementUsage owned by the resolved target
   * PartDefinition, carry one `subject target` ReferenceUsage typed by that
   * exact PartDefinition, and contain at least one required ConstraintUsage.
   * The subsequent constraint extractor verifies the predicates themselves.
   */
  async #verifyTargetedRequirementUsage(
    editingContextId: string,
    requirementsElementId: string,
    requirementName: string,
    target: RequirementsTarget,
  ): Promise<readonly string[]> {
    const element = await this.#syson.callTool({
      name: "syson_element_get",
      arguments: {
        editing_context_id: editingContextId,
        element_id: requirementsElementId,
      },
    });
    const elementKind = element.structuredContent.kind;
    if (
      element.structuredContent.id !== requirementsElementId ||
      element.structuredContent.label !== requirementName ||
      !isSysmlEntityKind(elementKind, "RequirementUsage")
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements target binding failed: SysON readback is not the exact " +
          `RequirementUsage "${requirementName}" (${requirementsElementId}).`,
      );
    }

    const childrenResult = await this.#syson.callTool({
      name: "syson_element_children",
      arguments: {
        editing_context_id: editingContextId,
        element_id: requirementsElementId,
      },
    });
    const children = parseProviderChildren(
      childrenResult.structuredContent,
      requirementsElementId,
    );
    const subjects = children.filter((child) =>
      isProviderChild(child, "target", "ReferenceUsage")
    );
    const constraints = children.filter((child) =>
      isProviderChild(child, undefined, "ConstraintUsage")
    );
    if (subjects.length !== 1 || constraints.length === 0) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements target binding failed: the native RequirementUsage must " +
          "contain exactly one subject named target and at least one required constraint.",
      );
    }
    const subjectId = (subjects[0] as Record<string, unknown>).id;
    if (typeof subjectId !== "string" || !subjectId.trim()) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements target binding failed: the subject has no provider identity.",
      );
    }
    const constraintUsageIds = constraints.map((constraint) =>
      (constraint as Record<string, unknown>).id as string
    );
    if (
      new Set(constraintUsageIds).size !== constraintUsageIds.length ||
      constraintUsageIds.includes(subjectId)
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements target binding failed: native child identities are not " +
          "a unique ConstraintUsage set disjoint from the subject.",
      );
    }

    const typing = await this.#syson.callTool({
      name: "syson_query_aql",
      arguments: {
        editing_context_id: editingContextId,
        object_id: subjectId,
        expression: ARCHITECTURE_FEATURE_TYPING_AQL,
      },
    });
    const response = typing.structuredContent;
    const results = response.results;
    if (
      response.objectId !== subjectId ||
      response.expression !== ARCHITECTURE_FEATURE_TYPING_AQL ||
      response.type !== "objects" || response.count !== 1 ||
      !Array.isArray(results) || results.length !== 1 ||
      !isExactProviderTarget(results[0], target)
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Requirements target binding failed: subject target is not typed by the " +
          `exact PartDefinition "${target.label}" (${target.elementId}).`,
      );
    }
    return Object.freeze(constraintUsageIds);
  }

  // ── Private: WAL helpers ──────────────────────────────────────────────────

  async #walBeginOrFail(
    projectId: string,
    runId: string,
    planDigest: string,
    dispatchedAt: string,
  ): Promise<Awaited<ReturnType<FileRequirementsAttemptStore["begin"]>>> {
    // Check for quarantine BEFORE any new WAL entry — the enrichment preflight
    // produces a different planDigest after a partial insertion, so the original
    // entry would not be found and a second insertion would happen without this guard.
    if (await this.#attempts.isQuarantined(projectId, runId)) {
      throw new RequirementsRunQuarantinedError();
    }
    try {
      return await this.#attempts.begin({
        projectId,
        runId,
        planDigest,
        dispatchedAt,
      });
    } catch (error) {
      if (error instanceof RequirementsWriteOutcomeUnknownError) throw error;
      throw new RequirementsWriteOutcomeUnknownError();
    }
  }

  async #runAttemptOrFail(
    projectId: string,
    runId: string,
  ): Promise<Awaited<ReturnType<FileRequirementsAttemptStore["readRun"]>>> {
    try {
      if (await this.#attempts.isQuarantined(projectId, runId)) {
        throw new RequirementsRunQuarantinedError();
      }
      const attempt = await this.#attempts.readRun(projectId, runId);
      if (attempt?.status === "dispatched") {
        throw new RequirementsWriteOutcomeUnknownError();
      }
      return attempt;
    } catch (error) {
      if (
        error instanceof RequirementsWriteOutcomeUnknownError ||
        error instanceof RequirementsRunQuarantinedError
      ) throw error;
      throw new RequirementsWriteOutcomeUnknownError();
    }
  }

  // ── Private: completed path helpers ──────────────────────────────────────

  async #completedFor(
    command: ModelWriteRequirementsRunExecutorCommand,
    proposal: RequirementsProposal,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (
      run.status !== "completed" ||
      !project.commandReceipts?.some(
        (receipt) => receipt.commandId === commandStep(command.commandId, "complete"),
      )
    ) return undefined;
    await this.#assertCompletedEvidenceExact(project, command, proposal);
    return project;
  }

  async #assertCompletedEvidenceExact(
    project: EngineeringProjectSnapshot,
    command: ModelWriteRequirementsRunExecutorCommand,
    proposal: RequirementsProposal,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    const result = run.resultSnapshot;
    if (!result) {
      throw completedRequirementsIntegrityError(
        "the run has no result snapshot",
      );
    }
    const snapshot = await this.#snapshots.get(result.snapshotId);
    if (
      !snapshot || snapshot.id !== result.snapshotId ||
      snapshot.revision !== result.revision ||
      snapshot.subject.id !== result.subjectId ||
      !project.threadSnapshots.some((reference) =>
        reference.snapshotId === result.snapshotId &&
        reference.revision === result.revision &&
        reference.subjectId === result.subjectId
      )
    ) {
      throw completedRequirementsIntegrityError(
        "the exact result snapshot is not durably attached to the project",
      );
    }
    try {
      validateThreadSnapshot(snapshot);
      await assertThreadSnapshotLineageIntact(snapshot, this.#snapshots);
    } catch (error) {
      throw completedRequirementsIntegrityError(
        `the result snapshot or its lineage is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const basis = requireBasis(run);
    if (
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision ||
      snapshot.subject.id !== basis.subjectId
    ) {
      throw completedRequirementsIntegrityError(
        "the result snapshot does not directly extend the run's exact basis",
      );
    }
    const base = await exactSnapshot(this.#snapshots, basis);
    if (
      base.subject.id !== basis.subjectId ||
      deterministicJson(snapshot.previous) !== deterministicJson({
          snapshotId: base.id,
          revision: base.revision,
        })
    ) {
      throw completedRequirementsIntegrityError(
        "the durable basis identity or direct predecessor link diverges",
      );
    }

    const architectureArtifact = findArchitectureArtifact(base);
    if (!architectureArtifact) {
      throw completedRequirementsIntegrityError(
        "the basis has no unique architecture artifact",
      );
    }
    const { archCapture, target } = await this.#resolveTargetFromArchitecture(
      base,
      architectureArtifact,
      proposal,
    );
    const priorRequirementsArtifact = requireRequirementsTip(
      base,
      proposal.containerComponent,
    );
    const requirements = requirementEntriesToOracleRequirements(
      proposal.requirements,
    );
    const planDigest = await requirementsPlanDigest(
      requirements,
      proposal.partDefName,
      target,
    );
    const attempt = await this.#runAttemptOrFail(project.project.id, run.id);
    if (
      attempt?.status !== "completed" || attempt.planDigest !== planDigest ||
      !attempt.result?.requirementsElementId
    ) {
      throw completedRequirementsIntegrityError(
        "the completed WAL does not carry the exact plan and RequirementUsage identity",
      );
    }
    const requirementsElementId = attempt.result.requirementsElementId;
    const capturedAt = requiredStart(run);

    // ConstraintUsage UUIDs are provider readback facts, not values that can be
    // recomputed from the signed proposal or the insertion WAL. On completed
    // replay, reopen them only through the single evidence artifact already
    // attached to the immutable result snapshot, then rebuild the whole capture
    // and extension around those identities before accepting the result.
    if (run.evidenceRefs.length !== 1) {
      throw completedRequirementsIntegrityError(
        "the run does not have exactly one requirements evidence reference",
      );
    }
    const evidence = run.evidenceRefs[0]!;
    if (
      evidence.kind !== "artifact" || evidence.snapshotId !== snapshot.id ||
      evidence.snapshotRevision !== snapshot.revision
    ) {
      throw completedRequirementsIntegrityError(
        "the evidence reference is not exactly bound to the result snapshot",
      );
    }
    const matchingArtifacts = snapshot.artifacts.filter((candidate) =>
      candidate.id === evidence.id
    );
    if (matchingArtifacts.length !== 1) {
      throw completedRequirementsIntegrityError(
        "the requirements evidence artifact is not present exactly once",
      );
    }
    const artifact = matchingArtifacts[0]!;
    let text: string | undefined;
    try {
      text = await this.#captures.read(artifact.fingerprint);
    } catch (error) {
      throw completedRequirementsIntegrityError(
        `the capture failed content-addressed readback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!text) {
      throw completedRequirementsIntegrityError(
        "the requirements capture is not durably readable",
      );
    }
    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch {
      throw completedRequirementsIntegrityError(
        "the requirements capture is invalid JSON",
      );
    }
    let recordedCapture: ExactRequirementsCapture;
    try {
      recordedCapture = parseExactRequirementsCapture(record);
    } catch (error) {
      throw completedRequirementsIntegrityError(
        `the requirements capture is not exact requirements-capture/3.0 evidence: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const captureOptions = {
      proposal,
      target,
      architectureArtifact,
      architectureBasis: basis,
      archCaptureSchema: archCapture.schemaVersion,
      seedArtifactId: archCapture.seed.artifactId,
      seedFingerprint: archCapture.seed.fingerprint,
      seedProducerRunId: archCapture.seed.producerRunId,
      requirementsElementId,
      requirements,
      runId: run.id,
      capturedAt,
    };
    const expectedCapture = buildCaptureRecord({
      ...captureOptions,
      constraintUsages: recordedCapture.constraintUsages,
    });
    const captureFp = await sha256Fingerprint(expectedCapture);
    const captureUri = requirementsUriFor(
      proposal.containerComponent,
      captureFp,
    );
    const expectedExtension = buildExtension({
      base,
      proposal,
      architectureArtifact,
      priorRequirementsArtifact,
      target,
      runId: run.id,
      capturedAt,
      captureFp,
      captureUri,
      requirements,
      requirementsElementId,
    });
    const reapplied = applyThreadSnapshotExtensionIfNew(
      base,
      expectedExtension,
    );
    if (
      !reapplied.applied ||
      deterministicJson(reapplied.snapshot) !== deterministicJson(snapshot)
    ) {
      throw completedRequirementsIntegrityError(
        "the result is not the exact requirements extension of its immutable basis",
      );
    }

    const expectedArtifactId =
      `requirements-${proposal.containerComponent}-${captureFp.digest}`;
    if (
      evidence.kind !== "artifact" || evidence.id !== expectedArtifactId ||
      evidence.snapshotId !== snapshot.id ||
      evidence.snapshotRevision !== snapshot.revision
    ) {
      throw completedRequirementsIntegrityError(
        "the evidence reference is not exactly bound to the reconstructed result",
      );
    }
    if (
      artifact.id !== expectedArtifactId ||
      !fingerprintsEqual(artifact.fingerprint, captureFp)
    ) {
      throw completedRequirementsIntegrityError(
        "the reconstructed requirements artifact identity is absent",
      );
    }
    if (
      !record || typeof record !== "object" || Array.isArray(record) ||
      deterministicJson(record) !== deterministicJson(expectedCapture)
    ) {
      throw completedRequirementsIntegrityError(
        "the capture no longer exactly seals its target, basis, seed, requirements, provider identity, and insertion time",
      );
    }
    const observed = await sha256Fingerprint(record);
    if (!fingerprintsEqual(observed, captureFp)) {
      throw completedRequirementsIntegrityError(
        "the capture fingerprint no longer matches its exact evidence bytes",
      );
    }

    // Reuse the enrichment-grade parser against the result artifact itself.
    // This independently proves exact artifact lineage, historical architecture
    // and seed anchors, and the active TracedRequirement projection.
    const parsedResult = await this.#readPriorRequirements(
      snapshot,
      artifact,
      proposal,
      target,
    );
    if (
      parsedResult.requirementsElementId !== requirementsElementId ||
      deterministicJson(parsedResult.requirements) !==
        deterministicJson(requirements)
    ) {
      throw completedRequirementsIntegrityError(
        "the result capture and Thread projection diverge from the signed requirements or completed WAL identity",
      );
    }
  }

  // ── Private: lifecycle helpers ────────────────────────────────────────────

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: ModelWriteRequirementsRunExecutorCommand,
    failure = {
      code: "model-write-requirements-not-published",
      message: "The generic requirements run stopped before evidence was published.",
    },
    required = false,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        (run.status !== "running" && run.status !== "publishing") ||
        run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary: failure.code ===
            "model-write-requirements-post-acknowledgement-quarantined"
          ? "Generic requirements run quarantined after an acknowledged SysON insertion."
          : "Generic requirements run stopped before evidence was published.",
        code: failure.code,
        message: failure.message,
      });
    } catch {
      if (required) {
        throw new Error("Could not record requirements run failure.");
      }
    }
  }

  async #reconcileLive(subjectId: string, runId: string): Promise<void> {
    try {
      await this.#liveUpdates?.reconcileRunOnce(subjectId, runId, this.#now());
    } catch {
      // Optional presentation journal.
    }
  }

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

function parseArchCapture(text: string): ParsedArchCapture {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Architecture capture is not JSON.");
  }
  return parseExactArchitectureCapture(value);
}

function isExactIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

// ── Private: capture record builder ──────────────────────────────────────────

interface RequirementsCaptureBuildOptions {
  proposal: RequirementsProposal;
  target: RequirementsTarget;
  architectureArtifact: ThreadArtifact;
  architectureBasis: EngineeringThreadSnapshotBasis;
  archCaptureSchema: string;
  seedArtifactId: string;
  seedFingerprint: ContentFingerprint;
  seedProducerRunId: string;
  requirementsElementId: string;
  requirements: readonly OracleRequirement[];
  runId: string;
  capturedAt: string;
}

function buildCaptureRecord(
  options: RequirementsCaptureBuildOptions & {
    constraintUsages: readonly VerifiedConstraintUsageIdentity[];
  },
): ExactRequirementsCapture {
  const record = {
    schemaVersion: REQUIREMENTS_CAPTURE_SCHEMA,
    ...buildCaptureRecordBase(options),
    requirementUsage: {
      id: options.requirementsElementId,
      kind: "RequirementUsage",
    },
    constraintUsages: options.constraintUsages
      .map((constraint) => ({
        requirementId: constraint.requirementId,
        id: constraint.id,
        kind: constraint.kind,
        sourceId: constraint.sourceId,
      }))
      .sort((left, right) =>
        left.requirementId < right.requirementId
          ? -1
          : left.requirementId > right.requirementId
          ? 1
          : 0
      ),
  };
  const parsed = parseExactRequirementsCapture(record);
  if (parsed.schemaVersion !== REQUIREMENTS_CAPTURE_SCHEMA) {
    throw new Error(
      "The current requirements capture builder did not produce schema 3.0.",
    );
  }
  return parsed;
}

function buildCaptureRecordBase(options: RequirementsCaptureBuildOptions) {
  return {
    operation: MODEL_WRITE_REQUIREMENTS_OPERATION,
    trustedRunId: options.runId,
    containerComponent: options.proposal.containerComponent,
    partDefName: options.proposal.partDefName,
    target: {
      kind: options.target.kind,
      label: options.target.label,
      elementId: options.target.elementId,
    },
    architectureBasis: {
      snapshotId: options.architectureBasis.snapshotId,
      revision: options.architectureBasis.revision,
      fingerprint: options.architectureArtifact.fingerprint.digest,
    },
    requirements: options.requirements,
    seed: {
      artifactId: options.seedArtifactId,
      fingerprint: options.seedFingerprint,
      producerRunId: options.seedProducerRunId,
    },
    architecture: {
      artifactId: options.architectureArtifact.id,
      fingerprint: options.architectureArtifact.fingerprint,
      producerRunId: options.architectureArtifact.producer.runId,
    },
    requirementsElementId: options.requirementsElementId,
    insertedAt: options.capturedAt,
  };
}

// ── Private: thread extension builder ────────────────────────────────────────

/**
 * Compute the complete active retirement closure for a requirements capture.
 * Evaluations and violations are current-state claims downstream of the prior
 * TracedRequirement and must retire with it during supersession.
 */
export function computePriorRequirementsArchiveCascade(
  base: ThreadSnapshot,
  priorRequirementsArtifact: ThreadArtifact,
): ReadonlyArray<ThreadEntityRef> {
  const roots: ThreadEntityRef[] = base.requirements
    .filter((requirement) =>
      requirement.trace.sourceArtifactId === priorRequirementsArtifact.id
    )
    .map((requirement) => ({ kind: "requirement", id: requirement.id }));
  return computeArchiveCascade(base, roots).map((entry) => entry.ref);
}

function buildExtension(options: {
  base: ThreadSnapshot;
  proposal: RequirementsProposal;
  architectureArtifact: ThreadArtifact;
  priorRequirementsArtifact: ThreadArtifact | undefined;
  target: RequirementsTarget;
  runId: string;
  capturedAt: string;
  captureFp: ContentFingerprint;
  captureUri: string;
  requirements: readonly OracleRequirement[];
  requirementsElementId: string;
}) {
  const {
    base,
    proposal,
    architectureArtifact,
    priorRequirementsArtifact,
    runId,
    capturedAt,
    captureFp,
    captureUri,
  } = options;

  const artifactId = `requirements-${proposal.containerComponent}-${captureFp.digest}`;
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const producer: ThreadOperationRef = {
    serverId: "syson",
    tool: "syson_element_insert_sysml",
    runId,
  };

  const inputArtifactIds = [
    architectureArtifact.id,
    ...(priorRequirementsArtifact ? [priorRequirementsArtifact.id] : []),
  ];

  const artifact: ThreadArtifact = {
    id: artifactId,
    name: `Requirements: ${proposal.containerComponent}`,
    kind: "sysml-model",
    version: captureFp.digest,
    fingerprint: captureFp,
    uri: captureUri,
    mediaType: "application/json",
    producer,
    inputArtifactIds,
    freshness,
  };

  const extensionId =
    `model-write-requirements-${proposal.containerComponent}-${captureFp.digest}`;

  // Consumption of the architecture artifact.
  const archConsumptionId = `consume-${architectureArtifact.id}-by-${artifactId}`;
  const archConsumption: ThreadArtifactConsumption = {
    id: archConsumptionId,
    artifactId: architectureArtifact.id,
    consumer: producer,
    // The architecture artifact's observedFingerprint is its own fingerprint
    // (not the captureFp) — we read and verified its bytes.
    observedFingerprint: architectureArtifact.fingerprint,
    verifiedAt: capturedAt,
    status: "verified",
  };

  const consumptions: ThreadArtifactConsumption[] = [archConsumption];
  if (priorRequirementsArtifact) {
    consumptions.push({
      id: `consume-${priorRequirementsArtifact.id}-by-${artifactId}`,
      artifactId: priorRequirementsArtifact.id,
      consumer: producer,
      observedFingerprint: priorRequirementsArtifact.fingerprint,
      verifiedAt: capturedAt,
      status: "verified",
    });
  }

  const tracedRequirements: TracedRequirement[] = options.requirements.map((
    requirement,
  ) => ({
    id: `requirement-${captureFp.digest}-${requirement.id}`,
    name: requirement.name,
    statement: `${requirement.name}: ${requirement.metric} ${requirement.operator} ` +
      `${requirement.limit.value} ${requirement.limit.unit}.`,
    version: captureFp.digest,
    criterion: {
      metric: requirement.metric,
      operator: requirement.operator,
      limit: {
        value: requirement.limit.value,
        unit: requirement.limit.unit,
      },
    },
    trace: {
      sourceArtifactId: artifactId,
      elementId: options.requirementsElementId,
      targetArtifactIds: [architectureArtifact.id],
    },
    freshness,
  }));
  const priorRequirements = priorRequirementsArtifact
    ? base.requirements.filter((requirement) =>
      requirement.trace.sourceArtifactId === priorRequirementsArtifact.id
    )
    : [];
  const priorByMetric = new Map(
    priorRequirements.map((
      requirement,
    ) => [requirement.criterion.metric, requirement]),
  );
  const priorArchiveCascade = priorRequirementsArtifact
    ? computePriorRequirementsArchiveCascade(base, priorRequirementsArtifact)
    : [];

  const provenance: ThreadProvenanceLink[] = [
    {
      id: `derived-from-architecture-${captureFp.digest}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: artifactId },
      to: { kind: "artifact" as const, id: architectureArtifact.id },
      rationale:
        `The native RequirementUsage is owned by PartDefinition "${options.target.label}" ` +
        `(${options.target.elementId}) from the reviewed architecture capture.`,
    },
    {
      id: `uses-${archConsumptionId}`,
      relation: "uses" as const,
      from: { kind: "consumption" as const, id: archConsumptionId },
      to: { kind: "artifact" as const, id: architectureArtifact.id },
      rationale:
        "The executor read the exact architecture capture to resolve the target element.",
    },
    ...(priorRequirementsArtifact
      ? [
        {
          id: `derived-from-requirements-${captureFp.digest}`,
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: artifactId },
          to: { kind: "artifact" as const, id: priorRequirementsArtifact.id },
          rationale:
            "The prior requirements capture was read as the predecessor of this enrichment.",
        },
        {
          // validateThreadSnapshot requires a "uses" provenance link for every
          // verified consumption. The prior-requirements consumption is verified
          // and must therefore carry its own link — the architecture link alone
          // does not satisfy the per-consumption invariant.
          id: `uses-consume-prior-requirements-${captureFp.digest}`,
          relation: "uses" as const,
          from: {
            kind: "consumption" as const,
            id: `consume-${priorRequirementsArtifact.id}-by-${artifactId}`,
          },
          to: { kind: "artifact" as const, id: priorRequirementsArtifact.id },
          rationale:
            "The executor read the exact prior requirements capture to plan the enrichment.",
        },
      ]
      : []),
    ...tracedRequirements.map((requirement) => ({
      id: `traces-to-target-${requirement.id}`,
      relation: "traces_to" as const,
      from: { kind: "requirement" as const, id: requirement.id },
      to: { kind: "artifact" as const, id: architectureArtifact.id },
      rationale:
        `The requirement constrains PartDefinition "${options.target.label}" ` +
        `(${options.target.elementId}) inside this architecture artifact.`,
    })),
    ...tracedRequirements.flatMap((requirement) => {
      const prior = priorByMetric.get(requirement.criterion.metric);
      return prior
        ? [{
          id: `supersedes-${prior.id}-by-${requirement.id}`,
          relation: "supersedes" as const,
          from: { kind: "requirement" as const, id: requirement.id },
          to: { kind: "requirement" as const, id: prior.id },
          rationale:
            "This verified requirement projection replaces the prior capture version " +
            "of the same metric.",
        }]
        : [];
    }),
  ];

  return {
    id: extensionId,
    name: `Requirements: ${proposal.containerComponent}`,
    subjectId: base.subject.id,
    capturedAt,
    artifacts: [artifact],
    consumptions,
    observations: [],
    requirements: tracedRequirements,
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
    ...(priorArchiveCascade.length > 0
      ? {
        archived: priorArchiveCascade.map((target) => ({
          target,
          summary: `Requirements enrichment retired prior ${target.kind} ${target.id}.`,
        })),
      }
      : {}),
    bindingProofs: [
      {
        provider: "syson",
        kind: "element",
        id: options.requirementsElementId,
      },
      {
        provider: "syson",
        kind: "part-definition",
        id: options.target.elementId,
      },
    ],
  };
}

// ── Private: shape guards ─────────────────────────────────────────────────────

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
    operation?.id !== MODEL_WRITE_REQUIREMENTS_OPERATION.id ||
    operation.version !== MODEL_WRITE_REQUIREMENTS_OPERATION.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical model.write-requirements@1 operation.",
    );
  }
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact requirements run it claimed.",
    );
  }
}

// ── Private: MRTR approval ────────────────────────────────────────────────────

async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<{
  decision: EngineeringDecision;
  proposal: NonNullable<EngineeringDecision["proposal"]>;
}> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      `Work item for run ${run.id} not found.`,
    );
  }
  const basis = requireBasis(run);
  const candidates: Array<{
    decision: EngineeringDecision;
    proposal: NonNullable<EngineeringDecision["proposal"]>;
  }> = [];
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find(
      (d) => d.id === decisionId && d.status === "approved",
    );
    if (!decision?.proposal || decision.proposal.parameters.length === 0) {
      continue;
    }
    const exactHumanApprovals = project.approvals.filter(
      (a: EngineeringApproval) =>
        a.decisionId === decision.id &&
        a.status === "approved" &&
        a.decidedByOrigin === "human" &&
        sameSnapshotBasis(a.baseSnapshot, basis) &&
        sameEvidenceRefs(a.inputEvidenceRefs, decision.inputEvidenceRefs) &&
        fingerprintsEqual(a.inputFingerprint, decision.inputFingerprint),
    );
    if (
      exactHumanApprovals.length === 1 &&
      sameSnapshotBasis(decision.baseSnapshot, basis) &&
      decision.inputFingerprint
    ) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      candidates.length === 0
        ? "No exact human-approved requirements MRTR decision is bound to this run basis."
        : "Ambiguous requirements MRTR: exactly one human-approved decision must be bound to this run basis.",
    );
  }
  const selected = candidates[0]!;
  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: selected.decision.baseSnapshot,
    inputEvidenceRefs: selected.decision.inputEvidenceRefs,
    proposal: {
      summary: selected.proposal.summary,
      parameters: selected.proposal.parameters,
    },
  });
  if (
    !fingerprintsEqual(
      expectedDecisionFingerprint,
      selected.decision.inputFingerprint,
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "requirements_decision_fingerprint_mismatch: the decision fingerprint no " +
        "longer seals its exact base snapshot, evidence references, and proposal.",
    );
  }
  const approvedDecisions = workItem.decisionIds.map((id) => {
    const decision = project.decisions.find((candidate) => candidate.id === id);
    if (!decision?.inputFingerprint) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Requirements work-item decision ${id} is not exactly approved.`,
      );
    }
    return { id, inputFingerprint: decision.inputFingerprint };
  });
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: workItem.operation!.id,
      version: workItem.operation!.version,
      bindings: workItem.operation!.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Requirements run input fingerprint no longer seals its exact MRTR decision and basis.",
    );
  }
  return selected;
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  if (!value || !("snapshotId" in value)) return false;
  return value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision &&
    value.subjectId === basis.subjectId;
}

function sameEvidenceRefs(
  left: readonly {
    snapshotId: string;
    snapshotRevision: number;
    kind: string;
    id: string;
  }[],
  right: readonly {
    snapshotId: string;
    snapshotRevision: number;
    kind: string;
    id: string;
  }[],
): boolean {
  const key = (ref: typeof left[number]) =>
    `${ref.snapshotId}\u0000${ref.snapshotRevision}\u0000${ref.kind}\u0000${ref.id}`;
  return left.length === right.length &&
    left.map(key).sort().every((item, index) => item === right.map(key).sort()[index]);
}

// ── Private: proposal parsing ─────────────────────────────────────────────────

function parseRequirementsProposal(
  proposal: NonNullable<EngineeringDecision["proposal"]>,
): RequirementsProposal {
  try {
    return parseRequirementsProposalParameters(proposal.parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Requirements proposal parameters are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ── Private: plan digest ──────────────────────────────────────────────────────

async function requirementsPlanDigest(
  requirements: readonly OracleRequirement[],
  partDefName: string,
  target: RequirementsTarget,
): Promise<string> {
  const fp = await fingerprintRequirementsPlan({
    partDefName,
    target,
    requirements,
  });
  return fp.digest;
}

// ── Private: sibling blocker check ───────────────────────────────────────────

async function assertNoBlockedRequirementsSibling(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  containerComponent: string,
  attempts: FileRequirementsAttemptStore,
): Promise<void> {
  const basis = requireBasis(run);
  const siblings = project.agentRuns.filter((candidate) => {
    if (candidate.id === run.id || !sameSnapshotBasis(candidate.basis, basis)) {
      return false;
    }
    const operation = project.workItems.find((item) => item.id === candidate.workItemId)
      ?.operation;
    const siblingContainer = requirementsRunContainer(project, candidate);
    return operation?.id === MODEL_WRITE_REQUIREMENTS_OPERATION.id &&
      operation.version === MODEL_WRITE_REQUIREMENTS_OPERATION.version &&
      (siblingContainer === undefined ||
        siblingContainer === containerComponent);
  });
  for (const sibling of siblings) {
    if (
      sibling.status === "completed" || sibling.status === "running" ||
      sibling.status === "publishing" ||
      (sibling.status === "failed" && isTerminalRequirementsFailure(sibling))
    ) {
      throw staleRequirementsBasisSibling();
    }
    try {
      if (
        await attempts.isQuarantined(project.project.id, sibling.id) ||
        await attempts.readRun(project.project.id, sibling.id)
      ) {
        throw staleRequirementsBasisSibling();
      }
    } catch (error) {
      if (error instanceof EngineeringProjectCommandError) throw error;
      throw staleRequirementsBasisSibling();
    }
  }
}

function requirementsRunContainer(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): string | undefined {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const decisions = (workItem?.decisionIds ?? []).flatMap((id) =>
    project.decisions.filter((decision) => decision.id === id)
  );
  const values = decisions.flatMap((decision) =>
    decision.proposal?.parameters.filter((parameter) =>
      parameter.key === "requirements.containerComponent" &&
      typeof parameter.value === "string"
    ).map((parameter) => parameter.value as string) ?? []
  );
  return values.length === 1 ? values[0] : undefined;
}

function isTerminalRequirementsFailure(run: EngineeringAgentRun): boolean {
  return run.failure?.code ===
      "model-write-requirements-provider-outcome-unknown" ||
    run.failure?.code ===
      "model-write-requirements-post-acknowledgement-quarantined" ||
    run.failure?.code === "model-write-requirements-quarantine-write-failed";
}

function staleRequirementsBasisSibling(): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(
    "invalid_transition",
    "A prior requirements run for this target on the exact same basis has an " +
      "active execution, published result, unresolved provider outcome, or durable WAL. " +
      "A separately reviewed transition must advance the basis before another write.",
  );
}

// ── Private: SysON response validation ───────────────────────────────────────

function verifyInsertionAck(value: unknown, expectedParentId: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "SysON requirements insert response must be a non-null object.",
    );
  }
  const record = value as Record<string, unknown>;
  if (record.inserted !== true) {
    throw new Error(
      `SysON requirements insert did not acknowledge success (inserted: ${
        String(record.inserted)
      }). Parent: ${expectedParentId}`,
    );
  }
  if (record.parentId !== expectedParentId) {
    throw new Error(
      `SysON requirements insert acknowledged parent "${String(record.parentId)}", ` +
        `expected target PartDefinition "${expectedParentId}".`,
    );
  }
}

function parseProviderChildren(
  value: unknown,
  expectedParentId: string,
): ReadonlyArray<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "syson_element_children returned a non-object response.",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    record.parentId !== expectedParentId || !Array.isArray(record.children) ||
    !Number.isSafeInteger(record.count) ||
    record.count !== record.children.length
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `syson_element_children response does not exactly echo parent ` +
        `"${expectedParentId}" and its child count.`,
    );
  }
  return record.children.map((child, index) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `syson_element_children child[${index}] is not an object.`,
      );
    }
    const entry = child as Record<string, unknown>;
    if (
      typeof entry.id !== "string" || !entry.id.trim() ||
      typeof entry.kind !== "string" || !entry.kind.trim() ||
      typeof entry.label !== "string"
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `syson_element_children child[${index}] is malformed.`,
      );
    }
    return entry;
  });
}

function isSysmlEntityKind(value: unknown, entity: string): boolean {
  return typeof value === "string" &&
    (value === entity || value.endsWith(`entity=${entity}`));
}

function isContentFingerprint(value: unknown): value is ContentFingerprint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.algorithm === "sha256" &&
    typeof record.digest === "string" && /^[a-f0-9]{64}$/.test(record.digest);
}

function isProviderChild(
  value: unknown,
  label: string | undefined,
  entity: string,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const child = value as Record<string, unknown>;
  return (label === undefined || child.label === label) &&
    isSysmlEntityKind(child.kind, entity);
}

function isExactProviderTarget(
  value: unknown,
  target: RequirementsTarget,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.id === target.elementId &&
    candidate.label === target.label &&
    isSysmlEntityKind(candidate.kind, "PartDefinition");
}

/**
 * Bind the structural child readback to the specialized constraint extractor.
 * Neither response may authorize an identity absent from the other one.
 */
function assertConstraintUsageChildBijection(
  childIds: readonly string[],
  extracted: readonly VerifiedConstraintUsageIdentity[],
  context: string,
): void {
  const childIdSet = new Set(childIds);
  const extractedIdSet = new Set(extracted.map((item) => item.id));
  const extractedSourceIdSet = new Set(extracted.map((item) => item.sourceId));
  if (
    childIds.length !== extracted.length ||
    childIdSet.size !== childIds.length ||
    extractedIdSet.size !== extracted.length ||
    extractedSourceIdSet.size !== extracted.length ||
    childIds.some((id) => !extractedIdSet.has(id) || !extractedSourceIdSet.has(id)) ||
    extracted.some((item) => item.id !== item.sourceId)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Requirements identity readback failed: ${context} child ConstraintUsage ` +
        "identities and syson_constraint_extract id/sourceId identities are not bijective.",
    );
  }
}

/** A V3 predecessor authorizes only the exact native identities it captured. */
function assertCapturedConstraintUsageBijection(
  captured: readonly RequirementsCaptureConstraintUsage[],
  live: readonly VerifiedConstraintUsageIdentity[],
): void {
  const liveByRequirementId = new Map(
    live.map((item) => [item.requirementId, item] as const),
  );
  if (
    captured.length !== live.length ||
    liveByRequirementId.size !== live.length ||
    captured.some((expected) => {
      const observed = liveByRequirementId.get(expected.requirementId);
      return observed === undefined || observed.id !== expected.id ||
        observed.kind !== expected.kind ||
        observed.sourceId !== expected.sourceId;
    })
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Prior V3 ConstraintUsage identity mismatch: the verified live predecessor " +
        "does not bijectively match its captured native identities.",
    );
  }
}

// ── Private: URI helpers ──────────────────────────────────────────────────────

function requirementsUriPrefix(containerComponent: string): string {
  return `${REQUIREMENTS_CAPTURE_URI_PREFIX}${containerComponent}/`;
}

function requirementsUriFor(
  containerComponent: string,
  fingerprint: ContentFingerprint,
): string {
  return `${requirementsUriPrefix(containerComponent)}sha256/${fingerprint.digest}`;
}

export { selectRequirementsTip };

// ── Private: lifecycle helpers ────────────────────────────────────────────────

function commandStep(commandId: string, step: string): string {
  return `${commandId}:model-write-requirements:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: ModelWriteRequirementsRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" ||
    !run.resultSnapshot ||
    !project.commandReceipts?.some(
      (receipt) => receipt.commandId === commandStep(command.commandId, "complete"),
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Requirements run ${command.runId} did not complete through this exact execution command.`,
    );
  }
}

function completedRequirementsIntegrityError(
  detail: string,
): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(
    "invalid_transition",
    `Completed requirements evidence integrity failure: ${detail}.`,
  );
}

function requirementsArtifactEntityRef(
  snapshot: ThreadSnapshot,
  runId: string,
): {
  snapshotId: string;
  snapshotRevision: number;
  kind: "artifact";
  id: string;
} {
  const produced = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "sysml-model" &&
    artifact.uri?.startsWith(REQUIREMENTS_CAPTURE_URI_PREFIX) &&
    artifact.producer.runId === runId
  );
  if (produced.length !== 1) {
    throw new Error(
      "Requirements snapshot has no unique artifact produced by this run.",
    );
  }
  const artifact = produced[0]!;
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: artifact.id,
  };
}

async function exactSnapshot(
  store: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await store.get(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Basis thread snapshot ${basis.snapshotId} r${basis.revision} for subject ` +
        `${basis.subjectId} is not durably readable as an exact identity.`,
    );
  }
  try {
    validateThreadSnapshot(snapshot);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Basis thread snapshot ${basis.snapshotId} is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return snapshot;
}
