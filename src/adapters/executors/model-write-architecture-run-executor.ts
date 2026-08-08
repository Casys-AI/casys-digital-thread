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
 * 10. WAL (keyed by planDigest) → dispatch or resume completed.
 * 11. SysON insertions.
 * 12. Verification re-extraction: every proposed component present.
 * 13. Capture save + CAS readback.
 * 14. Thread extension → applyThreadSnapshotExtensionIfNew → validateThreadSnapshot.
 * 15. Snapshot save + CAS readback.
 * 16. publishRun + completeRun + assertCompleted.
 */

import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  type ArchitectureProposal,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  parseArchitectureProposalParameters,
  planArchitectureInsertion,
  renderArchitectureSysml,
} from "../../domain/platform/architecture-proposal.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  type FileCaptureStore,
} from "../captures/file-capture-store.ts";
import {
  ArchitectureWriteOutcomeUnknownError,
  FileArchitectureAttemptStore,
} from "../wal/file-architecture-attempt-store.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../stores/live-thread-update-store.ts";
import { extractArchitectureStructure } from "../extractors/architecture-structure-extractor.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

// ── Public re-exports ────────────────────────────────────────────────────────

export { MODEL_WRITE_ARCHITECTURE_OPERATION };

/** Stable schema version written into every architecture capture. */
export const ARCHITECTURE_CAPTURE_SCHEMA = "architecture-capture/1.0" as const;

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
  readonly attempts: FileArchitectureAttemptStore;
  /** Fixed server-owned MCP client. No agent value reaches this boundary. */
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
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
  return snapshot.artifacts.find(
    (a) =>
      a.kind === "sysml-model" &&
      typeof a.uri === "string" &&
      a.uri.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX),
  );
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
  if (findArchitectureArtifact(basis)) return;
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
      // Finding 7 — stop traversal when we cross a subject boundary. A lineage
      // pointer that leads to a different subject's snapshot must not trigger the
      // ratchet for this subject.
      ancestor.subject.id !== basis.subject.id
    ) {
      break;
    }
    if (findArchitectureArtifact(ancestor)) {
      throw new ArchitectureArtifactRemovedError(basis.subject.id);
    }
    cursor = ancestor.previous;
  }
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
  readonly #attempts: FileArchitectureAttemptStore;
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(dependencies: ModelWriteArchitectureRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#seedCaptures = dependencies.seedCaptures;
    this.#captures = dependencies.captures;
    this.#attempts = dependencies.attempts;
    this.#syson = dependencies.syson;
    this.#lease = dependencies.lease;
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
    const { proposal } = requireMrtrApproval(project, run);
    const architectureProposal = parseProposal(proposal);

    return await this.#lease.withLease(
      command.projectId,
      command.runId,
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

    try {
      // Pre-claim shape re-check (post-lease).
      const preClaim = await this.#requiredProject(command.projectId);
      requireShape(preClaim, requireRun(preClaim, command.runId));

      // If the run was already completed by an earlier execution of this exact
      // command chain, return without re-claiming (the completeRun receipt is
      // keyed by commandId, not expectedRevision, so the check survives a retry
      // that carries a newer expectedRevision).
      const alreadyCompleted = await this.#completedFor(command);
      if (alreadyCompleted) {
        await this.#reconcileLive(alreadyCompleted.project.subjectId, command.runId);
        return alreadyCompleted;
      }

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
        await this.#reconcileLive(project.project.subjectId, run.id);
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      const capturedAt = requiredStart(run);
      const basis = requireBasis(run);

      // Step 6: load basis snapshot + seed capture (with byte-level fingerprint verification).
      const { base, seed, seedVerifiedFingerprint } = await this.#loadSeedInputs(basis);

      // Step 7: cliquet.
      await assertArchitectureArtifactNotRemoved(base, this.#snapshots);

      const editingContextId = seed.editingContextId;
      const rootPackageId = seed.rootPackageId;
      const seedArtifact = requireSeedArtifact(base);

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
      }

      // Step 10: WAL (one entry per plan, keyed by content digest).
      const planDigest = await planContentDigest(plan.toInsert, architectureProposal);
      const walResult = await this.#walBeginOrFail(
        project.project.id,
        command.runId,
        planDigest,
        capturedAt,
      );

      // Step 11: SysON insertions.
      let architecturePackageId: string;
      if (walResult.action === "completed") {
        // Idempotent resume: no new insertions needed.
        // Re-extract to learn the package ID.
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
        architecturePackageId = existingForResume.packageId;
        providerAcknowledged = true;
      } else {
        // Dispatch: perform all insertions.
        try {
          if (plan.mode === "initial") {
            const sysml = renderArchitectureSysml(architectureProposal);
            const result = await this.#syson.callTool({
              name: "syson_element_insert_sysml",
              arguments: {
                editing_context_id: editingContextId,
                parent_id: rootPackageId,
                sysml_text: sysml,
              },
            });
            verifyInsertionAck(result.structuredContent, rootPackageId);
          } else {
            // Enrichment: insert per-item using the architecture package as root.
            const packageId = existing!.packageId;
            await this.#insertEnrichmentItems(
              editingContextId,
              packageId,
              existing!,
              plan.toInsert,
            );
          }
        } catch (error) {
          if (!(error instanceof EngineeringProjectCommandError)) {
            throw new ArchitectureWriteOutcomeUnknownError();
          }
          throw error;
        }
        await this.#attempts.complete({
          projectId: project.project.id,
          runId: command.runId,
          planDigest,
        });
        providerAcknowledged = true;

        // Resolve the package ID after insertion.
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
        architecturePackageId = postInsert.packageId;
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
      verifyAllComponentsPresent(verified, architectureProposal, plan.adopted);

      // Step 13: build + save capture.
      const captureRecord = {
        schemaVersion: ARCHITECTURE_CAPTURE_SCHEMA,
        packageName: architectureProposal.packageName,
        systemName: architectureProposal.system.name,
        packageId: architecturePackageId,
        seedFingerprint: seedArtifact.fingerprint,
        declarations: verified.partDefs.map((pd) => ({
          id: pd.id,
          label: pd.label,
        })),
        insertedAt: capturedAt,
      };
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
      const extension = buildExtension({
        base,
        seedArtifact,
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
          evidenceRefs: [architectureArtifactEntityRef(snapshot)],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.#requiredProject(command.projectId);
      assertCompleted(complete, command);
      await this.#reconcileLive(complete.project.subjectId, command.runId);
      return complete;
    } catch (error) {
      if (snapshotPersisted && materializedSnapshot) {
        const complete = await this.#completedFor(command);
        if (complete) return complete;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Generic architecture evidence is durable but project attachment did not finish. " +
            "Retry this exact command; it will not insert a second package.",
        );
      }
      if (error instanceof ArchitectureWriteOutcomeUnknownError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The SysON architecture insertion outcome is unknown. An operator must inspect " +
            "SysON before any separately reviewed recovery path.",
        );
      }
      if (providerAcknowledged) {
        // A structural divergence (e.g. wrong FeatureTyping in the verified
        // re-extraction) is already a well-formed diagnostic error. Re-throw
        // it directly so the operator sees the real cause, not a generic retry
        // message — retrying would fail identically.
        if (error instanceof EngineeringProjectCommandError) throw error;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The SysON architecture insertion was acknowledged but evidence was not published. " +
            "Retry this exact command to resume read-back without another insertion.",
        );
      }
      if (claimed) await this.#recordFailure(origin, command);
      throw error;
    }
  }

  async #walBeginOrFail(
    projectId: string,
    runId: string,
    planDigest: string,
    dispatchedAt: string,
  ): Promise<{ readonly action: "dispatch" } | { readonly action: "completed" }> {
    try {
      return await this.#attempts.begin({ projectId, runId, planDigest, dispatchedAt });
    } catch (error) {
      if (error instanceof ArchitectureWriteOutcomeUnknownError) throw error;
      throw new ArchitectureWriteOutcomeUnknownError();
    }
  }

  async #insertEnrichmentItems(
    editingContextId: string,
    architecturePackageId: string,
    preflight: Awaited<ReturnType<typeof extractArchitectureStructure>>,
    items: ReturnType<typeof planArchitectureInsertion>["toInsert"],
  ): Promise<void> {
    // Phase A: insert all new part-defs under the architecture package.
    for (const item of items) {
      if (item.kind !== "part-def") continue;
      const sysml = `part def ${item.componentName} {}`;
      const result = await this.#syson.callTool({
        name: "syson_element_insert_sysml",
        arguments: {
          editing_context_id: editingContextId,
          parent_id: architecturePackageId,
          sysml_text: sysml,
        },
      });
      verifyInsertionAck(result.structuredContent, architecturePackageId);
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

    // Build a map from label to id for all current part-defs.
    const partDefIdByLabel = new Map<string, string>();
    for (const child of packageChildren) {
      partDefIdByLabel.set(child.label, child.id);
    }
    // Also include existing part-defs from preflight.
    if (preflight) {
      for (const pd of preflight.partDefs) {
        if (!partDefIdByLabel.has(pd.label)) {
          partDefIdByLabel.set(pd.label, pd.id);
        }
      }
    }

    // Phase C: insert usages.
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
      const sysml = `part ${item.usageName} : ${item.componentName};`;
      const result = await this.#syson.callTool({
        name: "syson_element_insert_sysml",
        arguments: {
          editing_context_id: editingContextId,
          parent_id: parentId,
          sysml_text: sysml,
        },
      });
      verifyInsertionAck(result.structuredContent, parentId);
    }
  }

  async #loadSeedInputs(
    basis: EngineeringThreadSnapshotBasis,
  ): Promise<{
    base: ThreadSnapshot;
    seed: { editingContextId: string; rootPackageId: string };
    seedVerifiedFingerprint: ContentFingerprint;
  }> {
    const base = await exactSnapshot(this.#snapshots, basis);
    const seedArtifact = base.artifacts.find(
      (a) => a.kind === "sysml-model" && a.producer.tool === "syson_model_create",
    );
    if (!seedArtifact) {
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
    // Finding 6 — recompute the fingerprint from the bytes we actually read, not
    // from the snapshot record. This proves that the content-addressed lookup
    // returned the right bytes, making the consumption's observedFingerprint an
    // attestation of a real byte-level verification, not a copy of the record.
    const seedVerifiedFingerprint = await sha256Fingerprint(
      JSON.parse(captureText) as Record<string, unknown>,
    );
    if (seedVerifiedFingerprint.digest !== seedArtifact.fingerprint.digest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Seed capture fingerprint mismatch: the bytes read from the store do not hash " +
          "to the fingerprint recorded in the snapshot.",
      );
    }
    const seed = parseSeedCaptureMiniFields(captureText);
    return { base, seed, seedVerifiedFingerprint };
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: ModelWriteArchitectureRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        run.status !== "running" || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "Generic architecture run stopped before a SysON insertion was acknowledged.",
        code: "model-write-architecture-not-published",
        message: "The generic architecture run stopped before evidence was published.",
      });
    } catch {
      // Preserve the original cause.
    }
  }

  async #completedFor(
    command: ModelWriteArchitectureRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.#requiredProject(command.projectId);
      assertCompleted(project, command);
      return project;
    } catch {
      return undefined;
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
    project.schemaVersion !== "3.0" ||
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

function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): {
  decision: EngineeringDecision;
  proposal: NonNullable<EngineeringDecision["proposal"]>;
} {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      `Work item for run ${run.id} not found.`,
    );
  }

  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find(
      (d) => d.id === decisionId && d.status === "approved",
    );
    if (!decision?.proposal || decision.proposal.parameters.length === 0) continue;

    const hasHumanApproval = project.approvals.some(
      (a: EngineeringApproval) =>
        a.decisionId === decision.id &&
        a.status === "approved" &&
        a.decidedByOrigin === "human",
    );
    if (hasHumanApproval) {
      return { decision, proposal: decision.proposal };
    }
  }

  throw new EngineeringProjectCommandError(
    "invalid_transition",
    'No human-approved MRTR decision (decidedByOrigin === "human") found for ' +
      "this architecture run. An operator must approve the architecture proposal " +
      "before execution can proceed.",
  );
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

// ── Private: seed-capture minimal parser ────────────────────────────────────

/**
 * Parse only the two fields needed from the seed capture: editingContextId
 * and rootPackage.id.
 *
 * WHY NARROW — `parseSysonModelSeedCapture` validates the whole schema and
 * checks CM-01-specific revision counts.  The generic executor needs only
 * the two SysON addressing fields; a narrow parse avoids coupling to CM-01
 * schema details.
 */
function parseSeedCaptureMiniFields(
  text: string,
): { editingContextId: string; rootPackageId: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The SysON model-seed capture is not valid JSON.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The SysON model-seed capture is not a JSON object.",
    );
  }
  const record = value as Record<string, unknown>;
  const results = record.normalizedResults;
  if (!results || typeof results !== "object" || Array.isArray(results)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      'The seed capture has no "normalizedResults" object.',
    );
  }
  const resultsRecord = results as Record<string, unknown>;
  const project = resultsRecord.project;
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      'The seed capture has no "normalizedResults.project" object.',
    );
  }
  const projectRecord = project as Record<string, unknown>;
  const editingContextId = projectRecord.editingContextId;
  if (typeof editingContextId !== "string" || !editingContextId.trim()) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      'The seed capture has no valid "normalizedResults.project.editingContextId".',
    );
  }
  const rootPkg = resultsRecord.rootPackage;
  if (!rootPkg || typeof rootPkg !== "object" || Array.isArray(rootPkg)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      'The seed capture has no "normalizedResults.rootPackage" object.',
    );
  }
  const rootPkgRecord = rootPkg as Record<string, unknown>;
  const rootPackageId = rootPkgRecord.id;
  if (typeof rootPackageId !== "string" || !rootPackageId.trim()) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      'The seed capture has no valid "normalizedResults.rootPackage.id".',
    );
  }
  return {
    editingContextId: editingContextId.trim(),
    rootPackageId: rootPackageId.trim(),
  };
}

// ── Private: seed artifact requirement ──────────────────────────────────────

function requireSeedArtifact(base: ThreadSnapshot): ThreadArtifact {
  const seed = base.artifacts.find(
    (a) => a.kind === "sysml-model" && a.producer.tool === "syson_model_create",
  );
  if (!seed) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The basis snapshot has no sysml-model seed artifact (syson_model_create).",
    );
  }
  return seed;
}

// ── Private: plan content digest ─────────────────────────────────────────────

async function planContentDigest(
  items: ReturnType<typeof planArchitectureInsertion>["toInsert"],
  proposal: ArchitectureProposal,
): Promise<string> {
  const canonical = deterministicJson({ items, packageName: proposal.packageName });
  const fp = await sha256Fingerprint(canonical);
  return fp.digest;
}

// ── Private: SysON response validation ───────────────────────────────────────

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

// ── Private: post-insertion verification ─────────────────────────────────────

function verifyAllComponentsPresent(
  verified: Awaited<ReturnType<typeof extractArchitectureStructure>>,
  proposal: ArchitectureProposal,
  adopted: ReturnType<typeof planArchitectureInsertion>["adopted"],
): void {
  if (!verified) return;
  const presentByLabel = new Map(verified.partDefs.map((pd) => [pd.label, pd]));

  // System must be present.
  if (!presentByLabel.has(proposal.system.name)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Verification failed: system PartDef "${proposal.system.name}" is absent after insertion.`,
    );
  }

  // Finding 1 — verify the FULL parent→usage→cible structure, not just PartDef
  // existence. A wrong type (e.g. `wing : Motor` instead of `wing : Wing`) or
  // a usage under the wrong parent must be rejected as a structural divergence.
  for (const component of proposal.components) {
    const componentDef = presentByLabel.get(component.name);
    if (!componentDef) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Verification failed: component PartDef "${component.name}" is absent after insertion.`,
      );
    }
    const parentDef = presentByLabel.get(component.parentName);
    if (!parentDef) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Verification failed: parent PartDef "${component.parentName}" for component ` +
          `"${component.name}" is absent after insertion.`,
      );
    }
    const matchingUsage = parentDef.usages.find(
      (u) => u.label === component.usageName && u.targetLabel === component.name,
    );
    if (!matchingUsage) {
      // Diagnose: is the usage present but with the wrong type?
      const wrongTyped = parentDef.usages.find((u) => u.label === component.usageName);
      if (wrongTyped) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Verification failed: usage "${component.usageName}" under "${component.parentName}" ` +
            `types "${wrongTyped.targetLabel}" instead of the proposed "${component.name}".`,
        );
      }
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Verification failed: usage "${component.usageName}" is absent under ` +
          `"${component.parentName}" after insertion of component "${component.name}".`,
      );
    }
  }

  // Previously adopted components must still be present.
  for (const adoptedItem of adopted) {
    if (!presentByLabel.has(adoptedItem.componentName)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Verification failed: previously-adopted component "${adoptedItem.componentName}" ` +
          "was removed from the model during this run.",
      );
    }
  }
}

// ── Private: thread extension builder ────────────────────────────────────────

function buildExtension(options: {
  base: ThreadSnapshot;
  seedArtifact: ThreadArtifact;
  /** Finding 6 — fingerprint recomputed from the bytes actually read, not copied
   * from the snapshot record. Proves a real byte-level verification occurred. */
  seedVerifiedFingerprint: ContentFingerprint;
  runId: string;
  capturedAt: string;
  captureFp: ContentFingerprint;
  captureUri: string;
  architectureProposal: ArchitectureProposal;
  verified: NonNullable<Awaited<ReturnType<typeof extractArchitectureStructure>>>;
}) {
  const {
    base,
    seedArtifact,
    seedVerifiedFingerprint,
    runId,
    capturedAt,
    captureFp,
    captureUri,
    architectureProposal,
    verified,
  } = options;

  const artifactId = `architecture-${captureFp.digest}`;
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

  const artifact: ThreadArtifact = {
    id: artifactId,
    name: `Architecture: ${architectureProposal.packageName}`,
    kind: "sysml-model",
    version: captureFp.digest,
    fingerprint: captureFp,
    uri: captureUri,
    mediaType: "application/json",
    producer,
    inputArtifactIds: [seedArtifact.id],
    freshness,
  };

  const extensionId = `model-write-architecture-${captureFp.digest}`;

  const consumptionId = `consume-${seedArtifact.id}-by-${artifactId}`;
  const consumption: ThreadArtifactConsumption = {
    id: consumptionId,
    artifactId: seedArtifact.id,
    consumer: producer,
    observedFingerprint: seedVerifiedFingerprint,
    verifiedAt: capturedAt,
    status: "verified",
  };

  const provenance = [
    {
      id: `derived-from-seed-${captureFp.digest}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: artifactId },
      to: { kind: "artifact" as const, id: seedArtifact.id },
      rationale:
        "The architecture package was inserted into the SysON model container " +
        "created by the seed run.",
    },
    {
      id: `uses-${consumptionId}`,
      relation: "uses" as const,
      from: { kind: "consumption" as const, id: consumptionId },
      to: { kind: "artifact" as const, id: seedArtifact.id },
      rationale: "The executor re-read the exact seed capture before inserting the " +
        "architecture package.",
    },
  ];

  return {
    id: extensionId,
    name: `Generic architecture: ${architectureProposal.packageName}`,
    subjectId: base.subject.id,
    capturedAt,
    artifacts: [artifact],
    consumptions: [consumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
    bindingProofs: [
      {
        provider: "syson",
        kind: "package",
        id: verified.packageId,
      },
    ],
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

function architectureArtifactEntityRef(
  snapshot: ThreadSnapshot,
): {
  snapshotId: string;
  snapshotRevision: number;
  kind: "artifact";
  id: string;
} {
  const artifact = findArchitectureArtifact(snapshot);
  if (!artifact) {
    throw new Error(
      "Architecture snapshot has no architecture artifact.",
    );
  }
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
