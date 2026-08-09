/**
 * Trusted executor for `verify.run-fea-static-proof@1`.
 *
 * WHY GENERIC — no constant in this module may name a specific product.
 * Every project-specific value arrives from the FEA proof case capture produced
 * by `verify.seal-proof-case@1`, the basis snapshot, or the MRTR-approved
 * bindings.
 *
 * Sequence (Op 2 of the generic FEA design):
 *  1.  Agent-only origin gate.
 *  2.  requireShape: operation id/version, 2 thread-entity bindings
 *      (proofCase, geometry).
 *  3.  requireMrtrApproval: find the exact human-approved decision; assert
 *      inputEvidenceRefs match the 2 binding artifacts exactly.
 *  4.  Proof capture read: captureFp from bound proofCase artifact fingerprint →
 *      read from CAS → parse → rehash canonicalProofText == proofDigest →
 *      re-validate MechanicalProofCase.
 *  5.  Lease threadWriteBasisLeaseScope; assertThreadWriteBasisAvailable.
 *  6.  Load basis snapshot; assert lineage intact (D7).
 *  7.  Cliquet assertFeaResultArtifactNotRemoved (subjectId, proofDigest);
 *      executionBasis contains proof artifact; binding geometry == {id,fingerprint}
 *      from proof capture.
 *  8.  requireRequirementsTip re-executed on executionBasis — same normative
 *      algorithm as the seal. Drift from proof capture's requirementsArtifact
 *      means refusal.
 *  9.  STEP: active artifact verified (id/kind/fingerprint/uri);
 *      read via CanonicalAssetReader; hash and bytes confirmed.
 * 10.  Fidélité oracle: projectProofRequirementToOracle →
 *      extractAndVerifyOracleRequirements (join by featurePath).
 * 11.  Staging ContainerAssetStager → named container path.
 * 12.  Policy asserted (assertProofWithinPolicy + assertStepBytesWithinPolicy);
 *      planDigest computed; WAL begin (dispatched).
 * 13.  Dispatch calculix_solve_static from sealed proof parameters only.
 * 14.  parseFeaSolverResponse (fail-closed, all structural invariants).
 * 15.  buildFeaSolverCaptureEnvelope → WAL recordSolver (canonical text embedded)
 *      → CAS write solver → readback. Absent = rematérialise from WAL text.
 *      Divergent fingerprint = TERMINAL integrity violation.
 * 16.  Oracle: buildOracleValues + callFeaConstraintOracle.
 * 17.  Verdict capture constructed → CAS write → readback → WAL completed.
 * 18.  Extension: artifacts (solver-result, fea-verdict), 2 ThreadObservations
 *      (mm/MPa), evaluations (id = ${requirement.id}-evaluation-${verdictCaptureFp},
 *      full 64-hex digest), violations+proposedActions 1:1 on fail,
 *      consumption CalculiX→STEP with attestation return.
 * 19.  validateThreadSnapshot; persist; CAS readback; publishRun; completeRun.
 * 20.  Catch 3 windows:
 *        dispatched without transition = outcome unknown (TERMINAL);
 *        solver-recorded = resume from oracle without redispatch;
 *        snapshot durable = idempotent attach before quarantine.
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
import { validateMechanicalProofCase } from "../../domain/analysis/mechanical-proof-case.ts";
import type { MechanicalProofCase } from "../../domain/analysis/mechanical-proof-case.ts";
import {
  assertProofWithinPolicy,
  assertStepBytesWithinPolicy,
  type FeaExecutionPolicy,
} from "../../domain/analysis/fea-execution-policy.ts";
import {
  applyThreadSnapshotExtensionIfNew,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  assertThreadSnapshotLineageIntact,
  ThreadSnapshotLineageIntegrityError,
} from "../stores/thread-snapshot-lineage.ts";
import type {
  ContentFingerprint,
  ProposedThreadAction,
  RequirementEvaluation,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadObservation,
  ThreadOperationRef,
  ThreadProvenanceLink,
  ThreadSnapshot,
  ThreadViolation,
} from "../../domain/thread/thread-snapshot.ts";
import type { FileCaptureStore } from "../captures/file-capture-store.ts";
import { FEA_VERDICT_ARTIFACT_URI_ROOT } from "../captures/file-capture-store.ts";
import {
  buildFeaSolverCaptureEnvelope,
  type ParsedFeaSolverResult,
  parseFeaSolverCaptureEnvelope,
  parseFeaSolverResponse,
} from "../captures/fea-solver-capture.ts";
import {
  buildOracleValues,
  callFeaConstraintOracle,
  feaEvaluationsFromOracle,
  projectProofRequirementToOracle,
} from "../captures/fea-oracle-adapter.ts";
import type { ParsedOracleResult } from "../captures/cm01-drip-tray-mechanical-oracle.ts";
import {
  FeaStaticProofOutcomeUnknownError,
  FileFeaStaticProofAttemptStore,
} from "../wal/file-fea-static-proof-attempt-store.ts";
import type { CanonicalAssetReader } from "./canonical-asset-reader.ts";
import type { ContainerAssetStager } from "./container-asset-stager.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "./thread-write-basis-guard.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../stores/live-thread-update-store.ts";
import {
  extractAndVerifyOracleRequirements,
  RequirementExtractionError,
} from "../extractors/syson-requirements-extractor.ts";
import { requireRequirementsTip } from "./model-write-requirements-run-executor.ts";
import {
  FEA_PROOF_CASE_CAPTURE_SCHEMA,
} from "./verify-seal-proof-case-run-executor.ts";

// ── Operation identity ────────────────────────────────────────────────────────

/**
 * Trusted executor reference for `verify.run-fea-static-proof@1`.
 *
 * WHY DOMAIN LAYER — the registry and the executor both need this constant.
 * Defining it here and re-exporting from the domain would force the registry
 * to import from adapters. This constant is the cross-layer anchor; import it
 * from this module in both registry.ts and server.ts.
 */
/**
 * The operation identity lives in the domain module (fea-proof-proposal.ts) so
 * that thread-write-basis-guard can import it without an adapter-level import
 * cycle. Re-exported here so callers keep a single import site.
 */
import { VERIFY_RUN_FEA_STATIC_PROOF_OPERATION } from "../../domain/analysis/fea-proof-proposal.ts";
export { VERIFY_RUN_FEA_STATIC_PROOF_OPERATION };

// ── FEA result artifact ratchet ───────────────────────────────────────────────

/**
 * Raised when an ancestor ThreadSnapshot carried a fea-verdict artifact for
 * a specific (subjectId, proofDigest) pair but the current basis does not.
 *
 * MONOTONY RATCHET — once a subject's thread carries a fea-verdict for a proof,
 * every later revision must also carry it (or carry an explicit archive marker).
 */
export class FeaResultArtifactRemovedError extends Error {
  constructor(subjectId: string, proofDigest: string) {
    super(
      `fea_result_artifact_removed: The thread for "${subjectId}" previously carried a ` +
        `fea-verdict artifact for proof "${
          proofDigest.slice(0, 16)
        }…" that is absent ` +
        "from the current basis. This is a monotony-ratchet violation.",
    );
    this.name = "FeaResultArtifactRemovedError";
  }
}

/**
 * Assert that the fea-verdict artifact for (subjectId, proofDigest) has NOT
 * been silently removed from the ancestor lineage.
 *
 * Fail-open on snapshot-store resolution errors (same convention as
 * assertRequirementsArtifactNotRemoved). Fail-closed when a FOUND ancestor
 * artifact has a MISSING current artifact.
 */
export async function assertFeaResultArtifactNotRemoved(
  basis: ThreadSnapshot,
  proofDigest: string,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  const uriPrefix = `${FEA_VERDICT_ARTIFACT_URI_ROOT}${proofDigest}/`;
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
      throw new FeaResultArtifactRemovedError(basis.subject.id, proofDigest);
    }
    cursor = ancestor.previous;
  }
}

// ── FEA proof case capture ────────────────────────────────────────────────────

interface FeaProofCaseCapture {
  readonly schemaVersion: typeof FEA_PROOF_CASE_CAPTURE_SCHEMA;
  readonly operation: { readonly id: string; readonly version: string };
  readonly trustedRunId: string;
  readonly proofDigest: string;
  readonly canonicalProofText: string;
  readonly geometryArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  };
  readonly stepArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
    readonly bytes: number;
  };
  readonly requirementsArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly producerRunId: string;
  };
  readonly requirementsElementId: string;
  readonly seedIdentity: {
    readonly editingContextId: string;
    readonly elementId: string;
  };
  readonly sealedAt: string;
}

function parseFeaProofCaseCapture(text: string): FeaProofCaseCapture {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("FEA proof case capture is not valid JSON.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("FEA proof case capture is not an object.");
  }
  const rec = raw as Record<string, unknown>;
  if (rec.schemaVersion !== FEA_PROOF_CASE_CAPTURE_SCHEMA) {
    throw new Error(
      `FEA proof case capture has unsupported schema: ${rec.schemaVersion}.`,
    );
  }
  const requireStr = (field: string): string => {
    const v = rec[field];
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`FEA proof case capture missing or empty field: ${field}.`);
    }
    return v;
  };
  const requireFp = (field: string): ContentFingerprint => {
    const v = rec[field];
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      throw new Error(`FEA proof case capture field ${field} is not an object.`);
    }
    const fpRec = v as Record<string, unknown>;
    if (
      fpRec.algorithm !== "sha256" || typeof fpRec.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(fpRec.digest as string)
    ) {
      throw new Error(
        `FEA proof case capture field ${field} is not a sha256 fingerprint.`,
      );
    }
    return { algorithm: "sha256", digest: fpRec.digest as string };
  };
  const requireArtifactRef = (
    field: string,
  ): { id: string; fingerprint: ContentFingerprint; producerRunId: string } => {
    const v = rec[field];
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      throw new Error(`FEA proof case capture field ${field} is not an object.`);
    }
    const artRec = v as Record<string, unknown>;
    const id = artRec.id;
    const producerRunId = artRec.producerRunId;
    if (typeof id !== "string" || !id.trim()) {
      throw new Error(`FEA proof case capture ${field}.id is missing.`);
    }
    if (typeof producerRunId !== "string" || !producerRunId.trim()) {
      throw new Error(`FEA proof case capture ${field}.producerRunId is missing.`);
    }
    const fpRec = artRec.fingerprint;
    if (!fpRec || typeof fpRec !== "object" || Array.isArray(fpRec)) {
      throw new Error(`FEA proof case capture ${field}.fingerprint is not an object.`);
    }
    const fpObj = fpRec as Record<string, unknown>;
    if (
      fpObj.algorithm !== "sha256" || typeof fpObj.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(fpObj.digest as string)
    ) {
      throw new Error(
        `FEA proof case capture ${field}.fingerprint is not a sha256 fingerprint.`,
      );
    }
    return {
      id: id as string,
      fingerprint: { algorithm: "sha256", digest: fpObj.digest as string },
      producerRunId: producerRunId as string,
    };
  };

  const opRec = rec.operation;
  if (!opRec || typeof opRec !== "object" || Array.isArray(opRec)) {
    throw new Error("FEA proof case capture.operation is missing.");
  }
  const op = opRec as Record<string, unknown>;
  if (typeof op.id !== "string" || !op.id.trim()) {
    throw new Error("FEA proof case capture.operation.id is missing.");
  }
  if (typeof op.version !== "string" || !op.version.trim()) {
    throw new Error("FEA proof case capture.operation.version is missing.");
  }

  const stepArtRec = rec.stepArtifact;
  if (!stepArtRec || typeof stepArtRec !== "object" || Array.isArray(stepArtRec)) {
    throw new Error("FEA proof case capture.stepArtifact is not an object.");
  }
  const stepRec = stepArtRec as Record<string, unknown>;
  const stepId = stepRec.id;
  const stepProducer = stepRec.producerRunId;
  if (typeof stepId !== "string" || !stepId.trim()) {
    throw new Error("FEA proof case capture.stepArtifact.id is missing.");
  }
  if (typeof stepProducer !== "string" || !stepProducer.trim()) {
    throw new Error("FEA proof case capture.stepArtifact.producerRunId is missing.");
  }
  const stepFpRec = stepRec.fingerprint;
  if (!stepFpRec || typeof stepFpRec !== "object" || Array.isArray(stepFpRec)) {
    throw new Error(
      "FEA proof case capture.stepArtifact.fingerprint is not an object.",
    );
  }
  const stepFpObj = stepFpRec as Record<string, unknown>;
  if (
    stepFpObj.algorithm !== "sha256" || typeof stepFpObj.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(stepFpObj.digest as string)
  ) {
    throw new Error(
      "FEA proof case capture.stepArtifact.fingerprint is not a sha256 fingerprint.",
    );
  }
  const stepBytesVal = stepRec.bytes;
  if (!Number.isSafeInteger(stepBytesVal) || (stepBytesVal as number) < 1) {
    throw new Error(
      "FEA proof case capture.stepArtifact.bytes must be a positive integer.",
    );
  }

  const seedRec = rec.seedIdentity;
  if (!seedRec || typeof seedRec !== "object" || Array.isArray(seedRec)) {
    throw new Error("FEA proof case capture.seedIdentity is not an object.");
  }
  const seed = seedRec as Record<string, unknown>;
  if (typeof seed.editingContextId !== "string" || !seed.editingContextId.trim()) {
    throw new Error("FEA proof case capture.seedIdentity.editingContextId is missing.");
  }
  if (typeof seed.elementId !== "string" || !seed.elementId.trim()) {
    throw new Error("FEA proof case capture.seedIdentity.elementId is missing.");
  }

  void requireFp; // used below via requireArtifactRef's own check

  return {
    schemaVersion: FEA_PROOF_CASE_CAPTURE_SCHEMA,
    operation: {
      id: op.id as string,
      version: op.version as string,
    },
    trustedRunId: requireStr("trustedRunId"),
    proofDigest: requireStr("proofDigest"),
    canonicalProofText: requireStr("canonicalProofText"),
    geometryArtifact: requireArtifactRef("geometryArtifact"),
    stepArtifact: {
      id: stepId as string,
      fingerprint: { algorithm: "sha256", digest: stepFpObj.digest as string },
      producerRunId: stepProducer as string,
      bytes: stepBytesVal as number,
    },
    requirementsArtifact: requireArtifactRef("requirementsArtifact"),
    requirementsElementId: requireStr("requirementsElementId"),
    seedIdentity: {
      editingContextId: seed.editingContextId as string,
      elementId: seed.elementId as string,
    },
    sealedAt: requireStr("sealedAt"),
  };
}

// ── FEA verdict capture schema (inline) ───────────────────────────────────────

const FEA_VERDICT_CAPTURE_SCHEMA = "fea-verdict-capture/1.0" as const;

interface FeaVerdictCaptureOracleOutcome {
  readonly requirementId: string;
  readonly status: "pass" | "fail" | "error" | "unresolved";
  readonly computedValue?: number;
  readonly threshold?: number;
  readonly unit?: string;
  readonly margin?: number;
}

interface FeaVerdictCapture {
  readonly schemaVersion: typeof FEA_VERDICT_CAPTURE_SCHEMA;
  readonly operation: string;
  readonly trustedRunId: string;
  readonly capturedAt: string;
  readonly proofDigest: string;
  readonly solverCaptureFp: string;
  readonly oracleOutcomes: readonly FeaVerdictCaptureOracleOutcome[];
  readonly policyVersion: string;
  readonly exactSolverRequest: unknown;
  readonly solverImage?: {
    readonly image: string;
    readonly digest: string;
    readonly observedAt: string;
  };
}

function buildVerdictCapture(options: {
  readonly trustedRunId: string;
  readonly capturedAt: string;
  readonly proofDigest: string;
  readonly solverCaptureFp: string;
  readonly oracleResults: ReadonlyMap<string, ParsedOracleResult>;
  readonly requirements: MechanicalProofCase["requirements"];
  readonly policyVersion: string;
  readonly exactSolverRequest: unknown;
  readonly solverImage?: { image: string; digest: string; observedAt: string };
}): FeaVerdictCapture {
  const oracleOutcomes: FeaVerdictCaptureOracleOutcome[] = options.requirements.map(
    (req) => {
      const result = options.oracleResults.get(req.id);
      if (!result) {
        throw new Error(
          `Verdict capture: oracle outcome missing for requirement "${req.id}".`,
        );
      }
      const base: FeaVerdictCaptureOracleOutcome = {
        requirementId: req.id,
        status: result.status,
      };
      if (result.status === "pass" || result.status === "fail") {
        return {
          ...base,
          computedValue: result.computedValue,
          threshold: result.threshold,
          unit: result.unit,
          margin: result.margin,
        };
      }
      return base;
    },
  );
  const capture: FeaVerdictCapture = {
    schemaVersion: FEA_VERDICT_CAPTURE_SCHEMA,
    operation:
      `${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version}`,
    trustedRunId: options.trustedRunId,
    capturedAt: options.capturedAt,
    proofDigest: options.proofDigest,
    solverCaptureFp: options.solverCaptureFp,
    oracleOutcomes,
    policyVersion: options.policyVersion,
    exactSolverRequest: options.exactSolverRequest,
    ...(options.solverImage ? { solverImage: options.solverImage } : {}),
  };
  return capture;
}

// ── Command and dependency types ──────────────────────────────────────────────

export interface VerifyRunFeaStaticProofRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

/**
 * Injectable solver image observer — returns the current solver container
 * image identity as a weak observation. Not a hard invariant: an error here
 * is swallowed silently and omitted from the verdict artifact.
 */
export type SolverImageObserver = () => Promise<{
  readonly image: string;
  readonly digest: string;
  readonly observedAt: string;
}>;

export interface VerifyRunFeaStaticProofRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  /** FEA proof case captures produced by `verify.seal-proof-case@1`. */
  readonly proofCaptures: FileCaptureStore<"fea-proof-case">;
  /** Read-only: re-reads the signed requirements capture for the tip check. */
  readonly requirementsCaptures: FileCaptureStore<"requirements-capture">;
  /**
   * Host directory of canonical sealed assets (server-owned; the executor
   * never hard-codes a path). Must match the CanonicalAssetReader directory.
   */
  readonly canonicalAssetDirectory: string;
  /** FEA solver result captures — written by this executor, read for CAS readback. */
  readonly solverCaptures: FileCaptureStore<"fea-solver-result">;
  /** FEA verdict captures — written by this executor. */
  readonly verdictCaptures: FileCaptureStore<"fea-verdict">;
  readonly attempts: FileFeaStaticProofAttemptStore;
  /** ContainerAssetStager — stages the STEP inside the CalculiX container. */
  readonly stager: ContainerAssetStager;
  /** Canonical STEP asset reader — reads from state/local/thread-assets. */
  readonly assetReader: CanonicalAssetReader;
  /** SysON MCP client — used for oracle fidelity check + constraint evaluate. */
  readonly syson: McpToolClient;
  /** CalculiX MCP client — used for the static solve dispatch. */
  readonly calculix: McpToolClient;
  readonly policy: FeaExecutionPolicy;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  /** Weak solver image observer — omitted from verdict on error. */
  readonly solverImageObserver?: SolverImageObserver;
  readonly now?: () => string;
}

// ── Main executor class ───────────────────────────────────────────────────────

export class VerifyRunFeaStaticProofRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #proofCaptures: FileCaptureStore<"fea-proof-case">;
  readonly #requirementsCaptures: FileCaptureStore<"requirements-capture">;
  readonly #canonicalAssetDirectory: string;
  readonly #solverCaptures: FileCaptureStore<"fea-solver-result">;
  readonly #verdictCaptures: FileCaptureStore<"fea-verdict">;
  readonly #attempts: FileFeaStaticProofAttemptStore;
  readonly #stager: ContainerAssetStager;
  readonly #assetReader: CanonicalAssetReader;
  readonly #syson: McpToolClient;
  readonly #calculix: McpToolClient;
  readonly #policy: FeaExecutionPolicy;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly #solverImageObserver?: SolverImageObserver;
  readonly #now: () => string;

  constructor(deps: VerifyRunFeaStaticProofRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#proofCaptures = deps.proofCaptures;
    this.#requirementsCaptures = deps.requirementsCaptures;
    this.#canonicalAssetDirectory = deps.canonicalAssetDirectory;
    this.#solverCaptures = deps.solverCaptures;
    this.#verdictCaptures = deps.verdictCaptures;
    this.#attempts = deps.attempts;
    this.#stager = deps.stager;
    this.#assetReader = deps.assetReader;
    this.#syson = deps.syson;
    this.#calculix = deps.calculix;
    this.#policy = deps.policy;
    this.#lease = deps.lease;
    this.#liveUpdates = deps.liveUpdates;
    this.#solverImageObserver = deps.solverImageObserver;
    this.#now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * Execute the FEA static-proof run for the given command.
   *
   * Exactly one CalculiX dispatch is performed per run. Any error after CalculiX
   * acknowledges the dispatch triggers the quarantine path: the run is marked
   * failed and the WAL blocks any automatic redispatch.
   */
  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    // Step 1 — agent-only gate.
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "FEA static-proof run executor may only be invoked by an agent origin.",
      );
    }

    // Step 2 — shape check (operation id/version/2 bindings).
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    const workItem = requireShape(project, run);

    // Step 3 — MRTR approval gate.
    const { decision } = await requireMrtrApproval(project, run);
    void decision; // decision used for fingerprint seal; params come from bindings

    // Step 4 — read proof capture from CAS via the proofCase binding.
    const basis0 = requireBasis(run);
    const basisSnapshot0 = await this.#exactSnapshot(basis0);
    const { proofCapture, proofCase } = await this.#readProofCapture(
      basisSnapshot0,
      workItem,
    );

    // Steps 5-6 — acquire the thread-write basis lease.
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () =>
        this.#executeLeased(
          origin,
          command,
          workItem,
          proofCapture,
          proofCase,
        ),
    );
  }

  // ── Private: leased execution ───────────────────────────────────────────────

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofRunExecutorCommand,
    workItem: ReturnType<typeof requireShape>,
    proofCapture: FeaProofCaseCapture,
    proofCase: MechanicalProofCase,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let providerAcknowledged = false;
    let snapshotPersisted = false;
    let materializationSnapshot: ThreadSnapshot | undefined;

    try {
      // Post-lease re-check.
      const preClaim = await this.#requiredProject(command.projectId);
      requireShape(preClaim, requireRun(preClaim, command.runId));

      // Idempotent completed short-circuit.
      const alreadyCompleted = await this.#completedFor(command);
      if (alreadyCompleted) {
        await this.#reconcileLive(alreadyCompleted.project.subjectId, command.runId);
        return alreadyCompleted;
      }

      // Step 5 — assertThreadWriteBasisAvailable.
      assertThreadWriteBasisAvailable(
        preClaim,
        requireRun(preClaim, command.runId),
      );

      const preClaimRun = requireRun(preClaim, command.runId);
      const basis = requireBasis(preClaimRun);

      // Step 6 — load basis snapshot; assert lineage intact.
      const basisSnapshot = await this.#exactSnapshot(basis);
      try {
        await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
      } catch (error) {
        if (error instanceof ThreadSnapshotLineageIntegrityError) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `Thread snapshot lineage integrity failure: ${error.message}`,
          );
        }
        throw error;
      }

      // Step 7a — cliquet: fea-verdict artifact not removed.
      await assertFeaResultArtifactNotRemoved(
        basisSnapshot,
        proofCapture.proofDigest,
        this.#snapshots,
      );

      // Step 7b — binding geometry {id, fingerprint} must match proof capture.
      const geometryBinding = workItem.operation!.bindings.find(
        (b) => b.name === "geometry" && b.source.kind === "thread-entity",
      );
      if (!geometryBinding || geometryBinding.source.kind !== "thread-entity") {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The geometry binding is missing from the work item.",
        );
      }
      const geometryRef = geometryBinding.source.reference;
      if (
        geometryRef.id !== proofCapture.geometryArtifact.id ||
        geometryRef.kind !== "artifact"
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The geometry binding artifact id does not match the sealed proof capture.",
        );
      }
      const geometryArtifactInBasis = basisSnapshot.artifacts.find(
        (a) => a.id === proofCapture.geometryArtifact.id,
      );
      if (!geometryArtifactInBasis) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Geometry artifact "${proofCapture.geometryArtifact.id}" from the proof ` +
            "capture is absent from the basis snapshot.",
        );
      }
      if (
        !fingerprintsEqual(
          geometryArtifactInBasis.fingerprint,
          proofCapture.geometryArtifact.fingerprint,
        )
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The geometry artifact fingerprint in the basis does not match the proof capture.",
        );
      }

      // Step 7c — proof artifact must be present in basis.
      // The proof case artifact is identified by the proofCase binding reference id.
      const proofCaseBinding = workItem.operation!.bindings.find(
        (b) => b.name === "proofCase" && b.source.kind === "thread-entity",
      );
      if (!proofCaseBinding || proofCaseBinding.source.kind !== "thread-entity") {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The proofCase binding is missing from the work item.",
        );
      }
      const proofCaseRefId = proofCaseBinding.source.reference.id;
      const proofCaseArtifactInBasis = basisSnapshot.artifacts.find(
        (a) => a.id === proofCaseRefId,
      );
      if (!proofCaseArtifactInBasis) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Proof case artifact "${proofCaseRefId}" from the binding is absent from ` +
            "the basis snapshot.",
        );
      }

      // Step 8 — requireRequirementsTip re-executed on executionBasis. The
      // containerComponent comes from the signed requirements capture re-read by
      // content-address — the same normative sequence as the seal; an artifact-id
      // pattern would be an undocumented contract.
      const requirementsArtifactFromCapture = proofCapture.requirementsArtifact;
      const reqCaptureRaw = await this.#requirementsCaptures.read(
        requirementsArtifactFromCapture.fingerprint,
      );
      if (!reqCaptureRaw) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The requirements capture referenced by the sealed proof is not readable " +
            "from the content-addressed store.",
        );
      }
      let containerComponent: string;
      try {
        const reqRecord = JSON.parse(reqCaptureRaw) as Record<string, unknown>;
        if (
          typeof reqRecord.containerComponent !== "string" ||
          !reqRecord.containerComponent
        ) {
          throw new Error("requirements capture has no containerComponent");
        }
        containerComponent = reqRecord.containerComponent;
      } catch (error) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Requirements capture parse failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      const currentTip = requireRequirementsTip(basisSnapshot, containerComponent);
      if (
        !currentTip ||
        currentTip.id !== requirementsArtifactFromCapture.id ||
        !fingerprintsEqual(
          currentTip.fingerprint,
          requirementsArtifactFromCapture.fingerprint,
        )
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "requirements_tip_drift: the requirements artifact tip has changed between " +
            "the seal and this run. The sealed proof capture is no longer the authoritative " +
            "requirements tip. Re-seal the proof after the current requirements are confirmed.",
        );
      }

      // Step 9 — STEP artifact re-located and verified in the CURRENT basis
      // (the sealed capture reflects seal-time state only; an archived or
      // replaced STEP must refuse here), then read via CanonicalAssetReader.
      const stepArtifactInBasis = basisSnapshot.artifacts.find(
        (a) => a.id === proofCapture.stepArtifact.id,
      );
      if (!stepArtifactInBasis) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `STEP artifact "${proofCapture.stepArtifact.id}" from the sealed proof is ` +
            "absent from the execution basis snapshot.",
        );
      }
      if (
        stepArtifactInBasis.kind !== "step" ||
        !fingerprintsEqual(
          stepArtifactInBasis.fingerprint,
          proofCapture.stepArtifact.fingerprint,
        )
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `STEP artifact "${stepArtifactInBasis.id}" in the execution basis does not ` +
            `match the sealed identity (kind "${stepArtifactInBasis.kind}", ` +
            `fingerprint ${stepArtifactInBasis.fingerprint.digest.slice(0, 16)}…).`,
        );
      }
      const stepDigest = proofCapture.stepArtifact.fingerprint.digest;
      const stepBytes = proofCapture.stepArtifact.bytes;
      const capturedAt = requiredStart(requireRun(preClaim, command.runId));
      let stepBytesData: Uint8Array;
      try {
        stepBytesData = await this.#assetReader.read(stepDigest);
      } catch (error) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `STEP canonical asset read failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (stepBytesData.length !== stepBytes) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `STEP byte count mismatch: proof capture declares ${stepBytes} bytes, ` +
            `canonical reader returned ${stepBytesData.length}.`,
        );
      }

      // Step 10 — fidélité oracle: verify SysON still reflects the proof requirements.
      const oracleRequirements = proofCase.requirements.map(
        projectProofRequirementToOracle,
      );
      try {
        await extractAndVerifyOracleRequirements(
          this.#syson,
          proofCapture.seedIdentity.editingContextId,
          proofCapture.requirementsElementId,
          oracleRequirements,
        );
      } catch (error) {
        if (error instanceof RequirementExtractionError) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `Oracle requirements fidelity check failed (${error.code}): ` +
              `${error.message} Recovery: ${error.recovery}`,
          );
        }
        throw error;
      }

      // Step 11 — staging: copy STEP into the container. The staged name is
      // derived exclusively from the sealed authority: the full content digest
      // names the bytes and nothing else. No run- or command-derived component
      // may reach a provider argument — even hashed, it would keep an
      // agent-to-provider authority flow. Collisions are impossible by
      // construction: an identical name implies identical bytes, and the
      // stager is idempotent on a matching digest.
      const containerFileName = `fea-${stepDigest}.step`;
      const stagedPath = `/exports/${containerFileName}`;
      try {
        await this.#stager.stage({
          sourcePath: `${this.#canonicalAssetDirectory}/${stepDigest}.step`,
          expectedDigest: stepDigest,
          expectedBytes: stepBytes,
          containerFileName,
        });
      } catch (error) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `STEP staging failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      // Step 12 — policy asserted; planDigest computed; WAL begin.
      try {
        assertProofWithinPolicy(proofCase, this.#policy);
        assertStepBytesWithinPolicy(stepBytes, this.#policy);
      } catch (error) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `FEA execution policy violation: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const exactSolverRequest = buildCalculixRequest(
        proofCase,
        stagedPath,
        stepDigest,
      );
      const planDigest = (await sha256Fingerprint({
        proofDigest: proofCapture.proofDigest,
        stepDigest,
        exactSolverRequest,
        policyVersion: this.#policy.policyVersion,
      })).digest;

      // Claim the run before WAL begin.
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the generic FEA static-proof run.",
      });
      claimed = true;

      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);

      if (run.status === "completed") {
        assertCompleted(project, command);
        await this.#reconcileLive(project.project.subjectId, command.runId);
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      // WAL begin — dispatched state reserves the sole CalculiX dispatch.
      const walResult = await this.#attempts.begin({
        projectId: command.projectId,
        runId: command.runId,
        planDigest,
        dispatchedAt: capturedAt,
      });

      // From WAL begin, any error after CalculiX ACK → quarantine.
      let solverCaptureFp: string;
      let canonicalSolverCaptureText: string;

      if (walResult.action === "solver-recorded" || walResult.action === "completed") {
        // Recovery path: resume from the WAL without redispatch.
        providerAcknowledged = true;
        solverCaptureFp = walResult.solverCaptureFp;
        canonicalSolverCaptureText = walResult.canonicalSolverCaptureText;
      } else {
        // Step 13 — dispatch calculix_solve_static from sealed proof only.
        let solveResult;
        try {
          solveResult = await this.#calculix.callTool({
            name: "calculix_solve_static",
            arguments: exactSolverRequest,
          });
          providerAcknowledged = true;
        } catch (_error) {
          // CalculiX never ACKed — dispatched but unknown, abort.
          throw new FeaStaticProofOutcomeUnknownError();
        }

        // Step 14 — parseFeaSolverResponse (fail-closed).
        let parsed: ParsedFeaSolverResult;
        try {
          parsed = parseFeaSolverResponse(solveResult.structuredContent, {
            stagedPath,
            stepDigest,
            stepBytes,
            supports: proofCase.analysis.supports.map((s) => ({
              name: s.selection.name,
              box: s.selection.box,
            })),
            loads: proofCase.analysis.loads.map((l) => ({
              name: l.selection.name,
              box: l.selection.box,
              force_n: l.force.value,
            })),
          });
        } catch (error) {
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            `CalculiX response parse failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        // Step 15 — build canonical envelope → WAL recordSolver → CAS write.
        const solverEnvelope = await buildFeaSolverCaptureEnvelope(parsed, {
          trustedRunId: command.runId,
          operation:
            `${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version}`,
          upstreamIdentities: {
            proofDigest: proofCapture.proofDigest,
            stepArtifactId: proofCapture.stepArtifact.id,
            stepFingerprint: proofCapture.stepArtifact.fingerprint,
            stagedPath,
          },
          capturedAt,
        });
        canonicalSolverCaptureText = solverEnvelope.canonicalText;
        solverCaptureFp = solverEnvelope.fingerprintDigest;

        await this.#attempts.recordSolver({
          projectId: command.projectId,
          runId: command.runId,
          planDigest,
          solverCaptureFp,
          canonicalSolverCaptureText,
        });
      }

      // CAS write + readback for solver capture.
      const solverFp: ContentFingerprint = {
        algorithm: "sha256",
        digest: solverCaptureFp,
      };
      await this.#solverCaptures.save(solverFp, canonicalSolverCaptureText);
      const readBackSolver = await this.#solverCaptures.read(solverFp);
      if (readBackSolver === undefined) {
        // Absent — rematérialise from WAL text (idempotent).
        await this.#solverCaptures.save(solverFp, canonicalSolverCaptureText);
      } else if (readBackSolver !== canonicalSolverCaptureText) {
        // Divergent fingerprint — TERMINAL integrity violation.
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "fea_solver_capture_integrity_violation: The CAS solver capture text diverges " +
            "from the WAL canonical text. The capture store may be corrupt; operator " +
            "inspection is required before any retry.",
        );
      }

      // Re-parse envelope from WAL text to get typed result for oracle.
      const parsedEnvelope = parseFeaSolverCaptureEnvelope(canonicalSolverCaptureText);

      // Step 16 — oracle: buildOracleValues + callFeaConstraintOracle.
      const oracleValues = buildOracleValues(
        parsedEnvelope.metrics,
        proofCase.requirements,
      );
      const oracleResults = await callFeaConstraintOracle(
        this.#syson,
        proofCase.requirements,
        oracleValues,
      );

      // Collect weak solver image observation.
      let solverImage: FeaVerdictCapture["solverImage"];
      if (this.#solverImageObserver) {
        try {
          solverImage = await this.#solverImageObserver();
        } catch {
          // Weak observation — swallow silently.
        }
      }

      // Step 17 — verdict capture constructed → CAS write → readback → WAL completed.
      const verdictCaptureRaw = buildVerdictCapture({
        trustedRunId: command.runId,
        capturedAt,
        proofDigest: proofCapture.proofDigest,
        solverCaptureFp,
        oracleResults,
        requirements: proofCase.requirements,
        policyVersion: this.#policy.policyVersion,
        exactSolverRequest,
        solverImage,
      });
      const verdictFp = await sha256Fingerprint(verdictCaptureRaw);
      const verdictCaptureText = deterministicJson(verdictCaptureRaw);
      const verdictContentFp: ContentFingerprint = {
        algorithm: "sha256",
        digest: verdictFp.digest,
      };
      await this.#verdictCaptures.save(verdictContentFp, verdictCaptureText);
      const readBackVerdict = await this.#verdictCaptures.read(verdictContentFp);
      if (readBackVerdict !== verdictCaptureText) {
        throw new Error("FEA verdict capture was not durably readable after save.");
      }

      await this.#attempts.complete({
        projectId: command.projectId,
        runId: command.runId,
        planDigest,
        verdictCaptureFp: verdictFp.digest,
      });

      // Step 18 — extension: artifacts, observations, evaluations, violations, consumptions.
      const verdictCaptureFp = verdictFp.digest;
      const verdictArtifactUri =
        `${FEA_VERDICT_ARTIFACT_URI_ROOT}${proofCapture.proofDigest}/sha256/${verdictCaptureFp}`;
      const solverArtifactUri =
        `casys://fea-solver-result-capture/sha256/${solverCaptureFp}`;

      const freshness: ThreadFreshness = {
        status: "fresh",
        changedAt: capturedAt,
        invalidatedByChangeIds: [],
      };
      const calculixOp: ThreadOperationRef = {
        serverId: "calculix",
        tool: "calculix_solve_static",
        runId: command.runId,
      };
      const digitalThreadOp: ThreadOperationRef = {
        serverId: "digital-thread",
        tool: "verify.run-fea-static-proof",
        runId: command.runId,
      };

      const solverResultArtifactId = `fea-solver-result-${solverCaptureFp}`;
      const verdictArtifactId = `fea-verdict-${verdictCaptureFp}`;

      const solverResultArtifact: ThreadArtifact = {
        id: solverResultArtifactId,
        name: "FEA static solve result",
        kind: "solver-result",
        version: solverCaptureFp,
        fingerprint: { algorithm: "sha256", digest: solverCaptureFp },
        uri: solverArtifactUri,
        mediaType: "application/json",
        producer: calculixOp,
        inputArtifactIds: [proofCapture.stepArtifact.id],
        freshness,
      };
      const verdictArtifact: ThreadArtifact = {
        id: verdictArtifactId,
        name: "FEA oracle verdict",
        kind: "document",
        version: verdictCaptureFp,
        fingerprint: verdictContentFp,
        uri: verdictArtifactUri,
        mediaType: "application/json",
        producer: digitalThreadOp,
        inputArtifactIds: [
          solverResultArtifactId,
          proofCaseRefId,
          proofCapture.requirementsArtifact.id,
        ],
        freshness,
      };

      // 2 ThreadObservations — one per metric, raw CalculiX values.
      const observations: ThreadObservation[] = proofCase.requirements.map((req) => {
        const mapping = req.metric === "maximum-displacement"
          ? { field: "maxDisplacement" as const, unit: "mm" }
          : { field: "maxVonMises" as const, unit: "MPa" };
        const rawValue = parsedEnvelope.metrics[mapping.field].value;
        return {
          id: `fea-observation-${verdictCaptureFp}-${req.id}`,
          name: `${req.name} measured by CalculiX`,
          metric: req.feature,
          quantity: { value: rawValue, unit: mapping.unit },
          source: {
            operation: calculixOp,
            artifactIds: [solverResultArtifactId],
            capturedAt,
          },
          freshness,
        };
      });

      // Evaluations — IDs use the full 64-hex verdictCaptureFp.
      const observationIds = observations.map((o) => o.id);
      const evaluations: RequirementEvaluation[] = feaEvaluationsFromOracle(
        oracleResults,
        proofCase.requirements,
        {
          verdictCaptureFp,
          evaluatedAt: capturedAt,
          evidenceArtifactId: verdictArtifactId,
          observationIds,
        },
      );

      // Violations + proposedActions 1:1 on fail (pattern CM-01 exact).
      const violations: ThreadViolation[] = evaluations.flatMap((ev) => {
        if (ev.status !== "fail") return [];
        return [{
          id: `${ev.id}-violation`,
          name: `${ev.name} exceeds the reviewed limit`,
          requirementId: ev.requirementId,
          evaluationId: ev.id,
          severity: "error" as const,
          status: "open" as const,
          detectedAt: capturedAt,
          observationIds: ev.observationIds,
          evidenceArtifactIds: [verdictArtifactId, solverResultArtifactId],
          summary: ev.message,
          freshness,
        }];
      });
      const proposedActions: ProposedThreadAction[] = violations.map((v) => ({
        id: `${v.id}-action`,
        name: `Review the FEA limit violation: ${v.name}`,
        kind: "review" as const,
        readiness: "ready" as const,
        rationale:
          "A bounded FEA oracle verdict identified a concept limit violation; " +
          "operator review is required before any further action is taken.",
        targets: [{ kind: "artifact" as const, id: verdictArtifactId }],
        addressesViolationIds: [v.id],
        dependsOnActionIds: [],
      }));

      // Consumption CalculiX→STEP with observedFingerprint attestation return.
      const consumption: ThreadArtifactConsumption = {
        id: `fea-consumption-${verdictCaptureFp}-calculix-step`,
        artifactId: proofCapture.stepArtifact.id,
        consumer: calculixOp,
        observedFingerprint: proofCapture.stepArtifact.fingerprint,
        verifiedAt: capturedAt,
        status: "verified",
      };

      // Provenance triplets.
      const provenance: ThreadProvenanceLink[] = [
        link(
          `fea-solver-from-step-${verdictCaptureFp}`,
          solverResultArtifactId,
          proofCapture.stepArtifact.id,
          "derived_from",
          "CalculiX solved the STEP after independently attesting its content hash.",
        ),
        link(
          `fea-consumption-uses-step-${verdictCaptureFp}`,
          consumption.id,
          proofCapture.stepArtifact.id,
          "uses",
          "CalculiX reported the SHA-256 of the STEP it consumed.",
          "consumption",
        ),
        link(
          `fea-verdict-from-solver-${verdictCaptureFp}`,
          verdictArtifactId,
          solverResultArtifactId,
          "derived_from",
          "The oracle verdict was produced from the CalculiX static solve result.",
        ),
        link(
          `fea-verdict-from-proof-${verdictCaptureFp}`,
          verdictArtifactId,
          proofCaseRefId,
          "derived_from",
          "The oracle verdict is anchored to the sealed proof case.",
        ),
        link(
          `fea-verdict-from-requirements-${verdictCaptureFp}`,
          verdictArtifactId,
          proofCapture.requirementsArtifact.id,
          "derived_from",
          "The oracle verdict uses the sealed requirements as the limit authority.",
        ),
        ...observations.map((obs) =>
          link(
            `${obs.id}-from-solver`,
            obs.id,
            solverResultArtifactId,
            "derived_from",
            "The mechanical observation came from the CalculiX static solve.",
            "observation",
          )
        ),
        ...evaluations.flatMap((ev) => [
          link(
            `${ev.id}-evaluates-req`,
            ev.id,
            ev.requirementId,
            "evaluates",
            "The SysON oracle classified the observed value against the proof limit.",
            "evaluation",
            "requirement",
          ),
          ...ev.observationIds.map((obsId) =>
            link(
              `${ev.id}-uses-${obsId}`,
              ev.id,
              obsId,
              "uses",
              "The oracle used this CalculiX observation to evaluate the limit.",
              "evaluation",
              "observation",
            )
          ),
          link(
            `${ev.id}-evidences-verdict`,
            ev.id,
            verdictArtifactId,
            "evidences",
            "The FEA verdict artifact is the evidence for this evaluation.",
            "evaluation",
          ),
        ]),
        ...violations.flatMap((v) => [
          {
            id: `${v.id}-caused-by`,
            relation: "caused_by" as const,
            from: { kind: "violation" as const, id: v.id },
            to: { kind: "evaluation" as const, id: v.evaluationId },
            rationale:
              "The bounded oracle verdict on the concept limit caused this violation.",
          },
          ...v.evidenceArtifactIds.map((artId) => ({
            id: `${v.id}-evidences-${artId}`,
            relation: "evidences" as const,
            from: { kind: "violation" as const, id: v.id },
            to: { kind: "artifact" as const, id: artId },
            rationale: "The FEA evidence supports this limit violation.",
          })),
        ]),
        ...proposedActions.map((a) => ({
          id: `${a.id}-addresses`,
          relation: "addresses" as const,
          from: { kind: "action" as const, id: a.id },
          to: { kind: "violation" as const, id: a.addressesViolationIds[0]! },
          rationale:
            "This review action is proposed to address the FEA limit violation.",
        })),
      ];

      const extension = {
        id: `fea-run-extension-${verdictCaptureFp}`,
        name: "FEA static-proof run evidence",
        subjectId: basisSnapshot.subject.id,
        capturedAt,
        artifacts: [solverResultArtifact, verdictArtifact],
        consumptions: [consumption],
        observations,
        requirements: [], // requirements already exist; do NOT recreate TracedRequirements
        evaluations,
        violations,
        proposedActions,
        provenance,
      };

      // Step 19 — validateThreadSnapshot; persist; CAS readback; publishRun; completeRun.
      const { snapshot: materialized } = applyThreadSnapshotExtensionIfNew(
        basisSnapshot,
        extension,
      );
      materializationSnapshot = materialized;

      try {
        validateThreadSnapshot(materialized);
      } catch (error) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `FEA snapshot failed validation: ${
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
        throw new Error("FEA snapshot was not durably readable after save.");
      }
      snapshotPersisted = true;

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the FEA static-proof oracle verdict.",
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
            "Recorded the FEA static-proof verdict with CalculiX attestation and oracle evaluation.",
          resultSnapshot: snapshotRef(materialized),
          evidenceRefs: [
            {
              snapshotId: materialized.id,
              snapshotRevision: materialized.revision,
              kind: "artifact" as const,
              id: verdictArtifactId,
            },
          ],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.#requiredProject(command.projectId);
      assertCompleted(complete, command);
      await this.#reconcileLive(complete.project.subjectId, command.runId);
      return complete;
    } catch (error) {
      // Step 20 — catch 3 windows.

      // Window: snapshot durable without publish → idempotent attach before quarantine.
      if (snapshotPersisted && materializationSnapshot) {
        const complete = await this.#completedFor(command);
        if (complete) return complete;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "FEA evidence is durable but project attachment did not finish. " +
            "Retry this exact command; providers will not run again.",
        );
      }

      // Window: dispatched but outcome unknown → TERMINAL.
      if (error instanceof FeaStaticProofOutcomeUnknownError) {
        if (claimed) {
          await this.#recordFailure(origin, command, {
            code: "verify-run-fea-static-proof-provider-outcome-unknown",
            message: "CalculiX was dispatched but the outcome is unknown; " +
              "automatic redispatch is forbidden pending human reconciliation.",
          }, true);
        }
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CalculiX dispatch outcome is unknown. An operator must inspect " +
            "the provider before any separately reviewed recovery path.",
        );
      }

      // Window: post-acknowledgement error → quarantine.
      if (providerAcknowledged) {
        try {
          await this.#attempts.quarantine({
            projectId: command.projectId,
            runId: command.runId,
            quarantinedAt: this.#now(),
          });
        } catch {
          if (claimed) {
            await this.#recordFailure(origin, command, {
              code: "verify-run-fea-static-proof-quarantine-write-failed",
              message:
                "CalculiX acknowledged the dispatch, but the quarantine could not be " +
                "recorded. Automatic retry is forbidden.",
            }, true);
          }
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            "The acknowledged CalculiX dispatch could not be durably quarantined. " +
              "The run was failed; operator inspection is required.",
          );
        }
        if (claimed) {
          await this.#recordFailure(origin, command, {
            code: "verify-run-fea-static-proof-post-acknowledgement-quarantined",
            message:
              "CalculiX acknowledged the dispatch, then structural verification failed; " +
              "the run is quarantined.",
          });
        }
        if (error instanceof EngineeringProjectCommandError) throw error;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CalculiX dispatch was acknowledged but evidence was not published; " +
            "the run is quarantined and may not be retried automatically.",
        );
      }

      if (claimed) await this.#recordFailure(origin, command);
      throw error;
    }
  }

  // ── Private: read proof capture ─────────────────────────────────────────────

  async #readProofCapture(
    basisSnapshot: ThreadSnapshot,
    workItem: ReturnType<typeof requireShape>,
  ): Promise<{ proofCapture: FeaProofCaseCapture; proofCase: MechanicalProofCase }> {
    const proofCaseBinding = workItem.operation!.bindings.find(
      (b) => b.name === "proofCase" && b.source.kind === "thread-entity",
    );
    if (!proofCaseBinding || proofCaseBinding.source.kind !== "thread-entity") {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The proofCase binding is missing from the work item operation.",
      );
    }
    const proofCaseRef = proofCaseBinding.source.reference;
    const proofCaseArtifact = basisSnapshot.artifacts.find(
      (a) => a.id === proofCaseRef.id,
    );
    if (!proofCaseArtifact) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Proof case artifact "${proofCaseRef.id}" from the binding is absent from ` +
          "the basis snapshot.",
      );
    }
    const captureText = await this.#proofCaptures.read(proofCaseArtifact.fingerprint);
    if (!captureText) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `FEA proof case capture ${
          proofCaseArtifact.fingerprint.digest.slice(0, 16)
        }… is absent from the CAS store; the seal must be re-run.`,
      );
    }
    let proofCapture: FeaProofCaseCapture;
    try {
      proofCapture = parseFeaProofCaseCapture(captureText);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `FEA proof case capture is not parseable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    // Rehash canonicalProofText → must equal proofDigest.
    const sha256 = await sha256OfText(proofCapture.canonicalProofText);
    if (sha256 !== proofCapture.proofDigest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "FEA proof case canonicalProofText SHA-256 diverges from the stored proofDigest. " +
          "The capture may be corrupt.",
      );
    }
    // Re-validate the proof case from the canonical text.
    let proofCase: MechanicalProofCase;
    try {
      proofCase = validateMechanicalProofCase(
        JSON.parse(proofCapture.canonicalProofText),
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Sealed proof case failed re-validation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return { proofCapture, proofCase };
  }

  // ── Private: project and snapshot helpers ───────────────────────────────────

  async #requiredProject(id: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(id);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${id} does not exist.`,
      );
    }
    return project;
  }

  async #exactSnapshot(
    basis: EngineeringThreadSnapshotBasis,
  ): Promise<ThreadSnapshot> {
    const snapshot = await this.#snapshots.get(basis.snapshotId);
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision ||
      snapshot.subject.id !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Basis snapshot ${basis.snapshotId} r${basis.revision} for ` +
          `subject ${basis.subjectId} is not exactly available.`,
      );
    }
    return snapshot;
  }

  async #completedFor(
    command: VerifyRunFeaStaticProofRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.#requiredProject(command.projectId);
      assertCompleted(project, command);
      return project;
    } catch {
      return undefined;
    }
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyRunFeaStaticProofRunExecutorCommand,
    failure?: { code: string; message: string },
    terminal?: boolean,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = project.agentRuns.find((item) => item.id === command.runId);
      if (
        !run || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId ||
        !["running", "publishing"].includes(run.status)
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary: failure
          ? failure.message
          : "FEA static-proof run stopped before durable evidence was published.",
        code: failure?.code ?? "verify-run-fea-static-proof-not-published",
        message: failure?.message ?? terminal
          ? "The FEA dispatch outcome is unknown; the run cannot be retried automatically."
          : "The FEA run stopped before durable evidence was published.",
      });
    } catch { /* preserve original failure */ }
  }

  async #reconcileLive(subjectId: string, runId: string): Promise<void> {
    try {
      await this.#liveUpdates?.reconcileRunOnce(subjectId, runId, this.#now());
    } catch { /* durable result wins */ }
  }
}

// ── Private: module-level helpers ─────────────────────────────────────────────

/**
 * requireShape — verify the work item matches verify.run-fea-static-proof@1
 * with 2 thread-entity bindings (proofCase, geometry).
 */
function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): ReturnType<typeof project.workItems.find> & NonNullable<unknown> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const proofCaseBinding = operation?.bindings.find(
    (b) => b.name === "proofCase" && b.source.kind === "thread-entity",
  );
  const geometryBinding = operation?.bindings.find(
    (b) => b.name === "geometry" && b.source.kind === "thread-entity",
  );
  if (
    project.schemaVersion !== "3.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id ||
    operation.version !== VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version ||
    !proofCaseBinding ||
    !geometryBinding ||
    operation.bindings.length !== 2
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${run.id} is not bound to ` +
        `${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version} ` +
        "with a thread-snapshot basis, schema-3.0 project, proofCase binding, and " +
        "geometry binding.",
    );
  }
  return workItem;
}

/**
 * requireMrtrApproval — find the sole human-approved MRTR decision bound to
 * this run's basis.
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
        ? "No exact human-approved FEA run MRTR decision is bound to this run basis."
        : "Ambiguous FEA run MRTR: exactly one human-approved decision must be bound.",
    );
  }
  const selected = candidates[0]!;
  const expectedDecisionFp = await sha256Fingerprint({
    baseSnapshot: selected.decision.baseSnapshot,
    inputEvidenceRefs: selected.decision.inputEvidenceRefs,
    proposal: {
      summary: selected.proposal.summary,
      parameters: selected.proposal.parameters,
    },
  });
  if (!fingerprintsEqual(expectedDecisionFp, selected.decision.inputFingerprint!)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "FEA run decision fingerprint no longer seals its exact base snapshot, " +
        "evidence references, and proposal.",
    );
  }
  const approvedDecisions = workItem.decisionIds.map((id) => {
    const d = project.decisions.find((c) => c.id === id);
    if (!d?.inputFingerprint) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `FEA run work-item decision ${id} is not exactly approved.`,
      );
    }
    return { id, inputFingerprint: d.inputFingerprint };
  });
  const expectedRunFp = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: workItem.operation!.id,
      version: workItem.operation!.version,
      bindings: workItem.operation!.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFp)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "FEA run input fingerprint no longer seals its exact MRTR decision and basis.",
    );
  }
  return selected;
}

/**
 * Assert that the run has reached the completed status for this exact command.
 */
function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: VerifyRunFeaStaticProofRunExecutorCommand,
): void {
  const run = project.agentRuns.find((item) => item.id === command.runId);
  if (!run || run.status !== "completed") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `FEA run ${command.runId} did not reach completed status.`,
    );
  }
}

/**
 * Build the calculix_solve_static arguments from the sealed proof case.
 * Arguments are constructed from the proof case only — never from agent input.
 */
function buildCalculixRequest(
  proof: MechanicalProofCase,
  stepPath: string,
  expectedSha256: string,
): Record<string, unknown> {
  return {
    step_path: stepPath,
    expected_step_sha256: expectedSha256,
    mesh_size_mm: proof.analysis.mesh.targetSize.value,
    material: {
      e_mpa: proof.analysis.material.youngModulus.value,
      nu: proof.analysis.material.poissonRatio.value,
    },
    selections: [
      ...proof.analysis.supports.map((s) => ({
        name: s.selection.name,
        box: { min: s.selection.box.min, max: s.selection.box.max },
      })),
      ...proof.analysis.loads.map((l) => ({
        name: l.selection.name,
        box: { min: l.selection.box.min, max: l.selection.box.max },
      })),
    ],
    fixed: proof.analysis.supports.map((s) => s.selection.name),
    loads: proof.analysis.loads.map((l) => ({
      selection: l.selection.name,
      force_n: l.force.value,
    })),
  };
}

async function sha256OfText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:${step}`;
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
  const key = (
    ref: { snapshotId: string; snapshotRevision: number; kind: string; id: string },
  ) => `${ref.snapshotId}\u0000${ref.snapshotRevision}\u0000${ref.kind}\u0000${ref.id}`;
  return left.length === right.length &&
    left.map(key).sort().every((item, index) => item === right.map(key).sort()[index]);
}

function link(
  id: string,
  fromId: string,
  toId: string,
  relation: ThreadProvenanceLink["relation"],
  rationale: string,
  fromKind: ThreadProvenanceLink["from"]["kind"] = "artifact",
  toKind: ThreadProvenanceLink["to"]["kind"] = "artifact",
): ThreadProvenanceLink {
  return {
    id,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    rationale,
  };
}
