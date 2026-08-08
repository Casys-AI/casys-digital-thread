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
 * 17.  renderOracleRequirementsSysml → syson_element_insert_sysml.
 * 18.  providerAcknowledged = true.
 * 19.  WAL complete.
 * 20.  Identify element by label = partDefName in package children (D5).
 * 21.  extractAndVerifyOracleRequirements: fail-closed fidelity check.
 * 22.  Build capture record → sha256Fingerprint → save → CAS readback.
 * 23.  Build thread extension → applyThreadSnapshotExtensionIfNew →
 *       validateThreadSnapshot.
 * 24.  Snapshot save + CAS readback.
 * 25.  publishRun + completeRun + assertCompleted.
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
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import { parseSysonModelSeedCapture } from "../../domain/platform/syson-model-seed.ts";
import {
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  parseRequirementsProposalParameters,
  planRequirementsEnrichment,
  requirementEntriesToOracleRequirements,
  type RequirementsProposal,
} from "../../domain/platform/requirements-proposal.ts";
import {
  ORACLE_REQUIREMENT_OPERATORS,
  type OracleRequirement,
  renderOracleRequirementsSysml,
  SUPPORTED_ORACLE_UNITS,
} from "../../domain/analysis/proof-case.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  type FileCaptureStore,
  REQUIREMENTS_CAPTURE_URI_PREFIX,
} from "../captures/file-capture-store.ts";
import {
  FileRequirementsAttemptStore,
  RequirementsRunQuarantinedError,
  RequirementsWriteOutcomeUnknownError,
} from "../wal/file-requirements-attempt-store.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import {
  assertThreadSnapshotLineageIntact,
  ThreadSnapshotLineageIntegrityError,
} from "../stores/thread-snapshot-lineage.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../stores/live-thread-update-store.ts";
import {
  extractAndVerifyOracleRequirements,
  RequirementExtractionError,
} from "../extractors/syson-requirements-extractor.ts";
import { findArchitectureArtifact } from "./model-write-architecture-run-executor.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

// ── Public re-exports ────────────────────────────────────────────────────────

export { MODEL_WRITE_REQUIREMENTS_OPERATION };

/** Stable schema version for every requirements capture record. */
export const REQUIREMENTS_CAPTURE_SCHEMA = "requirements-capture/1.0" as const;

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
  readonly seedCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  /** Generic architecture captures — read-only for target resolution. */
  readonly architectureCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly captures: FileCaptureStore<"requirements-capture">;
  readonly attempts: FileRequirementsAttemptStore;
  /** Fixed server-owned MCP client. No agent value reaches this boundary. */
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

// ── Exported: find requirements artifact for a given target ──────────────────

/**
 * Locate the active requirements artifact for a specific containerComponent.
 *
 * Returns undefined if no requirements artifact for this component exists yet,
 * which is the initial-write signal for the executor.
 */
export function findRequirementsArtifact(
  snapshot: ThreadSnapshot,
  containerComponent: string,
): ThreadArtifact | undefined {
  const selected = selectRequirementsTip(snapshot, containerComponent);
  return selected.kind === "one" ? selected.artifact : undefined;
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
  readonly #captures: FileCaptureStore<"requirements-capture">;
  readonly #attempts: FileRequirementsAttemptStore;
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly #now: () => string;

  constructor(deps: ModelWriteRequirementsRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#seedCaptures = deps.seedCaptures;
    this.#architectureCaptures = deps.architectureCaptures;
    this.#captures = deps.captures;
    this.#attempts = deps.attempts;
    this.#syson = deps.syson;
    this.#lease = deps.lease;
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
    const { decision, proposal: rawProposal } = await requireMrtrApproval(project, run);
    const proposal = parseRequirementsProposal(rawProposal);

    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.#executeLeased(origin, command, proposal, decision),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: ModelWriteRequirementsRunExecutorCommand,
    proposal: RequirementsProposal,
    decision: EngineeringDecision,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let providerAcknowledged = false;
    let snapshotPersisted = false;
    let materializedSnapshot: ThreadSnapshot | undefined;

    try {
      // Post-lease shape re-check.
      const preClaim = await this.#requiredProject(command.projectId);
      requireShape(preClaim, requireRun(preClaim, command.runId));

      // Idempotent path: if already completed by this exact command, return.
      const alreadyCompleted = await this.#completedFor(command);
      if (alreadyCompleted) {
        await this.#reconcileLive(alreadyCompleted.project.subjectId, command.runId);
        return alreadyCompleted;
      }

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

      // Step 9: find the architecture artifact and resolve the target component.
      const architectureArtifact = findArchitectureArtifact(base);
      if (!architectureArtifact) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "No generic architecture artifact is present in the basis snapshot. " +
            "Run model.write-architecture@1 before authoring requirements.",
        );
      }
      const { archCapture, editingContextId, architecturePackageId, target } =
        await this.#resolveTargetFromArchitecture(
          architectureArtifact,
          proposal,
        );

      // Step 11a: the decision must still seal exactly what the command service
      // presented to the human. No executor-specific fingerprint is accepted.
      const signedInputFingerprint = await sha256Fingerprint({
        baseSnapshot: decision.baseSnapshot,
        inputEvidenceRefs: decision.inputEvidenceRefs,
        proposal: {
          summary: decision.proposal!.summary,
          parameters: decision.proposal!.parameters,
        },
      });
      if (!fingerprintsEqual(signedInputFingerprint, decision.inputFingerprint)) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "requirements_decision_fingerprint_mismatch: the decision fingerprint no " +
            "longer seals its exact base snapshot, evidence references, and proposal.",
        );
      }

      // Step 11b: #resolveTargetFromArchitecture has derived this envelope only
      // from the exact signed basis and proposal: the basis selects the content-
      // addressed architecture capture, the proposal selects one unique partDef,
      // and that partDef must have one unique typing usage. Keep the values
      // together here so later publication cannot substitute another derivation.
      const derivedEnvelope = {
        target,
        architectureBasis: {
          snapshotId: basis.snapshotId,
          revision: basis.revision,
          fingerprint: architectureArtifact.fingerprint.digest,
        },
        partDefName: proposal.partDefName,
        requirements: requirementEntriesToOracleRequirements(proposal.requirements),
      };

      assertNoBlockedRequirementsSibling(project, run);

      // Step 12: find the prior requirements artifact (enrichment path).
      const priorArtifact = findRequirementsArtifact(base, proposal.containerComponent);
      const priorCapture = priorArtifact
        ? await this.#readPriorRequirements(priorArtifact, proposal)
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
      //   Inserting the same partDef name twice into the same parent package
      //   produces TWO distinct elements with the same label — it is a pure
      //   insert, NOT a replace. Enrichment cannot call insert twice; D5
      //   identification would find two matches and fail with ambiguity.
      //
      // ENRICHMENT STRATEGY — delete + reinsert:
      //   Before WAL begin, we locate the prior element by label (below). In the
      //   dispatch path, we delete it with syson_element_delete, then insert a
      //   NEW element containing the full set (toInsert + adopted). After the
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
      // enrichment mode ⇒ toInsert + adopted (re-renders entire partDef).
      const renderRequirements = [
        ...insertOracleRequirements,
        ...adoptedOracleRequirements,
      ];

      // Pre-WAL enrichment lookup: find the existing partDef element to delete.
      // This must happen before WAL begin so quarantine protects delete+insert atomicity.
      let priorRequirementsElementId: string | undefined;
      if (enrichmentPlan.adopted.length > 0) {
        priorRequirementsElementId = await this.#findElementByLabelOrUndefined(
          editingContextId,
          architecturePackageId,
          proposal.partDefName,
        );
        // Identity guard (BLOQUANT — delete+reinsert makes it structurally necessary):
        // the element found by label MUST be the exact element the prior capture
        // recorded. A homonyme inserted by a foreign path would be silently deleted
        // without provenance proof. Refuse before WAL begin — no state is written.
        // Error key: "foreign_requirements_element".
        if (priorRequirementsElementId !== undefined && priorCapture !== undefined) {
          if (priorRequirementsElementId !== priorCapture.requirementsElementId) {
            throw new EngineeringProjectCommandError(
              "invalid_transition",
              `foreign_requirements_element: element found by label "${proposal.partDefName}" ` +
                `is "${priorRequirementsElementId}" but the prior capture recorded ` +
                `"${priorCapture.requirementsElementId}". A foreign element with the ` +
                "same name must not be deleted without provenance. Manual inspection required.",
            );
          }
        }
        // If already absent (e.g. manual deletion), enrichment continues with
        // pure insert of all metrics — the verification step will confirm.
      }

      // Compute planDigest for the WAL (covers the requirements to render + target).
      const planDigest = await requirementsPlanDigest(
        renderRequirements,
        proposal.partDefName,
        architecturePackageId,
      );

      // Step 16: WAL begin (quarantine check inside).
      const existingAttempt = await this.#runAttemptOrFail(
        project.project.id,
        command.runId,
      );

      let requirementsElementId: string;
      if (existingAttempt?.status === "completed") {
        // A completed WAL record means SysON already acknowledged the insertion.
        // Only readback is needed — no second insertion.
        providerAcknowledged = true;
        requirementsElementId = await this.#identifyByLabelOrFail(
          editingContextId,
          architecturePackageId,
          proposal.partDefName,
        );
      } else {
        const walResult = await this.#walBeginOrFail(
          project.project.id,
          command.runId,
          planDigest,
          capturedAt,
        );
        if (walResult.action === "completed") {
          providerAcknowledged = true;
          requirementsElementId = await this.#identifyByLabelOrFail(
            editingContextId,
            architecturePackageId,
            proposal.partDefName,
          );
        } else {
          // Step 17: (enrichment) delete prior element, then insert full set;
          //           (initial) insert directly.
          //
          // For enrichment with adopted metrics: delete the prior partDef element
          // first (irreversible via syson_element_delete) so that re-insertion of
          // the complete set (toInsert + adopted) does not create a duplicate label.
          // The WAL entry is "dispatched" until step 19 (complete); if delete
          // succeeds but insert fails, the dispatched WAL causes quarantine on
          // retry rather than a silent second deletion.
          if (priorRequirementsElementId !== undefined) {
            try {
              await this.#syson.callTool({
                name: "syson_element_delete",
                arguments: { element_id: priorRequirementsElementId },
              });
            } catch (error) {
              if (!(error instanceof EngineeringProjectCommandError)) {
                throw new RequirementsWriteOutcomeUnknownError();
              }
              throw error;
            }
          }
          const sysmlText = renderOracleRequirementsSysml(
            proposal.partDefName,
            renderRequirements,
          );
          try {
            const insertResult = await this.#syson.callTool({
              name: "syson_element_insert_sysml",
              arguments: {
                editing_context_id: editingContextId,
                parent_id: architecturePackageId,
                sysml_text: sysmlText,
              },
            });
            verifyInsertionAck(insertResult.structuredContent, architecturePackageId);
            // Step 18: from this point any error takes the post-acknowledgement path.
            providerAcknowledged = true;
          } catch (error) {
            if (!(error instanceof EngineeringProjectCommandError)) {
              throw new RequirementsWriteOutcomeUnknownError();
            }
            throw error;
          }

          // Step 19: WAL complete.
          try {
            await this.#attempts.complete({
              projectId: project.project.id,
              runId: command.runId,
              planDigest,
            });
          } catch {
            const durable = await this.#runAttemptOrFail(
              project.project.id,
              command.runId,
            );
            if (durable?.status !== "completed" || durable.planDigest !== planDigest) {
              throw new RequirementsWriteOutcomeUnknownError();
            }
          }

          // Step 20: identify element by label (D5 — never by exclusion).
          requirementsElementId = await this.#identifyByLabelOrFail(
            editingContextId,
            architecturePackageId,
            proposal.partDefName,
          );
        }
      }

      // Step 21: extractAndVerifyOracleRequirements — fail-closed fidelity check.
      let verifiedRequirements: readonly OracleRequirement[];
      try {
        verifiedRequirements = await extractAndVerifyOracleRequirements(
          this.#syson,
          editingContextId,
          requirementsElementId,
          oracleRequirements,
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
        packageId: architecturePackageId,
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
      return complete;
    } catch (error) {
      if (snapshotPersisted && materializedSnapshot) {
        const complete = await this.#completedFor(command);
        if (complete) return complete;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Requirements evidence is durable but project attachment did not finish. " +
            "Retry this exact command; it will not insert a second element.",
        );
      }
      if (error instanceof RequirementsWriteOutcomeUnknownError) {
        if (claimed) {
          await this.#recordFailure(origin, command, {
            code: "model-write-requirements-provider-outcome-unknown",
            message:
              "The provider outcome is unknown after a durable dispatch record; automatic redispatch is forbidden pending human reconciliation.",
          }, true);
        }
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The SysON requirements insertion outcome is unknown. An operator must inspect " +
            "SysON before any separately reviewed recovery path.",
        );
      }
      if (error instanceof RequirementsRunQuarantinedError) {
        if (claimed) {
          await this.#recordFailure(origin, command, {
            code: "model-write-requirements-post-acknowledgement-quarantined",
            message:
              "SysON acknowledged a requirements insertion, then structural verification failed; the run is quarantined.",
          });
        }
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          error.message,
        );
      }
      if (providerAcknowledged) {
        if (
          error instanceof EngineeringProjectCommandError ||
          error instanceof RequirementExtractionError
        ) {
          // Structural failure after acknowledgement — quarantine the run.
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
                  "SysON acknowledged a requirements insertion, but the durable quarantine could not be recorded. Automatic retry is forbidden.",
              }, true);
            }
            throw new EngineeringProjectCommandError(
              "invalid_transition",
              "The acknowledged SysON requirements insertion could not be durably quarantined. " +
                "The run was failed; an operator must inspect SysON before any new run.",
            );
          }
          if (claimed) {
            await this.#recordFailure(origin, command, {
              code: "model-write-requirements-post-acknowledgement-quarantined",
              message:
                "SysON acknowledged a requirements insertion, then structural verification failed; the run is quarantined.",
            });
          }
          throw error;
        }
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The SysON requirements insertion was acknowledged but evidence was not published. " +
            "Retry this exact command to resume read-back without another insertion.",
        );
      }
      if (claimed) await this.#recordFailure(origin, command);
      throw error;
    }
  }

  // ── Private: resolve target from architecture capture ─────────────────────

  /**
   * Parse the architecture capture for the given artifact and find the
   * containerComponent's partDef elementId and usageName.
   *
   * D5: identification is by label match, never by exclusion.
   * D3: partDefName is already computed from containerComponent.
   */
  async #resolveTargetFromArchitecture(
    architectureArtifact: ThreadArtifact,
    proposal: RequirementsProposal,
  ): Promise<{
    readonly archCapture: ParsedArchCapture;
    readonly editingContextId: string;
    readonly architecturePackageId: string;
    readonly target: { readonly usageName: string; readonly elementId: string };
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
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The generic architecture capture is not parseable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const architecturePackageId = archCapture.package.id;

    // Find the containerComponent partDef by label (D5).
    const matches = archCapture.partDefinitions.filter(
      (pd) => pd.label === proposal.containerComponent,
    );
    if (matches.length === 0) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "requirements_envelope_derivation_mismatch: " +
          `component "${proposal.containerComponent}" is not present in the generic ` +
          "architecture capture. Run model.write-architecture@1 to add it first.",
      );
    }
    if (matches.length > 1) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "requirements_envelope_derivation_mismatch: " +
          `${matches.length} partDefs have label "${proposal.containerComponent}" ` +
          "in the architecture capture. The model must have unique part-definition labels.",
      );
    }
    const componentPartDef = matches[0]!;
    const elementId = componentPartDef.id;

    // A usage "dripTray : DripTray" lives under the parent partDef's usages.
    // The signed component name must resolve to exactly one occurrence: taking
    // the first match would make the envelope depend on capture ordering.
    const typingUsages = archCapture.partDefinitions.flatMap((pd) =>
      pd.usages.filter((usage) => usage.targetLabel === proposal.containerComponent)
    );
    if (typingUsages.length !== 1) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "requirements_envelope_derivation_mismatch: " +
          `expected exactly one usage typing "${proposal.containerComponent}" in the ` +
          `architecture capture selected by the signed basis, found ${typingUsages.length}.`,
      );
    }
    const usageName = typingUsages[0]!.label;

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
    const editingContextId = seedCapture.normalizedResults.project.editingContextId;

    return {
      archCapture,
      editingContextId,
      architecturePackageId,
      target: { usageName, elementId },
    };
  }

  // ── Private: read prior requirements ─────────────────────────────────────

  async #readPriorRequirements(
    priorArtifact: ThreadArtifact,
    proposal: RequirementsProposal,
  ): Promise<{
    readonly requirements: readonly OracleRequirement[];
    readonly requirementsElementId: string;
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
    if (
      !record || typeof record !== "object" || Array.isArray(record) ||
      (record as Record<string, unknown>).schemaVersion !==
        REQUIREMENTS_CAPTURE_SCHEMA ||
      (record as Record<string, unknown>).containerComponent !==
        proposal.containerComponent ||
      !Array.isArray((record as Record<string, unknown>).requirements)
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The prior requirements capture does not match the expected schema or target component.",
      );
    }
    // BLOQUANT identity anchor: the capture records which SysON element was
    // inserted. The enrichment path uses this to verify the element found by
    // label is the same one — a homonyme must be refused, not silently deleted.
    const rawReqsElementId = (record as Record<string, unknown>).requirementsElementId;
    if (typeof rawReqsElementId !== "string" || !rawReqsElementId.trim()) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The prior requirements capture is missing a valid requirementsElementId.",
      );
    }
    // F4 — fail-closed validation of each prior requirement. An unsafe cast here
    // would allow a malformed capture to produce a silent enrichment plan error
    // (wrong metric compared, wrong unit bypassed). Every element is validated
    // against the same invariants that the proposal parser enforces on new input.
    // RÉSERVE 3: derive operator set from the domain constant so that adding an
    // operator to ORACLE_REQUIREMENT_OPERATORS automatically extends this check.
    const raw = (record as Record<string, unknown>).requirements as unknown[];
    const validated: OracleRequirement[] = [];
    const allowedOperators: ReadonlySet<string> = new Set<string>(
      ORACLE_REQUIREMENT_OPERATORS,
    );
    for (let index = 0; index < raw.length; index++) {
      const req = raw[index];
      if (!req || typeof req !== "object" || Array.isArray(req)) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          `Prior requirements capture requirements[${index}] is not an object.`,
        );
      }
      const r = req as Record<string, unknown>;
      if (
        typeof r.id !== "string" || !r.id.trim() ||
        typeof r.name !== "string" || !r.name.trim() ||
        typeof r.metric !== "string" || !r.metric.trim()
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          `Prior requirements capture requirements[${index}] missing required string fields (id, name, metric).`,
        );
      }
      if (typeof r.operator !== "string" || !allowedOperators.has(r.operator)) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          `Prior requirements capture requirements[${index}].operator "${
            String(r.operator)
          }" is not a valid comparison operator.`,
        );
      }
      const limit = r.limit;
      if (
        !limit || typeof limit !== "object" || Array.isArray(limit) ||
        typeof (limit as Record<string, unknown>).value !== "number" ||
        typeof (limit as Record<string, unknown>).unit !== "string"
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          `Prior requirements capture requirements[${index}].limit is missing or has wrong types.`,
        );
      }
      const unit = (limit as Record<string, unknown>).unit as string;
      if (!SUPPORTED_ORACLE_UNITS.includes(unit)) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          `Prior requirements capture requirements[${index}].limit.unit "${unit}" is not in the supported vocabulary.`,
        );
      }
      validated.push({
        id: r.id as string,
        name: r.name as string,
        metric: r.metric as string,
        operator: r.operator as OracleRequirement["operator"],
        limit: {
          value: (limit as Record<string, unknown>).value as number,
          unit,
        },
      });
    }
    return { requirements: validated, requirementsElementId: rawReqsElementId };
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
    packageId: string,
    partDefName: string,
  ): Promise<string | undefined> {
    let children: unknown[];
    try {
      const result = await this.#syson.callTool({
        name: "syson_element_children",
        arguments: {
          editing_context_id: editingContextId,
          element_id: packageId,
        },
      });
      const c = result.structuredContent.children;
      if (!Array.isArray(c)) {
        throw new Error(
          "syson_element_children: structuredContent.children must be an array.",
        );
      }
      children = c;
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
          `in package "${packageId}". Manual inspection required before enrichment.`,
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
    packageId: string,
    partDefName: string,
  ): Promise<string> {
    let children: unknown[];
    try {
      const result = await this.#syson.callTool({
        name: "syson_element_children",
        arguments: {
          editing_context_id: editingContextId,
          element_id: packageId,
        },
      });
      const c = result.structuredContent.children;
      if (!Array.isArray(c)) {
        throw new Error(
          "syson_element_children: structuredContent.children must be an array.",
        );
      }
      children = c;
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
          `in children of package "${packageId}" after insertion.`,
      );
    }
    if (matches.length > 1) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `D5 identification ambiguous: ${matches.length} elements with label "${partDefName}" ` +
          `in children of package "${packageId}". Manual inspection required.`,
      );
    }
    const match = matches[0] as Record<string, unknown>;
    if (typeof match.id !== "string" || !match.id.trim()) {
      throw new RequirementsWriteOutcomeUnknownError();
    }
    return match.id;
  }

  // ── Private: WAL helpers ──────────────────────────────────────────────────

  async #walBeginOrFail(
    projectId: string,
    runId: string,
    planDigest: string,
    dispatchedAt: string,
  ): Promise<{ readonly action: "dispatch" } | { readonly action: "completed" }> {
    // Check for quarantine BEFORE any new WAL entry — the enrichment preflight
    // produces a different planDigest after a partial insertion, so the original
    // entry would not be found and a second insertion would happen without this guard.
    if (await this.#attempts.isQuarantined(projectId, runId)) {
      throw new RequirementsRunQuarantinedError();
    }
    try {
      return await this.#attempts.begin({ projectId, runId, planDigest, dispatchedAt });
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
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (
      run.status !== "completed" ||
      !project.commandReceipts?.some(
        (receipt) => receipt.commandId === commandStep(command.commandId, "complete"),
      )
    ) return undefined;
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
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed requirements run has no result snapshot.",
      );
    }
    const snapshot = await this.#snapshots.get(result.snapshotId);
    if (
      !snapshot || snapshot.id !== result.snapshotId ||
      snapshot.revision !== result.revision
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed requirements result snapshot is not durably readable.",
      );
    }
    const uriPrefix = requirementsUriPrefix(proposal.containerComponent);
    const artifacts = snapshot.artifacts.filter((artifact) =>
      artifact.kind === "sysml-model" &&
      artifact.uri?.startsWith(uriPrefix) &&
      artifact.producer.runId === run.id
    );
    if (artifacts.length !== 1 || run.evidenceRefs.length !== 1) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed requirements run does not have exactly one result evidence artifact.",
      );
    }
    const artifact = artifacts[0]!;
    const evidence = run.evidenceRefs[0]!;
    if (
      evidence.kind !== "artifact" || evidence.id !== artifact.id ||
      evidence.snapshotId !== snapshot.id ||
      evidence.snapshotRevision !== snapshot.revision ||
      artifact.id !==
        `requirements-${proposal.containerComponent}-${artifact.fingerprint.digest}` ||
      artifact.mediaType !== "application/json"
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed requirements evidence reference is not exactly bound to its result snapshot.",
      );
    }
    const text = await this.#captures.read(artifact.fingerprint);
    if (!text) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed requirements capture is not durably readable.",
      );
    }
    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed requirements capture is invalid JSON.",
      );
    }
    const actual = await sha256Fingerprint(record);
    if (!fingerprintsEqual(actual, artifact.fingerprint)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Completed requirements capture fingerprint no longer matches its exact evidence bytes.",
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
        summary:
          failure.code === "model-write-requirements-post-acknowledgement-quarantined"
            ? "Generic requirements run quarantined after an acknowledged SysON insertion."
            : "Generic requirements run stopped before evidence was published.",
        code: failure.code,
        message: failure.message,
      });
    } catch {
      if (required) throw new Error("Could not record requirements run failure.");
    }
  }

  async #reconcileLive(subjectId: string, runId: string): Promise<void> {
    try {
      await this.#liveUpdates?.reconcileRunOnce(subjectId, runId, this.#now());
    } catch {
      // Optional presentation journal.
    }
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
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

// ── Private: architecture capture parser ─────────────────────────────────────

/**
 * Minimal structure of a parsed architecture capture v2.0 record.
 * We only read the fields the requirements executor needs.
 */
interface ParsedArchCapture {
  readonly schemaVersion: string;
  readonly package: { readonly id: string; readonly label: string };
  readonly partDefinitions: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly usages: ReadonlyArray<{
      readonly id?: string;
      readonly label: string;
      readonly targetLabel: string;
    }>;
  }>;
  readonly seed: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  };
}

function parseArchCapture(text: string): ParsedArchCapture {
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    throw new Error("Architecture capture is not JSON.");
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Architecture capture is not an object.");
  }
  const r = record as Record<string, unknown>;

  if (typeof r.schemaVersion !== "string") {
    throw new Error("Architecture capture missing schemaVersion.");
  }
  if (!r.package || typeof r.package !== "object" || Array.isArray(r.package)) {
    throw new Error("Architecture capture missing package.");
  }
  const pkg = r.package as Record<string, unknown>;
  if (typeof pkg.id !== "string" || typeof pkg.label !== "string") {
    throw new Error("Architecture capture package missing id or label.");
  }
  if (!Array.isArray(r.partDefinitions)) {
    throw new Error("Architecture capture missing partDefinitions.");
  }
  if (!r.seed || typeof r.seed !== "object" || Array.isArray(r.seed)) {
    throw new Error("Architecture capture missing seed.");
  }
  const seed = r.seed as Record<string, unknown>;
  if (
    typeof seed.artifactId !== "string" ||
    typeof seed.producerRunId !== "string" ||
    !seed.fingerprint || typeof seed.fingerprint !== "object" ||
    Array.isArray(seed.fingerprint) ||
    typeof (seed.fingerprint as Record<string, unknown>).algorithm !== "string" ||
    typeof (seed.fingerprint as Record<string, unknown>).digest !== "string"
  ) {
    throw new Error("Architecture capture seed is missing required fields.");
  }

  const partDefinitions = (r.partDefinitions as unknown[]).map((pd, index) => {
    if (!pd || typeof pd !== "object" || Array.isArray(pd)) {
      throw new Error(
        `Architecture capture partDefinitions[${index}] is not an object.`,
      );
    }
    const p = pd as Record<string, unknown>;
    if (typeof p.id !== "string" || typeof p.label !== "string") {
      throw new Error(
        `Architecture capture partDefinitions[${index}] missing id or label.`,
      );
    }
    const usages = Array.isArray(p.usages)
      ? (p.usages as unknown[]).map((u, ui) => {
        if (!u || typeof u !== "object" || Array.isArray(u)) {
          throw new Error(`partDefinitions[${index}].usages[${ui}] is not an object.`);
        }
        const usage = u as Record<string, unknown>;
        if (
          typeof usage.label !== "string" ||
          typeof usage.targetLabel !== "string"
        ) {
          throw new Error(
            `partDefinitions[${index}].usages[${ui}] missing label or targetLabel.`,
          );
        }
        return {
          id: typeof usage.id === "string" ? usage.id : undefined,
          label: usage.label,
          targetLabel: usage.targetLabel,
        };
      })
      : [];
    return { id: p.id, label: p.label, usages };
  });

  return {
    schemaVersion: r.schemaVersion,
    package: { id: pkg.id, label: pkg.label },
    partDefinitions,
    seed: {
      artifactId: seed.artifactId,
      fingerprint: seed.fingerprint as ContentFingerprint,
      producerRunId: seed.producerRunId,
    },
  };
}

// ── Private: capture record builder ──────────────────────────────────────────

function buildCaptureRecord(options: {
  proposal: RequirementsProposal;
  target: { usageName: string; elementId: string };
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
}) {
  return {
    schemaVersion: REQUIREMENTS_CAPTURE_SCHEMA,
    operation: MODEL_WRITE_REQUIREMENTS_OPERATION,
    trustedRunId: options.runId,
    containerComponent: options.proposal.containerComponent,
    partDefName: options.proposal.partDefName,
    target: {
      usageName: options.target.usageName,
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

function buildExtension(options: {
  base: ThreadSnapshot;
  proposal: RequirementsProposal;
  architectureArtifact: ThreadArtifact;
  priorRequirementsArtifact: ThreadArtifact | undefined;
  target: { usageName: string; elementId: string };
  runId: string;
  capturedAt: string;
  captureFp: ContentFingerprint;
  captureUri: string;
  requirements: readonly OracleRequirement[];
  requirementsElementId: string;
  packageId: string;
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

  const provenance = [
    {
      id: `derived-from-architecture-${captureFp.digest}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: artifactId },
      to: { kind: "artifact" as const, id: architectureArtifact.id },
      rationale:
        "The requirements were inserted into the SysON element identified by the " +
        "reviewed architecture capture.",
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
  ];

  return {
    id: extensionId,
    name: `Requirements: ${proposal.containerComponent}`,
    subjectId: base.subject.id,
    capturedAt,
    artifacts: [artifact],
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
    bindingProofs: [
      {
        provider: "syson",
        kind: "element",
        id: options.requirementsElementId,
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
    project.schemaVersion !== "3.0" ||
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
    if (!decision?.proposal || decision.proposal.parameters.length === 0) continue;
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
  return candidates[0]!;
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  if (!value || !("snapshotId" in value)) return false;
  return value.snapshotId === basis.snapshotId && value.revision === basis.revision &&
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
  packageId: string,
): Promise<string> {
  const fp = await sha256Fingerprint({
    partDefName,
    packageId,
    requirements,
  });
  return fp.digest;
}

// ── Private: sibling blocker check ───────────────────────────────────────────

function assertNoBlockedRequirementsSibling(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const basis = requireBasis(run);
  const blockers = project.agentRuns.filter((candidate) => {
    if (candidate.id === run.id || candidate.status !== "failed") return false;
    if (!candidate.failure || !sameSnapshotBasis(candidate.basis, basis)) return false;
    const operation = project.workItems.find((item) => item.id === candidate.workItemId)
      ?.operation;
    return operation?.id === MODEL_WRITE_REQUIREMENTS_OPERATION.id &&
      operation.version === MODEL_WRITE_REQUIREMENTS_OPERATION.version &&
      (candidate.failure.code ===
          "model-write-requirements-provider-outcome-unknown" ||
        candidate.failure.code ===
          "model-write-requirements-post-acknowledgement-quarantined" ||
        candidate.failure.code ===
          "model-write-requirements-quarantine-write-failed");
  });
  if (blockers.length > 0) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "A prior requirements run on this exact basis has an unresolved provider outcome " +
        "or post-acknowledgement quarantine. A separately reviewed recovery must advance " +
        "the basis before another requirements run can write SysON.",
    );
  }
}

// ── Private: SysON response validation ───────────────────────────────────────

function verifyInsertionAck(value: unknown, expectedParentId: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SysON requirements insert response must be a non-null object.");
  }
  const record = value as Record<string, unknown>;
  if (record.inserted !== true) {
    throw new Error(
      `SysON requirements insert did not acknowledge success (inserted: ${
        String(record.inserted)
      }). Parent: ${expectedParentId}`,
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

// ── Private: tip selector ─────────────────────────────────────────────────────

/**
 * Exported for unit-testing. Callers outside this module that need a boolean
 * should use findRequirementsArtifact / assertRequirementsArtifactNotRemoved
 * instead — those express clearer intent. This function is the testable core.
 */
export function selectRequirementsTip(
  snapshot: ThreadSnapshot,
  containerComponent: string,
):
  | { readonly kind: "absent" }
  | { readonly kind: "retired" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "one"; readonly artifact: ThreadArtifact } {
  const uriPrefix = requirementsUriPrefix(containerComponent);
  const all = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "sysml-model" && artifact.uri?.startsWith(uriPrefix)
  );
  if (all.length === 0) return { kind: "absent" };
  const consumed = new Set(all.flatMap((artifact) => artifact.inputArtifactIds));
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
    snapshot.revision !== basis.revision
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Basis thread snapshot ${basis.snapshotId} r${basis.revision} is not durably readable.`,
    );
  }
  return snapshot;
}
