/**
 * Trusted executor for the generic `model.write-architecture@1` operation.
 *
 * WHY GENERIC — no constant in this module may name a specific product
 * (coffee, drone, …). Every project-specific value is read from the basis
 * snapshot, the seed capture, or the MRTR-approved decision parameters.
 *
 * Sequence (spec §3.3):
 *  1. Agent-only origin gate.
 *  2. requireShape: operation id/version/binding shape check.
 *  3. requireMrtrApproval: find approved decision with decidedByOrigin === "human".
 *  4. Parse proposal from decision.proposal.parameters.
 *  5. Lease + claim.
 *  6. Load basis snapshot + seed capture.
 *  7. Cliquet: assertArchitectureArtifactNotRemoved.
 *  8. Preflight re-extraction → planArchitectureInsertion.
 *  9. Conflict + empty-plan guard.
 * 10. Run-scoped WAL seals the ordered source-backed plan → dispatch or resume.
 * 11. SysON insertions.
 * 12. Verification re-extraction: every proposed component present.
 * 13. Capture save + CAS readback.
 * 14. Thread extension → applyThreadSnapshotExtensionIfNew → validateThreadSnapshot.
 * 15. Snapshot save + CAS readback.
 * 16. publishRun + completeRun + assertCompleted.
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
import {
  parseSysonModelSeedCapture,
  requireExactSysonModelSeed,
} from "../../../domain/architecture/seed/syson-model-seed.ts";
import {
  type AdoptedItem,
  ArchitecturePackageScopeError,
  type ArchitectureProposal,
  architectureWriteSelector,
  assertArchitecturePackageScope,
  type ExistingArchitectureStructure,
  type InsertionItem,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  parseArchitectureProposalParameters,
  planArchitectureInsertion,
  renderArchitectureSysmlWithManifest,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  type ArchitectureGraphRatchetResult,
  ratchetArchitectureGraph,
  verifyProposedArchitecturePresence,
} from "../../../domain/architecture/renderer/architecture-graph-ratchet.ts";
import { buildArchitectureThreadExtension } from "../../../domain/architecture/renderer/architecture-thread-extension.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  type FileCaptureStore,
} from "../../shared/cas/file-capture-store.ts";
import {
  ARCHITECTURE_CAPTURE_SCHEMA,
  architectureGraphFromCapture,
  buildExactArchitectureCapture,
  type ExactArchitectureCapture,
  parseExactArchitectureCapture,
} from "./architecture-capture.ts";
import {
  type SysmlSourceAnalysisCaptureService,
  type SysmlSourceAnalysisReference,
  type VerifiedSysmlSourceAnalysis,
} from "./sysml-source-analysis-capture.ts";
import {
  ArchitectureRunQuarantinedError,
  ArchitectureWriteOutcomeUnknownError,
  architectureWritePlanDigest,
  FileArchitectureAttemptStore,
} from "./file-architecture-attempt-store.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import {
  assertThreadSnapshotLineageIntact,
  ThreadSnapshotLineageIntegrityError,
} from "../../shared/stores/thread-snapshot-lineage.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../../shared/stores/live-thread-update-store.ts";
import {
  ArchitectureStructureExtractionError,
  extractArchitectureStructure,
} from "./architecture-structure-extractor.ts";
import { writeSysonTypedPartUsage } from "./syson-typed-part-usage-writer.ts";
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

export { MODEL_WRITE_ARCHITECTURE_OPERATION };
export { ARCHITECTURE_CAPTURE_SCHEMA };

// ── Error: architecture artifact removed from a successor snapshot ────────────

/**
 * Raised when an ancestor ThreadSnapshot carried an architecture artifact but
 * the current basis does not.
 *
 * MONOTONY RATCHET — once a subject's thread carries an architecture artifact,
 * every later revision must also carry it. Silently dropping it would make the
 * downstream projector and the enrichment preflight unreliable.
 */
export class ArchitectureArtifactRemovedError extends Error {
  constructor(subjectId: string) {
    super(
      `architecture_artifact_removed: The thread for "${subjectId}" previously carried ` +
        "an architecture artifact that is absent from the current basis. This is a " +
        "monotony-ratchet violation; the artifact must not be removed once published.",
    );
    this.name = "ArchitectureArtifactRemovedError";
  }
}

// ── Command and dependency types ─────────────────────────────────────────────

export interface ModelWriteArchitectureRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface ModelWriteArchitectureRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  /** Seed captures produced by `architecture.seed-syson-model@2`. */
  readonly seedCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly captures: FileCaptureStore<"architecture-capture">;
  /** Server-rendered source capture → analysis boundary before every SysON write. */
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisCaptureService;
  readonly attempts: FileArchitectureAttemptStore;
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

// ── Exported predicate: find the architecture artifact by URI prefix ──────────

/**
 * Locate the generic architecture artifact in any basis snapshot.
 *
 * Both the kind guard and the URI-prefix check are required: other sysml-model
 * artifacts (seed, oracle-requirements, sensitivity) must not match.
 */
export function findArchitectureArtifact(
  snapshot: ThreadSnapshot,
): ThreadArtifact | undefined {
  return requireArchitectureTip(snapshot);
}

/**
 * Return the sole active generic architecture lineage tip.
 *
 * Tips are first calculated across the complete history, then archive markers
 * are applied to those tips.  Filtering archived artifacts before calculating
 * the graph would incorrectly revive an archived predecessor.
 */
function requireArchitectureTip(
  snapshot: ThreadSnapshot,
): ThreadArtifact | undefined {
  const selected = selectArchitectureTip(snapshot);
  if (selected.kind === "absent") return undefined;
  if (selected.kind === "retired") {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The generic architecture lineage has an explicitly archived current tip. " +
        "A separately reviewed recovery or replacement basis is required before authoring again.",
    );
  }
  if (selected.kind === "ambiguous") {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Generic architecture lineage has multiple current tips; an enrichment cannot choose a predecessor.",
    );
  }
  if (selected.kind === "invalid") {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Generic architecture artifact input lineage is not exact: every architecture artifact must consume one SysON seed and at most one unique architecture predecessor, with no merge or extra input.",
    );
  }
  return selected.artifact;
}

function selectArchitectureTip(snapshot: ThreadSnapshot):
  | { readonly kind: "absent" }
  | { readonly kind: "retired" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "invalid" }
  | { readonly kind: "one"; readonly artifact: ThreadArtifact } {
  const all = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "sysml-model" &&
    artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX)
  );
  if (all.length === 0) return { kind: "absent" };

  const byId = new Map(
    snapshot.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const architectureIds = new Set(all.map((artifact) => artifact.id));
  for (const artifact of all) {
    const uniqueInputs = new Set(artifact.inputArtifactIds);
    const seedInputs = artifact.inputArtifactIds.filter((id) => {
      const input = byId.get(id);
      return input ? isExactSysonSeedArtifact(input) : false;
    });
    const predecessorInputs = artifact.inputArtifactIds.filter((id) =>
      architectureIds.has(id)
    );
    if (
      uniqueInputs.size !== artifact.inputArtifactIds.length ||
      seedInputs.length !== 1 || predecessorInputs.length > 1 ||
      artifact.inputArtifactIds.length !== 1 + predecessorInputs.length ||
      predecessorInputs.includes(artifact.id)
    ) {
      return { kind: "invalid" };
    }
  }
  const consumed = new Set(
    all.flatMap((artifact) => artifact.inputArtifactIds),
  );
  const tips = all.filter((artifact) => !consumed.has(artifact.id));
  if (tips.length === 0) return { kind: "ambiguous" };
  const archived = archivedRefKeys(snapshot);
  const activeTips = tips.filter((artifact) =>
    !archived.has(`artifact:${artifact.id}`)
  );
  if (activeTips.length === 0) return { kind: "retired" };
  return activeTips.length === 1
    ? { kind: "one", artifact: activeTips[0]! }
    : { kind: "ambiguous" };
}

function isExactSysonSeedArtifact(artifact: ThreadArtifact): boolean {
  return artifact.kind === "sysml-model" &&
    artifact.uri?.startsWith("casys://syson-model-seed-capture/sha256/") ===
      true &&
    artifact.producer.serverId === "syson" &&
    artifact.producer.tool === "syson_model_create";
}

// ── Exported: cliquet check (called by follow-up executors too) ───────────────

/**
 * Assert that an architecture artifact has NOT been silently removed from the
 * subject's thread history.
 *
 * Fail-open on snapshot-store resolution errors (same convention as
 * `assertOracleRequirementsNotRemoved`) — the fail-closed invariant is that
 * a FOUND ancestor artifact with a MISSING current artifact raises the error.
 */
export async function assertArchitectureArtifactNotRemoved(
  basis: ThreadSnapshot,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  // An explicit archive is a valid retirement, not a silent deletion.  It is
  // handled by requireArchitectureTip, which refuses to revive an old node.
  if (basis.artifacts.some(isGenericArchitectureArtifact)) return;
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
    /**
     * `break` (not `throw`) on any of the four terminal conditions below.
     *
     * - Missing or mismatched ancestor: the lineage is broken or the resolved
     *   snapshot does not match its pointer. The ratchet's responsibility is
     *   narrow: assert monotonicity within a single subject's intact lineage.
     *   The executor separately calls assertThreadSnapshotLineageIntact before
     *   this predicate and rejects that corruption before any provider call.
     *
     * - Subject boundary (`ancestor.subject.id !== basis.subject.id`): a
     *   lineage pointer that crosses to a different subject's snapshot is
     *   almost certainly corruption. The architecture-artifact ratchet only asserts that *this*
     *   subject never silently drops an artifact it once published. An artifact
     *   held by a *different* subject's snapshot must not trigger a ratchet
     *   for this one.
     *
     * Throwing here would be wrong in both cases: the caller would see an
     * `ArchitectureArtifactRemovedError`, which is a false positive that
     * would permanently block legitimate runs for this subject.
     */
    if (
      !ancestor || ancestor.id !== cursor.snapshotId ||
      ancestor.revision !== cursor.revision ||
      ancestor.subject.id !== basis.subject.id
    ) {
      break;
    }
    if (ancestor.artifacts.some(isGenericArchitectureArtifact)) {
      throw new ArchitectureArtifactRemovedError(basis.subject.id);
    }
    cursor = ancestor.previous;
  }
}

function isGenericArchitectureArtifact(artifact: ThreadArtifact): boolean {
  return artifact.kind === "sysml-model" &&
    artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX) === true;
}

// ── Executor ─────────────────────────────────────────────────────────────────

/**
 * Trusted V3 generic architecture authoring operation.
 *
 * The executor cannot accept a product name or a SysML fragment from any
 * caller. It derives the SysML package text from an MRTR-approved decision
 * whose parameters were reviewed and signed by a human operator.
 */
export class ModelWriteArchitectureRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #seedCaptures: ModelWriteArchitectureRunExecutorDependencies["seedCaptures"];
  readonly #captures: FileCaptureStore<"architecture-capture">;
  readonly #sysmlSourceAnalysis: SysmlSourceAnalysisCaptureService;
  readonly #attempts: FileArchitectureAttemptStore;
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #capabilityRuntime: CapabilityRuntimeExecutionEligibility | undefined;
  readonly #capabilityRuntimeSession:
    | Pick<CapabilityRuntimeExecutionSessionCoordinator, "begin">
    | undefined;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(dependencies: ModelWriteArchitectureRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#seedCaptures = dependencies.seedCaptures;
    this.#captures = dependencies.captures;
    this.#sysmlSourceAnalysis = dependencies.sysmlSourceAnalysis;
    this.#attempts = dependencies.attempts;
    this.#syson = dependencies.syson;
    this.#lease = dependencies.lease;
    this.#capabilityRuntime = dependencies.capabilityRuntime;
    this.#capabilityRuntimeSession = dependencies.capabilityRuntimeSession;
    this.#liveUpdates = dependencies.liveUpdates;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: ModelWriteArchitectureRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute a generic architecture run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);

    // MRTR gate — proposal is consumed here so it is verified before leasing.
    const { proposal } = await requireMrtrApproval(project, run);
    const architectureProposal = parseProposal(proposal);
    await this.#assertPredecessorPackageScopeBeforeLease(
      run,
      architectureProposal,
    );

    // A run-scoped lease is sufficient to replay one runId, but it leaves two
    // independently queued work items free to author divergent successors from
    // the same immutable ThreadSnapshot basis.  Serialize this irreversible
    // operation by its exact Thread basis instead. The same scope is shared
    // with requirements and geometry writers: only one `base + 1` successor
    // can own the next subject revision.
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, architectureProposal),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: ModelWriteArchitectureRunExecutorCommand,
    architectureProposal: ArchitectureProposal,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let providerAcknowledged = false;
    let snapshotPersisted = false;
    let materializedSnapshot: ThreadSnapshot | undefined;
    let capabilitySession: CapabilityRuntimeExecutionSession | undefined;

    try {
      // Pre-claim shape re-check (post-lease).
      const preClaim = await this.#requiredProject(command.projectId);
      requireShape(preClaim, requireRun(preClaim, command.runId));

      // If the run was already completed by an earlier execution of this exact
      // command chain, return without re-claiming (the completeRun receipt is
      // keyed by commandId, not expectedRevision, so the check survives a retry
      // that carries a newer expectedRevision).
      const alreadyCompleted = await this.#completedFor(
        command,
        architectureProposal,
      );
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
      // The scope lease has made this pre-claim snapshot authoritative for
      // sibling selection.  Refuse before changing lifecycle state, reading a
      // seed capture, or touching SysON when a prior same-basis writer already
      // owns, consumed, or may have mutated this basis.
      await assertNoBlockedArchitectureSibling(
        preClaim,
        requireRun(preClaim, command.runId),
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
        summary: "Started the generic model-write-architecture run.",
      });
      claimed = true;

      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);

      if (run.status === "completed") {
        assertCompleted(project, command);
        await this.#assertCompletedEvidenceExact(
          project,
          command,
          architectureProposal,
        );
        await this.#reconcileLive(project.project.subjectId, run.id);
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      const capturedAt = requiredStart(run);
      const basis = requireBasis(run);

      // Step 6: load basis snapshot + seed capture (with byte-level fingerprint verification).
      const { base, seed, seedArtifact, seedVerifiedFingerprint } = await this
        .#loadSeedInputs(basis);
      // Step 7: cliquet.
      await assertArchitectureArtifactNotRemoved(base, this.#snapshots);

      const editingContextId = seed.editingContextId;
      const rootPackageId = seed.rootPackageId;
      const previousArchitectureArtifact = requireArchitectureTip(base);
      await this.#assertPredecessorCaptureExact(
        previousArchitectureArtifact,
        base,
        seedArtifact,
      );

      // The immutable run-level WAL is consulted before any live preflight. A
      // completed record means SysON already acknowledged a mutation: the
      // current model may naturally yield an empty or different plan, but this
      // retry must perform readback/publication only and never insert again.
      let architecturePackageId: string;
      let adopted: ReturnType<typeof planArchitectureInsertion>["adopted"] = [];
      let sealedSources: readonly VerifiedSysmlSourceAnalysis[] = [];
      const existingAttempt = await this.#runAttemptOrFail(
        project.project.id,
        command.runId,
      );
      if (existingAttempt?.status === "completed") {
        // A completed run-scoped WAL is an irreversible provider acknowledgement
        // before any readback can fail.  The outer catch must quarantine every
        // subsequent extraction/capture failure instead of leaving a retryable
        // running run that might redispatch.
        providerAcknowledged = true;
        sealedSources = await this.#reopenSysmlSources(
          existingAttempt.sourceAnalyses,
        );
        this.#assertCurrentAttemptRunBasis(
          existingAttempt,
          architectureProposal,
          run.id,
          capturedAt,
        );
        this.#assertSourcesMatchCurrentProposal(
          sealedSources,
          architectureProposal,
        );
        const existingForResume = await extractArchitectureStructure(
          this.#syson,
          editingContextId,
          rootPackageId,
          architectureProposal.packageName,
        );
        if (!existingForResume) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            "WAL is completed but the architecture package is absent from SysON. " +
              "Operator inspection required.",
          );
        }
        architecturePackageId = existingAttempt.result.architecturePackageId;
        if (existingForResume.packageId !== architecturePackageId) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            "WAL recovery found an architecture Package whose id does not match the exact architecturePackageId pinned after acknowledgement.",
          );
        }
      } else {
        // Step 8: preflight re-extraction → insertion plan.
        const existing = await extractArchitectureStructure(
          this.#syson,
          editingContextId,
          rootPackageId,
          architectureProposal.packageName,
        );
        const plan = planArchitectureInsertion(existing, architectureProposal);

        // Step 9: conflict + empty-plan guard.
        if (plan.conflicts.length > 0) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `Architecture insertion plan has ${plan.conflicts.length} conflict(s). ` +
              `First: ${plan.conflicts[0]!.message}`,
          );
        }
        if (plan.toInsert.length === 0) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            "All proposed architecture components are already present and adopted. " +
              "No insertion is needed; this transition would produce no new evidence.",
          );
        } else {
          const sealedWriteItems = plan.mode === "initial"
            ? initialSealedWriteItems(architectureProposal)
            : plan.toInsert;
          sealedSources = await this.#captureAndReopenSysmlSources(
            architectureProposal,
            plan.mode,
            sealedWriteItems,
            run.id,
          );
          this.#assertSourcesMatchCurrentProposal(
            sealedSources,
            architectureProposal,
          );
          const sourceAnalyses = sealedSources.map((source) => source.reference);
          const planDigest = await architectureWritePlanDigest({
            items: sealedWriteItems,
            packageName: architectureProposal.packageName,
            sourceAnalyses,
          });
          const walResult = await this.#walBeginOrFail(
            project.project.id,
            command.runId,
            architectureProposal.packageName,
            sealedWriteItems,
            planDigest,
            capturedAt,
            sourceAnalyses,
          );
          if (walResult.action === "completed") {
            // A concurrently recovered record won the race. This branch is still
            // strictly readback-only.
            providerAcknowledged = true;
            const completedAttempt = await this.#runAttemptOrFail(
              project.project.id,
              command.runId,
            );
            if (!completedAttempt) {
              throw new ArchitectureWriteOutcomeUnknownError();
            }
            sealedSources = await this.#reopenSysmlSources(
              completedAttempt.sourceAnalyses,
            );
            this.#assertCurrentAttemptRunBasis(
              completedAttempt,
              architectureProposal,
              run.id,
              capturedAt,
            );
            this.#assertSourcesMatchCurrentProposal(
              sealedSources,
              architectureProposal,
            );
            const existingForResume = await extractArchitectureStructure(
              this.#syson,
              editingContextId,
              rootPackageId,
              architectureProposal.packageName,
            );
            if (!existingForResume) {
              throw new EngineeringProjectCommandError(
                "invalid_transition",
                "WAL is completed but the architecture package is absent from SysON. " +
                  "Operator inspection required.",
              );
            }
            architecturePackageId = walResult.architecturePackageId;
            if (existingForResume.packageId !== architecturePackageId) {
              throw new EngineeringProjectCommandError(
                "invalid_transition",
                "WAL recovery found an architecture Package whose id does not match the exact architecturePackageId pinned after acknowledgement.",
              );
            }
          } else {
            // Dispatch: perform all insertions.
            try {
              if (plan.mode === "initial") {
                const sysml = sourceTextForSelector(sealedSources, {
                  kind: "full-package",
                  packageName: architectureProposal.packageName,
                });
                const result = await this.#syson.callTool({
                  name: "syson_element_insert_sysml",
                  arguments: {
                    editing_context_id: editingContextId,
                    parent_id: rootPackageId,
                    sysml_text: sysml,
                  },
                });
                verifyInsertionAck(result.structuredContent, rootPackageId);
                // Only a structurally valid acknowledgement establishes that a
                // remote mutation happened. From this point every later error —
                // including a Phase-B enrichment re-read — must take the
                // post-acknowledgement quarantine path.
                providerAcknowledged = true;
              } else {
                // Enrichment: insert per-item using the architecture package as root.
                const packageId = existing!.packageId;
                await this.#insertEnrichmentItems(
                  editingContextId,
                  packageId,
                  plan.toInsert,
                  sealedSources,
                  () => {
                    providerAcknowledged = true;
                  },
                );
              }
            } catch (error) {
              if (
                !(error instanceof EngineeringProjectCommandError) &&
                !providerAcknowledged
              ) {
                throw new ArchitectureWriteOutcomeUnknownError();
              }
              throw error;
            }
            if (plan.mode === "initial") {
              // SysON can acknowledge a syntactically valid multi-statement
              // insertion while retaining only a prefix of that source. The
              // full-package source remains the canonical first write, but
              // every possible recovery statement was rendered, analysed and
              // sealed in the WAL before dispatch. Re-read the provider and
              // issue only the exact missing statements from that sealed set.
              // This read happens after the dispatch catch deliberately: an
              // extraction failure after a valid ACK is a quarantined
              // structural failure, not an unknown provider outcome.
              const initialReadback = await extractArchitectureStructure(
                this.#syson,
                editingContextId,
                rootPackageId,
                architectureProposal.packageName,
              );
              if (!initialReadback) {
                throw new EngineeringProjectCommandError(
                  "invalid_transition",
                  "The architecture package is absent from SysON immediately after the acknowledged initial insertion.",
                );
              }
              const fallbackPlan = planArchitectureInsertion(
                initialReadback,
                architectureProposal,
              );
              if (fallbackPlan.conflicts.length > 0) {
                throw new EngineeringProjectCommandError(
                  "invalid_transition",
                  "The acknowledged initial insertion left a conflicting partial architecture. " +
                    `First: ${fallbackPlan.conflicts[0]!.message}`,
                );
              }
              assertInitialFallbackWasSealed(
                fallbackPlan.toInsert,
                sealedWriteItems,
              );
              if (fallbackPlan.toInsert.length > 0) {
                await this.#insertEnrichmentItems(
                  editingContextId,
                  initialReadback.packageId,
                  fallbackPlan.toInsert,
                  sealedSources,
                  () => {
                    providerAcknowledged = true;
                  },
                );
              }
            }
            // Resolve and fully verify the exact provider graph before promoting
            // the WAL from dispatched to completed. An ACK alone proves only that
            // a mutation may have occurred; it must never authorize publication.
            const postInsert = await extractArchitectureStructure(
              this.#syson,
              editingContextId,
              rootPackageId,
              architectureProposal.packageName,
            );
            if (!postInsert) {
              throw new EngineeringProjectCommandError(
                "invalid_transition",
                "The architecture package is absent from SysON immediately after insertion.",
              );
            }
            if (existing && postInsert.packageId !== existing.packageId) {
              throw new EngineeringProjectCommandError(
                "invalid_transition",
                "The architecture Package identity changed during enrichment readback.",
              );
            }
            architecturePackageId = postInsert.packageId;
            adopted = plan.adopted;
            verifyAllComponentsPresent(
              postInsert,
              architectureProposal,
              adopted,
            );
            await this.#assertNoUnattestedLiveArchitecture(
              postInsert,
              architectureProposal,
              previousArchitectureArtifact,
            );

            try {
              await this.#attempts.complete({
                projectId: project.project.id,
                runId: command.runId,
                planDigest,
                architecturePackageId,
              });
              providerAcknowledged = true;
            } catch {
              // A rename can be visible before the caller observes a later fsync
              // error. Re-read the immutable run record: only an exact completed
              // record pinned to this readback Package may resume safely.
              const durable = await this.#runAttemptOrFail(
                project.project.id,
                command.runId,
              );
              if (
                durable?.status !== "completed" ||
                durable.planDigest !== planDigest ||
                durable.result.architecturePackageId !== architecturePackageId
              ) {
                throw new ArchitectureWriteOutcomeUnknownError();
              }
              providerAcknowledged = true;
            }
          }
        }
      }

      // Step 12: verification re-extraction.
      const verified = await extractArchitectureStructure(
        this.#syson,
        editingContextId,
        rootPackageId,
        architectureProposal.packageName,
      );
      if (!verified) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Verification re-extraction: the architecture package is absent after insertion.",
        );
      }
      if (verified.packageId !== architecturePackageId) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Verification failed: the architecture Package identity changed between acknowledgement and final readback.",
        );
      }
      verifyAllComponentsPresent(verified, architectureProposal, adopted);
      await this.#assertNoUnattestedLiveArchitecture(
        verified,
        architectureProposal,
        previousArchitectureArtifact,
      );

      // Step 13: build + save capture. Roots are sealed here; readers consume ids.
      const captureRecord = buildExactArchitectureCapture({
        trustedRunId: run.id,
        packageName: architectureProposal.packageName,
        systemName: architectureProposal.system.name,
        scopeRoot: {
          id: architecturePackageId,
          kind: "Package",
          label: verified.packageLabel,
        },
        semanticRoot: resolveSealedSemanticRoot(
          verified,
          architectureProposal.system.name,
        ),
        seed: {
          artifactId: seedArtifact.id,
          fingerprint: seedVerifiedFingerprint,
          producerRunId: seedArtifact.producer.runId,
        },
        ...(previousArchitectureArtifact
          ? {
            predecessor: {
              artifactId: previousArchitectureArtifact.id,
              fingerprint: previousArchitectureArtifact.fingerprint,
              producerRunId: previousArchitectureArtifact.producer.runId,
            },
          }
          : {}),
        live: verified,
        insertedAt: capturedAt,
        sourceAnalyses: sealedSources.map((source) => source.reference),
      });
      // Fingerprint the object so SHA-256 = SHA-256(raw text bytes of captureText).
      // FileCaptureStore.save verifies SHA-256 of raw bytes, so the fingerprint
      // must be computed on the object (= deterministicJson encoding), not on the
      // already-stringified text (which would add an extra JSON-quoting layer).
      const captureFp = await sha256Fingerprint(captureRecord);
      const captureText = deterministicJson(captureRecord);

      await this.#captures.save(captureFp, captureText);
      const persistedCapture = await this.#captures.read(captureFp);
      if (persistedCapture !== captureText) {
        throw new Error(
          "Generic architecture capture was not durably readable after save.",
        );
      }

      // Step 14: build + apply thread extension.
      const captureUri = this.#captures.uriFor(captureFp);
      const extension = buildArchitectureThreadExtension({
        base,
        seedArtifact,
        previousArchitectureArtifact,
        seedVerifiedFingerprint,
        runId: run.id,
        capturedAt,
        captureFp,
        captureUri,
        architectureProposal,
        verified,
      });

      const applied = applyThreadSnapshotExtensionIfNew(base, extension, {
        appliedAt: capturedAt,
      });
      if (!applied.applied) {
        throw new Error(
          "Generic architecture snapshot extension was already present — " +
            "this exact evidence was published in a prior revision.",
        );
      }
      const snapshot = applied.snapshot;
      // Validate before persisting: catches any broken invariant before write.
      validateThreadSnapshot(snapshot);
      materializedSnapshot = snapshot;

      // Step 15: save snapshot + CAS readback.
      await this.#snapshots.save(snapshot);
      const savedSnapshot = await this.#snapshots.get(snapshot.id);
      if (
        !savedSnapshot ||
        deterministicJson(savedSnapshot) !== deterministicJson(snapshot)
      ) {
        throw new Error(
          "Generic architecture snapshot was not durably readable after save.",
        );
      }
      snapshotPersisted = true;

      // Step 16: publish + complete.
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the generic SysON architecture read-back.",
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
          summary:
            "Recorded the generic system-model architecture and its SysON read-back.",
          resultSnapshot: snapshotRef(snapshot),
          evidenceRefs: [architectureArtifactEntityRef(snapshot, run.id)],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.#requiredProject(command.projectId);
      assertCompleted(complete, command);
      await this.#assertCompletedEvidenceExact(
        complete,
        command,
        architectureProposal,
      );
      await this.#reconcileLive(complete.project.subjectId, command.runId);
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: { kind: "release" },
      });
      return complete;
    } catch (error) {
      if (snapshotPersisted && materializedSnapshot) {
        const complete = await this.#completedFor(
          command,
          architectureProposal,
        );
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
          "Generic architecture evidence is durable but project attachment did not finish. " +
            "Retry this exact command; it will not insert a second package.",
        );
      }
      if (error instanceof ArchitectureWriteOutcomeUnknownError) {
        await this.#recordFailure(origin, command, {
          code: "model-write-architecture-provider-outcome-unknown",
          message:
            "The provider outcome is unknown after a durable dispatch record; automatic redispatch is forbidden pending human reconciliation.",
        }, claimed);
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "retain" },
        });
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The SysON architecture insertion outcome is unknown. An operator must inspect " +
            "SysON before any separately reviewed recovery path.",
        );
      }
      // BLOQUANT C — quarantine sentinel found: the run was already quarantined
      // by a prior structural failure post-acknowledgement. Fail the run so its
      // status is visible, and surface the reason as a diagnostic error.
      if (error instanceof ArchitectureRunQuarantinedError) {
        await this.#recordFailure(origin, command, {
          code: "model-write-architecture-post-acknowledgement-quarantined",
          message:
            "SysON acknowledged an architecture insertion, then structural verification failed; the run is quarantined.",
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
        /**
         * Any failure after a validated provider acknowledgement can follow a
         * partial remote mutation: transport failures are no safer than known
         * structural errors. Quarantine the runId independently of planDigest
         * so no retry can derive a smaller plan and redispatch it.
         */
        try {
          await this.#attempts.quarantine({
            projectId: command.projectId,
            runId: command.runId,
            quarantinedAt: this.#now(),
          });
        } catch {
          // If the sentinel itself cannot be persisted, the only remaining
          // durable stop is the project lifecycle. Do not swallow that
          // transition: a run which still looks running could be retried.
          if (claimed) {
            await this.#recordFailure(origin, command, {
              code: "model-write-architecture-quarantine-write-failed",
              message:
                "SysON acknowledged an architecture insertion, but the durable quarantine could not be recorded. Automatic retry is forbidden.",
            }, true);
          }
          await settleCapabilityRuntimeSession({
            session: capabilitySession,
            policy: { kind: "retain" },
          });
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            "The acknowledged SysON insertion could not be durably quarantined. " +
              "The run was failed; an operator must inspect SysON before any new run.",
          );
        }
        if (claimed) {
          await this.#recordFailure(origin, command, {
            code: "model-write-architecture-post-acknowledgement-quarantined",
            message:
              "SysON acknowledged an architecture insertion, then provider readback or structural verification failed; the run is quarantined.",
          });
        }
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "retain" },
        });
        if (
          error instanceof EngineeringProjectCommandError ||
          error instanceof ArchitectureStructureExtractionError
        ) throw error;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "SysON acknowledged an architecture insertion, then a provider call or readback failed. " +
            "The run is quarantined pending exact reconciliation.",
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
          "Generic architecture write requires the configured JIT capability runtime session before a run can be claimed.",
        missingBindingMessage:
          "Generic architecture write requires the sealed model.author-system@1 operational capability before a run can be claimed.",
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

  async #walBeginOrFail(
    projectId: string,
    runId: string,
    packageName: string,
    items: ReturnType<typeof planArchitectureInsertion>["toInsert"],
    planDigest: string,
    dispatchedAt: string,
    sourceAnalyses: readonly SysmlSourceAnalysisReference[],
  ): Promise<
    | { readonly action: "dispatch" }
    | { readonly action: "completed"; readonly architecturePackageId: string }
  > {
    /**
     * BLOQUANT C — check the run-level quarantine before consulting the WAL.
     * A completed acknowledgement cannot authorize recovery after structural
     * verification failed: the operator must inspect the possibly partial
     * provider graph. The quarantine sentinel therefore takes precedence over
     * every dispatched or completed attempt for the run.
     */
    if (await this.#attempts.isQuarantined(projectId, runId)) {
      throw new ArchitectureRunQuarantinedError();
    }
    try {
      return await this.#attempts.begin({
        projectId,
        runId,
        packageName,
        items,
        planDigest,
        dispatchedAt,
        sourceAnalyses,
      });
    } catch (error) {
      if (error instanceof ArchitectureWriteOutcomeUnknownError) throw error;
      throw new ArchitectureWriteOutcomeUnknownError();
    }
  }

  async #runAttemptOrFail(
    projectId: string,
    runId: string,
  ): Promise<Awaited<ReturnType<FileArchitectureAttemptStore["readRun"]>>> {
    try {
      if (await this.#attempts.isQuarantined(projectId, runId)) {
        throw new ArchitectureRunQuarantinedError();
      }
      const attempt = await this.#attempts.readRun(projectId, runId);
      if (attempt?.status === "dispatched") {
        throw new ArchitectureWriteOutcomeUnknownError();
      }
      return attempt;
    } catch (error) {
      if (
        error instanceof ArchitectureRunQuarantinedError ||
        error instanceof ArchitectureWriteOutcomeUnknownError
      ) throw error;
      // A torn/corrupt/unreadable run record is evidence of a possible remote
      // mutation. Never turn it into a fresh preflight.
      throw new ArchitectureWriteOutcomeUnknownError();
    }
  }

  /**
   * Capture every server-owned write form before the WAL permits dispatch, then
   * immediately reopen the durable bytes. The returned sourceText is therefore
   * not a freshly rendered string: it is the exact CAS text sent to SysON.
   */
  async #captureAndReopenSysmlSources(
    proposal: ArchitectureProposal,
    mode: "initial" | "enrichment",
    items: ReturnType<typeof planArchitectureInsertion>["toInsert"],
    runId: string,
  ): Promise<readonly VerifiedSysmlSourceAnalysis[]> {
    if (
      mode === "initial" && items[0]?.kind !== "full-package" ||
      mode === "enrichment" && items.some((item) => item.kind === "full-package")
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Architecture write selectors do not match their initial or enrichment mode.",
      );
    }
    const selectors = items.map((item) =>
      architectureWriteSelector(item, proposal.packageName)
    );
    const references = await Promise.all(
      selectors.map((selector) =>
        this.#sysmlSourceAnalysis.capture({
          proposal,
          selector,
          runId,
          operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
        })
      ),
    );
    return await this.#reopenSysmlSources(references);
  }

  async #reopenSysmlSources(
    references: readonly SysmlSourceAnalysisReference[],
  ): Promise<readonly VerifiedSysmlSourceAnalysis[]> {
    if (references.length === 0) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "A current architecture write must seal at least one rendered SysML source.",
      );
    }
    try {
      return await Promise.all(
        references.map((reference) => this.#sysmlSourceAnalysis.reopen(reference)),
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Sealed SysML source evidence is not exact and cannot be dispatched: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * A v3 WAL is a binding to this exact run occurrence, not just a correctly
   * shaped bundle for the same package.  Validate its server-owned dispatch
   * basis before any provider read or publication path can trust it.
   */
  #assertCurrentAttemptRunBasis(
    attempt: NonNullable<
      Awaited<ReturnType<FileArchitectureAttemptStore["readRun"]>>
    >,
    proposal: ArchitectureProposal,
    runId: string,
    dispatchedAt: string,
  ): void {
    if (
      attempt.runId !== runId ||
      attempt.packageName !== proposal.packageName ||
      attempt.dispatchedAt !== dispatchedAt
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Current architecture WAL does not match the signed package and immutable run dispatch basis.",
      );
    }
  }

  /**
   * Reopening proves CAS integrity.  Re-rendering proves the bytes are still
   * the native source of the proposal currently under authority.  Without this
   * second check, a self-consistent v3 WAL from another valid proposal could
   * be replayed under the same package/run/selectors.
   */
  #assertSourcesMatchCurrentProposal(
    sources: readonly VerifiedSysmlSourceAnalysis[],
    proposal: ArchitectureProposal,
  ): void {
    for (const source of sources) {
      const rendered = renderArchitectureSysmlWithManifest(
        proposal,
        source.reference.selector,
      );
      if (
        source.source.sourceText !== rendered.sourceText ||
        deterministicJson(source.source.manifest) !==
          deterministicJson(rendered.manifest)
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Current architecture WAL source evidence does not exactly match the signed proposal render.",
        );
      }
    }
  }

  async #insertEnrichmentItems(
    editingContextId: string,
    architecturePackageId: string,
    items: ReturnType<typeof planArchitectureInsertion>["toInsert"],
    sources: readonly VerifiedSysmlSourceAnalysis[],
    onAcknowledged: () => void,
  ): Promise<void> {
    // Phase A: insert all new part-defs under the architecture package.
    for (const item of items) {
      if (item.kind !== "part-def") continue;
      const sysml = sourceTextForSelector(sources, {
        kind: "part-def",
        packageName: sources[0]?.reference.selector.packageName ?? "",
        componentName: item.componentName,
      });
      const result = await this.#syson.callTool({
        name: "syson_element_insert_sysml",
        arguments: {
          editing_context_id: editingContextId,
          parent_id: architecturePackageId,
          sysml_text: sysml,
        },
      });
      verifyInsertionAck(result.structuredContent, architecturePackageId);
      // Do not mark acknowledgement before its parent/id shape is verified.
      // Once valid, Phase B and Phase C are post-acknowledgement territory.
      onAcknowledged();
    }

    // Phase B: re-extract package to get IDs for newly inserted part-defs.
    const postPartDef = await this.#syson.callTool({
      name: "syson_element_children",
      arguments: {
        editing_context_id: editingContextId,
        element_id: architecturePackageId,
      },
    });
    const packageChildren = parseChildrenResponse(
      postPartDef.structuredContent,
      architecturePackageId,
    );

    // The package may have changed while Phase A was writing. Rebuild the
    // parent map only from CURRENT PartDefinitions and fail before Phase C if
    // any label is ambiguous. A final readback would notice the duplicate too,
    // but only after a PartUsage could have been inserted under an arbitrary
    // homonymous parent.
    const currentPartDefs = packageChildren.filter((child) =>
      isPartDefinitionKind(child.kind)
    );
    const labelCounts = new Map<string, number>();
    for (const partDef of currentPartDefs) {
      labelCounts.set(partDef.label, (labelCounts.get(partDef.label) ?? 0) + 1);
    }
    const duplicateLabels = [...labelCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([label]) => label);
    if (duplicateLabels.length > 0) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Cannot insert architecture usages: ambiguous PartDefinition labels after " +
          `part-definition insertion: ${duplicateLabels.join(", ")}. ` +
          "Manual SysON inspection required before any usage is written.",
      );
    }

    // Build a map from label to id for all current part-defs. Do not fall back
    // to preflight IDs: they are stale after a concurrent model change.
    const partDefIdByLabel = new Map<string, string>();
    for (const partDef of currentPartDefs) {
      partDefIdByLabel.set(partDef.label, partDef.id);
    }

    // Phase C: lower reviewed usage statements through SysON's native model
    // operations. The sealed SysML remains the immutable authoring evidence;
    // this adapter owns the provider-specific PartUsage + FeatureTyping
    // sequence because textual insertion can ACK while omitting the usage.
    for (const item of items) {
      if (item.kind !== "usage") continue;
      const parentId = partDefIdByLabel.get(item.parentName);
      if (!parentId) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Cannot insert usage for "${item.componentName}": parent part-def ` +
            `"${item.parentName}" has no resolved ID after insertion.`,
        );
      }
      const targetId = partDefIdByLabel.get(item.componentName);
      if (!targetId) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Cannot type usage "${item.usageName}": target part-def ` +
            `"${item.componentName}" has no resolved ID after insertion.`,
        );
      }
      // Reopen the sealed source even though native lowering consumes its
      // reviewed fields rather than sending its text to SysON. This proves the
      // WAL selector still names the exact statement being implemented.
      sourceTextForSelector(
        sources,
        architectureWriteSelector(
          item,
          sources[0]?.reference.selector.packageName ?? "",
        ),
      );
      await writeSysonTypedPartUsage({
        syson: this.#syson,
        editingContextId,
        parentPartDefinitionId: parentId,
        targetPartDefinitionId: targetId,
        targetPartDefinitionLabel: item.componentName,
        usageName: item.usageName,
        onAcknowledged,
      });
    }

    // Phase D: insert reviewed AttributeUsage under the owning PartDefinition.
    for (const item of items) {
      if (item.kind !== "attribute") continue;
      const parentId = partDefIdByLabel.get(item.parentName);
      if (!parentId) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Cannot insert attribute "${item.attributeName}": parent part-def ` +
            `"${item.parentName}" has no resolved ID after insertion.`,
        );
      }
      const sysml = sourceTextForSelector(
        sources,
        architectureWriteSelector(
          item,
          sources[0]?.reference.selector.packageName ?? "",
        ),
      );
      const result = await this.#syson.callTool({
        name: "syson_element_insert_sysml",
        arguments: {
          editing_context_id: editingContextId,
          parent_id: parentId,
          sysml_text: sysml,
        },
      });
      verifyInsertionAck(result.structuredContent, parentId);
      onAcknowledged();
    }
  }

  async #loadSeedInputs(
    basis: EngineeringThreadSnapshotBasis,
  ): Promise<{
    base: ThreadSnapshot;
    seed: { editingContextId: string; rootPackageId: string };
    seedArtifact: ThreadArtifact;
    seedVerifiedFingerprint: ContentFingerprint;
  }> {
    const base = await exactSnapshot(this.#snapshots, basis);
    try {
      await assertThreadSnapshotLineageIntact(base, this.#snapshots);
    } catch (error) {
      if (error instanceof ThreadSnapshotLineageIntegrityError) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          `The architecture basis ThreadSnapshot has an invalid predecessor lineage: ${error.message}`,
        );
      }
      throw error;
    }
    const seedCandidates = base.artifacts.filter(
      (artifact) =>
        artifact.kind === "sysml-model" &&
        artifact.producer.serverId === "syson" &&
        artifact.producer.tool === "syson_model_create" &&
        artifact.inputArtifactIds.length === 0 &&
        artifact.uri?.startsWith("casys://syson-model-seed-capture/sha256/"),
    );
    const seedArtifact = seedCandidates.length === 1 ? seedCandidates[0] : undefined;
    if (
      !seedArtifact
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The basis ThreadSnapshot has no SysON model-seed artifact " +
          "(sysml-model produced by syson_model_create). " +
          "The architecture run must follow a completed syson-model-seed run.",
      );
    }
    const captureText = await this.#seedCaptures.read(seedArtifact.fingerprint);
    if (!captureText) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The SysON model-seed capture is not readable from the content-addressed store.",
      );
    }
    /**
     * Recompute the fingerprint from the bytes we actually read rather than
     * copying the digest from the snapshot record. This makes the resulting
     * `observedFingerprint` an attestation that the byte-level store returned
     * the correct content, not a tautological copy of what the record claims.
     *
     * WHY `sha256Fingerprint(JSON.parse(captureText))` equals the raw-bytes
     * hash stored by `FileCaptureStore`:
     *
     *   (1) The seed executor wrote `captureText = deterministicJson(captureRecord)`.
     *   (2) `FileCaptureStore.save()` stores that text and fingerprints it as
     *       `SHA-256(UTF-8(captureText))` — i.e. the raw bytes of the JSON string.
     *   (3) `sha256Fingerprint(obj)` computes `SHA-256(deterministicJson(obj))`.
     *   (4) For a value written by `deterministicJson`, the round-trip is stable:
     *       `deterministicJson(JSON.parse(deterministicJson(x))) === deterministicJson(x)`.
     *   (5) Therefore:
     *       `sha256Fingerprint(JSON.parse(captureText))`
     *         = `SHA-256(deterministicJson(JSON.parse(captureText)))`
     *         = `SHA-256(deterministicJson(captureRecord))`
     *         = `SHA-256(captureText bytes)`
     *         = the digest stored by `FileCaptureStore`.
     *
     * This equivalence holds ONLY because the capture text was produced by
     * `deterministicJson`. Do not generalise to arbitrary JSON sources.
     */
    let seedCapture: ReturnType<typeof parseSysonModelSeedCapture>;
    let seedCaptureRecord: unknown;
    try {
      seedCaptureRecord = JSON.parse(captureText);
      seedCapture = parseSysonModelSeedCapture(seedCaptureRecord);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The SysON model-seed capture is not an exact canonical seed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    // Hash the complete stored canonical capture, not the parser's convenient
    // projection: the projection deliberately omits fields and cannot attest
    // the evidence bytes.
    const seedVerifiedFingerprint = await sha256Fingerprint(seedCaptureRecord);
    if (
      !fingerprintsEqual(seedVerifiedFingerprint, seedArtifact.fingerprint) ||
      seedCapture.trustedRunId !== seedArtifact.producer.runId ||
      seedArtifact.id !== `syson-model-seed-${seedArtifact.fingerprint.digest}`
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Seed capture fingerprint mismatch: the bytes read from the store do not hash " +
          "to the fingerprint recorded in the snapshot.",
      );
    }
    await this.#assertExactSeedLineage(
      base,
      seedArtifact,
      seedCaptureRecord,
      seedCapture,
    );
    const seed = {
      editingContextId: seedCapture.normalizedResults.project.editingContextId,
      rootPackageId: seedCapture.normalizedResults.rootPackage.id,
    };
    return { base, seed, seedArtifact, seedVerifiedFingerprint };
  }

  /**
   * A successor may enrich only the Package scope sealed by its exact current
   * predecessor capture. This is intentionally before the lease: changing the
   * package is outside the registered one-package surface, not a provider
   * outcome that needs a WAL, quarantine, or project lifecycle transition.
   */
  async #assertPredecessorPackageScopeBeforeLease(
    run: EngineeringAgentRun,
    proposal: ArchitectureProposal,
  ): Promise<void> {
    const { base, seedArtifact } = await this.#loadSeedInputs(requireBasis(run));
    await assertArchitectureArtifactNotRemoved(base, this.#snapshots);
    const predecessor = requireArchitectureTip(base);
    const capture = await this.#assertPredecessorCaptureExact(
      predecessor,
      base,
      seedArtifact,
    );
    if (!capture) return;
    try {
      assertArchitecturePackageScope({
        packageName: capture.packageName,
        scopeRootId: capture.scopeRoot.id,
      }, proposal);
    } catch (error) {
      if (error instanceof ArchitecturePackageScopeError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Architecture package scope preflight rejected (${error.code}): ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * A valid seed capture is insufficient on its own: it must be the exact r2
   * descendant of the current subject's r1 documentary baseline.  Otherwise a
   * copied capture could direct this run into another subject's SysON editing
   * context while all content hashes still look valid.
   */
  async #assertExactSeedLineage(
    base: ThreadSnapshot,
    seedArtifact: ThreadArtifact,
    seedCaptureRecord: unknown,
    seedCapture: ReturnType<typeof parseSysonModelSeedCapture>,
  ): Promise<void> {
    const declaredR1 = seedCapture.lineage.baseSnapshot;
    if (declaredR1.subjectId !== base.subject.id || declaredR1.revision !== 1) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The SysON model-seed capture does not name this subject's exact r1 documentary baseline.",
      );
    }

    const lineage: ThreadSnapshot[] = [];
    let cursor: ThreadSnapshot | undefined = base;
    const visited = new Set<string>();
    while (cursor) {
      const key = `${cursor.id}\u0000${cursor.revision}`;
      if (visited.has(key)) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "The SysON model-seed lineage contains a cycle.",
        );
      }
      visited.add(key);
      lineage.push(cursor);
      if (!cursor.previous) break;
      const previous = await this.#snapshots.get(cursor.previous.snapshotId);
      if (
        !previous || previous.id !== cursor.previous.snapshotId ||
        previous.revision !== cursor.previous.revision ||
        previous.subject.id !== base.subject.id
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "The SysON model-seed lineage is not an exact same-subject snapshot chain.",
        );
      }
      cursor = previous;
    }

    const r1 = lineage.find((snapshot) =>
      snapshot.id === declaredR1.snapshotId &&
      snapshot.revision === declaredR1.revision &&
      snapshot.subject.id === declaredR1.subjectId
    );
    const seedR2 = lineage.filter((snapshot) =>
      snapshot.revision === 2 &&
      snapshot.previous?.snapshotId === declaredR1.snapshotId &&
      snapshot.previous.revision === declaredR1.revision &&
      snapshot.artifacts.some((artifact) => artifact.id === seedArtifact.id)
    );
    if (!r1 || seedR2.length !== 1) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The SysON model-seed artifact is not introduced by the exact r2 descendant of its declared r1 documentary baseline.",
      );
    }

    let exact;
    try {
      exact = await requireExactSysonModelSeed(seedR2[0]!, seedCaptureRecord);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The SysON model-seed documentary lineage is not exact: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (
      exact.artifactId !== seedArtifact.id ||
      !fingerprintsEqual(exact.fingerprint, seedArtifact.fingerprint) ||
      exact.normalizedResults.project.editingContextId !==
        seedCapture.normalizedResults.project.editingContextId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact r2 SysON model-seed identity does not match the architecture basis artifact.",
      );
    }
  }

  /**
   * The capture is evidence of the reviewed graph, not a convenient dump of
   * whatever happened to be live in SysON.  For an enrichment, the previous
   * capture is the only admitted inherited graph; for an initial write, only
   * the reviewed proposal is admitted.  A separate reviewed removal operation
   * is required to make an old edge disappear.
   */
  async #assertNoUnattestedLiveArchitecture(
    verified: ExistingArchitectureStructure,
    proposal: ArchitectureProposal,
    predecessor: ThreadArtifact | undefined,
  ): Promise<void> {
    let predecessorGraph: ExistingArchitectureStructure | undefined;
    if (predecessor) {
      const text = await this.#captures.read(predecessor.fingerprint);
      if (!text) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "The predecessor architecture capture is not durably readable.",
        );
      }
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "The predecessor architecture capture is invalid JSON.",
        );
      }
      const fingerprint = await sha256Fingerprint(record);
      let capture: ExactArchitectureCapture;
      try {
        capture = parseExactArchitectureCapture(record);
      } catch (error) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          `The predecessor architecture graph is malformed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (
        !fingerprintsEqual(fingerprint, predecessor.fingerprint) ||
        predecessor.id !== `architecture-${predecessor.fingerprint.digest}` ||
        capture.trustedRunId !== predecessor.producer.runId
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "The predecessor architecture capture is not exact architecture-capture/4.0 evidence.",
        );
      }
      predecessorGraph = architectureGraphFromCapture(capture);
    }
    requireAcceptedArchitectureRatchet(
      ratchetArchitectureGraph({
        predecessor: predecessorGraph,
        proposal,
        live: verified,
      }),
    );
  }

  async #assertPredecessorCaptureExact(
    predecessor: ThreadArtifact | undefined,
    base: ThreadSnapshot,
    seedArtifact: ThreadArtifact,
  ): Promise<ExactArchitectureCapture | undefined> {
    if (!predecessor) return undefined;
    const text = await this.#captures.read(predecessor.fingerprint);
    if (!text) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The predecessor architecture capture is not durably readable.",
      );
    }
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The predecessor architecture capture is invalid JSON.",
      );
    }
    let capture: ExactArchitectureCapture;
    try {
      capture = parseExactArchitectureCapture(record);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The predecessor architecture capture is not canonical architecture-capture/4.0 evidence: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const fingerprint = await sha256Fingerprint(record);
    if (
      !fingerprintsEqual(fingerprint, predecessor.fingerprint) ||
      predecessor.id !== `architecture-${predecessor.fingerprint.digest}` ||
      predecessor.version !== predecessor.fingerprint.digest ||
      predecessor.kind !== "sysml-model" ||
      predecessor.uri !==
        `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${predecessor.fingerprint.digest}` ||
      predecessor.mediaType !== "application/json" ||
      predecessor.producer.serverId !== "syson" ||
      predecessor.producer.tool !== "syson_element_insert_sysml" ||
      capture.trustedRunId !== predecessor.producer.runId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The predecessor architecture capture is not exact architecture-capture/4.0 evidence.",
      );
    }
    const captureSeed = capture.seed;
    if (
      captureSeed.artifactId !== seedArtifact.id ||
      !fingerprintsEqual(captureSeed.fingerprint, seedArtifact.fingerprint) ||
      captureSeed.producerRunId !== seedArtifact.producer.runId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The predecessor architecture capture does not name the exact SysON seed consumed by its Thread artifact.",
      );
    }

    const capturePredecessor = capture.predecessor;
    let declaredPredecessor: ThreadArtifact | undefined;
    if (capturePredecessor) {
      declaredPredecessor = base.artifacts.find((artifact) =>
        artifact.id === capturePredecessor.artifactId
      );
      if (
        !declaredPredecessor ||
        !isGenericArchitectureArtifact(declaredPredecessor) ||
        declaredPredecessor.id !==
          `architecture-${declaredPredecessor.fingerprint.digest}` ||
        declaredPredecessor.version !==
          declaredPredecessor.fingerprint.digest ||
        declaredPredecessor.uri !==
          `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${declaredPredecessor.fingerprint.digest}` ||
        declaredPredecessor.mediaType !== "application/json" ||
        declaredPredecessor.producer.serverId !== "syson" ||
        declaredPredecessor.producer.tool !== "syson_element_insert_sysml" ||
        !fingerprintsEqual(
          capturePredecessor.fingerprint,
          declaredPredecessor.fingerprint,
        ) ||
        capturePredecessor.producerRunId !== declaredPredecessor.producer.runId
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "The predecessor architecture capture does not name one exact prior architecture artifact.",
        );
      }
    }

    const expectedInputs = [
      seedArtifact.id,
      ...(declaredPredecessor ? [declaredPredecessor.id] : []),
    ];
    if (
      predecessor.inputArtifactIds.length !== expectedInputs.length ||
      new Set(predecessor.inputArtifactIds).size !==
        predecessor.inputArtifactIds.length ||
      expectedInputs.some((id) => !predecessor.inputArtifactIds.includes(id))
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The predecessor architecture capture declarations and Thread artifact inputs are not bijective.",
      );
    }
    return capture;
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: ModelWriteArchitectureRunExecutorCommand,
    failure = {
      code: "model-write-architecture-not-published",
      message: "The generic architecture run stopped before evidence was published.",
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
            "model-write-architecture-post-acknowledgement-quarantined"
          ? "Generic architecture run quarantined after an acknowledged SysON insertion."
          : "Generic architecture run stopped before evidence was published.",
        code: failure.code,
        message: failure.message,
      });
    } catch {
      if (required) throw new ArchitectureWriteOutcomeUnknownError();
      // Preserve the original cause on ordinary pre-acknowledgement failures.
    }
  }

  async #completedFor(
    command: ModelWriteArchitectureRunExecutorCommand,
    architectureProposal: ArchitectureProposal,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    if (requireRun(project, command.runId).status !== "completed") {
      return undefined;
    }
    // A completed run is terminal: invalid evidence is a hard integrity error,
    // never a reason to fall through to claim/publish logic.
    assertCompleted(project, command);
    await this.#assertCompletedEvidenceExact(
      project,
      command,
      architectureProposal,
    );
    return project;
  }

  async #assertCompletedEvidenceExact(
    project: EngineeringProjectSnapshot,
    command: ModelWriteArchitectureRunExecutorCommand,
    architectureProposal: ArchitectureProposal,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    const result = run.resultSnapshot;
    if (!result) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture run has no result snapshot.",
      );
    }
    const snapshot = await this.#snapshots.get(result.snapshotId);
    if (
      !snapshot || snapshot.id !== result.snapshotId ||
      snapshot.revision !== result.revision
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture result snapshot is not durably readable.",
      );
    }
    try {
      validateThreadSnapshot(snapshot);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Completed architecture result snapshot is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const basis = run.basis;
    const declaredResultRefs = project.threadSnapshots.filter((reference) =>
      reference.snapshotId === result.snapshotId &&
      reference.revision === result.revision &&
      reference.subjectId === result.subjectId
    );
    if (
      basis?.kind !== "thread-snapshot" ||
      basis.subjectId !== project.project.subjectId ||
      result.subjectId !== project.project.subjectId ||
      snapshot.subject.id !== project.project.subjectId ||
      declaredResultRefs.length !== 1 ||
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture result is not the exact same-subject direct successor declared by the run basis and project ThreadSnapshot references.",
      );
    }
    try {
      await assertThreadSnapshotLineageIntact(snapshot, this.#snapshots);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Completed architecture result has an invalid predecessor lineage: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const artifacts = snapshot.artifacts.filter((artifact) =>
      artifact.kind === "sysml-model" &&
      artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX) &&
      artifact.producer.runId === run.id
    );
    if (artifacts.length !== 1 || run.evidenceRefs.length !== 1) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture run does not have exactly one result evidence artifact.",
      );
    }
    const artifact = artifacts[0]!;
    const currentTip = requireArchitectureTip(snapshot);
    if (!currentTip || currentTip.id !== artifact.id) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture evidence is not the unique active lineage tip produced by its run.",
      );
    }
    const evidence = run.evidenceRefs[0]!;
    if (
      evidence.kind !== "artifact" || evidence.id !== artifact.id ||
      evidence.snapshotId !== snapshot.id ||
      evidence.snapshotRevision !== snapshot.revision ||
      artifact.id !== `architecture-${artifact.fingerprint.digest}` ||
      artifact.version !== artifact.fingerprint.digest ||
      artifact.uri !==
        `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${artifact.fingerprint.digest}` ||
      artifact.producer.serverId !== "syson" ||
      artifact.producer.tool !== "syson_element_insert_sysml" ||
      artifact.producer.runId !== run.id ||
      artifact.mediaType !== "application/json"
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture evidence reference is not exactly bound to its result snapshot.",
      );
    }
    const text = await this.#captures.read(artifact.fingerprint);
    if (!text) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture capture is not durably readable.",
      );
    }
    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture capture is invalid JSON.",
      );
    }
    let capture: ExactArchitectureCapture;
    try {
      capture = parseExactArchitectureCapture(record);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Completed architecture capture is not canonical architecture-capture/4.0 evidence: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const actual = await sha256Fingerprint(record);
    if (!fingerprintsEqual(actual, artifact.fingerprint)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture capture fingerprint no longer matches its exact evidence bytes.",
      );
    }
    if (
      capture.trustedRunId !== run.id ||
      capture.packageName !== architectureProposal.packageName ||
      capture.systemName !== architectureProposal.system.name ||
      capture.insertedAt !== requiredStart(run) ||
      artifact.name !== `Architecture: ${capture.packageName}` ||
      artifact.freshness.status !== "fresh" ||
      artifact.freshness.changedAt !== capture.insertedAt ||
      artifact.freshness.invalidatedByChangeIds.length !== 0
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture capture and artifact metadata are not exactly bound to the signed proposal and run start.",
      );
    }

    const seedArtifact = snapshot.artifacts.find((candidate) =>
      candidate.id === capture.seed.artifactId
    );
    if (
      !seedArtifact || !isExactSysonSeedArtifact(seedArtifact) ||
      seedArtifact.id !==
        `syson-model-seed-${seedArtifact.fingerprint.digest}` ||
      seedArtifact.version !== seedArtifact.fingerprint.digest ||
      seedArtifact.uri !==
        `casys://syson-model-seed-capture/sha256/${seedArtifact.fingerprint.digest}` ||
      seedArtifact.mediaType !== "application/json" ||
      !fingerprintsEqual(seedArtifact.fingerprint, capture.seed.fingerprint) ||
      seedArtifact.producer.runId !== capture.seed.producerRunId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture capture does not name its exact SysON seed artifact.",
      );
    }

    let predecessorArtifact: ThreadArtifact | undefined;
    if (capture.predecessor) {
      predecessorArtifact = snapshot.artifacts.find((candidate) =>
        candidate.id === capture.predecessor!.artifactId
      );
      if (
        !predecessorArtifact ||
        !isGenericArchitectureArtifact(predecessorArtifact) ||
        predecessorArtifact.id !==
          `architecture-${predecessorArtifact.fingerprint.digest}` ||
        predecessorArtifact.version !==
          predecessorArtifact.fingerprint.digest ||
        predecessorArtifact.uri !==
          `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${predecessorArtifact.fingerprint.digest}` ||
        predecessorArtifact.mediaType !== "application/json" ||
        predecessorArtifact.producer.serverId !== "syson" ||
        predecessorArtifact.producer.tool !== "syson_element_insert_sysml" ||
        !fingerprintsEqual(
          predecessorArtifact.fingerprint,
          capture.predecessor.fingerprint,
        ) ||
        predecessorArtifact.producer.runId !== capture.predecessor.producerRunId
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Completed architecture capture does not name one exact architecture predecessor.",
        );
      }
    }

    const expectedInputs = [
      seedArtifact.id,
      ...(predecessorArtifact ? [predecessorArtifact.id] : []),
    ];
    const exactConsumption = (
      input: ThreadArtifact,
      expectedFingerprint: ContentFingerprint,
    ) =>
      snapshot.consumptions.filter((consumption) =>
        consumption.artifactId === input.id &&
        fingerprintsEqual(
          consumption.observedFingerprint,
          expectedFingerprint,
        ) &&
        consumption.status === "verified" &&
        consumption.verifiedAt === capture.insertedAt &&
        consumption.consumer.serverId === artifact.producer.serverId &&
        consumption.consumer.tool === artifact.producer.tool &&
        consumption.consumer.runId === artifact.producer.runId
      ).length === 1;
    if (
      artifact.inputArtifactIds.length !== expectedInputs.length ||
      new Set(artifact.inputArtifactIds).size !==
        artifact.inputArtifactIds.length ||
      expectedInputs.some((id) => !artifact.inputArtifactIds.includes(id)) ||
      !exactConsumption(seedArtifact, capture.seed.fingerprint) ||
      (capture.predecessor && predecessorArtifact &&
        !exactConsumption(predecessorArtifact, capture.predecessor.fingerprint))
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture artifact inputs are not bijective with its exact seed and optional predecessor capture declarations.",
      );
    }

    let base: ThreadSnapshot;
    try {
      base = await exactSnapshot(this.#snapshots, basis);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Completed architecture basis is not exactly readable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const baseSeedArtifact = base.artifacts.find((candidate) =>
      candidate.id === seedArtifact.id
    );
    if (
      !baseSeedArtifact ||
      deterministicJson(baseSeedArtifact) !== deterministicJson(seedArtifact)
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture seed artifact is not the exact immutable basis input.",
      );
    }

    const expectedPredecessorArtifact = requireArchitectureTip(base);
    if (
      (expectedPredecessorArtifact === undefined) !==
        (capture.predecessor === undefined) ||
      (expectedPredecessorArtifact !== undefined &&
        (capture.predecessor === undefined ||
          capture.predecessor.artifactId !== expectedPredecessorArtifact.id ||
          !fingerprintsEqual(
            capture.predecessor.fingerprint,
            expectedPredecessorArtifact.fingerprint,
          ) ||
          capture.predecessor.producerRunId !==
            expectedPredecessorArtifact.producer.runId ||
          predecessorArtifact === undefined ||
          deterministicJson(predecessorArtifact) !==
            deterministicJson(expectedPredecessorArtifact)))
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture capture does not name the exact active predecessor from its immutable basis.",
      );
    }

    const verified = architectureGraphFromCapture(capture);
    try {
      verifyAllComponentsPresent(verified, architectureProposal, []);
      await this.#assertPredecessorCaptureExact(
        expectedPredecessorArtifact,
        base,
        baseSeedArtifact,
      );
      await this.#assertNoUnattestedLiveArchitecture(
        verified,
        architectureProposal,
        expectedPredecessorArtifact,
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Completed architecture capture does not exactly represent its signed proposal and attested predecessor graph: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // The WAL is the durable provider acknowledgement. Its planDigest seals
    // the live preflight split between adopted and inserted items, which cannot
    // be reconstructed offline from the final capture without confusing a
    // pre-existing live adoption with an insertion performed by this run. The
    // strict replay anchors the fields that are independently recoverable:
    // identity, terminal status, dispatch instant, and acknowledged Package id.
    let completedAttempt: Awaited<
      ReturnType<FileArchitectureAttemptStore["readRun"]>
    >;
    try {
      completedAttempt = await this.#attempts.readRun(
        project.project.id,
        run.id,
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Completed architecture WAL is not exactly readable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (
      completedAttempt?.status !== "completed" ||
      completedAttempt.dispatchedAt !== capture.insertedAt ||
      completedAttempt.result.architecturePackageId !== capture.scopeRoot.id
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture evidence is not backed by an exact completed WAL acknowledgement, run start, and Package identity.",
      );
    }
    if (
      !sameSourceAnalysisReferences(
        capture.sourceAnalyses,
        completedAttempt.sourceAnalyses,
      )
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed current architecture capture does not match the exact source-analysis evidence sealed by its WAL.",
      );
    }
    const sources = await this.#reopenSysmlSources(capture.sourceAnalyses);
    this.#assertCurrentAttemptRunBasis(
      completedAttempt,
      architectureProposal,
      run.id,
      requiredStart(run),
    );
    this.#assertSourcesMatchCurrentProposal(sources, architectureProposal);

    let rebuilt: ReturnType<typeof applyThreadSnapshotExtensionIfNew>;
    try {
      rebuilt = applyThreadSnapshotExtensionIfNew(
        base,
        buildArchitectureThreadExtension({
          base,
          seedArtifact,
          previousArchitectureArtifact: expectedPredecessorArtifact,
          seedVerifiedFingerprint: capture.seed.fingerprint,
          runId: run.id,
          capturedAt: capture.insertedAt,
          captureFp: artifact.fingerprint,
          captureUri: artifact.uri,
          architectureProposal,
          verified,
        }),
        { appliedAt: capture.insertedAt },
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Completed architecture result cannot be rebuilt from its exact basis and capture: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (
      !rebuilt.applied ||
      deterministicJson(rebuilt.snapshot) !== deterministicJson(snapshot)
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed architecture result is not the exact immutable extension of its declared basis.",
      );
    }
  }

  async #reconcileLive(subjectId: string, runId: string): Promise<void> {
    try {
      await this.#liveUpdates?.reconcileRunOnce(
        subjectId,
        runId,
        this.#now(),
      );
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

// ── Private: shape guards ────────────────────────────────────────────────────

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
    operation?.id !== MODEL_WRITE_ARCHITECTURE_OPERATION.id ||
    operation.version !== MODEL_WRITE_ARCHITECTURE_OPERATION.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical model.write-architecture@1 operation.",
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
      "This executor may run only the exact architecture run it claimed.",
    );
  }
}

// ── Private: MRTR approval ───────────────────────────────────────────────────

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
        ? "No exact human-approved architecture MRTR decision is bound to this run basis."
        : "Ambiguous architecture MRTR: exactly one human-approved architecture decision must be bound to this run basis.",
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
      "Architecture decision input fingerprint no longer seals its exact base " +
        "snapshot, evidence references, summary, and parameters.",
    );
  }

  const approvedDecisions = workItem.decisionIds.map((id) => {
    const decision = project.decisions.find((candidate) => candidate.id === id);
    if (!decision?.inputFingerprint) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Architecture work-item decision ${id} is not exactly approved.`,
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
    // This spelling and order intentionally mirror queueV3Run.  The run
    // fingerprint is a queue-time seal, not a locally similar digest.
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Architecture run input fingerprint no longer seals its exact MRTR decision and basis.",
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
  return value?.snapshotId === basis.snapshotId &&
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

// ── Private: proposal parsing ────────────────────────────────────────────────

function parseProposal(
  proposal: NonNullable<EngineeringDecision["proposal"]>,
): ArchitectureProposal {
  try {
    return parseArchitectureProposalParameters(proposal.parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Architecture proposal parameters are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Return only persisted-and-reopened bytes for the exact server write form. */
function sourceTextForSelector(
  sources: readonly VerifiedSysmlSourceAnalysis[],
  selector: SysmlSourceAnalysisReference["selector"],
): string {
  const matches = sources.filter((source) =>
    deterministicJson(source.reference.selector) === deterministicJson(selector)
  );
  if (matches.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The architecture dispatch has no one exact reopened SysML source for its registered write form.",
    );
  }
  return matches[0]!.source.sourceText;
}

function sameSourceAnalysisReferences(
  left: readonly SysmlSourceAnalysisReference[],
  right: readonly SysmlSourceAnalysisReference[],
): boolean {
  return deterministicJson(left) === deterministicJson(right);
}

// ── Private: SysON response validation ───────────────────────────────────────

/**
 * Seal the canonical full-package write and every deterministic statement that
 * may be needed if SysON retains only a prefix of that write. The synthetic
 * empty package is planning input only: it makes the existing enrichment
 * planner enumerate the system definition, component definitions, usages and
 * attributes without inventing a second insertion grammar.
 */
function initialSealedWriteItems(
  proposal: ArchitectureProposal,
): readonly InsertionItem[] {
  const fallback = planArchitectureInsertion(
    {
      packageId: "pre-dispatch-sealed-package",
      packageLabel: proposal.packageName,
      partDefs: [],
    },
    proposal,
  );
  if (fallback.mode !== "enrichment" || fallback.conflicts.length > 0) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The initial architecture fallback plan is not deterministic.",
    );
  }
  return Object.freeze([
    { kind: "full-package" as const },
    ...fallback.toInsert,
  ]);
}

/** The post-ACK readback may select only statements sealed before dispatch. */
function assertInitialFallbackWasSealed(
  missing: readonly InsertionItem[],
  sealed: readonly InsertionItem[],
): void {
  const allowed = new Set(
    sealed.filter((item) => item.kind !== "full-package").map(deterministicJson),
  );
  const unsealed = missing.find((item) => !allowed.has(deterministicJson(item)));
  if (unsealed) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The initial SysON readback requires an architecture statement that was not sealed before dispatch.",
    );
  }
}

function verifyInsertionAck(value: unknown, expectedParentId: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SysON insert response must be a non-null object.");
  }
  const record = value as Record<string, unknown>;
  if (record.inserted !== true) {
    throw new Error(
      `SysON insert did not acknowledge success (inserted: ${
        String(record.inserted)
      }).`,
    );
  }
  if (record.parentId !== expectedParentId) {
    throw new Error(
      `SysON insert parentId mismatch: expected "${expectedParentId}", ` +
        `got "${String(record.parentId)}".`,
    );
  }
}

function parseChildrenResponse(
  value: unknown,
  expectedParentId: string,
): readonly { id: string; kind: string; label: string }[] {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    (value as Record<string, unknown>).parentId !== expectedParentId ||
    !Array.isArray((value as Record<string, unknown>).children)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Unexpected syson_element_children response for element "${expectedParentId}".`,
    );
  }
  const record = value as Record<string, unknown>;
  return (record.children as unknown[]).map((child, i) => {
    if (
      !child || typeof child !== "object" || Array.isArray(child) ||
      typeof (child as Record<string, unknown>).id !== "string" ||
      typeof (child as Record<string, unknown>).label !== "string"
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `syson_element_children child[${i}] is malformed.`,
      );
    }
    const c = child as Record<string, unknown>;
    return {
      id: c.id as string,
      kind: (c.kind as string) ?? "",
      label: c.label as string,
    };
  });
}

function isPartDefinitionKind(kind: string): boolean {
  return kind === "PartDefinition" || kind === "sysml::PartDefinition" ||
    kind.endsWith("entity=PartDefinition");
}

// ── Private: post-insertion verification ─────────────────────────────────────

function requireAcceptedArchitectureRatchet(
  result: ArchitectureGraphRatchetResult,
): void {
  if (result.status === "rejected") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      result.message,
    );
  }
}

function verifyAllComponentsPresent(
  verified: ExistingArchitectureStructure | undefined,
  proposal: ArchitectureProposal,
  adopted: readonly AdoptedItem[],
): void {
  requireAcceptedArchitectureRatchet(
    verifyProposedArchitecturePresence({ live: verified, proposal, adopted }),
  );
}

/**
 * Producer-only identity seal. Readers consume the sealed id and never repeat
 * this name lookup. SysON already returns PartDefinition ids; the proposed
 * system name selects among them exactly once after post-write verification.
 */
function resolveSealedSemanticRoot(
  verified: ExistingArchitectureStructure,
  proposedSystemName: string,
): {
  readonly id: string;
  readonly kind: "PartDefinition";
  readonly label: string;
} {
  const matches = verified.partDefs.filter((part) =>
    part.label === proposedSystemName && part.id
  );
  if (matches.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Verification failed: the proposed system PartDefinition is not unique after readback.",
    );
  }
  return {
    id: matches[0]!.id,
    kind: "PartDefinition",
    label: matches[0]!.label,
  };
}

// ── Private: lifecycle helpers ────────────────────────────────────────────────

function commandStep(commandId: string, step: string): string {
  return `${commandId}:model-write-architecture:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: ModelWriteArchitectureRunExecutorCommand,
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
      `Architecture run ${command.runId} did not complete through this exact execution command.`,
    );
  }
}

/**
 * A run-scoped WAL cannot by itself prevent a new runId from re-dispatching an
 * unresolved provider write.  Keep recovery explicitly reviewed by refusing a
 * sibling run on the same sealed basis after either terminal uncertainty.
 */
async function assertNoBlockedArchitectureSibling(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  attempts: FileArchitectureAttemptStore,
): Promise<void> {
  const basis = requireBasis(run);
  const siblings = project.agentRuns.filter((candidate) => {
    if (candidate.id === run.id || !sameSnapshotBasis(candidate.basis, basis)) {
      return false;
    }
    const operation = project.workItems.find((item) => item.id === candidate.workItemId)
      ?.operation;
    return operation?.id === MODEL_WRITE_ARCHITECTURE_OPERATION.id &&
      operation.version === MODEL_WRITE_ARCHITECTURE_OPERATION.version;
  });
  for (const sibling of siblings) {
    if (
      sibling.status === "completed" ||
      sibling.status === "running" ||
      sibling.status === "publishing"
    ) {
      throw staleArchitectureBasisSibling();
    }
    if (sibling.status === "failed" && isTerminalArchitectureFailure(sibling)) {
      // The shared Thread write-basis guard immediately above is the sole
      // authority for terminal uncertain failures. Reaching this point means
      // its exact human reconciliation (and, for an accepted effect, basis
      // release) was revalidated. Do not let the executor's lower-level WAL
      // sentinel silently override that governed release.
      continue;
    }
    try {
      // A process can die after WAL reservation or acknowledgement but before
      // its lifecycle transition is persisted.  A sibling must treat either
      // durable fact as a basis-level stop: only the exact runId may recover
      // its own WAL record.
      if (
        await attempts.isQuarantined(project.project.id, sibling.id) ||
        await attempts.readRun(project.project.id, sibling.id)
      ) {
        throw staleArchitectureBasisSibling();
      }
    } catch (error) {
      if (error instanceof EngineeringProjectCommandError) throw error;
      // An unreadable sibling journal could conceal a dispatched provider
      // write.  The safe resolution is the same as for a known terminal WAL.
      throw staleArchitectureBasisSibling();
    }
  }
}

function isTerminalArchitectureFailure(run: EngineeringAgentRun): boolean {
  return run.failure?.code ===
      "model-write-architecture-provider-outcome-unknown" ||
    run.failure?.code ===
      "model-write-architecture-post-acknowledgement-quarantined" ||
    run.failure?.code ===
      "model-write-architecture-quarantine-write-failed";
}

function staleArchitectureBasisSibling(): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(
    "invalid_transition",
    "A prior generic architecture run on this exact basis has an unresolved " +
      "provider outcome, active execution, post-acknowledgement quarantine, or published result. " +
      "A separately reviewed recovery must advance the basis before another run can write SysON.",
  );
}

function architectureArtifactEntityRef(
  snapshot: ThreadSnapshot,
  runId: string,
): {
  snapshotId: string;
  snapshotRevision: number;
  kind: "artifact";
  id: string;
} {
  const produced = snapshot.artifacts.filter((artifact) =>
    isGenericArchitectureArtifact(artifact) && artifact.producer.runId === runId
  );
  const tip = requireArchitectureTip(snapshot);
  if (produced.length !== 1 || !tip || tip.id !== produced[0]!.id) {
    throw new Error(
      "Architecture snapshot has no unique current artifact produced by this run.",
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
    !snapshot ||
    snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact basis ThreadSnapshot required by the architecture run is not readable.",
    );
  }
  try {
    return validateThreadSnapshot(snapshot);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The basis ThreadSnapshot is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
