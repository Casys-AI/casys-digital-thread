/**
 * Trusted executor for the generic `design.write-geometry@1` operation.
 *
 * WHY NO PROVIDER CALL — `design.write-geometry@1` does NOT re-execute
 * build123d.  It seals the exact bytes from the human-signed draft (D1
 * decision).  All effects are idempotent CAS writes to the local filesystem,
 * so no WAL is required: a crash at any point leaves no uncertain provider
 * state, and a retry picks up safely via the CAS idempotence of each store.
 *
 * Sequence:
 *  1. Agent-only origin gate.
 *  2. requireShape: operation id/version check.
 *  3. requireMrtrApproval: find approved decision with decidedByOrigin === "human".
 *  4. parseGeometryDecisionParameters from decision.proposal.parameters.
 *  5. Lease + claim.
 *  6. Load basis snapshot (ThreadSnapshot).
 *  7. D5 — architecture check: basis must carry an architecture artifact whose
 *     fingerprint matches params.manifest.architectureBasis.artifactFingerprint.
 *  8. Cliquet: assertGeometryArtifactNotRemoved.
 *  9. Reload draft JSON by draftDigest; byte-level fingerprint recomputation.
 * 10. Architecture capture load + per-component binding verification (D5 part 2).
 * 11. Verify each binary in state/local/geometry-draft-assets/{digest}.
 * 12. Build geometry capture record + save to FileCaptureStore<"geometry-capture">.
 * 13. Thread extension → applyThreadSnapshotExtensionIfNew → validateThreadSnapshot.
 * 14. Snapshot save + CAS readback.
 * 15. publishRun + completeRun + assertCompleted.
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
import {
  DESIGN_WRITE_GEOMETRY_OPERATION,
  type GeometryDecisionParameters,
  parseGeometryDecisionParameters,
} from "../../domain/platform/geometry-proposal.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadEntityKind,
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
  GEOMETRY_CAPTURE_URI_PREFIX,
} from "../captures/file-capture-store.ts";
import { GEOMETRY_DRAFT_ASSETS_DIR } from "../captures/geometry-draft-capture.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../stores/live-thread-update-store.ts";

// ── Public constants ──────────────────────────────────────────────────────────

/**
 * Re-exported from domain so callers (tests, server wiring) can import the
 * operation ref from one canonical location without depending on geometry-proposal.ts.
 */
export { DESIGN_WRITE_GEOMETRY_OPERATION };

/** Schema version written into every canonical geometry capture. */
export const GEOMETRY_CAPTURE_SCHEMA = "geometry-capture/1.0" as const;

// ── Cliquet error ─────────────────────────────────────────────────────────────

/**
 * Raised when a successor snapshot omits a geometry artifact that appeared in
 * an ancestor.
 *
 * MONOTONY RATCHET — once a subject's thread carries a geometry artifact, every
 * later revision must also carry it.  Silently dropping it would make the
 * downstream geometry viewer and the enrichment preflight unreliable.
 */
export class GeometryArtifactRemovedError extends Error {
  constructor(subjectId: string) {
    super(
      `geometry_artifact_removed: The thread for "${subjectId}" previously carried ` +
        "a geometry artifact that is absent from the current basis. This is a " +
        "monotony-ratchet violation; the artifact must not be removed once published.",
    );
    this.name = "GeometryArtifactRemovedError";
  }
}

// ── Asset verification error ──────────────────────────────────────────────────

export type GeometryAssetVerificationCode =
  | "asset_not_found"
  | "sha256_mismatch";

/**
 * Thrown when a draft binary asset cannot be verified against its signed hash.
 *
 * Callers MUST treat this as stop-for-review: the operator signed specific
 * bytes and the local draft store does not hold them.  Automatic retry is
 * NOT permitted until the operator diagnoses the cause.
 */
export class GeometryAssetVerificationError extends Error {
  constructor(
    readonly code: GeometryAssetVerificationCode,
    readonly context: Readonly<Record<string, string>>,
    message: string,
  ) {
    super(message);
    this.name = "GeometryAssetVerificationError";
  }
}

// ── I2: MRTR ↔ draft artifact hash cross-check ───────────────────────────────

/**
 * Verify that the artifact hashes the human signed in the MRTR match the
 * hashes stored in the draft record.
 *
 * WHY EXPORTED — this guard is pure (no I/O) and is called inside the execute
 * hot-path.  Exporting it lets the unit tests directly verify the D1/D2 attack
 * scenario (human signs hashes for D2 while the viewer shows D1) without
 * bootstrapping a full project fixture.
 */
export function assertMrtrArtifactHashesMatchDraft(
  mrtrAssemblyFiles: ReadonlyArray<{ fingerprint: { digest: string } }>,
  mrtrPartMeshes: ReadonlyArray<{ fingerprint: { digest: string } }>,
  draftAssemblyFiles: ReadonlyArray<{ fingerprint: { digest: string } }>,
  draftPartMeshes: ReadonlyArray<{ fingerprint: { digest: string } }>,
): void {
  if (mrtrAssemblyFiles.length !== draftAssemblyFiles.length) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `MRTR has ${mrtrAssemblyFiles.length} assembly file(s) but draft record ` +
        `has ${draftAssemblyFiles.length}. Hashes may belong to a different draft.`,
    );
  }
  for (let k = 0; k < mrtrAssemblyFiles.length; k++) {
    const mrtrDigest = mrtrAssemblyFiles[k]!.fingerprint.digest;
    const draftDigestK = draftAssemblyFiles[k]!.fingerprint.digest;
    if (mrtrDigest !== draftDigestK) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Assembly file ${k} fingerprint mismatch: MRTR carries '` +
          `${mrtrDigest.slice(0, 16)}…', draft record has '` +
          `${draftDigestK.slice(0, 16)}…'. The MRTR was signed for a ` +
          "different draft. Operator inspection required.",
      );
    }
  }
  if (mrtrPartMeshes.length !== draftPartMeshes.length) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `MRTR has ${mrtrPartMeshes.length} part mesh(es) but draft record has ` +
        `${draftPartMeshes.length}. Hashes may belong to a different draft.`,
    );
  }
  for (let k = 0; k < mrtrPartMeshes.length; k++) {
    const mrtrDigest = mrtrPartMeshes[k]!.fingerprint.digest;
    const draftDigestK = draftPartMeshes[k]!.fingerprint.digest;
    if (mrtrDigest !== draftDigestK) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Part mesh ${k} fingerprint mismatch: MRTR carries '` +
          `${mrtrDigest.slice(0, 16)}…', draft record has '` +
          `${draftDigestK.slice(0, 16)}…'. The MRTR was signed for a ` +
          "different draft. Operator inspection required.",
      );
    }
  }
}

// ── Command type ──────────────────────────────────────────────────────────────

export interface DesignWriteGeometryRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

// ── Executor ──────────────────────────────────────────────────────────────────

export interface DesignWriteGeometryRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  /** Architecture captures — used for D5 per-component binding verification. */
  readonly architectureCaptures: FileCaptureStore<"architecture-capture">;
  /** Draft geometry JSON captures produced by the preview tool. */
  readonly geometryDraftCaptures: FileCaptureStore<"geometry-draft">;
  /** Canonical geometry captures sealed by this executor. */
  readonly geometryCaptures: FileCaptureStore<"geometry-capture">;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

/**
 * Trusted generic geometry-sealing executor.
 *
 * No provider call is made.  The executor verifies the draft bytes against the
 * human-signed MRTR parameters and promotes them to the canonical thread.
 */
export class DesignWriteGeometryRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #architectureCaptures: FileCaptureStore<"architecture-capture">;
  readonly #geometryDraftCaptures: FileCaptureStore<"geometry-draft">;
  readonly #geometryCaptures: FileCaptureStore<"geometry-capture">;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(dependencies: DesignWriteGeometryRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#architectureCaptures = dependencies.architectureCaptures;
    this.#geometryDraftCaptures = dependencies.geometryDraftCaptures;
    this.#geometryCaptures = dependencies.geometryCaptures;
    this.#lease = dependencies.lease;
    this.#liveUpdates = dependencies.liveUpdates;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: DesignWriteGeometryRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute a design-write-geometry run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);

    // MRTR gate — parse proposal before leasing so invalid parameters fail fast.
    const { proposal } = await requireMrtrApproval(project, run);
    let params: GeometryDecisionParameters;
    try {
      params = parseGeometryDecisionParameters(proposalToMap(proposal));
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Geometry decision parameters are invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.#executeLeased(origin, command, params),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: DesignWriteGeometryRunExecutorCommand,
    params: GeometryDecisionParameters,
  ): Promise<EngineeringProjectSnapshot> {
    let snapshotPersisted = false;
    let materializedSnapshot: ThreadSnapshot | undefined;

    try {
      // Post-lease shape re-check.
      const preClaim = await this.#requiredProject(command.projectId);
      requireShape(preClaim, requireRun(preClaim, command.runId));

      const alreadyCompleted = await this.#completedFor(command);
      if (alreadyCompleted) {
        await this.#reconcileLive(alreadyCompleted.project.subjectId, command.runId);
        return alreadyCompleted;
      }

      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the design-write-geometry run.",
      });

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

      // Step 6: load basis snapshot.
      const base = await this.#snapshots.get(basis.snapshotId);
      if (!base || base.revision !== basis.revision) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Basis snapshot ${basis.snapshotId} revision ${basis.revision} not found.`,
        );
      }

      // Step 7 (D5 part 1): architecture artifact must exist with matching fingerprint.
      const architectureArtifact = requireArchitectureArtifact(
        base,
        params.manifest.architectureBasis.artifactFingerprint,
      );

      // Step 8: cliquet.
      await assertGeometryArtifactNotRemoved(base, this.#snapshots);

      // Step 9: reload draft JSON + byte-level fingerprint recomputation.
      const draftFp: ContentFingerprint = {
        algorithm: "sha256",
        digest: params.draftDigest,
      };
      const draftText = await this.#geometryDraftCaptures.read(draftFp);
      if (!draftText) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Geometry draft ${params.draftDigest} not found in the draft store. ` +
            "The draft may have been cleared before the human decision was executed.",
        );
      }
      const draftRecord = JSON.parse(draftText);
      const recomputedDraftFp = await sha256Fingerprint(draftRecord);
      if (!fingerprintsEqual(recomputedDraftFp, draftFp)) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Draft capture byte-level fingerprint mismatch: the bytes read from the draft " +
            "store do not hash to the signed draft digest. Operator inspection required.",
        );
      }

      // I2: cross-check MRTR artifact hashes against the draft record.
      // See assertMrtrArtifactHashesMatchDraft for the attack scenario this guards.
      assertMrtrArtifactHashesMatchDraft(
        params.manifest.artifactHashes?.assemblyFiles ?? [],
        params.manifest.artifactHashes?.partMeshes ?? [],
        draftRecord.assemblyFiles ?? [],
        draftRecord.partMeshes ?? [],
      );

      // Step 10 (D5 part 2): architecture capture load + per-component binding check.
      await assertComponentBindingsMatchArchitecture(
        params,
        architectureArtifact,
        this.#architectureCaptures,
      );

      // Step 11: binary asset verification.
      const { assemblyFiles = [], partMeshes = [] } = params.manifest.artifactHashes ??
        {};
      for (const file of assemblyFiles) {
        await verifyDraftAsset(
          file.fingerprint.digest,
          `assembly file ${file.name}`,
        );
      }
      for (const mesh of partMeshes) {
        await verifyDraftAsset(
          mesh.fingerprint.digest,
          `part mesh ${mesh.name}`,
        );
      }

      // Step 12: build canonical geometry capture.
      const captureRecord = {
        schemaVersion: GEOMETRY_CAPTURE_SCHEMA,
        operation: DESIGN_WRITE_GEOMETRY_OPERATION,
        trustedRunId: run.id,
        draftDigest: params.draftDigest,
        manifest: params.manifest,
        architectureBasis: {
          artifactId: architectureArtifact.id,
          fingerprint: architectureArtifact.fingerprint,
          producerRunId: architectureArtifact.producer.runId,
        },
        sealedAt: capturedAt,
      };
      const captureFp = await sha256Fingerprint(captureRecord);
      const captureText = deterministicJson(captureRecord);

      await this.#geometryCaptures.save(captureFp, captureText);
      const persistedCapture = await this.#geometryCaptures.read(captureFp);
      if (persistedCapture !== captureText) {
        throw new Error(
          "Geometry capture was not durably readable after save.",
        );
      }

      // Step 13: build thread extension + validate.
      const captureUri = this.#geometryCaptures.uriFor(captureFp);
      const extension = buildExtension({
        base,
        architectureArtifact,
        runId: run.id,
        capturedAt,
        captureFp,
        captureUri,
        params,
      });

      const applied = applyThreadSnapshotExtensionIfNew(base, extension, {
        appliedAt: capturedAt,
      });
      if (!applied.applied) {
        throw new Error(
          "Geometry snapshot extension was already present — " +
            "this exact evidence was published in a prior revision.",
        );
      }
      const snapshot = applied.snapshot;
      validateThreadSnapshot(snapshot);
      materializedSnapshot = snapshot;

      // Step 14: save snapshot + CAS readback.
      await this.#snapshots.save(snapshot);
      const savedSnapshot = await this.#snapshots.get(snapshot.id);
      if (
        !savedSnapshot ||
        deterministicJson(savedSnapshot) !== deterministicJson(snapshot)
      ) {
        throw new Error(
          "Geometry snapshot was not durably readable after save.",
        );
      }
      snapshotPersisted = true;

      // Step 15: publish + complete.
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the sealed geometry evidence.",
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
          summary: "Sealed geometry draft into canonical evidence thread.",
          resultSnapshot: snapshotRef(snapshot),
          evidenceRefs: [geometryArtifactEntityRef(snapshot, run.id)],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.#requiredProject(command.projectId);
      assertCompleted(complete, command);
      await this.#reconcileLive(complete.project.subjectId, command.runId);
      return complete;
    } catch (error) {
      // If the snapshot was persisted but project attachment didn't complete,
      // a retry with the same commandId will find and return the completed run
      // via #completedFor without re-promoting the draft.
      if (snapshotPersisted && materializedSnapshot) {
        const complete = await this.#completedFor(command);
        if (complete) return complete;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Geometry evidence is durable but project attachment did not finish. " +
            "Retry this exact command; it will not re-seal the draft.",
        );
      }
      throw error;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const snapshot = await this.#projects.get(projectId);
    if (!snapshot) {
      throw new EngineeringProjectCommandError(
        "entity_not_found",
        `Project ${projectId} not found.`,
      );
    }
    return snapshot;
  }

  async #completedFor(
    command: DesignWriteGeometryRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = project.agentRuns.find((r) => r.id === command.runId);
    if (run?.status === "completed") return project;
    return undefined;
  }

  async #reconcileLive(subjectId: string, runId: string): Promise<void> {
    try {
      await this.#liveUpdates?.reconcileRunOnce(subjectId, runId, this.#now());
    } catch { /* Optional presentation journal — ignore failures. */ }
  }
}

// ── Exported: cliquet check + architecture requirement (testable) ─────────────

export { assertGeometryArtifactNotRemoved, requireArchitectureArtifact };

// ── D5: architecture artifact requirement ─────────────────────────────────────

/**
 * Find the architecture artifact in the basis snapshot whose fingerprint
 * matches the architecture basis declared in the geometry manifest.
 *
 * WHY NOT JUST ANY ARCHITECTURE ARTIFACT — the geometry manifest commits to a
 * specific architecture revision (fingerprint).  A newer architecture captured
 * in the same snapshot but with different bindings must not silently satisfy
 * the check.
 */
function requireArchitectureArtifact(
  base: ThreadSnapshot,
  expectedFingerprint: ContentFingerprint,
): ThreadArtifact {
  const candidates = base.artifacts.filter(
    (a) =>
      a.kind === "sysml-model" &&
      a.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX) &&
      fingerprintsEqual(a.fingerprint, expectedFingerprint),
  );
  if (candidates.length === 0) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `D5 violation: the basis snapshot does not carry an architecture artifact with ` +
        `fingerprint ${expectedFingerprint.digest}. ` +
        "The geometry manifest must reference the current basis architecture.",
    );
  }
  if (candidates.length > 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "D5 violation: multiple architecture artifacts match the basis fingerprint.",
    );
  }
  return candidates[0]!;
}

// ── D5: per-component binding verification ────────────────────────────────────

/**
 * Load the architecture capture and verify that every component in the
 * geometry manifest maps to a real PartUsage by (id, label).
 *
 * WHY LOAD THE CAPTURE — the PartUsage element IDs and labels were extracted
 * during the architecture run and stored in the capture JSON.  Re-extracting
 * from SysON at write time would require a live provider call (violating D1's
 * server-fixed sealing principle).  The capture is the authority.
 */
async function assertComponentBindingsMatchArchitecture(
  params: GeometryDecisionParameters,
  architectureArtifact: ThreadArtifact,
  architectureCaptures: FileCaptureStore<"architecture-capture">,
): Promise<void> {
  if (params.manifest.components.length === 0) return;

  const captureText = await architectureCaptures.read(architectureArtifact.fingerprint);
  if (!captureText) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "D5 violation: architecture capture not found for fingerprint " +
        architectureArtifact.fingerprint.digest + ".",
    );
  }

  const captureRecord = JSON.parse(captureText) as {
    partDefinitions?: Array<{
      id: string;
      label: string;
      usages?: Array<{ id: string; label: string }>;
    }>;
  };

  // Build a flat index of all PartUsage entries: { id, label }
  const allUsages = new Map<string, string>(); // id → label
  for (const pd of captureRecord.partDefinitions ?? []) {
    for (const usage of pd.usages ?? []) {
      allUsages.set(usage.id, usage.label);
    }
  }

  for (const component of params.manifest.components) {
    const label = allUsages.get(component.elementId);
    if (label === undefined) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `D5 violation: geometry manifest component elementId "${component.elementId}" ` +
          "is not present in the architecture capture as a PartUsage.",
      );
    }
    if (label !== component.usageName) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `D5 violation: geometry manifest component elementId "${component.elementId}" ` +
          `has usageName "${component.usageName}" but the architecture capture labels ` +
          `it "${label}".`,
      );
    }
  }
}

// ── Cliquet (monotony ratchet) ────────────────────────────────────────────────

/**
 * Assert that the current basis has not silently removed a geometry artifact
 * that appeared in an ancestor snapshot.
 *
 * WHY WALK ANCESTORS — `assertGeometryArtifactNotRemoved` cannot rely on the
 * basis revision alone.  A geometry artifact can legitimately be absent from
 * the very first revision.  The ratchet only fires when a *prior* revision
 * carried a geometry artifact and the current basis does not.
 */
async function assertGeometryArtifactNotRemoved(
  basis: ThreadSnapshot,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  if (hasGeometryArtifact(basis)) return;

  // Walk ancestors up to a hard cap to prevent O(n) unbounded reads.
  const MAX_ANCESTORS = 50;
  let current = basis.previous;
  for (let i = 0; i < MAX_ANCESTORS; i++) {
    if (!current) return; // Reached the root without finding a geometry artifact.
    const ancestor = await snapshots.get(current.snapshotId);
    if (!ancestor) return; // Missing ancestor — cannot determine; do not block.
    if (hasGeometryArtifact(ancestor)) {
      throw new GeometryArtifactRemovedError(basis.subject.id);
    }
    current = ancestor.previous;
  }
}

function hasGeometryArtifact(snapshot: ThreadSnapshot): boolean {
  return snapshot.artifacts.some(
    (a) => a.kind === "cad-model" && a.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX),
  );
}

// ── Binary asset verification ─────────────────────────────────────────────────

/**
 * Verify that a binary asset exists in the draft-assets directory and that its
 * SHA-256 matches the expected digest.
 *
 * WHY FAIL-CLOSED — the operator signed specific bytes.  If the draft-assets
 * directory does not hold those exact bytes, we cannot seal the geometry: the
 * seal would attest bytes the operator never reviewed.
 */
async function verifyDraftAsset(expectedDigest: string, name: string): Promise<void> {
  const path = `${GEOMETRY_DRAFT_ASSETS_DIR}/${expectedDigest}`;
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new GeometryAssetVerificationError(
        "asset_not_found",
        { name, expectedDigest, path },
        `Geometry draft asset not found: ${name} (${expectedDigest.slice(0, 16)}…). ` +
          "Re-run the geometry preview before retrying the write.",
      );
    }
    throw error;
  }
  const actual = await sha256Hex(bytes);
  if (actual !== expectedDigest) {
    throw new GeometryAssetVerificationError(
      "sha256_mismatch",
      { name, expected: expectedDigest, actual },
      `SHA-256 mismatch for geometry draft asset ${name}: ` +
        `expected ${expectedDigest.slice(0, 16)}…, got ${actual.slice(0, 16)}….`,
    );
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Thread extension ──────────────────────────────────────────────────────────

function buildExtension(options: {
  base: ThreadSnapshot;
  architectureArtifact: ThreadArtifact;
  runId: string;
  capturedAt: string;
  captureFp: ContentFingerprint;
  captureUri: string;
  params: GeometryDecisionParameters;
}) {
  const {
    base,
    architectureArtifact,
    runId,
    capturedAt,
    captureFp,
    captureUri,
    params,
  } = options;

  const artifactId = `geometry-${captureFp.digest}`;
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const producer: ThreadOperationRef = {
    serverId: "build123d",
    tool: "build123d_export",
    runId,
  };

  // Primary geometry artifact: the sealed geometry capture (JSON).
  const primaryArtifact: ThreadArtifact = {
    id: artifactId,
    name: `Geometry: ${
      params.manifest.components.length === 0
        ? "assembly"
        : params.manifest.components.map((c) => c.usageName).join(", ")
    }`,
    kind: "cad-model",
    version: captureFp.digest,
    fingerprint: captureFp,
    uri: captureUri,
    mediaType: "application/json",
    producer,
    inputArtifactIds: [architectureArtifact.id],
    freshness,
  };

  // Per-part-mesh artifacts: one "mesh" artifact per sealed part mesh.
  const partMeshArtifacts: ThreadArtifact[] =
    (params.manifest.artifactHashes?.partMeshes ?? []).map((mesh) => ({
      id: `mesh-${mesh.fingerprint.digest}`,
      name: `Mesh: ${mesh.semanticKey}`,
      kind: "mesh" as const,
      version: mesh.fingerprint.digest,
      fingerprint: mesh.fingerprint,
      uri: `casys://geometry-draft-asset/sha256/${mesh.fingerprint.digest}`,
      mediaType: "model/stl",
      producer,
      inputArtifactIds: [artifactId],
      freshness,
    }));

  // Per-assembly-file artifacts: one artifact per exported format (step, gltf, stl).
  const assemblyFileArtifacts: ThreadArtifact[] =
    (params.manifest.artifactHashes?.assemblyFiles ?? []).map((file) => ({
      id: `cad-asset-${file.fingerprint.digest}`,
      name: `${file.format.toUpperCase()}: ${file.name}`,
      kind: (file.format === "step" ? "step" : "cad-model") as ThreadArtifact["kind"],
      version: file.fingerprint.digest,
      fingerprint: file.fingerprint,
      uri: `casys://geometry-draft-asset/sha256/${file.fingerprint.digest}`,
      mediaType: file.format === "step"
        ? "model/step"
        : file.format === "gltf"
        ? "model/gltf+json"
        : "model/stl",
      producer,
      inputArtifactIds: [artifactId],
      freshness,
    }));

  const consumptionId = `consume-arch-${architectureArtifact.id}-by-${artifactId}`;
  const consumption: ThreadArtifactConsumption = {
    id: consumptionId,
    artifactId: architectureArtifact.id,
    consumer: producer,
    observedFingerprint: architectureArtifact.fingerprint,
    verifiedAt: capturedAt,
    status: "verified",
  };

  const extensionId = `design-write-geometry-${captureFp.digest}`;

  return {
    id: extensionId,
    name: `Geometry seal: ${captureFp.digest.slice(0, 16)}`,
    subjectId: base.subject.id,
    capturedAt,
    artifacts: [primaryArtifact, ...assemblyFileArtifacts, ...partMeshArtifacts],
    consumptions: [consumption],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: `derived-from-architecture-${captureFp.digest}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifactId },
        to: { kind: "artifact" as const, id: architectureArtifact.id },
        rationale:
          "The geometry was produced against the exact architecture artifact that provides " +
          "the component structure and SysON element bindings (D5 verification passed).",
      },
      {
        id: `uses-${consumptionId}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: consumptionId },
        to: { kind: "artifact" as const, id: architectureArtifact.id },
        rationale:
          "The executor loaded the exact architecture capture to verify per-component bindings.",
      },
    ],
    proposedActions: [],
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function commandStep(commandId: string, step: string): string {
  return `${commandId}:design-write-geometry:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: DesignWriteGeometryRunExecutorCommand,
): void {
  const run = project.agentRuns.find((r) => r.id === command.runId);
  if (run?.status !== "completed") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Geometry run ${command.runId} is expected to be completed but has status ` +
        `"${run?.status ?? "not found"}".`,
    );
  }
}

function geometryArtifactEntityRef(
  snapshot: ThreadSnapshot,
  runId: string,
): {
  snapshotId: string;
  snapshotRevision: number;
  kind: ThreadEntityKind;
  id: string;
} {
  const artifact = snapshot.artifacts.find(
    (a) => a.kind === "cad-model" && a.producer.runId === runId,
  );
  if (!artifact) {
    throw new Error(
      `Geometry artifact for run ${runId} not found in snapshot ${snapshot.id}.`,
    );
  }
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact" as ThreadEntityKind,
    id: artifact.id,
  };
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact geometry run it claimed.",
    );
  }
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (
    workItem?.operation?.id !== DESIGN_WRITE_GEOMETRY_OPERATION.id ||
    workItem.operation.version !== DESIGN_WRITE_GEOMETRY_OPERATION.version
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${run.id} is not bound to ${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}.`,
    );
  }
}

/**
 * Require exactly one human-approved MRTR decision bound to the run's basis.
 *
 * Follows the same filter logic as requireMrtrApproval in model-write-architecture:
 * status === "approved", exactly one human approval with matching basis + fingerprints.
 * Returns the decision and its proposal.
 */
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
        ? "No exact human-approved geometry MRTR decision is bound to this run basis."
        : "Ambiguous geometry MRTR: exactly one human-approved decision must be bound to this run basis.",
    );
  }

  // Verify run input fingerprint matches queue-time seal.
  const approvedDecisions = workItem.decisionIds.map((id) => {
    const decision = project.decisions.find((candidate) => candidate.id === id);
    if (!decision?.inputFingerprint) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Geometry work-item decision ${id} is not exactly approved.`,
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
      "Geometry run input fingerprint no longer seals its exact MRTR decision and basis.",
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
  return (
    value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision &&
    value.subjectId === basis.subjectId
  );
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
    `${ref.snapshotId} ${ref.snapshotRevision} ${ref.kind} ${ref.id}`;
  return (
    left.length === right.length &&
    left.map(key).sort().every((item, index) => item === right.map(key).sort()[index])
  );
}

/**
 * Convert an `EngineeringDecisionProposal.parameters` array into a `ReadonlyMap`
 * for `parseGeometryDecisionParameters`.
 */
function proposalToMap(
  proposal: NonNullable<EngineeringDecision["proposal"]>,
): ReadonlyMap<string, string | number | boolean> {
  return new Map(proposal.parameters.map(({ key, value }) => [key, value]));
}
