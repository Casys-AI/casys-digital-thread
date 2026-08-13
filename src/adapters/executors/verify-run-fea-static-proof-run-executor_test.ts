/**
 * Tests for `verify.run-fea-static-proof@1` executor.
 *
 * Test strategy:
 *   - Early guards (non-agent origin, shape, proof capture parse) use pure stubs
 *     that stop before any WAL or provider dispatch.
 *   - `assertFeaResultArtifactNotRemoved` is tested as a pure exported function.
 *   - Policy violation and requirements tip drift tests verify the rejection
 *     without requiring a live provider.
 *   - WAL state machine and CAS coherence tests use in-memory stub implementations
 *     for all stores, with fingerprints computed via sha256Fingerprint.
 *     CalculiX dispatch absence is verified by checking the call count stub.
 *   - The "fail verdict publishable" invariant is tested on the snapshot directly
 *     via validateThreadSnapshot — the only gate that distinguishes
 *     "snapshot builds" from "snapshot is publishable".
 *
 * Tests requiring a live ContainerAssetStager, file WAL, or real SysON calls
 * are deferred to the integration gate (following the modelica executor pattern).
 */

import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import {
  EngineeringProjectCommandError,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  MECHANICAL_PROOF_CASE_SCHEMA,
  validateMechanicalProofCase,
} from "../../domain/analysis/mechanical-proof-case.ts";
import { FEA_EXECUTION_POLICY_VERSION } from "../../domain/analysis/fea-execution-policy.ts";
import type { StaticStructuralSolveInput } from "../../domain/analysis/static-structural-solver.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  assertFeaResultArtifactNotRemoved,
  FeaResultArtifactRemovedError,
  readCompletedVerdictCapture,
  VERIFY_RUN_FEA_STATIC_PROOF_OPERATION,
  VerifyRunFeaStaticProofRunExecutor,
} from "./verify-run-fea-static-proof-run-executor.ts";
import { lowerCalculixStaticStructuralSolve } from "../providers/calculix/mcp-calculix-static-structural-solver.ts";

// ── Shared constants ──────────────────────────────────────────────────────────

const AGENT = { kind: "agent" as const, actorId: "agent:fea-test" };
const PROJECT_ID = "project:fea-static-proof-test";
const SUBJECT_ID = "subject:drip-tray-test";
const RUN_ID = "run:fea-run-001";
const SNAP_ID = "snap:basis-001";
const WORK_ITEM_ID = "wi:fea-run-001";
const DECISION_ID = "dec:fea-run-001";
const APPROVAL_ID = "app:fea-run-001";
const STEP_SHA256 = "b".repeat(64);
const STEP_BYTES = 50000;
const CONTAINER_COMPONENT = "drip-tray-concept";
const REQS_FP = "d".repeat(64);
const REQS_ARTIFACT_ID = `requirements-${CONTAINER_COMPONENT}-${REQS_FP}`;
const REQS_URI =
  `casys://requirements-capture/${CONTAINER_COMPONENT}/sha256/${REQS_FP}`;
const GEOM_FP = "e".repeat(64);
const GEOM_ARTIFACT_ID = `geometry-step-${GEOM_FP}`;
const EDITING_CTX_ID = "ectx-test-001";
const REQS_ELEMENT_ID = "elem-reqs-test-001";

const AT = "2026-08-09T12:00:00.000Z";
const COMMAND_BASE = {
  commandId: "cmd:fea-001",
  projectId: PROJECT_ID,
  expectedRevision: 1,
  issuedAt: AT,
  runId: RUN_ID,
};

function stagedTarget(containerFileName: string) {
  return Object.freeze({ containerPath: `/inputs/${containerFileName}` });
}

// ── Minimal ThreadSnapshot helper ─────────────────────────────────────────────

/**
 * Build a valid ThreadSnapshot with all required fields.
 * Passing artifacts overrides the default empty list.
 * Subject kind is "part" — valid for concept-phase mechanical targets.
 *
 * WHY conditional spread on previous: the JSON validator rejects object keys
 * whose value is undefined; spreading `undefined` omits the key cleanly.
 */
function makeSnap(
  options: {
    readonly id: string;
    readonly revision: number;
    readonly previous?: { snapshotId: string; revision: number };
    readonly artifacts?: ThreadArtifact[];
    readonly proofArtifactId?: string;
  } = { id: SNAP_ID, revision: 1 },
): ThreadSnapshot {
  const frs = { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
  const modelArtId = options.proofArtifactId ??
    options.artifacts?.[0]?.id ??
    "model-art-id";
  return {
    schemaVersion: "1.0",
    id: options.id,
    revision: options.revision,
    // Conditional spread: omit key entirely when undefined so the JSON
    // validator does not reject `"$.previous: contains unsupported undefined"`.
    ...(options.previous !== undefined ? { previous: options.previous } : {}),
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "DripTray concept",
      kind: "part",
      version: String(options.revision),
      modelArtifactId: modelArtId,
    },
    freshness: frs,
    changeSet: {
      id: `cs-${options.id}-r${options.revision}`,
      name: "Snapshot for test",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [],
    },
    artifacts: options.artifacts ?? [],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}

/** Reusable freshness object for test artifacts. */
function frs() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

// ── Oracle constraint row builder ─────────────────────────────────────────────

/**
 * Build a single syson_constraint_extract row matching a proof-case requirement.
 *
 * WHY here: multiple tests need a valid oracle response; centralising avoids
 * copy-pasting the exact SysON expression AST shape.  extractAndVerifyOracleRequirements
 * expects structuredContent.constraints[], not .requirements[].
 */
function buildConstraintRow(
  req: { operator: string; feature: string; limit: { value: number; unit: string } },
): unknown {
  return {
    expression: {
      kind: "binary",
      op: req.operator,
      left: { kind: "ref", featurePath: [req.feature] },
      right: { kind: "literal", value: req.limit.value, unit: req.limit.unit },
    },
  };
}

// ── Shared proof case fixture ─────────────────────────────────────────────────

function buildRawProofCase(): Record<string, unknown> {
  return {
    schemaVersion: MECHANICAL_PROOF_CASE_SCHEMA,
    id: "proof-drip-tray-concept-01",
    revision: 1,
    scope: "DripTray concept-phase structural check.",
    evidenceBoundary: "Concept prototype only, not production-certified.",
    project: {
      id: PROJECT_ID,
      subjectId: SUBJECT_ID,
      baseThreadSnapshot: { id: SNAP_ID, revision: 1, subjectId: SUBJECT_ID },
    },
    target: { id: "target-drip-tray", modelElementId: "elem-drip-tray-001" },
    authorization: { workItemId: WORK_ITEM_ID, decisionId: DECISION_ID },
    requirementsSource: {
      provider: "syson",
      editingContextId: EDITING_CTX_ID,
      elementId: REQS_ELEMENT_ID,
    },
    solver: {
      provider: "calculix",
      tool: "calculix_solve_static",
      resultSchemaVersion: "2.0",
    },
    cadSource: {
      kind: "parametric",
      generator: {
        provider: "build123d",
        tool: "build123d-export",
        definition: {
          mediaType: "text/x-python",
          sha256: "a".repeat(64),
          bytes: 1024,
        },
      },
      engineeringBoundary: {
        designIntent: "preserved",
        editableCad: "native",
        manufacturability: "not-established",
        limitations: ["Test-fixture only — not manufacturing-ready."],
      },
    },
    expectedCadArtifact: { format: "step", sha256: STEP_SHA256, bytes: STEP_BYTES },
    analysis: {
      kind: "linear-static",
      material: {
        model: "isotropic-linear-elastic",
        basis: "ABS plastic assumed for concept.",
        youngModulus: { value: 2000, unit: "MPa" },
        poissonRatio: { value: 0.4, unit: "1" },
      },
      mesh: { kind: "tetrahedral-volume", targetSize: { value: 2.0, unit: "mm" } },
      supports: [
        {
          id: "support-base",
          kind: "fixed",
          selection: {
            name: "SupportBase",
            box: { min: [0, 0, 0], max: [50, 50, 2], unit: "mm" },
          },
        },
      ],
      loads: [
        {
          id: "load-top",
          kind: "force",
          selection: {
            name: "LoadTop",
            box: { min: [0, 0, 28], max: [50, 50, 30], unit: "mm" },
          },
          force: { value: [0, 0, -5], unit: "N" },
        },
      ],
    },
    requirements: [
      {
        id: "req-disp",
        name: "max_displacement_limit",
        metric: "maximum-displacement",
        feature: "drip_tray_max_displacement",
        operator: "<=",
        limit: { value: 1.0, unit: "mm" },
      },
      {
        id: "req-stress",
        name: "max_stress_limit",
        metric: "maximum-von-mises-stress",
        feature: "drip_tray_max_von_mises",
        operator: "<=",
        limit: { value: 20000000, unit: "Pa" },
      },
    ],
  };
}

// ── Fixture builder ───────────────────────────────────────────────────────────

/**
 * Builds a complete, fingerprint-consistent project snapshot and shared fixtures.
 * All fingerprints are computed via sha256Fingerprint — no hardcoded digests.
 *
 * WHY run.status = "running" and run.startedAt set:
 *   After claimRun, the executor re-loads the project inside #executeLeased and
 *   asserts run.status === "running".  The test stub always returns the same project,
 *   so the run must already be "running" to pass that post-claim status check.
 *   requiredStart() at step 9 requires run.startedAt to be set.
 *
 * WHY decisionProposal.parameters is non-empty:
 *   requireMrtrApproval skips decisions whose proposal.parameters is empty —
 *   a guard preventing approval of an un-parameterised proposal.  At least one
 *   parameter must be present for the decision to be eligible as an MRTR candidate.
 */
async function buildFixtures() {
  const rawProofCase = buildRawProofCase();
  const proofCase = validateMechanicalProofCase(rawProofCase);
  const canonicalProofText = deterministicJson(proofCase);
  const proofDigestFp = await sha256Fingerprint(proofCase);
  const proofDigest = proofDigestFp.digest;

  const proofCaptureFp = "f".repeat(64);
  const proofCaptureFingerprint = {
    algorithm: "sha256" as const,
    digest: proofCaptureFp,
  };

  const basisRef = { snapshotId: SNAP_ID, revision: 1, subjectId: SUBJECT_ID };
  const basis = { kind: "thread-snapshot" as const, ...basisRef };

  const geometryArtifact = {
    id: GEOM_ARTIFACT_ID,
    fingerprint: { algorithm: "sha256" as const, digest: GEOM_FP },
    producerRunId: "run:geom-producer",
  };
  const stepArtifact = {
    id: `step-${STEP_SHA256}`,
    fingerprint: { algorithm: "sha256" as const, digest: STEP_SHA256 },
    producerRunId: "run:geom-producer",
    bytes: STEP_BYTES,
  };
  const requirementsArtifact = {
    id: REQS_ARTIFACT_ID,
    fingerprint: { algorithm: "sha256" as const, digest: REQS_FP },
    producerRunId: "run:reqs-producer",
  };

  // Build the proof case capture (matches the seal executor output format).
  const proofCaptureRaw = {
    schemaVersion: "fea-proof-case-capture/1.0",
    operation: {
      id: VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id,
      version: VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version,
    },
    trustedRunId: "run:seal-001",
    proofDigest,
    canonicalProofText,
    geometryArtifact,
    stepArtifact,
    requirementsArtifact,
    requirementsElementId: REQS_ELEMENT_ID,
    seedIdentity: {
      editingContextId: EDITING_CTX_ID,
      elementId: REQS_ELEMENT_ID,
    },
    sealedAt: "2026-08-09T11:00:00.000Z",
  };
  const proofCaptureText = JSON.stringify(proofCaptureRaw);

  // Build basis snapshot with all required artifacts.
  const basisArtifacts: ThreadArtifact[] = [
    {
      id: GEOM_ARTIFACT_ID,
      name: "DripTray STEP geometry",
      kind: "step",
      version: GEOM_FP,
      fingerprint: { algorithm: "sha256", digest: GEOM_FP },
      uri: `casys://geometry-step-capture/sha256/${GEOM_FP}`,
      mediaType: "model/step",
      producer: {
        serverId: "build123d",
        tool: "build123d_export",
        runId: "run:geom-producer",
      },
      inputArtifactIds: [],
      freshness: frs(),
    },
    {
      id: `step-${STEP_SHA256}`,
      name: "DripTray STEP export",
      kind: "step",
      version: STEP_SHA256,
      fingerprint: { algorithm: "sha256", digest: STEP_SHA256 },
      uri: `casys://geometry-step-capture/sha256/${STEP_SHA256}`,
      mediaType: "model/step",
      producer: {
        serverId: "build123d",
        tool: "build123d_export",
        runId: "run:geom-producer",
      },
      inputArtifactIds: [],
      freshness: frs(),
    },
    {
      id: REQS_ARTIFACT_ID,
      name: "DripTray requirements capture",
      kind: "sysml-model",
      version: REQS_FP,
      fingerprint: { algorithm: "sha256", digest: REQS_FP },
      uri: REQS_URI,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "verify.seal-proof-case",
        runId: "run:reqs-producer",
      },
      inputArtifactIds: [],
      freshness: frs(),
    },
    {
      id: proofCaptureFp,
      name: "DripTray proof case",
      kind: "document",
      version: proofCaptureFp,
      fingerprint: proofCaptureFingerprint,
      uri: `casys://fea-proof-case-capture/sha256/${proofCaptureFp}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "verify.seal-proof-case",
        runId: "run:seal-001",
      },
      inputArtifactIds: [],
      freshness: frs(),
    },
  ];
  const basisSnapshot = makeSnap({
    id: SNAP_ID,
    revision: 1,
    artifacts: basisArtifacts,
    proofArtifactId: proofCaptureFp,
  });

  // Build bindings for the work item.
  const proofCaseBinding = {
    name: "proofCase",
    source: {
      kind: "thread-entity" as const,
      reference: {
        snapshotId: SNAP_ID,
        snapshotRevision: 1,
        kind: "artifact" as const,
        id: proofCaptureFp,
      },
    },
  };
  const geometryBinding = {
    name: "geometry",
    source: {
      kind: "thread-entity" as const,
      reference: {
        snapshotId: SNAP_ID,
        snapshotRevision: 1,
        kind: "artifact" as const,
        id: GEOM_ARTIFACT_ID,
      },
    },
  };
  const operation = {
    id: VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id,
    version: VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version,
    bindings: [proofCaseBinding, geometryBinding],
  };

  // MRTR decision + approval with computed fingerprints.
  const inputEvidenceRefs = [
    {
      snapshotId: SNAP_ID,
      snapshotRevision: 1,
      kind: "artifact" as const,
      id: proofCaptureFp,
    },
    {
      snapshotId: SNAP_ID,
      snapshotRevision: 1,
      kind: "artifact" as const,
      id: GEOM_ARTIFACT_ID,
    },
  ];
  const decisionProposal = {
    summary: "Run FEA for DripTray concept.",
    // WHY non-empty: requireMrtrApproval skips decisions with parameters.length === 0.
    parameters: [
      {
        key: "operation",
        label: "FEA Operation",
        value: VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id,
      },
    ],
  };
  const decisionFp = await sha256Fingerprint({
    baseSnapshot: basisRef,
    inputEvidenceRefs,
    proposal: {
      summary: decisionProposal.summary,
      parameters: decisionProposal.parameters,
    },
  });

  const decision = {
    id: DECISION_ID,
    phaseId: "phase:fea-01",
    title: "Approve FEA run",
    question: "Run CalculiX on the sealed proof case?",
    status: "approved" as const,
    requestedAt: AT,
    baseSnapshot: basisRef,
    inputFingerprint: decisionFp,
    inputEvidenceRefs,
    approvalIds: [APPROVAL_ID],
    proposal: {
      ...decisionProposal,
      proposedAt: AT,
      proposedBy: { kind: "human" as const, actorId: "operator:erwan" },
    },
  };

  const approval = {
    id: APPROVAL_ID,
    decisionId: DECISION_ID,
    status: "approved" as const,
    requestedAt: AT,
    decidedAt: AT,
    decidedBy: "operator:erwan",
    decidedByOrigin: "human" as const,
    baseSnapshot: basisRef,
    inputFingerprint: decisionFp,
    inputEvidenceRefs,
  };

  const workItem = {
    id: WORK_ITEM_ID,
    phaseId: "phase:fea-01",
    title: "FEA static proof run for DripTray",
    description: "Run CalculiX on the sealed DripTray FEA proof case.",
    kind: "define" as const,
    operation,
    status: "in-progress" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [DECISION_ID],
    blockerIds: [],
  };

  const runFp = await sha256Fingerprint({
    workItemId: WORK_ITEM_ID,
    basis,
    operation,
    approvedDecisions: [{ id: DECISION_ID, inputFingerprint: decisionFp }],
  });

  const run = {
    id: RUN_ID,
    workItemId: WORK_ITEM_ID,
    status: "running" as const,
    summary: "FEA static proof run for DripTray concept.",
    queuedAt: AT,
    startedAt: AT,
    claimedBy: undefined,
    completedAt: undefined,
    basis,
    inputFingerprint: runFp,
    evidenceRefs: [],
    resultSnapshot: undefined,
  };

  const project: EngineeringProjectSnapshot = {
    schemaVersion: "3.0",
    project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
    revision: 1,
    agentRuns: [run],
    workItems: [workItem],
    decisions: [decision],
    approvals: [approval],
    threadSnapshots: [basisRef],
    commandReceipts: [],
    briefIds: [],
    phaseIds: [],
    changeIds: [],
    phases: [],
    briefs: [],
  } as unknown as EngineeringProjectSnapshot;

  // Staged path and expected solver request shape (matches buildCalculixRequest).
  const stagedPath = `/inputs/fea-${STEP_SHA256}-001.step`;
  const expectedSupports = proofCase.analysis.supports.map((s) => ({
    name: s.selection.name,
    box: s.selection.box,
  }));
  const expectedLoads = proofCase.analysis.loads.map((l) => ({
    name: l.selection.name,
    box: l.selection.box,
    force_n: l.force.value,
  }));

  return {
    proofCase,
    proofCaptureText,
    proofCaptureFingerprint,
    proofCaptureFp,
    proofDigest,
    basisSnapshot,
    project,
    run,
    workItem,
    decision,
    approval,
    basis,
    geometryArtifact,
    stepArtifact,
    requirementsArtifact,
    stagedPath,
    expectedSupports,
    expectedLoads,
  };
}

// ── 1. Non-agent origin rejected before any store read ────────────────────────

Deno.test(
  "verify-run-fea-static-proof executor rejects a human origin before any store read",
  async () => {
    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: {
        get: () => Promise.reject(new Error("must not read")),
      } as never,
      commands: {} as never,
      snapshots: {} as never,
      proofCaptures: {} as never,
      requirementsCaptures: {} as never,
      solverCaptures: {} as never,
      verdictCaptures: {} as never,
      attempts: {} as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {} as never,
      assetReader: {} as never,
      syson: {} as never,
      solver: {} as never,
      policy: {} as never,
      lease: {} as never,
    });
    await assertRejects(
      () => executor.execute({ kind: "human", actorId: "reviewer" }, COMMAND_BASE),
      EngineeringProjectCommandError,
      "agent origin",
    );
  },
);

// ── 2. Project not found ───────────────────────────────────────────────────────

Deno.test(
  "verify-run-fea-static-proof executor returns project_not_found when project absent",
  async () => {
    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(undefined) } as never,
      commands: {} as never,
      snapshots: {} as never,
      proofCaptures: {} as never,
      requirementsCaptures: {} as never,
      solverCaptures: {} as never,
      verdictCaptures: {} as never,
      attempts: {} as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {} as never,
      assetReader: {} as never,
      syson: {} as never,
      solver: {} as never,
      policy: {} as never,
      lease: {} as never,
    });
    await assertRejects(
      () => executor.execute(AGENT, COMMAND_BASE),
      EngineeringProjectCommandError,
      PROJECT_ID,
    );
  },
);

// ── 3. Wrong operation id — invalid_transition ────────────────────────────────

Deno.test(
  "verify-run-fea-static-proof executor rejects a run bound to a different operation id",
  async () => {
    const run = {
      id: RUN_ID,
      workItemId: "wi:wrong",
      status: "running" as const,
      summary: "wrong op",
      queuedAt: AT,
      startedAt: AT,
      basis: {
        kind: "thread-snapshot" as const,
        snapshotId: SNAP_ID,
        revision: 1,
        subjectId: SUBJECT_ID,
      },
      evidenceRefs: [],
    };
    const workItem = {
      id: "wi:wrong",
      phaseId: "ph:01",
      title: "Wrong op",
      description: "",
      kind: "define" as const,
      operation: { id: "other.operation", version: "1", bindings: [] },
      status: "in-progress" as const,
      owner: "agent" as const,
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    };
    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: {
        get: () =>
          Promise.resolve({
            schemaVersion: "3.0",
            project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
            revision: 1,
            agentRuns: [run],
            workItems: [workItem],
            decisions: [],
            approvals: [],
            threadSnapshots: [],
          }),
      } as never,
      commands: {} as never,
      snapshots: {} as never,
      proofCaptures: {} as never,
      requirementsCaptures: {} as never,
      solverCaptures: {} as never,
      verdictCaptures: {} as never,
      attempts: {} as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {} as never,
      assetReader: {} as never,
      syson: {} as never,
      solver: {} as never,
      policy: {} as never,
      lease: {} as never,
    });
    await assertRejects(
      () => executor.execute(AGENT, COMMAND_BASE),
      EngineeringProjectCommandError,
      VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id,
    );
  },
);

// ── 4. Missing proofCase binding — invalid_transition ────────────────────────

Deno.test(
  "verify-run-fea-static-proof executor rejects a work item with only a geometry binding",
  async () => {
    const run = {
      id: RUN_ID,
      workItemId: "wi:one-binding",
      status: "running" as const,
      summary: "one binding",
      queuedAt: AT,
      startedAt: AT,
      basis: {
        kind: "thread-snapshot" as const,
        snapshotId: SNAP_ID,
        revision: 1,
        subjectId: SUBJECT_ID,
      },
      evidenceRefs: [],
    };
    const workItem = {
      id: "wi:one-binding",
      phaseId: "ph:01",
      title: "One binding",
      description: "",
      kind: "define" as const,
      operation: {
        id: VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id,
        version: VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version,
        bindings: [
          {
            name: "geometry",
            source: {
              kind: "thread-entity" as const,
              reference: {
                snapshotId: SNAP_ID,
                snapshotRevision: 1,
                kind: "artifact" as const,
                id: GEOM_ARTIFACT_ID,
              },
            },
          },
        ],
      },
      status: "in-progress" as const,
      owner: "agent" as const,
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    };
    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: {
        get: () =>
          Promise.resolve({
            schemaVersion: "3.0",
            project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
            revision: 1,
            agentRuns: [run],
            workItems: [workItem],
            decisions: [],
            approvals: [],
            threadSnapshots: [],
          }),
      } as never,
      commands: {} as never,
      snapshots: {} as never,
      proofCaptures: {} as never,
      requirementsCaptures: {} as never,
      solverCaptures: {} as never,
      verdictCaptures: {} as never,
      attempts: {} as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {} as never,
      assetReader: {} as never,
      syson: {} as never,
      solver: {} as never,
      policy: {} as never,
      lease: {} as never,
    });
    await assertRejects(
      () => executor.execute(AGENT, COMMAND_BASE),
      EngineeringProjectCommandError,
    );
  },
);

// ── 5. Proof capture absent from CAS — invalid_transition ─────────────────────

Deno.test(
  "verify-run-fea-static-proof executor stops when proof capture is absent from CAS",
  async () => {
    const fx = await buildFixtures();
    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(fx.project) } as never,
      commands: {} as never,
      snapshots: { get: () => Promise.resolve(fx.basisSnapshot) } as never,
      proofCaptures: {
        read: () => Promise.resolve(undefined),
      } as never,
      requirementsCaptures: {} as never,
      solverCaptures: {} as never,
      verdictCaptures: {} as never,
      attempts: {} as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {} as never,
      assetReader: {} as never,
      syson: {} as never,
      solver: {} as never,
      policy: {} as never,
      lease: {
        withLease: (_: unknown, __: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
    });
    await assertRejects(
      () => executor.execute(AGENT, COMMAND_BASE),
      EngineeringProjectCommandError,
      "absent from the CAS store",
    );
  },
);

// ── 6. Proof capture proofDigest mismatch — invalid_input ─────────────────────

Deno.test(
  "verify-run-fea-static-proof executor stops when proofDigest diverges from canonicalProofText sha256",
  async () => {
    const fx = await buildFixtures();
    const corruptCapture = JSON.stringify({
      schemaVersion: "fea-proof-case-capture/1.0",
      operation: {
        id: VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id,
        version: VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version,
      },
      trustedRunId: "run:seal-001",
      proofDigest: "0".repeat(64), // wrong digest — SHA-256 mismatch
      canonicalProofText: deterministicJson(fx.proofCase),
      geometryArtifact: fx.geometryArtifact,
      stepArtifact: fx.stepArtifact,
      requirementsArtifact: fx.requirementsArtifact,
      requirementsElementId: REQS_ELEMENT_ID,
      seedIdentity: { editingContextId: EDITING_CTX_ID, elementId: REQS_ELEMENT_ID },
      sealedAt: "2026-08-09T11:00:00.000Z",
    });
    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(fx.project) } as never,
      commands: {} as never,
      snapshots: { get: () => Promise.resolve(fx.basisSnapshot) } as never,
      proofCaptures: { read: () => Promise.resolve(corruptCapture) } as never,
      requirementsCaptures: {} as never,
      solverCaptures: {} as never,
      verdictCaptures: {} as never,
      attempts: {} as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {} as never,
      assetReader: {} as never,
      syson: {} as never,
      solver: {} as never,
      policy: {} as never,
      lease: {
        withLease: (_: unknown, __: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
    });
    await assertRejects(
      () => executor.execute(AGENT, COMMAND_BASE),
      EngineeringProjectCommandError,
      "SHA-256 diverges",
    );
  },
);

// ── 7. assertFeaResultArtifactNotRemoved — no ancestor verdict ────────────────

Deno.test(
  "assertFeaResultArtifactNotRemoved does not throw when no ancestor carried the verdict artifact",
  async () => {
    const snap = makeSnap({ id: SNAP_ID, revision: 1 });
    await assertFeaResultArtifactNotRemoved(
      snap,
      "a".repeat(64),
      { get: () => Promise.resolve(undefined) } as never,
    );
  },
);

// ── 8. assertFeaResultArtifactNotRemoved — monotony ratchet triggers ──────────

Deno.test(
  "assertFeaResultArtifactNotRemoved throws when ancestor had verdict but current does not",
  async () => {
    const proofDigest = "a".repeat(64);
    const verdictFp = "b".repeat(64);
    const verdictUri =
      `casys://fea-verdict-capture/proof/${proofDigest}/sha256/${verdictFp}`;

    const ancestor = makeSnap({
      id: "snap:ancestor",
      revision: 1,
      artifacts: [
        {
          id: `fea-verdict-${verdictFp}`,
          name: "verdict",
          kind: "document",
          version: verdictFp,
          fingerprint: { algorithm: "sha256", digest: verdictFp },
          uri: verdictUri,
          mediaType: "application/json",
          producer: {
            serverId: "digital-thread",
            tool: "verify.run-fea-static-proof",
            runId: "run:prev",
          },
          inputArtifactIds: [],
          freshness: frs(),
        },
      ],
      proofArtifactId: `fea-verdict-${verdictFp}`,
    });

    // Current snapshot references ancestor but carries no verdict artifact.
    const current = makeSnap({
      id: SNAP_ID,
      revision: 2,
      previous: { snapshotId: "snap:ancestor", revision: 1 },
      artifacts: [],
      proofArtifactId: "model-art-id",
    });

    const snapshots = {
      get: (id: string) =>
        id === "snap:ancestor" ? Promise.resolve(ancestor) : Promise.resolve(undefined),
    };

    await assertRejects(
      () => assertFeaResultArtifactNotRemoved(current, proofDigest, snapshots as never),
      FeaResultArtifactRemovedError,
    );
  },
);

// ── 9. assertFeaResultArtifactNotRemoved — current already carries verdict ────

Deno.test(
  "assertFeaResultArtifactNotRemoved does not throw when current snapshot carries verdict",
  async () => {
    const proofDigest = "a".repeat(64);
    const verdictFp = "b".repeat(64);
    const verdictUri =
      `casys://fea-verdict-capture/proof/${proofDigest}/sha256/${verdictFp}`;

    const current = makeSnap({
      id: SNAP_ID,
      revision: 3,
      artifacts: [
        {
          id: `fea-verdict-${verdictFp}`,
          name: "verdict",
          kind: "document",
          version: verdictFp,
          fingerprint: { algorithm: "sha256", digest: verdictFp },
          uri: verdictUri,
          mediaType: "application/json",
          producer: {
            serverId: "digital-thread",
            tool: "verify.run-fea-static-proof",
            runId: "run:prev",
          },
          inputArtifactIds: [],
          freshness: frs(),
        },
      ],
      proofArtifactId: `fea-verdict-${verdictFp}`,
    });

    await assertFeaResultArtifactNotRemoved(
      current,
      proofDigest,
      { get: () => Promise.resolve(undefined) } as never,
    );
  },
);

// ── 10. Requirements tip drift — rejected before dispatch ─────────────────────

Deno.test(
  "verify-run-fea-static-proof executor rejects when requirements tip changed between seal and run",
  async () => {
    const fx = await buildFixtures();
    // Replace the requirements artifact with a different fingerprint (drift).
    const driftedReqsFp = "9".repeat(64);
    const driftedReqsId = `requirements-${CONTAINER_COMPONENT}-${driftedReqsFp}`;
    const driftedArtifacts = fx.basisSnapshot.artifacts.map((a) =>
      a.id === REQS_ARTIFACT_ID
        ? {
          ...a,
          id: driftedReqsId,
          fingerprint: { algorithm: "sha256" as const, digest: driftedReqsFp },
          uri:
            `casys://requirements-capture/${CONTAINER_COMPONENT}/sha256/${driftedReqsFp}`,
        }
        : a
    );
    const driftedBasis = makeSnap({
      id: SNAP_ID,
      revision: 1,
      artifacts: driftedArtifacts,
      proofArtifactId: fx.proofCaptureFp,
    });

    let calculixCalled = false;
    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(fx.project) } as never,
      commands: {
        claimRun: () => Promise.resolve({} as never),
        failRun: () => Promise.resolve({} as never),
      } as never,
      snapshots: { get: () => Promise.resolve(driftedBasis) } as never,
      proofCaptures: { read: () => Promise.resolve(fx.proofCaptureText) } as never,
      requirementsCaptures: {
        read: () =>
          Promise.resolve(JSON.stringify({ containerComponent: CONTAINER_COMPONENT })),
      } as never,
      solverCaptures: {} as never,
      verdictCaptures: {} as never,
      attempts: {} as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {} as never,
      assetReader: {} as never,
      syson: {} as never,
      solver: {
        callTool: () => {
          calculixCalled = true;
          return Promise.resolve({ structuredContent: {} });
        },
      } as never,
      policy: {
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 0.5,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 1000000,
        selectionsMax: 10,
      } as never,
      lease: {
        withLease: (_: unknown, __: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
    });
    await assertRejects(
      () => executor.execute(AGENT, COMMAND_BASE),
      EngineeringProjectCommandError,
      "requirements_tip_drift",
    );
    assertStrictEquals(
      calculixCalled,
      false,
      "CalculiX must not be called on tip drift",
    );
  },
);

// ── 11. WAL solver-recorded recovery — no CalculiX redispatch ─────────────────

Deno.test(
  "verify-run-fea-static-proof executor does not redispatch CalculiX when WAL is solver-recorded",
  async () => {
    const fx = await buildFixtures();
    let resolveCallCount = 0;
    let solveCallCount = 0;
    let stageCallCount = 0;
    let preflightCallCount = 0;
    let recoveryCaptureWriteCount = 0;
    let quarantineCallCount = 0;

    // Canned solver capture text — structure only, not fully validated in this test.
    const cannedSolverText = JSON.stringify({
      schemaVersion: "fea-solver-result-capture/1.0",
      operation:
        `${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version}`,
      trustedRunId: RUN_ID,
      capturedAt: AT,
      upstreamIdentities: {
        proofDigest: fx.proofDigest,
        stepArtifactId: fx.stepArtifact.id,
        stepFingerprint: fx.stepArtifact.fingerprint,
        stagedPath: fx.stagedPath,
      },
      inputArtifact: {
        path: "/tmp/staged/drip.step",
        sourcePath: fx.stagedPath,
        sha256: STEP_SHA256,
        bytes: STEP_BYTES,
      },
      constraints: {
        fixedSelections: fx.proofCase.analysis.supports.map((support) =>
          support.selection.name
        ),
        loads: fx.proofCase.analysis.loads.map((load) => ({
          selection: load.selection.name,
          forceN: load.force.value,
        })),
      },
      mesh: { nodes: 10000, elements: 5000, nodesPerSelection: { SupportBase: 400 } },
      metrics: {
        maxDisplacement: {
          value: 0.45,
          unit: "mm",
          nodeId: 1001,
          vectorMm: [0, 0, 0.45],
        },
        maxVonMises: { value: 8.2, unit: "MPa", elementId: 2001 },
      },
    });
    const cannedFp = (await sha256Fingerprint(JSON.parse(cannedSolverText))).digest;

    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(fx.project) } as never,
      commands: {
        claimRun: () => Promise.resolve({} as never),
        failRun: () => Promise.resolve({} as never),
      } as never,
      snapshots: { get: () => Promise.resolve(fx.basisSnapshot) } as never,
      proofCaptures: { read: () => Promise.resolve(fx.proofCaptureText) } as never,
      requirementsCaptures: {
        read: () =>
          Promise.resolve(JSON.stringify({ containerComponent: CONTAINER_COMPONENT })),
      } as never,
      solverCaptures: {
        read: () => Promise.resolve(cannedSolverText),
        save: () => {
          recoveryCaptureWriteCount++;
          return Promise.reject(
            new Error("solver-recorded recovery capture write sentinel"),
          );
        },
        uriFor: () => `casys://fea-solver-result-capture/sha256/${cannedFp}`,
      } as never,
      verdictCaptures: {} as never,
      attempts: {
        preflight: () => {
          preflightCallCount++;
          return Promise.resolve({
            action: "solver-recorded" as const,
            solverCaptureFp: cannedFp,
            canonicalSolverCaptureText: cannedSolverText,
          });
        },
        begin: () => Promise.reject(new Error("begin must not run on recovery")),
        recordSolver: () =>
          Promise.reject(new Error("recordSolver must not be called on recovery")),
        complete: () => Promise.resolve(),
        quarantine: () => {
          quarantineCallCount++;
          return Promise.resolve();
        },
      } as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {
        resolveTarget: ({ containerFileName }: { containerFileName: string }) =>
          stagedTarget(containerFileName),
        stage: () => {
          stageCallCount++;
          return Promise.resolve(stagedTarget(`fea-${STEP_SHA256}.step`));
        },
      } as never,
      assetReader: { read: () => Promise.resolve(new Uint8Array(STEP_BYTES)) } as never,
      // WHY correct constraints format: extractAndVerifyOracleRequirements calls
      // syson_constraint_extract and expects structuredContent.constraints (not
      // .requirements) with a binary expression AST.  Wrong format stops the run.
      syson: {
        callTool: () =>
          Promise.resolve({
            structuredContent: {
              constraints: fx.proofCase.requirements.map(buildConstraintRow),
            },
          }),
      } as never,
      solver: {
        resolve: (input: StaticStructuralSolveInput) => {
          resolveCallCount++;
          return lowerCalculixStaticStructuralSolve(input);
        },
        solve: () => {
          solveCallCount++;
          return Promise.reject(new Error("solve must not run on recovery"));
        },
      } as never,
      policy: {
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 0.5,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 1000000,
        selectionsMax: 10,
      } as never,
      lease: {
        withLease: (_: unknown, __: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
    });

    await assertRejects(
      () => executor.execute(AGENT, COMMAND_BASE),
      EngineeringProjectCommandError,
      "solver-recorded recovery capture write sentinel",
    );
    assertStrictEquals(resolveCallCount, 1, "the exact solve plan must be resolved");
    assertStrictEquals(preflightCallCount, 1, "WAL preflight must be reached");
    assertStrictEquals(
      recoveryCaptureWriteCount,
      1,
      "solver-recorded recovery must reach capture rematerialization",
    );
    assertStrictEquals(
      solveCallCount,
      0,
      "CalculiX must NOT be dispatched on WAL solver-recorded recovery",
    );
    assertStrictEquals(
      stageCallCount,
      0,
      "Docker staging must NOT run on WAL solver-recorded recovery",
    );
    assertStrictEquals(
      quarantineCallCount,
      1,
      "a post-recorded structural failure must quarantine the recovered attempt",
    );
  },
);

Deno.test(
  "verify-run-fea-static-proof completed WAL crash replay does not re-observe the solver image or re-complete",
  async () => {
    const fx = await buildFixtures();
    const replayBasis: ThreadSnapshot = {
      ...fx.basisSnapshot,
      requirements: fx.proofCase.requirements.map((requirement) => ({
        id: `thread-${requirement.id}`,
        name: requirement.name,
        statement: `${requirement.name} must satisfy its sealed limit.`,
        version: "1.0",
        criterion: {
          metric: requirement.feature,
          operator: requirement.operator,
          limit: requirement.limit,
        },
        trace: {
          sourceArtifactId: REQS_ARTIFACT_ID,
          elementId: REQS_ELEMENT_ID,
          targetArtifactIds: [fx.stepArtifact.id],
        },
        freshness: frs(),
      })),
      provenance: fx.proofCase.requirements.map((requirement) => ({
        id: `prov-thread-${requirement.id}-traces-step`,
        relation: "traces_to" as const,
        from: { kind: "requirement" as const, id: `thread-${requirement.id}` },
        to: { kind: "artifact" as const, id: fx.stepArtifact.id },
        rationale: "The sealed requirement constrains the staged STEP artifact.",
      })),
    };
    let currentProject = fx.project;
    let persistedSnapshot: ThreadSnapshot | undefined;
    const solverText = JSON.stringify({
      schemaVersion: "fea-solver-result-capture/1.0",
      operation:
        `${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version}`,
      trustedRunId: RUN_ID,
      capturedAt: AT,
      upstreamIdentities: {
        proofDigest: fx.proofDigest,
        stepArtifactId: fx.stepArtifact.id,
        stepFingerprint: fx.stepArtifact.fingerprint,
        stagedPath: fx.stagedPath,
      },
      inputArtifact: {
        path: "/tmp/staged/drip.step",
        sourcePath: fx.stagedPath,
        sha256: STEP_SHA256,
        bytes: STEP_BYTES,
      },
      constraints: {
        fixedSelections: fx.proofCase.analysis.supports.map((support) =>
          support.selection.name
        ),
        loads: fx.proofCase.analysis.loads.map((load) => ({
          selection: load.selection.name,
          forceN: load.force.value,
        })),
      },
      mesh: { nodes: 10000, elements: 5000, nodesPerSelection: { SupportBase: 400 } },
      metrics: {
        maxDisplacement: {
          value: 0.45,
          unit: "mm",
          nodeId: 1001,
          vectorMm: [0, 0, 0.45],
        },
        maxVonMises: { value: 8.2, unit: "MPa", elementId: 2001 },
      },
    });
    const solverFp = (await sha256Fingerprint(JSON.parse(solverText))).digest;
    const replayCapturedAt = AT;
    const replayRequest = {
      step_path: `/inputs/fea-${STEP_SHA256}.step`,
      expected_step_sha256: STEP_SHA256,
      mesh_size_mm: fx.proofCase.analysis.mesh.targetSize.value,
      material: {
        e_mpa: fx.proofCase.analysis.material.youngModulus.value,
        nu: fx.proofCase.analysis.material.poissonRatio.value,
      },
      selections: [
        ...fx.proofCase.analysis.supports.map((support) => ({
          name: support.selection.name,
          box: { min: support.selection.box.min, max: support.selection.box.max },
        })),
        ...fx.proofCase.analysis.loads.map((load) => ({
          name: load.selection.name,
          box: { min: load.selection.box.min, max: load.selection.box.max },
        })),
      ],
      fixed: fx.proofCase.analysis.supports.map((support) => support.selection.name),
      loads: fx.proofCase.analysis.loads.map((load) => ({
        selection: load.selection.name,
        force_n: load.force.value,
      })),
    };
    const verdict = {
      schemaVersion: "fea-verdict-capture/1.0",
      operation:
        `${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version}`,
      trustedRunId: RUN_ID,
      capturedAt: replayCapturedAt,
      proofDigest: fx.proofDigest,
      solverCaptureFp: solverFp,
      oracleOutcomes: fx.proofCase.requirements.map((requirement) => ({
        requirementId: requirement.id,
        status: "pass" as const,
        computedValue: requirement.metric === "maximum-displacement" ? 0.45 : 8.2,
        threshold: requirement.limit.value,
        unit: requirement.limit.unit,
        margin: requirement.limit.value -
          (requirement.metric === "maximum-displacement" ? 0.45 : 8.2),
      })),
      policyVersion: FEA_EXECUTION_POLICY_VERSION,
      exactSolverRequest: replayRequest,
      solverImage: {
        image: "ghcr.io/casys-ai/calculix@sha256:sealed",
        digest: "e".repeat(64),
        observedAt: replayCapturedAt,
      },
    };
    const verdictText = deterministicJson(verdict);
    const verdictFp = (await sha256Fingerprint(verdict)).digest;
    let imageObservations = 0;
    let sysonCalls = 0;
    let completeCalls = 0;
    let stageCalls = 0;
    let verdictReadFp: string | undefined;
    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(currentProject) } as never,
      commands: {
        claimRun: () => Promise.resolve({} as never),
        failRun: () => Promise.resolve({} as never),
        publishRun: () => {
          currentProject = {
            ...currentProject,
            revision: currentProject.revision + 1,
            agentRuns: currentProject.agentRuns.map((run) =>
              run.id === RUN_ID ? { ...run, status: "publishing" as const } : run
            ),
          };
          return Promise.resolve({} as never);
        },
        completeRun: () => {
          currentProject = {
            ...currentProject,
            revision: currentProject.revision + 1,
            agentRuns: currentProject.agentRuns.map((run) =>
              run.id === RUN_ID ? { ...run, status: "completed" as const } : run
            ),
          };
          return Promise.resolve({} as never);
        },
      } as never,
      snapshots: {
        get: (id: string) =>
          Promise.resolve(id === replayBasis.id ? replayBasis : persistedSnapshot),
        save: (snapshot: ThreadSnapshot) => {
          persistedSnapshot = snapshot;
          return Promise.resolve();
        },
      } as never,
      proofCaptures: { read: () => Promise.resolve(fx.proofCaptureText) } as never,
      requirementsCaptures: {
        read: () =>
          Promise.resolve(JSON.stringify({ containerComponent: CONTAINER_COMPONENT })),
      } as never,
      solverCaptures: {
        read: () => Promise.resolve(solverText),
        save: () => Promise.resolve(),
      } as never,
      verdictCaptures: {
        read: (fingerprint: { digest: string }) => {
          verdictReadFp = fingerprint.digest;
          return Promise.resolve(verdictText);
        },
      } as never,
      attempts: {
        preflight: () =>
          Promise.resolve({
            action: "completed" as const,
            solverCaptureFp: solverFp,
            verdictCaptureFp: verdictFp,
            canonicalSolverCaptureText: solverText,
          }),
        begin: () => Promise.reject(new Error("begin must not run on recovery")),
        complete: () => {
          completeCalls++;
          return Promise.resolve();
        },
        quarantine: () => Promise.resolve(),
      } as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {
        resolveTarget: ({ containerFileName }: { containerFileName: string }) =>
          stagedTarget(containerFileName),
        stage: () => {
          stageCalls++;
          return Promise.resolve(stagedTarget(`fea-${STEP_SHA256}.step`));
        },
      } as never,
      assetReader: { read: () => Promise.resolve(new Uint8Array(STEP_BYTES)) } as never,
      syson: {
        callTool: () => {
          sysonCalls++;
          return Promise.resolve({
            structuredContent: {
              constraints: fx.proofCase.requirements.map(buildConstraintRow),
            },
          });
        },
      } as never,
      solver: {
        resolve: lowerCalculixStaticStructuralSolve,
        solve: () => Promise.reject(new Error("must not dispatch")),
      } as never,
      policy: {
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 0.5,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 1000000,
        selectionsMax: 10,
      } as never,
      lease: {
        withLease: (_: unknown, __: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
      solverImageObserver: () => {
        imageObservations++;
        return Promise.resolve({
          image: "unexpected",
          digest: "d".repeat(64),
          observedAt: AT,
        });
      },
      // Deliberately later than the sealed image observation. A completed WAL
      // must read the existing verdict bytes, not derive a replacement from a
      // new clock value or image observation.
      now: () => "2026-08-11T00:00:00.000Z",
    });
    const completed = await executor.execute(AGENT, COMMAND_BASE);
    assertEquals(
      completed.agentRuns.find((run) => run.id === RUN_ID)?.status,
      "completed",
    );
    const verdictArtifact = persistedSnapshot?.artifacts.find((artifact) =>
      artifact.id === `fea-verdict-${verdictFp}`
    );
    assertEquals(verdictArtifact?.fingerprint.digest, verdictFp);
    assertEquals(verdictArtifact?.freshness.changedAt, replayCapturedAt);
    assertStrictEquals(imageObservations, 0);
    assertStrictEquals(verdictReadFp, verdictFp);
    assertStrictEquals(sysonCalls, 0, "completed replay must not contact SysON");
    assertStrictEquals(stageCalls, 0, "completed replay must not stage through Docker");
    assertStrictEquals(completeCalls, 0);
  },
);

Deno.test(
  "completed WAL rejects a valid ISO verdict timestamp different from requiredStart",
  async () => {
    const verdict = {
      schemaVersion: "fea-verdict-capture/1.0",
      operation:
        `${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version}`,
      trustedRunId: RUN_ID,
      capturedAt: "2026-08-09T12:34:56.000Z",
      proofDigest: "a".repeat(64),
      solverCaptureFp: "b".repeat(64),
      oracleOutcomes: [],
      policyVersion: FEA_EXECUTION_POLICY_VERSION,
      exactSolverRequest: { step_path: "/inputs/fea.step" },
    };
    const text = deterministicJson(verdict);
    const fingerprint = (await sha256Fingerprint(verdict)).digest;
    await assertRejects(
      () =>
        readCompletedVerdictCapture(
          { read: () => Promise.resolve(text) } as never,
          fingerprint,
          {
            trustedRunId: RUN_ID,
            capturedAt: AT,
            proofDigest: verdict.proofDigest,
            solverCaptureFp: verdict.solverCaptureFp,
            policyVersion: FEA_EXECUTION_POLICY_VERSION,
            exactSolverRequest: verdict.exactSolverRequest,
          },
        ),
      EngineeringProjectCommandError,
      "does not bind this exact run",
    );
  },
);

// ── 12. Policy violation — rejected before WAL begin ─────────────────────────

Deno.test(
  "verify-run-fea-static-proof executor rejects before WAL begin when policy is violated",
  async () => {
    const fx = await buildFixtures();
    let walBeginCalled = false;

    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(fx.project) } as never,
      commands: { claimRun: () => Promise.resolve({} as never) } as never,
      snapshots: { get: () => Promise.resolve(fx.basisSnapshot) } as never,
      proofCaptures: { read: () => Promise.resolve(fx.proofCaptureText) } as never,
      requirementsCaptures: {
        read: () =>
          Promise.resolve(JSON.stringify({ containerComponent: CONTAINER_COMPONENT })),
      } as never,
      solverCaptures: {} as never,
      verdictCaptures: {} as never,
      attempts: {
        begin: () => {
          walBeginCalled = true;
          return Promise.resolve({ action: "dispatch" as const });
        },
      } as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {
        resolveTarget: ({ containerFileName }: { containerFileName: string }) =>
          stagedTarget(containerFileName),
        stage: () => Promise.resolve(stagedTarget(`fea-${STEP_SHA256}.step`)),
      } as never,
      assetReader: { read: () => Promise.resolve(new Uint8Array(STEP_BYTES)) } as never,
      // Oracle must pass for policy check to be reached.
      syson: {
        callTool: () =>
          Promise.resolve({
            structuredContent: {
              constraints: fx.proofCase.requirements.map(buildConstraintRow),
            },
          }),
      } as never,
      solver: {
        resolve: lowerCalculixStaticStructuralSolve,
        solve: () => Promise.reject(new Error("must not dispatch")),
      } as never,
      policy: {
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 100.0, // proof mesh = 2mm → violates minimum
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 1000000,
        selectionsMax: 10,
      } as never,
      lease: {
        withLease: (_: unknown, __: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
    });
    await assertRejects(
      () => executor.execute(AGENT, COMMAND_BASE),
      EngineeringProjectCommandError,
      "policy violation",
    );
    assertStrictEquals(
      walBeginCalled,
      false,
      "WAL begin must NOT be called on policy violation",
    );
  },
);

Deno.test(
  "verify-run-fea-static-proof rejects a staged location that diverges from its planned request before WAL or solver dispatch",
  async () => {
    const fx = await buildFixtures();
    let walBeginCalled = false;
    let solverCalled = false;
    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(fx.project) } as never,
      commands: { claimRun: () => Promise.resolve({} as never) } as never,
      snapshots: { get: () => Promise.resolve(fx.basisSnapshot) } as never,
      proofCaptures: { read: () => Promise.resolve(fx.proofCaptureText) } as never,
      requirementsCaptures: {
        read: () =>
          Promise.resolve(JSON.stringify({ containerComponent: CONTAINER_COMPONENT })),
      } as never,
      solverCaptures: {} as never,
      verdictCaptures: {} as never,
      attempts: {
        preflight: () => Promise.resolve(undefined),
        begin: () => {
          walBeginCalled = true;
          return Promise.resolve({ action: "dispatch" as const });
        },
      } as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {
        resolveTarget: ({ containerFileName }: { containerFileName: string }) =>
          stagedTarget(containerFileName),
        stage: () =>
          Promise.resolve(Object.freeze({
            containerPath: "/inputs/wrong-asset.step",
          })),
      } as never,
      assetReader: { read: () => Promise.resolve(new Uint8Array(STEP_BYTES)) } as never,
      syson: {
        callTool: () =>
          Promise.resolve({
            structuredContent: {
              constraints: fx.proofCase.requirements.map(buildConstraintRow),
            },
          }),
      } as never,
      solver: {
        resolve: lowerCalculixStaticStructuralSolve,
        solve: () => {
          solverCalled = true;
          return Promise.reject(new Error("solver must not dispatch"));
        },
      } as never,
      policy: {
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 0.5,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 1000000,
        selectionsMax: 10,
      } as never,
      lease: {
        withLease: (_: unknown, __: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
    });

    await assertRejects(
      () => executor.execute(AGENT, COMMAND_BASE),
      EngineeringProjectCommandError,
      "different from the planned location",
    );
    assertStrictEquals(walBeginCalled, false);
    assertStrictEquals(solverCalled, false);
  },
);

// ── 13. CAS solver absent → rematérialisation triggered ──────────────────────

Deno.test(
  "verify-run-fea-static-proof executor saves solver CAS when absent after WAL solver-recorded",
  async () => {
    const fx = await buildFixtures();
    const cannedText = JSON.stringify({
      schemaVersion: "fea-solver-result-capture/1.0",
      operation:
        `${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.id}@${VERIFY_RUN_FEA_STATIC_PROOF_OPERATION.version}`,
      trustedRunId: RUN_ID,
      capturedAt: AT,
      upstreamIdentities: {
        proofDigest: fx.proofDigest,
        stepArtifactId: fx.stepArtifact.id,
        stepFingerprint: fx.stepArtifact.fingerprint,
        stagedPath: fx.stagedPath,
      },
      inputArtifact: {
        path: "/tmp/staged/drip.step",
        sourcePath: fx.stagedPath,
        sha256: STEP_SHA256,
        bytes: STEP_BYTES,
      },
      constraints: { supports: fx.expectedSupports, loads: fx.expectedLoads },
      mesh: { nodes: 10000, elements: 5000, nodesPerSelection: { SupportBase: 400 } },
      metrics: {
        maxDisplacement: {
          value: 0.45,
          unit: "mm",
          nodeId: 1001,
          vectorMm: [0, 0, 0.45],
        },
        maxVonMises: { value: 8.2, unit: "MPa", elementId: 2001 },
      },
    });
    const cannedFp = (await sha256Fingerprint(JSON.parse(cannedText))).digest;

    let rematSaveCalled = false;
    let solverReadCount = 0;

    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(fx.project) } as never,
      commands: {
        claimRun: () => Promise.resolve({} as never),
        failRun: () => Promise.resolve({} as never),
      } as never,
      snapshots: { get: () => Promise.resolve(fx.basisSnapshot) } as never,
      proofCaptures: { read: () => Promise.resolve(fx.proofCaptureText) } as never,
      requirementsCaptures: {
        read: () =>
          Promise.resolve(JSON.stringify({ containerComponent: CONTAINER_COMPONENT })),
      } as never,
      solverCaptures: {
        read: (_fp: unknown) => {
          solverReadCount++;
          // First read: absent. Second read (after rematérialisation): present.
          return Promise.resolve(solverReadCount === 1 ? undefined : cannedText);
        },
        save: () => {
          rematSaveCalled = true;
          return Promise.resolve();
        },
        uriFor: () => `casys://fea-solver-result-capture/sha256/${cannedFp}`,
      } as never,
      verdictCaptures: {} as never,
      attempts: {
        preflight: () =>
          Promise.resolve({
            action: "solver-recorded" as const,
            solverCaptureFp: cannedFp,
            canonicalSolverCaptureText: cannedText,
          }),
        begin: () => Promise.reject(new Error("begin must not run on recovery")),
        recordSolver: () => Promise.resolve(),
        complete: () => Promise.resolve(),
        quarantine: () => Promise.resolve(),
      } as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {
        resolveTarget: ({ containerFileName }: { containerFileName: string }) =>
          stagedTarget(containerFileName),
        stage: () => Promise.resolve(stagedTarget(`fea-${STEP_SHA256}.step`)),
      } as never,
      assetReader: { read: () => Promise.resolve(new Uint8Array(STEP_BYTES)) } as never,
      syson: {
        callTool: () =>
          Promise.resolve({
            structuredContent: {
              constraints: fx.proofCase.requirements.map(buildConstraintRow),
            },
          }),
      } as never,
      solver: {
        resolve: lowerCalculixStaticStructuralSolve,
        solve: () => Promise.reject(new Error("must not dispatch")),
      } as never,
      policy: {
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 0.5,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 1000000,
        selectionsMax: 10,
      } as never,
      lease: {
        withLease: (_: unknown, __: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
    });

    try {
      await executor.execute(AGENT, COMMAND_BASE);
    } catch {
      // Stubs not fully wired — only checking rematérialisation.
    }
    assertStrictEquals(
      rematSaveCalled,
      true,
      "solver CAS rematérialisation must be triggered when absent",
    );
  },
);

// ── 14. CAS solver divergent → TERMINAL ──────────────────────────────────────

Deno.test(
  "verify-run-fea-static-proof executor stops with TERMINAL error when CAS solver text diverges from WAL",
  async () => {
    const fx = await buildFixtures();
    const walCanonicalText =
      `{"schemaVersion":"fea-solver-result-capture/1.0","source":"wal"}`;
    const divergedCasText =
      `{"schemaVersion":"fea-solver-result-capture/1.0","source":"corrupted"}`;
    const fp = "a".repeat(64);

    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(fx.project) } as never,
      commands: {
        claimRun: () => Promise.resolve({} as never),
        failRun: () => Promise.resolve({} as never),
      } as never,
      snapshots: { get: () => Promise.resolve(fx.basisSnapshot) } as never,
      proofCaptures: { read: () => Promise.resolve(fx.proofCaptureText) } as never,
      requirementsCaptures: {
        read: () =>
          Promise.resolve(JSON.stringify({ containerComponent: CONTAINER_COMPONENT })),
      } as never,
      solverCaptures: {
        read: () => Promise.resolve(divergedCasText), // diverges from WAL
        save: () => Promise.resolve(),
        uriFor: () => `casys://fea-solver-result-capture/sha256/${fp}`,
      } as never,
      verdictCaptures: {} as never,
      attempts: {
        preflight: () =>
          Promise.resolve({
            action: "solver-recorded" as const,
            solverCaptureFp: fp,
            canonicalSolverCaptureText: walCanonicalText,
          }),
        begin: () => Promise.reject(new Error("begin must not run on recovery")),
        complete: () => Promise.resolve(),
        quarantine: () => Promise.resolve(),
      } as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {
        resolveTarget: ({ containerFileName }: { containerFileName: string }) =>
          stagedTarget(containerFileName),
        stage: () => Promise.resolve(stagedTarget(`fea-${STEP_SHA256}.step`)),
      } as never,
      assetReader: { read: () => Promise.resolve(new Uint8Array(STEP_BYTES)) } as never,
      syson: {
        callTool: () =>
          Promise.resolve({
            structuredContent: {
              constraints: fx.proofCase.requirements.map(buildConstraintRow),
            },
          }),
      } as never,
      solver: {
        resolve: lowerCalculixStaticStructuralSolve,
        solve: () => Promise.reject(new Error("must not dispatch")),
      } as never,
      policy: {
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 0.5,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 1000000,
        selectionsMax: 10,
      } as never,
      lease: {
        withLease: (_: unknown, __: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
    });
    await assertRejects(
      () => executor.execute(AGENT, COMMAND_BASE),
      EngineeringProjectCommandError,
      "fea_solver_capture_integrity_violation",
    );
  },
);

// ── 15. STEP byte count mismatch — stops before WAL ──────────────────────────

Deno.test(
  "verify-run-fea-static-proof executor stops when asset reader returns wrong byte count",
  async () => {
    const fx = await buildFixtures();
    let walBeginCalled = false;

    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(fx.project) } as never,
      commands: { claimRun: () => Promise.resolve({} as never) } as never,
      snapshots: { get: () => Promise.resolve(fx.basisSnapshot) } as never,
      proofCaptures: { read: () => Promise.resolve(fx.proofCaptureText) } as never,
      requirementsCaptures: {
        read: () =>
          Promise.resolve(JSON.stringify({ containerComponent: CONTAINER_COMPONENT })),
      } as never,
      solverCaptures: {} as never,
      verdictCaptures: {} as never,
      attempts: {
        begin: () => {
          walBeginCalled = true;
          return Promise.resolve({ action: "dispatch" as const });
        },
      } as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: { stage: () => Promise.resolve() } as never,
      assetReader: {
        read: () => Promise.resolve(new Uint8Array(STEP_BYTES + 99)), // wrong size
      } as never,
      // Oracle runs at step 10, after STEP read (step 9) — won't be reached.
      syson: { callTool: () => Promise.resolve({ structuredContent: {} }) } as never,
      solver: { callTool: () => Promise.resolve({ structuredContent: {} }) } as never,
      policy: {
        policyVersion: FEA_EXECUTION_POLICY_VERSION,
        meshTargetSizeMinMm: 0.5,
        forceMagnitudeMaxN: 1000,
        stepBytesMax: 1000000,
        selectionsMax: 10,
      } as never,
      lease: {
        withLease: (_: unknown, __: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
    });
    await assertRejects(
      () => executor.execute(AGENT, COMMAND_BASE),
      EngineeringProjectCommandError,
      "byte count mismatch",
    );
    assertStrictEquals(
      walBeginCalled,
      false,
      "WAL begin must NOT be called on bytes mismatch",
    );
  },
);

// ── 16. Fail verdict with violations passes validateThreadSnapshot ─────────────

Deno.test(
  "verify-run-fea-static-proof: fail verdict snapshot with 1:1 violations and proposedActions passes validateThreadSnapshot",
  async () => {
    const fx = await buildFixtures();
    const verdictFp = "c".repeat(64);
    const solverFp = "d".repeat(64);
    const proofDigest = fx.proofDigest;
    const verdictUri =
      `casys://fea-verdict-capture/proof/${proofDigest}/sha256/${verdictFp}`;
    const solverUri = `casys://fea-solver-result-capture/sha256/${solverFp}`;
    const reqDispId = "req-disp";
    const reqStressId = "req-stress";
    const solverArtId = `fea-solver-result-${solverFp}`;
    const verdictArtId = `fea-verdict-${verdictFp}`;
    const obsDispId = `fea-observation-${verdictFp}-${reqDispId}`;
    const obsStressId = `fea-observation-${verdictFp}-${reqStressId}`;
    const evalDispId = `${reqDispId}-evaluation-${verdictFp}`;
    const evalStressId = `${reqStressId}-evaluation-${verdictFp}`;
    const violDispId = `${evalDispId}-violation`;
    const violStressId = `${evalStressId}-violation`;
    const actionDispId = `${violDispId}-action`;
    const actionStressId = `${violStressId}-action`;
    const f = frs();
    const evalOp = {
      serverId: "syson",
      tool: "syson_constraint_evaluate",
      runId: verdictArtId,
    };

    /**
     * Build the fail-verdict snapshot. validateThreadSnapshot is the only gate
     * that distinguishes "snapshot builds in memory" from "snapshot is publishable".
     *
     * The provenance links below are mandatory by the validator's invariants:
     *   derived_from: observation → source artifact
     *   evaluates:    evaluation → requirement
     *   uses:         evaluation → observation
     *   evidences:    evaluation/violation → evidence artifact
     *   caused_by:    violation → evaluation
     *   addresses:    action → violation
     *   traces_to:    requirement → constrained artifact
     *
     * WHY comparison.limit.unit === "MPa": the oracle converts the SysON Pa limit
     * to MPa for the observation comparison; normalizedUnit must equal actual.unit
     * and limit.unit — a mismatch is a validator rejection, not a silent pass.
     */
    const snapshotWithFail: ThreadSnapshot = {
      schemaVersion: "1.0",
      id: "snap:fea-fail",
      revision: 1,
      generatedAt: AT,
      subject: {
        id: SUBJECT_ID,
        name: "DripTray concept",
        kind: "part",
        version: "1",
        modelArtifactId: solverArtId,
      },
      freshness: f,
      changeSet: {
        id: "cs-fea-fail",
        name: "FEA fail verdict",
        status: "applied",
        createdAt: AT,
        appliedAt: AT,
        changes: [],
      },
      artifacts: [
        {
          id: solverArtId,
          name: "FEA static solve result",
          kind: "solver-result",
          version: solverFp,
          fingerprint: { algorithm: "sha256", digest: solverFp },
          uri: solverUri,
          mediaType: "application/json",
          producer: {
            serverId: "calculix",
            tool: "calculix_solve_static",
            runId: RUN_ID,
          },
          inputArtifactIds: [],
          freshness: f,
        },
        {
          id: verdictArtId,
          name: "FEA oracle verdict",
          kind: "document",
          version: verdictFp,
          fingerprint: { algorithm: "sha256", digest: verdictFp },
          uri: verdictUri,
          mediaType: "application/json",
          producer: {
            serverId: "digital-thread",
            tool: "verify.run-fea-static-proof",
            runId: RUN_ID,
          },
          inputArtifactIds: [],
          freshness: f,
        },
      ],
      consumptions: [],
      observations: [
        {
          id: obsDispId,
          name: "max_displacement_limit measured by CalculiX",
          metric: "drip_tray_max_displacement",
          quantity: { value: 2.5, unit: "mm" },
          source: {
            operation: {
              serverId: "calculix",
              tool: "calculix_solve_static",
              runId: RUN_ID,
            },
            artifactIds: [solverArtId],
            capturedAt: AT,
          },
          freshness: f,
        },
        {
          id: obsStressId,
          name: "max_stress_limit measured by CalculiX",
          metric: "drip_tray_max_von_mises",
          quantity: { value: 45.0, unit: "MPa" },
          source: {
            operation: {
              serverId: "calculix",
              tool: "calculix_solve_static",
              runId: RUN_ID,
            },
            artifactIds: [solverArtId],
            capturedAt: AT,
          },
          freshness: f,
        },
      ],
      requirements: [
        {
          id: reqDispId,
          name: "max_displacement_limit",
          statement: "Maximum displacement must not exceed the reviewed limit.",
          version: "1.0",
          criterion: {
            metric: "drip_tray_max_displacement",
            operator: "<=",
            limit: { value: 1.0, unit: "mm" },
          },
          trace: {
            sourceArtifactId: verdictArtId,
            elementId: REQS_ELEMENT_ID,
            targetArtifactIds: [solverArtId],
          },
          freshness: f,
        },
        {
          id: reqStressId,
          name: "max_stress_limit",
          statement: "Maximum von Mises stress must not exceed the reviewed limit.",
          version: "1.0",
          criterion: {
            metric: "drip_tray_max_von_mises",
            operator: "<=",
            limit: { value: 20.0, unit: "MPa" },
          },
          trace: {
            sourceArtifactId: verdictArtId,
            elementId: REQS_ELEMENT_ID,
            targetArtifactIds: [solverArtId],
          },
          freshness: f,
        },
      ],
      evaluations: [
        {
          id: evalDispId,
          name: "max_displacement_limit evaluation",
          requirementId: reqDispId,
          observationIds: [obsDispId],
          status: "fail",
          evaluatedAt: AT,
          evaluator: evalOp,
          evidenceArtifactIds: [verdictArtId],
          message: "The observed value exceeds the reviewed concept limit.",
          freshness: f,
          comparison: {
            observationId: obsDispId,
            actual: { value: 2.5, unit: "mm" },
            operator: "<=",
            limit: { value: 1.0, unit: "mm" },
            normalizedUnit: "mm",
            margin: { value: -1.5, unit: "mm" },
          },
        },
        {
          id: evalStressId,
          name: "max_stress_limit evaluation",
          requirementId: reqStressId,
          observationIds: [obsStressId],
          status: "fail",
          evaluatedAt: AT,
          evaluator: evalOp,
          evidenceArtifactIds: [verdictArtId],
          message: "The observed value exceeds the reviewed concept limit.",
          freshness: f,
          comparison: {
            observationId: obsStressId,
            actual: { value: 45.0, unit: "MPa" },
            operator: "<=",
            // WHY "MPa": normalizedUnit must equal both actual.unit and limit.unit;
            // the oracle converts SysON Pa to MPa before building the comparison.
            limit: { value: 20.0, unit: "MPa" },
            normalizedUnit: "MPa",
            margin: { value: -25.0, unit: "MPa" },
          },
        },
      ],
      violations: [
        {
          id: violDispId,
          name: "max_displacement_limit exceeds the reviewed limit",
          requirementId: reqDispId,
          evaluationId: evalDispId,
          severity: "error",
          status: "open",
          detectedAt: AT,
          observationIds: [obsDispId],
          evidenceArtifactIds: [verdictArtId],
          summary: "The observed value exceeds the reviewed concept limit.",
          freshness: f,
        },
        {
          id: violStressId,
          name: "max_stress_limit exceeds the reviewed limit",
          requirementId: reqStressId,
          evaluationId: evalStressId,
          severity: "error",
          status: "open",
          detectedAt: AT,
          observationIds: [obsStressId],
          evidenceArtifactIds: [verdictArtId],
          summary: "The observed value exceeds the reviewed concept limit.",
          freshness: f,
        },
      ],
      proposedActions: [
        {
          id: actionDispId,
          name:
            "Review the FEA limit violation: max_displacement_limit exceeds the reviewed limit",
          kind: "review",
          readiness: "ready",
          rationale:
            "A bounded FEA oracle verdict identified a concept limit violation; " +
            "operator review is required before any further action is taken.",
          targets: [{ kind: "artifact", id: verdictArtId }],
          addressesViolationIds: [violDispId],
          dependsOnActionIds: [],
        },
        {
          id: actionStressId,
          name:
            "Review the FEA limit violation: max_stress_limit exceeds the reviewed limit",
          kind: "review",
          readiness: "ready",
          rationale:
            "A bounded FEA oracle verdict identified a concept limit violation; " +
            "operator review is required before any further action is taken.",
          targets: [{ kind: "artifact", id: verdictArtId }],
          addressesViolationIds: [violStressId],
          dependsOnActionIds: [],
        },
      ],
      provenance: [
        // Observations derive from the solver result artifact.
        {
          id: "prov:obs-disp-from-solver",
          relation: "derived_from",
          from: { kind: "observation", id: obsDispId },
          to: { kind: "artifact", id: solverArtId },
          rationale: "Displacement observation extracted from the CalculiX result.",
        },
        {
          id: "prov:obs-stress-from-solver",
          relation: "derived_from",
          from: { kind: "observation", id: obsStressId },
          to: { kind: "artifact", id: solverArtId },
          rationale: "Von Mises observation extracted from the CalculiX result.",
        },
        // Requirements trace to the constrained artifact.
        {
          id: "prov:req-disp-traces-to",
          relation: "traces_to",
          from: { kind: "requirement", id: reqDispId },
          to: { kind: "artifact", id: solverArtId },
          rationale: "The displacement limit bounds the solver result artifact.",
        },
        {
          id: "prov:req-stress-traces-to",
          relation: "traces_to",
          from: { kind: "requirement", id: reqStressId },
          to: { kind: "artifact", id: solverArtId },
          rationale: "The von Mises limit bounds the solver result artifact.",
        },
        // Evaluations evaluate a requirement.
        {
          id: "prov:eval-disp-evaluates-req",
          relation: "evaluates",
          from: { kind: "evaluation", id: evalDispId },
          to: { kind: "requirement", id: reqDispId },
          rationale: "This evaluation checks the displacement requirement.",
        },
        {
          id: "prov:eval-stress-evaluates-req",
          relation: "evaluates",
          from: { kind: "evaluation", id: evalStressId },
          to: { kind: "requirement", id: reqStressId },
          rationale: "This evaluation checks the stress requirement.",
        },
        // Evaluations use observations.
        {
          id: "prov:eval-disp-uses-obs",
          relation: "uses",
          from: { kind: "evaluation", id: evalDispId },
          to: { kind: "observation", id: obsDispId },
          rationale: "The displacement evaluation is grounded in this observation.",
        },
        {
          id: "prov:eval-stress-uses-obs",
          relation: "uses",
          from: { kind: "evaluation", id: evalStressId },
          to: { kind: "observation", id: obsStressId },
          rationale: "The stress evaluation is grounded in this observation.",
        },
        // Evaluations are evidenced by the verdict artifact.
        {
          id: "prov:eval-disp-evidenced-by-verdict",
          relation: "evidences",
          from: { kind: "evaluation", id: evalDispId },
          to: { kind: "artifact", id: verdictArtId },
          rationale: "The evaluation outcome is recorded in the verdict artifact.",
        },
        {
          id: "prov:eval-stress-evidenced-by-verdict",
          relation: "evidences",
          from: { kind: "evaluation", id: evalStressId },
          to: { kind: "artifact", id: verdictArtId },
          rationale: "The evaluation outcome is recorded in the verdict artifact.",
        },
        // Violations are caused by their evaluation.
        {
          id: "prov:viol-disp-caused-by-eval",
          relation: "caused_by",
          from: { kind: "violation", id: violDispId },
          to: { kind: "evaluation", id: evalDispId },
          rationale:
            "The displacement violation is the direct consequence of a failed evaluation.",
        },
        {
          id: "prov:viol-stress-caused-by-eval",
          relation: "caused_by",
          from: { kind: "violation", id: violStressId },
          to: { kind: "evaluation", id: evalStressId },
          rationale:
            "The stress violation is the direct consequence of a failed evaluation.",
        },
        // Violations are evidenced by the verdict artifact.
        {
          id: "prov:viol-disp-evidenced-by-verdict",
          relation: "evidences",
          from: { kind: "violation", id: violDispId },
          to: { kind: "artifact", id: verdictArtId },
          rationale: "The violation is recorded in the verdict artifact.",
        },
        {
          id: "prov:viol-stress-evidenced-by-verdict",
          relation: "evidences",
          from: { kind: "violation", id: violStressId },
          to: { kind: "artifact", id: verdictArtId },
          rationale: "The violation is recorded in the verdict artifact.",
        },
        // Actions address the violations.
        {
          id: "prov:action-disp-addresses-viol",
          relation: "addresses",
          from: { kind: "action", id: actionDispId },
          to: { kind: "violation", id: violDispId },
          rationale: "This review action addresses the open displacement violation.",
        },
        {
          id: "prov:action-stress-addresses-viol",
          relation: "addresses",
          from: { kind: "action", id: actionStressId },
          to: { kind: "violation", id: violStressId },
          rationale: "This review action addresses the open stress violation.",
        },
      ],
    };

    // This is the publishability gate — the snapshot must pass full validation.
    validateThreadSnapshot(snapshotWithFail);
  },
);

// ── 17. Fail verdict extension accepted by applyThreadSnapshotExtensionIfNew ──

Deno.test(
  "verify-run-fea-static-proof: fail verdict extension is accepted by applyThreadSnapshotExtensionIfNew",
  async () => {
    const fx = await buildFixtures();
    const verdictFp = "e".repeat(64);
    const solverFp = "f".repeat(64);
    const proofDigest = fx.proofDigest;
    const verdictUri =
      `casys://fea-verdict-capture/proof/${proofDigest}/sha256/${verdictFp}`;
    const solverUri = `casys://fea-solver-result-capture/sha256/${solverFp}`;
    const verdictArtId = `fea-verdict-${verdictFp}`;
    const solverArtId = `fea-solver-result-${solverFp}`;
    const f = frs();

    const extension = {
      id: `fea-run-extension-${verdictFp}`,
      name: "FEA static-proof run evidence",
      subjectId: SUBJECT_ID,
      capturedAt: AT,
      artifacts: [
        {
          id: solverArtId,
          name: "FEA static solve result",
          kind: "solver-result" as const,
          version: solverFp,
          fingerprint: { algorithm: "sha256" as const, digest: solverFp },
          uri: solverUri,
          mediaType: "application/json",
          producer: {
            serverId: "calculix",
            tool: "calculix_solve_static",
            runId: RUN_ID,
          },
          inputArtifactIds: [],
          freshness: f,
        },
        {
          id: verdictArtId,
          name: "FEA oracle verdict",
          kind: "document" as const,
          version: verdictFp,
          fingerprint: { algorithm: "sha256" as const, digest: verdictFp },
          uri: verdictUri,
          mediaType: "application/json",
          producer: {
            serverId: "digital-thread",
            tool: "verify.run-fea-static-proof",
            runId: RUN_ID,
          },
          inputArtifactIds: [],
          freshness: f,
        },
      ],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      proposedActions: [],
      provenance: [],
    };

    const { snapshot } = applyThreadSnapshotExtensionIfNew(fx.basisSnapshot, extension);
    assertEquals(snapshot.artifacts.some((a) => a.id === verdictArtId), true);
    assertEquals(snapshot.artifacts.some((a) => a.id === solverArtId), true);
  },
);

// ── 18. STEP artifact fingerprint diverges in basis — rejected at step 9 ────────

Deno.test(
  "the run refuses when the STEP artifact in the execution basis diverges from the sealed identity",
  async () => {
    const fx = await buildFixtures();
    // Replace the STEP artifact's fingerprint in the basis with a diverged digest.
    // The artifact id still matches the sealed proof capture, but the fingerprint
    // does not — the executor must refuse at step 9 before any WAL or dispatch.
    const divergedStepFp = "1".repeat(64);
    const divergedArtifacts = fx.basisSnapshot.artifacts.map((a) =>
      a.id === fx.stepArtifact.id
        ? {
          ...a,
          fingerprint: { algorithm: "sha256" as const, digest: divergedStepFp },
        }
        : a
    );
    const divergedBasis = makeSnap({
      id: SNAP_ID,
      revision: 1,
      artifacts: divergedArtifacts,
      proofArtifactId: fx.proofCaptureFp,
    });

    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(fx.project) } as never,
      commands: {} as never,
      snapshots: { get: () => Promise.resolve(divergedBasis) } as never,
      proofCaptures: { read: () => Promise.resolve(fx.proofCaptureText) } as never,
      requirementsCaptures: {
        read: () =>
          Promise.resolve(JSON.stringify({ containerComponent: CONTAINER_COMPONENT })),
      } as never,
      solverCaptures: {} as never,
      verdictCaptures: {} as never,
      attempts: {} as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {} as never,
      assetReader: {} as never,
      syson: {} as never,
      solver: {} as never,
      policy: {} as never,
      lease: {
        withLease: (_: unknown, __: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
    });

    await assertRejects(
      () => executor.execute(AGENT, COMMAND_BASE),
      EngineeringProjectCommandError,
      "does not match the sealed identity",
    );
  },
);

// ── 19. containerComponent comes from the signed capture, not artifact id ────────

Deno.test(
  "the run reads containerComponent from the signed requirements capture, not from the artifact id",
  async () => {
    const fx = await buildFixtures();
    // containerComponent in the signed capture does NOT match the pattern
    // "requirements-{containerComponent}-{fp}" encoded in the artifact id.
    // An executor that parsed the id would search for CONTAINER_COMPONENT and
    // find nothing in the URI space below — producing a requirements_tip_drift.
    // The correct executor reads from the signed capture and finds the artifact.
    const customComponent = "custom-not-from-id";

    // Same artifact id and fingerprint as the proof capture's requirementsArtifact,
    // but URI uses customComponent — so only a lookup by customComponent succeeds.
    const customUri =
      `casys://requirements-capture/${customComponent}/sha256/${REQS_FP}`;
    const customArtifacts = fx.basisSnapshot.artifacts.map((a) =>
      a.id === REQS_ARTIFACT_ID ? { ...a, uri: customUri } : a
    );
    const customBasis = makeSnap({
      id: SNAP_ID,
      revision: 1,
      artifacts: customArtifacts,
      proofArtifactId: fx.proofCaptureFp,
    });

    let tipDriftThrown = false;
    const executor = new VerifyRunFeaStaticProofRunExecutor({
      projects: { get: () => Promise.resolve(fx.project) } as never,
      commands: {} as never,
      snapshots: { get: () => Promise.resolve(customBasis) } as never,
      proofCaptures: { read: () => Promise.resolve(fx.proofCaptureText) } as never,
      requirementsCaptures: {
        read: () =>
          Promise.resolve(JSON.stringify({ containerComponent: customComponent })),
      } as never,
      solverCaptures: {} as never,
      verdictCaptures: {} as never,
      attempts: {} as never,
      canonicalAssetDirectory: "state/local/thread-assets",
      stager: {} as never,
      assetReader: {} as never,
      syson: {} as never,
      solver: {} as never,
      policy: {} as never,
      lease: {
        withLease: (_: unknown, __: unknown, fn: () => Promise<unknown>) => fn(),
      } as never,
    });

    try {
      await executor.execute(AGENT, COMMAND_BASE);
    } catch (error) {
      if (
        error instanceof EngineeringProjectCommandError &&
        error.message.includes("requirements_tip_drift")
      ) {
        tipDriftThrown = true;
      }
    }

    // If requirements_tip_drift was thrown, the executor read from the artifact id
    // pattern instead of the signed capture — that is the bug being prevented.
    assertStrictEquals(
      tipDriftThrown,
      false,
      "containerComponent must come from the signed requirements capture, not the artifact id pattern",
    );
  },
);
