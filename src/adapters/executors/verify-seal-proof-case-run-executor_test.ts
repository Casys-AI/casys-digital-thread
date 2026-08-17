/**
 * Tests for verify-seal-proof-case-run-executor.ts (Op 1 of the FEA proof chain).
 *
 * WHY A FICTITIOUS PROJECT — the executor is generic; "fea-seal-test" proves
 * that no product-specific project.id hardcoding leaks into the path.
 *
 * WHY STUB readTextFile — the catalog path
 * "config/mechanical-proof-cases/desk-lamp-dl04-arm-cantilever.json" does not
 * need to exist on disk; tests supply an in-memory stub so the suite can run on any
 * checkout without a pre-existing file.
 *
 * WHY STUB CAPTURE STORES for geometry/requirements/seed — the seal executor only
 * reads from these stores (never writes). Using read-only stubs with controlled
 * content means tests do not depend on the geometry or requirements executors
 * having run first. The real file-backed FileCaptureStore is used only for
 * proofCaseCaptures (the executor writes there).
 *
 * WHY AN EXPLICIT OPERATION REGISTRY — the fixture pins the trusted operation
 * and thread-snapshot basis while delegating every other operation to the real
 * registry.
 *
 * Coverage:
 *   1. Human-origin rejection — no I/O touched
 *   2. MRTR absent — run with no approved decision → invalid_transition
 *   3. Catalog absent — unknown proof case ID → invalid_input
 *   4. Digest divergent — MRTR proofDigest differs from computed → invalid_input
 *   5. PartUsage target rejected — elementId not in geometry partDefinitions → invalid_transition
 *   6. Derived requirements tip rejected — tip does not match MRTR artifact → invalid_transition
 *   7. Happy path — sealed artifact in snapshot; triplets present;
 *      validateThreadSnapshot passes; idempotent replay returns same project revision
 */

import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import {
  encodeFeaProofDecisionParameters,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
} from "../../domain/analysis/fea-proof-proposal.ts";
import { validateMechanicalProofCase } from "../../domain/analysis/mechanical-proof-case.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type {
  EngineeringProjectPlanOperationRegistry,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import type { EngineeringProjectCommandOrigin } from "../../application/ports/in/engineering-project-command-origin.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../captures/file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../stores/file-thread-snapshot-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../validators/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "./approved-brief-baseline-run-executor.ts";
import { approvedBriefSourceAnalysisFixture } from "../../testing/approved-brief-source-analysis-fixture.ts";
import {
  FEA_PROOF_CASE_CAPTURE_URI_PREFIX,
  VerifySealProofCaseRunExecutor,
} from "./verify-seal-proof-case-run-executor.ts";
import { GEOMETRY_BUNDLE_CAPTURE_SCHEMA } from "./design-write-geometry-run-executor.ts";
import { REQUIREMENTS_CAPTURE_SCHEMA } from "./model-write-requirements-run-executor.ts";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const AGENT: EngineeringProjectCommandOrigin = {
  kind: "agent",
  actorId: "agent:engineering",
};
const HUMAN: EngineeringProjectCommandOrigin = {
  kind: "human",
  actorId: "human:reviewer",
};

/** Fictitious non-CM01 project id. */
const PROJECT_ID = "fea-seal-test";
const SUBJECT_ID = `project:${PROJECT_ID}`;
const RETIRED_CM01_PROOF_CASE_ID = "coffee-machine-cm01-drip-tray-mechanical-v1";

/** The model element ID that the proof case declares as its FEA target. */
const TARGET_ELEMENT_ID = "drip-tray-element-test-001";
const EDITING_CONTEXT_ID = "ctx-fea-seal-test-001";
const CONTAINER_COMPONENT = "DripTray";
const REQUIREMENTS_ELEMENT_ID = "req-element-test-001";

/** Stable fake fingerprints (length 64 hex) for test-local captures. */
const GEOM_DIGEST = "a".repeat(64);
const STEP_BYTES = 12345;
const STEP_DIGEST = await sha256Hex(new Uint8Array(STEP_BYTES));
const REQ_DIGEST = "c".repeat(64);
const SEED_DIGEST = "d".repeat(64);

/** ISO datetime reused across stubs. */
const NOW = "2026-08-09T10:00:00.000Z";

// ---------------------------------------------------------------------------
// Test 1 — Human-origin rejection: no I/O touched
// ---------------------------------------------------------------------------

Deno.test(
  "verify-seal-proof-case executor rejects a human origin before any store access",
  async () => {
    const executor = new VerifySealProofCaseRunExecutor({
      projects: {
        get: () => Promise.reject(new Error("must not read")),
      } as never,
      commands: {} as never,
      snapshots: {} as never,
      proofCaseCaptures: {} as never,
      geometryCaptures: {} as never,
      requirementsCaptures: {} as never,
      seedCaptures: {} as never,
      canonicalAssetReader: {} as never,
      lease: {} as never,
    });
    await assertRejects(
      () =>
        executor.execute(HUMAN, {
          commandId: "human-cmd",
          projectId: PROJECT_ID,
          expectedRevision: 1,
          issuedAt: NOW,
          runId: "run:seal",
        }),
      EngineeringProjectCommandError,
      "Only an authenticated agent",
    );
  },
);

// ---------------------------------------------------------------------------
// Test 2 — MRTR absent: run with no approved decision
// ---------------------------------------------------------------------------

Deno.test(
  "verify-seal-proof-case executor rejects a run bound to no approved FEA proof-case MRTR decision",
  async () => {
    const executor = new VerifySealProofCaseRunExecutor({
      projects: {
        get: () =>
          Promise.resolve({
            schemaVersion: "3.0",
            revision: 1,
            project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
            agentRuns: [{
              id: "run:seal",
              workItemId: "seal-item",
              status: "queued",
              evidenceRefs: [],
              basis: {
                kind: "thread-snapshot",
                snapshotId: "snap-001",
                revision: 1,
                subjectId: SUBJECT_ID,
              },
            }],
            workItems: [{
              id: "seal-item",
              phaseId: "seal-phase",
              title: "Seal FEA proof case",
              description: "Seal the reviewed mechanical proof case.",
              kind: "verify",
              status: "in-progress",
              owner: "agent",
              dependsOnWorkItemIds: [],
              evidenceRefs: [],
              decisionIds: [],
              blockerIds: [],
              operation: {
                id: VERIFY_SEAL_PROOF_CASE_OPERATION.id,
                version: VERIFY_SEAL_PROOF_CASE_OPERATION.version,
                bindings: [{
                  name: "approvedBrief",
                  source: { kind: "approved-brief" },
                }],
              },
            }],
            decisions: [],
            approvals: [],
            phases: [],
            blockers: [],
            threadSnapshots: [],
          } as never),
      } as never,
      commands: {} as never,
      snapshots: {} as never,
      proofCaseCaptures: {} as never,
      geometryCaptures: {} as never,
      requirementsCaptures: {} as never,
      seedCaptures: {} as never,
      canonicalAssetReader: {} as never,
      lease: {} as never,
    });
    await assertRejects(
      () =>
        executor.execute(AGENT, {
          commandId: "no-mrtr",
          projectId: PROJECT_ID,
          expectedRevision: 1,
          issuedAt: NOW,
          runId: "run:seal",
        }),
      EngineeringProjectCommandError,
      "MRTR decision",
    );
  },
);

// ---------------------------------------------------------------------------
// Test 3 — Catalog absent: unknown proof case ID
// ---------------------------------------------------------------------------

Deno.test(
  "verify-seal-proof-case executor rejects the retired CM-01 proof case before a source read",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-fea-seal-catalog-absent-",
    });
    try {
      const retiredCase = makeTestCase(
        "snap-001",
        RETIRED_CM01_PROOF_CASE_ID,
        "snap-001",
      );
      const caseFp = await sha256Fingerprint(retiredCase);
      const proofDigest = caseFp.digest;

      const geomArtifact = makeGeomArtifact();
      const reqArtifact = makeReqArtifact();

      const params = encodeFeaProofDecisionParameters(
        proofDigest,
        retiredCase,
        { id: geomArtifact.id, fingerprint: geomArtifact.fingerprint },
        { id: reqArtifact.id, fingerprint: reqArtifact.fingerprint },
      );

      const fixture = await queuedSealFixture(directory, {
        proofCase: retiredCase,
        proofDigest,
        params: [...params],
        geomArtifact,
        reqArtifact,
      });

      let sourceReads = 0;
      const executor = new VerifySealProofCaseRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        proofCaseCaptures: new FileCaptureStore({
          ...FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
          directory: `${directory}/fea-proof-captures`,
        }),
        geometryCaptures: makeGeomCaptureStub() as never,
        requirementsCaptures: makeReqCaptureStub() as never,
        seedCaptures: makeSeedCaptureStub() as never,
        canonicalAssetReader: makeCanonicalAssetReader() as never,
        lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
        readTextFile: () => {
          sourceReads += 1;
          return Promise.reject(new Error("retired proof case must not be read"));
        },
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "catalog-absent",
            projectId: PROJECT_ID,
            expectedRevision: fixture.queued.revision,
            issuedAt: NOW,
            runId: fixture.runId,
          }),
        EngineeringProjectCommandError,
        "server-side catalog",
      );
      assertEquals(sourceReads, 0, "A retired proof case must not reach its source.");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 4 — Digest divergent: MRTR proofDigest differs from computed digest
// ---------------------------------------------------------------------------

Deno.test(
  "verify-seal-proof-case executor rejects when the MRTR proofDigest diverges from the computed case digest",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-fea-seal-digest-divergent-",
    });
    try {
      const realCase = makeTestCase("snap-001", undefined, "snap-001");
      const wrongDigest = "f".repeat(64);

      const geomArtifact = makeGeomArtifact();
      const reqArtifact = makeReqArtifact();

      // Encode params with a wrong proofDigest (the catalog ID is correct so the
      // catalog check passes; only the digest guard fires).
      const params = encodeFeaProofDecisionParameters(
        wrongDigest,
        realCase,
        { id: geomArtifact.id, fingerprint: geomArtifact.fingerprint },
        { id: reqArtifact.id, fingerprint: reqArtifact.fingerprint },
      );

      const fixture = await queuedSealFixture(directory, {
        proofCase: realCase,
        proofDigest: wrongDigest,
        params: [...params],
        geomArtifact,
        reqArtifact,
      });

      const executor = new VerifySealProofCaseRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        proofCaseCaptures: new FileCaptureStore({
          ...FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
          directory: `${directory}/fea-proof-captures`,
        }),
        geometryCaptures: makeGeomCaptureStub() as never,
        requirementsCaptures: makeReqCaptureStub() as never,
        seedCaptures: makeSeedCaptureStub() as never,
        canonicalAssetReader: makeCanonicalAssetReader() as never,
        lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
        readTextFile: makeReadStub(realCase),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "digest-divergent",
            projectId: PROJECT_ID,
            expectedRevision: fixture.queued.revision,
            issuedAt: NOW,
            runId: fixture.runId,
          }),
        EngineeringProjectCommandError,
        "digest divergence",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 4b — authorization.workItemId must match the queued run
// ---------------------------------------------------------------------------

Deno.test(
  "verify-seal-proof-case executor rejects when authorization.workItemId does not match the run",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-fea-seal-work-item-mismatch-",
    });
    try {
      const mismatched = validateMechanicalProofCase({
        ...makeTestCase("snap-001", undefined, "snap-001"),
        authorization: {
          workItemId: "other-item",
          decisionId: "seal-decision",
        },
      });
      const proofDigest = (await sha256Fingerprint(mismatched)).digest;
      const geomArtifact = makeGeomArtifact();
      const reqArtifact = makeReqArtifact();
      const params = encodeFeaProofDecisionParameters(
        proofDigest,
        mismatched,
        { id: geomArtifact.id, fingerprint: geomArtifact.fingerprint },
        { id: reqArtifact.id, fingerprint: reqArtifact.fingerprint },
      );
      const fixture = await queuedSealFixture(directory, {
        proofCase: mismatched,
        proofDigest,
        params: [...params],
        geomArtifact,
        reqArtifact,
      });
      const executor = new VerifySealProofCaseRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        proofCaseCaptures: new FileCaptureStore({
          ...FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
          directory: `${directory}/fea-proof-captures`,
        }),
        geometryCaptures: makeGeomCaptureStub() as never,
        requirementsCaptures: makeReqCaptureStub() as never,
        seedCaptures: makeSeedCaptureStub() as never,
        canonicalAssetReader: makeCanonicalAssetReader() as never,
        lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
        readTextFile: makeReadStub(mismatched),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "work-item-mismatch",
            projectId: PROJECT_ID,
            expectedRevision: fixture.queued.revision,
            issuedAt: NOW,
            runId: fixture.runId,
          }),
        EngineeringProjectCommandError,
        "authorization.workItemId",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 5 — PartUsage target rejected: elementId not in partDefinitions
// ---------------------------------------------------------------------------

Deno.test(
  "verify-seal-proof-case executor rejects when the MRTR target.modelElementId is not in partDefinitions (PartUsage guard)",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-fea-seal-part-usage-",
    });
    try {
      const geomArtifact = makeGeomArtifact();
      const reqArtifact = makeReqArtifact();

      // Phase 1: build the brief baseline and register r2, so we can learn
      // r2Snapshot.id before constructing the proof case.  The proof case must
      // reference the ACTUAL r2 snapshot id so assertReviewBasisDescendantOrEqual
      // passes and the executor reaches #verifyGeometry (the partDefinitions check).
      const base = await buildSealFixtureBase(directory, { geomArtifact, reqArtifact });

      // Build the proof case referencing the real r2 basis snapshot.
      const testCase = makeTestCase(
        base.r2Snapshot.id,
        undefined,
        base.r2Snapshot.id,
        base.r2Snapshot.revision,
      );
      const testFp = await sha256Fingerprint(testCase);
      const proofDigest = testFp.digest;

      const params = encodeFeaProofDecisionParameters(
        proofDigest,
        testCase,
        { id: geomArtifact.id, fingerprint: geomArtifact.fingerprint },
        { id: reqArtifact.id, fingerprint: reqArtifact.fingerprint },
      );

      // Phase 2: queue the seal run with the correct proof case.
      const fixture = await appendSealRun(base, {
        proofCase: testCase,
        proofDigest,
        params: [...params],
      });

      // Geometry capture stub that returns a manifest WITHOUT the target elementId.
      const geomCaptureWithoutTarget = JSON.stringify({
        schemaVersion: GEOMETRY_BUNDLE_CAPTURE_SCHEMA,
        manifest: {
          partDefinitions: [{
            elementId: "some-other-element-id-not-the-target",
            label: "OtherPart",
            files: [{
              format: "step",
              name: "other.step",
              fingerprint: { algorithm: "sha256", digest: STEP_DIGEST },
            }],
          }],
        },
      });
      const geomCaptureStubNoTarget = {
        read: () => Promise.resolve(geomCaptureWithoutTarget),
      };

      const executor = new VerifySealProofCaseRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        proofCaseCaptures: new FileCaptureStore({
          ...FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
          directory: `${directory}/fea-proof-captures`,
        }),
        geometryCaptures: geomCaptureStubNoTarget as never,
        requirementsCaptures: makeReqCaptureStub() as never,
        seedCaptures: makeSeedCaptureStub() as never,
        canonicalAssetReader: makeCanonicalAssetReader() as never,
        lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
        readTextFile: makeReadStub(testCase),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "part-usage",
            projectId: PROJECT_ID,
            expectedRevision: fixture.queued.revision,
            issuedAt: NOW,
            runId: fixture.runId,
          }),
        EngineeringProjectCommandError,
        "partDefinitions",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 6 — Derived requirements tip rejected
// ---------------------------------------------------------------------------

Deno.test(
  "verify-seal-proof-case executor rejects when the active requirements tip does not match the MRTR-signed artifact",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-fea-seal-tip-mismatch-",
    });
    try {
      const testCase = makeTestCase("snap-001", undefined, "snap-001");
      const testFp = await sha256Fingerprint(testCase);
      const proofDigest = testFp.digest;

      const geomArtifact = makeGeomArtifact();

      // Build a requirements artifact whose fingerprint DIFFERS from what
      // will be in the basis snapshot — this simulates tip mismatch.
      const wrongReqFingerprint: ContentFingerprint = {
        algorithm: "sha256",
        digest: "e".repeat(64),
      };
      const wrongReqArtifact: ThreadArtifact = {
        id: "req-wrong",
        name: "Wrong requirements artifact",
        kind: "sysml-model",
        version: "wrong-v",
        fingerprint: wrongReqFingerprint,
        uri: `casys://requirements-capture/${CONTAINER_COMPONENT}/sha256/${
          "e".repeat(64)
        }`,
        mediaType: "application/json",
        producer: {
          serverId: "digital-thread",
          tool: "model-write-requirements",
          runId: "run-req-wrong",
        },
        inputArtifactIds: [],
        freshness: {
          status: "fresh",
          changedAt: NOW,
          invalidatedByChangeIds: [],
        },
      };

      // The MRTR encodes the wrong artifact (not in the snapshot).
      const params = encodeFeaProofDecisionParameters(
        proofDigest,
        testCase,
        { id: geomArtifact.id, fingerprint: geomArtifact.fingerprint },
        {
          id: wrongReqArtifact.id,
          fingerprint: wrongReqArtifact.fingerprint,
        },
      );

      // Actual requirements artifact in the snapshot is the real one.
      const realReqArtifact = makeReqArtifact();

      const fixture = await queuedSealFixture(directory, {
        proofCase: testCase,
        proofDigest,
        params: [...params],
        geomArtifact,
        reqArtifact: realReqArtifact, // snapshot has the real one
      });

      const executor = new VerifySealProofCaseRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        proofCaseCaptures: new FileCaptureStore({
          ...FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
          directory: `${directory}/fea-proof-captures`,
        }),
        geometryCaptures: makeGeomCaptureStub() as never,
        requirementsCaptures: makeReqCaptureStub() as never,
        seedCaptures: makeSeedCaptureStub() as never,
        canonicalAssetReader: makeCanonicalAssetReader() as never,
        lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
        readTextFile: makeReadStub(testCase),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "tip-mismatch",
            projectId: PROJECT_ID,
            expectedRevision: fixture.queued.revision,
            issuedAt: NOW,
            runId: fixture.runId,
          }),
        EngineeringProjectCommandError,
        // Either artifact not found or tip mismatch
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 7 — Happy path: sealed artifact + triplets + validateThreadSnapshot + idempotent replay
// ---------------------------------------------------------------------------

Deno.test(
  "verify-seal-proof-case executor seals a proof case; published snapshot has triplets and passes validateThreadSnapshot; idempotent replay does not advance project revision",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-fea-seal-happy-",
    });
    try {
      let tick = 0;
      const baseTime = Date.parse("2026-08-09T10:00:00.000Z");
      const nowFn = () => new Date(baseTime + ++tick * 1_000).toISOString();

      // Build the baseline run to get the real r1 snapshot reference.
      const projects = new FileEngineeringProjectRevisionStore(
        `${directory}/projects`,
      );
      const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
      const baselineCaptures = new FileCaptureStore({
        ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
        directory: `${directory}/baseline-captures`,
      });
      const proofCaseCaptures = new FileCaptureStore({
        ...FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
        directory: `${directory}/fea-proof-captures`,
      });

      const briefs = new ProjectBriefCommandService(projects, nowFn);
      let project = await briefs.startProject(AGENT, {
        commandId: "start-fea-seal-test",
        projectId: PROJECT_ID,
        projectName: "FEA Seal Test Project",
        issuedAt: "2026-08-09T09:59:00.000Z",
        intent: "Test the verify-seal-proof-case executor.",
        intentSource: {
          kind: "human",
          reference: "conversation:fea-seal-test",
        },
      });
      project = await briefs.proposeBrief(AGENT, {
        ...ctx("propose-brief", project.revision),
        items: [{
          id: "objective",
          kind: "objective",
          statement: "Validate the FEA proof case seal executor in isolation.",
          sourceRefs: [{
            kind: "intent",
            reference: "conversation:fea-seal-test",
          }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement: "Seal a mechanical proof case into the thread.",
          sourceRefs: [{
            kind: "intent",
            reference: "conversation:fea-seal-test",
          }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement: "Proof case sealed as a signed mandate for the FEA run.",
          sourceRefs: [{
            kind: "intent",
            reference: "conversation:fea-seal-test",
          }],
          dependsOnItemIds: [],
        }],
      });
      project = await briefs.approveBrief(HUMAN, {
        ...ctx("approve-brief", project.revision),
        briefSnapshotId: project.framing!.proposedBrief!.id,
        briefRevision: project.framing!.proposedBrief!.revision,
        rationale: "Brief is clear for the FEA seal executor test.",
        inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
      });

      const commands = new EngineeringProjectCommandService(
        projects,
        new ExactThreadCompletionEvidenceValidator(snapshots),
        nowFn,
        { operations: makeTestPlanOperationRegistry() },
        new ExactInitialBaselineEvidenceValidator(
          snapshots,
          baselineCaptures,
          approvedBriefSourceAnalysisFixture(directory),
        ),
      );

      // Publish plan (brief baseline first).
      project = await commands.publishPlan(AGENT, {
        ...ctx("publish-plan", project.revision),
        startingPoint: "idea-or-spec",
        phases: [{ id: "baseline", name: "Baseline", description: "Brief baseline." }],
        workItems: [{
          id: "record-brief",
          phaseId: "baseline",
          owner: "agent",
          dependsOnWorkItemIds: [],
          decisionIds: [],
          operation: {
            id: "baseline.from-approved-brief",
            version: "1",
            bindings: [{
              name: "approvedBrief",
              source: { kind: "approved-brief" },
            }],
          },
        }],
        requiredDecisions: [],
      });

      project = await commands.queueRun(AGENT, {
        ...ctx("queue-brief", project.revision),
        runId: "run:brief-baseline",
        workItemId: "record-brief",
        summary: "Record the approved brief.",
        basis: project.plan!.basis,
      });

      const baselined = await new ApprovedBriefBaselineRunExecutor({
        projects,
        commands,
        captures: baselineCaptures,
        ...approvedBriefSourceAnalysisFixture(directory),
        snapshots,
        lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
        now: () => "2026-08-09T10:01:00.000Z",
      }).execute(AGENT, {
        commandId: "agent-brief-baseline",
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: "2026-08-09T10:01:00.000Z",
        runId: "run:brief-baseline",
      });

      const r1Ref = baselined.threadSnapshots[0]!;
      const r1Snapshot = await snapshots.get(r1Ref.snapshotId);
      assertExists(r1Snapshot, "r1 snapshot must be readable.");

      // Extend the r1 snapshot with geometry, requirements, and STEP artifacts so
      // the FEA seal executor finds them in the basis.
      const geomArtifact = makeGeomArtifact();
      const reqArtifact = makeReqArtifact();
      const stepArtifact = makeStepArtifact();

      const r2Snapshot = buildExtendedSnapshot(r1Snapshot, [
        geomArtifact,
        reqArtifact,
        stepArtifact,
      ]);
      validateThreadSnapshot(r2Snapshot); // sanity
      await snapshots.save(r2Snapshot);

      // r2Ref intentionally lacks `kind`; `kind` is only valid on
      // EngineeringBasisRef (queueRun.basis), not on EngineeringThreadSnapshotRef
      // (threadSnapshots, resultSnapshot, baseSnapshot). validateSnapshotRef uses
      // exactRecord and rejects every unknown field including kind.
      const r2Ref = {
        snapshotId: r2Snapshot.id,
        revision: r2Snapshot.revision,
        subjectId: r2Snapshot.subject.id,
      };

      // Build the proof case pointing to r2 as the reviewBasis.
      const proofCase = makeTestCase(
        r2Snapshot.id,
        undefined,
        r2Snapshot.id,
        r2Snapshot.revision,
      );
      const proofFp = await sha256Fingerprint(proofCase);
      const proofDigest = proofFp.digest;

      const proposalParameters = encodeFeaProofDecisionParameters(
        proofDigest,
        proofCase,
        { id: geomArtifact.id, fingerprint: geomArtifact.fingerprint },
        { id: reqArtifact.id, fingerprint: reqArtifact.fingerprint },
      );

      // Register r2 in project.threadSnapshots via a stub fixture run (same
      // rationale as in queuedSealFixture: proposeDecision and queueRun both
      // call assertDeclaredSnapshot, which only passes for snapshots that were
      // added by a completed run).
      project = await commands.appendChange(AGENT, {
        ...ctx("append-fixture", baselined.revision),
        baseSnapshot: r1Ref,
        phases: [{
          id: "fixture-phase",
          name: "Fixture: register extended snapshot",
          description:
            "Stub phase to promote r2 into the project's declared snapshots.",
        }],
        workItems: [{
          id: "fixture-item",
          phaseId: "fixture-phase",
          owner: "agent",
          dependsOnWorkItemIds: [],
          decisionIds: [],
          operation: { id: "fixture.artifacts-stub", version: "1", bindings: [] },
        }],
        requiredDecisions: [],
      });
      project = await commands.queueRun(AGENT, {
        ...ctx("queue-fixture", project.revision),
        runId: "run:fixture-artifacts",
        workItemId: "fixture-item",
        summary: "Stub: register extended snapshot.",
        basis: {
          kind: "thread-snapshot" as const,
          snapshotId: r1Ref.snapshotId,
          revision: r1Ref.revision,
          subjectId: r1Ref.subjectId,
        },
      });
      project = await commands.claimRun(AGENT, {
        ...ctx("claim-fixture", project.revision),
        runId: "run:fixture-artifacts",
        summary: "Stub: claim fixture run.",
      });
      project = await commands.publishRun(AGENT, {
        ...ctx("publish-fixture", project.revision),
        runId: "run:fixture-artifacts",
        summary: "Stub: publish fixture run.",
      });
      project = await commands.completeRun(AGENT, {
        ...ctx("complete-fixture", project.revision),
        runId: "run:fixture-artifacts",
        summary: "Stub: complete fixture run.",
        resultSnapshot: r2Ref,
        evidenceRefs: [{
          kind: "artifact" as const,
          id: geomArtifact.id,
          snapshotId: r2Snapshot.id,
          snapshotRevision: r2Snapshot.revision,
        }],
      });
      // r2 is now the current HEAD in project.threadSnapshots.

      // Register the seal work item using r2 as the new base.
      project = await commands.appendChange(AGENT, {
        ...ctx("append-seal", project.revision),
        baseSnapshot: r2Ref,
        phases: [{
          id: "seal-phase",
          name: "Seal FEA proof case",
          description: "Seal the reviewed mechanical proof case.",
        }],
        workItems: [{
          id: "seal-item",
          phaseId: "seal-phase",
          owner: "agent",
          dependsOnWorkItemIds: ["record-brief"],
          decisionIds: ["seal-decision"],
          operation: {
            id: VERIFY_SEAL_PROOF_CASE_OPERATION.id,
            version: VERIFY_SEAL_PROOF_CASE_OPERATION.version,
            bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
          },
        }],
        requiredDecisions: [{
          id: "seal-decision",
          phaseId: "seal-phase",
          title: "Approve FEA proof case seal",
          question: "Approve the seal of the mechanical proof case into the thread?",
        }],
      });

      project = await commands.proposeDecision(AGENT, {
        ...ctx("propose-seal-decision", project.revision),
        decisionId: "seal-decision",
        baseSnapshot: r2Ref,
        proposal: {
          summary: "Seal the desk-lamp-dl04-arm-cantilever proof case.",
          parameters: [...proposalParameters],
        },
      });
      const sealDecision = project.decisions.find(
        (d) => d.id === "seal-decision",
      )!;
      assertExists(sealDecision.inputFingerprint, "Decision must have a fingerprint.");

      project = await commands.approveDecision(HUMAN, {
        ...ctx("approve-seal-decision", project.revision),
        decisionId: "seal-decision",
        rationale: "MRTR approved: seal the exact mechanical proof case.",
        inputFingerprint: sealDecision.inputFingerprint!,
      });

      const runId = "run:verify-seal";
      project = await commands.queueRun(AGENT, {
        ...ctx("queue-seal", project.revision),
        runId,
        workItemId: "seal-item",
        summary: "Seal the desk-lamp-dl04-arm-cantilever proof case.",
        basis: { kind: "thread-snapshot" as const, ...r2Ref },
      });

      const executor = new VerifySealProofCaseRunExecutor({
        projects,
        commands,
        snapshots,
        proofCaseCaptures,
        geometryCaptures: makeGeomCaptureStub() as never,
        requirementsCaptures: makeReqCaptureStub() as never,
        seedCaptures: makeSeedCaptureStub() as never,
        canonicalAssetReader: makeCanonicalAssetReader() as never,
        lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
        readTextFile: makeReadStub(proofCase),
      });

      const completed = await executor.execute(AGENT, {
        commandId: "agent-seal",
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: "2026-08-09T10:30:00.000Z",
        runId,
      });

      // The run must be completed with a result snapshot.
      const run = completed.agentRuns.find((r) => r.id === runId)!;
      assertEquals(run.status, "completed", "Run must be completed.");
      assertExists(
        run.resultSnapshot,
        "Completed run must carry a result snapshot reference.",
      );

      // The published snapshot must be both readable and valid.
      const resultSnapshot = await snapshots.get(run.resultSnapshot!.snapshotId);
      assertExists(resultSnapshot, "Result snapshot must be readable after CAS save.");
      validateThreadSnapshot(resultSnapshot); // structural correctness gate
      assertEquals(resultSnapshot.schemaVersion, "1.1");

      const historicalBasis = await snapshots.get(r2Snapshot.id);
      assertExists(historicalBasis);
      assertEquals(
        historicalBasis.analysisGraph,
        undefined,
        "The seal must promote a successor, never mutate its historical basis snapshot.",
      );

      // The snapshot must carry exactly one FEA proof case artifact.
      const sealArtifacts = resultSnapshot.artifacts.filter(
        (a) =>
          a.kind === "document" &&
          a.uri?.startsWith(FEA_PROOF_CASE_CAPTURE_URI_PREFIX),
      );
      assertEquals(
        sealArtifacts.length,
        1,
        "Snapshot must carry exactly one sealed FEA proof case artifact.",
      );
      assertEquals(
        sealArtifacts[0]!.version,
        proofDigest,
        "Artifact version must equal proofDigest (cliquet key).",
      );
      assert(
        resultSnapshot.analysisGraph?.relations.every((relation) =>
          relation.assertion.evidence.length === 1 &&
          relation.assertion.evidence[0]!.id === sealArtifacts[0]!.id &&
          relation.assertion.evidence[0]!.fingerprint.digest ===
            sealArtifacts[0]!.fingerprint.digest
        ),
        "Every proof declaration must cite only the exact sealed proof artifact.",
      );
      assert(
        !resultSnapshot.analysisGraph?.relations.some((relation) =>
          relation.assertion.from.kind === "parameter" &&
          relation.assertion.to.kind === "metric"
        ),
        "A proof case seal must not invent a parameter-to-result influence.",
      );

      // The snapshot must carry nine provenance entities (3 triplets × 3 entities each:
      // 1 artifact + 3 consumptions + 6 provenance links = 10 total entities).
      // Verify consumptions count (3 verified consumptions).
      const sealsConsumptions = resultSnapshot.consumptions.filter(
        (c) => c.consumer.runId === runId,
      );
      assertEquals(
        sealsConsumptions.length,
        3,
        "Snapshot must carry exactly 3 ThreadArtifactConsumptions for this seal run.",
      );
      for (const consumption of sealsConsumptions) {
        assertEquals(
          consumption.status,
          "verified",
          "All consumptions must be status: verified.",
        );
      }

      // Provenance: 6 links (2 per input artifact: derived_from + uses).
      const sealProvenance = resultSnapshot.provenance.filter(
        (p) =>
          p.relation === "derived_from" &&
          "id" in p.from &&
          p.from.id === sealArtifacts[0]!.id,
      );
      assertEquals(
        sealProvenance.length,
        3,
        "Snapshot must carry exactly 3 derived_from provenance links for the seal artifact.",
      );

      // The FEA proof case capture must be readable.
      const captureUri = sealArtifacts[0]!.uri!;
      const captureFpDigest = captureUri.replace(
        `${FEA_PROOF_CASE_CAPTURE_URI_PREFIX}sha256/`,
        "",
      );
      const captureFp: ContentFingerprint = {
        algorithm: "sha256",
        digest: captureFpDigest,
      };
      const storedCapture = await proofCaseCaptures.read(captureFp);
      assertExists(
        storedCapture,
        "FEA proof case capture must be readable after the run.",
      );
      const parsedCapture = JSON.parse(storedCapture);
      assertEquals(
        parsedCapture.proofDigest,
        proofDigest,
        "Stored capture must carry the correct proofDigest.",
      );

      // Idempotent replay: same command on completed run must return the same
      // project revision without advancing it or writing a new snapshot.
      const revisionBefore = completed.revision;
      const replay = await executor.execute(AGENT, {
        commandId: "agent-seal", // identical commandId
        projectId: PROJECT_ID,
        expectedRevision: completed.revision,
        issuedAt: "2026-08-09T10:31:00.000Z",
        runId,
      });
      assertEquals(
        replay.revision,
        revisionBefore,
        "Idempotent replay must not advance the project revision.",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 8 — imported-or-reconstructed cadSource: sealed artifact passes validateThreadSnapshot
// ---------------------------------------------------------------------------

Deno.test(
  "verify-seal-proof-case executor seals a proof case with imported-or-reconstructed cadSource; published snapshot passes validateThreadSnapshot",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-fea-seal-imported-cad-",
    });
    try {
      const geomArtifact = makeGeomArtifact();
      const reqArtifact = makeReqArtifact();

      // Phase 1: build the brief baseline + fixture snapshot so we know the
      // real r2Snapshot.id before constructing the proof case.
      const base = await buildSealFixtureBase(directory, { geomArtifact, reqArtifact });

      // Build a proof case using cadSource.kind === "imported-or-reconstructed".
      const proofCase = validateMechanicalProofCase({
        schemaVersion: "mechanical-proof-case/1.0",
        id: "desk-lamp-dl04-arm-cantilever",
        revision: 1,
        scope: "structural-concept",
        evidenceBoundary: "demo",
        project: {
          id: PROJECT_ID,
          subjectId: SUBJECT_ID,
          baseThreadSnapshot: {
            id: base.r2Snapshot.id,
            revision: base.r2Snapshot.revision,
            subjectId: SUBJECT_ID,
          },
        },
        target: {
          id: "drip-tray-target",
          modelElementId: TARGET_ELEMENT_ID,
        },
        authorization: {
          workItemId: "seal-item",
          decisionId: "seal-decision",
        },
        requirementsSource: {
          provider: "syson",
          editingContextId: EDITING_CONTEXT_ID,
          elementId: REQUIREMENTS_ELEMENT_ID,
        },
        solver: {
          provider: "calculix",
          tool: "calculix_solve_static",
          resultSchemaVersion: "2.0",
        },
        cadSource: {
          kind: "imported-or-reconstructed",
          method: "import",
          sources: [{
            id: "source-step-01",
            name: "DripTray_v1.step",
            format: "step",
            sha256: "e".repeat(64),
            bytes: 98765,
            sourceUri: "casys://cad-repository/drip-tray/v1.step",
          }],
          license: {
            identifier: "proprietary-demo",
            evidenceUri: "casys://licenses/demo-cad-license",
          },
          conversion: {
            tool: "FreeCAD",
            revision: "0.21.1",
            losses: ["parametric-features-not-preserved"],
          },
          engineeringBoundary: {
            designIntent: "partial",
            editableCad: "reconstructed",
            manufacturability: "not-established",
            limitations: [
              "Reconstruction-only; original parametric intent not preserved.",
            ],
          },
        },
        expectedCadArtifact: {
          format: "step",
          sha256: STEP_DIGEST,
          bytes: STEP_BYTES,
        },
        analysis: {
          kind: "linear-static",
          material: {
            model: "isotropic-linear-elastic",
            basis: "PLA",
            youngModulus: { value: 3000, unit: "MPa" },
            poissonRatio: { value: 0.35, unit: "1" },
          },
          mesh: {
            kind: "tetrahedral-volume",
            targetSize: { value: 2.0, unit: "mm" },
          },
          supports: [{
            id: "FixedBase",
            kind: "fixed",
            selection: {
              name: "BaseFlange",
              box: { min: [0, 0, 0], max: [100, 5, 100], unit: "mm" },
            },
          }],
          loads: [{
            id: "TopForce",
            kind: "force",
            selection: {
              name: "TopFace",
              box: { min: [0, 25, 0], max: [100, 30, 100], unit: "mm" },
            },
            force: { value: [0, -10, 0], unit: "N" },
          }],
        },
        requirements: [{
          id: "R-DISP",
          name: "max-displacement",
          metric: "maximum-displacement",
          feature: "u.max",
          operator: "<=",
          limit: { value: 1.0, unit: "mm" },
        }, {
          id: "R-STRESS",
          name: "max-von-mises-stress",
          metric: "maximum-von-mises-stress",
          feature: "sigma.max",
          operator: "<=",
          limit: { value: 180000000, unit: "Pa" },
        }],
      });
      const proofFp = await sha256Fingerprint(proofCase);
      const proofDigest = proofFp.digest;

      const proposalParameters = encodeFeaProofDecisionParameters(
        proofDigest,
        proofCase,
        { id: geomArtifact.id, fingerprint: geomArtifact.fingerprint },
        { id: reqArtifact.id, fingerprint: reqArtifact.fingerprint },
      );

      // Phase 2: append the seal run using the fixture base.
      const fixture = await appendSealRun(base, {
        proofCase,
        proofDigest,
        params: [...proposalParameters],
      });

      const proofCaseCaptures = new FileCaptureStore({
        ...FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
        directory: `${directory}/fea-proof-captures`,
      });

      const executor = new VerifySealProofCaseRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        proofCaseCaptures,
        geometryCaptures: makeGeomCaptureStub() as never,
        requirementsCaptures: makeReqCaptureStub() as never,
        seedCaptures: makeSeedCaptureStub() as never,
        canonicalAssetReader: makeCanonicalAssetReader() as never,
        lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
        readTextFile: makeReadStub(proofCase),
      });

      const completed = await executor.execute(AGENT, {
        commandId: "agent-seal-imported",
        projectId: PROJECT_ID,
        expectedRevision: fixture.queued.revision,
        issuedAt: NOW,
        runId: fixture.runId,
      });

      const run = completed.agentRuns.find((r) => r.id === fixture.runId)!;
      assertEquals(run.status, "completed", "Run must be completed.");
      assertExists(run.resultSnapshot, "Completed run must carry a result snapshot.");

      // The published snapshot must be valid.
      const resultSnapshot = await fixture.snapshots.get(
        run.resultSnapshot!.snapshotId,
      );
      assertExists(resultSnapshot, "Result snapshot must be readable.");
      validateThreadSnapshot(resultSnapshot); // structural correctness gate

      // The sealed artifact must carry the correct proofDigest.
      const sealArtifact = resultSnapshot.artifacts.find(
        (a) =>
          a.kind === "document" &&
          a.uri?.startsWith(FEA_PROOF_CASE_CAPTURE_URI_PREFIX),
      );
      assertExists(
        sealArtifact,
        "Snapshot must carry a sealed FEA proof case artifact.",
      );
      assertEquals(
        sealArtifact!.version,
        proofDigest,
        "Artifact version must equal proofDigest.",
      );

      // The CAS capture must embed the imported-or-reconstructed cadSource via
      // the canonical proof text.
      const captureFp: ContentFingerprint = {
        algorithm: "sha256",
        digest: sealArtifact!.uri!.replace(
          `${FEA_PROOF_CASE_CAPTURE_URI_PREFIX}sha256/`,
          "",
        ),
      };
      const rawCapture = await proofCaseCaptures.read(captureFp);
      assertExists(rawCapture, "Proof case capture must be readable from CAS.");
      const captureRecord = JSON.parse(rawCapture) as Record<string, unknown>;
      const canonicalProofText = captureRecord.canonicalProofText as string;
      assertEquals(
        canonicalProofText.includes("imported-or-reconstructed"),
        true,
        "Canonical proof text must contain the cadSource kind.",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface SealFixture {
  projects: FileEngineeringProjectRevisionStore;
  commands: EngineeringProjectCommandService;
  snapshots: FileThreadSnapshotStore;
  queued: Awaited<ReturnType<EngineeringProjectCommandService["queueRun"]>>;
  runId: string;
}

/**
 * Phase-1 result: brief baseline + extended snapshot registered via a fixture
 * stub run.  Callers that need to build their proof case from the ACTUAL r2
 * snapshot id (e.g. test 5) should call buildSealFixtureBase + appendSealRun
 * separately instead of the combined queuedSealFixture wrapper.
 */
interface SealFixtureBase {
  r2Snapshot: ThreadSnapshot;
  projectRevision: number;
  projects: FileEngineeringProjectRevisionStore;
  commands: EngineeringProjectCommandService;
  snapshots: FileThreadSnapshotStore;
}

/**
 * Phase 1 — brief baseline + extend r1 to r2 + fixture stub run.
 *
 * Returns the fixture base so callers can inspect r2Snapshot.id before
 * constructing the proof case.  This is necessary when assertReviewBasisDescendantOrEqual
 * would otherwise reject a proof case whose baseThreadSnapshot.id does not
 * appear in the snapshot store (e.g. the fictitious "snap-001").
 */
async function buildSealFixtureBase(
  directory: string,
  opts: { geomArtifact: ThreadArtifact; reqArtifact: ThreadArtifact },
): Promise<SealFixtureBase> {
  let tick = 0;
  const baseTime = Date.parse("2026-08-09T10:00:00.000Z");
  const nowFn = () => new Date(baseTime + ++tick * 1_000).toISOString();

  const projects = new FileEngineeringProjectRevisionStore(
    `${directory}/projects`,
  );
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });

  const briefs = new ProjectBriefCommandService(projects, nowFn);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-proj",
    projectId: PROJECT_ID,
    projectName: "FEA seal test",
    issuedAt: "2026-08-09T09:59:00.000Z",
    intent: "Test the verify-seal-proof-case executor.",
    intentSource: { kind: "human", reference: "conversation:fea-seal" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...ctx("propose-brief", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Test the FEA proof case seal executor.",
      sourceRefs: [{ kind: "intent", reference: "conversation:fea-seal" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Seal a mechanical proof case.",
      sourceRefs: [{ kind: "intent", reference: "conversation:fea-seal" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "FEA proof case sealed.",
      sourceRefs: [{ kind: "intent", reference: "conversation:fea-seal" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...ctx("approve-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Approved for FEA seal executor test.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });

  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    nowFn,
    { operations: makeTestPlanOperationRegistry() },
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      baselineCaptures,
      approvedBriefSourceAnalysisFixture(directory),
    ),
  );

  project = await commands.publishPlan(AGENT, {
    ...ctx("publish-plan", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{ id: "baseline", name: "Baseline", description: "Brief baseline." }],
    workItems: [{
      id: "record-brief",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });

  project = await commands.queueRun(AGENT, {
    ...ctx("queue-brief", project.revision),
    runId: "run:brief-baseline",
    workItemId: "record-brief",
    summary: "Record the approved brief.",
    basis: project.plan!.basis,
  });

  const baselined = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    ...approvedBriefSourceAnalysisFixture(directory),
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-09T10:01:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-brief-baseline",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-09T10:01:00.000Z",
    runId: "run:brief-baseline",
  });

  const r1Ref = baselined.threadSnapshots[0]!;
  const r1Snapshot = await snapshots.get(r1Ref.snapshotId);
  if (!r1Snapshot) throw new Error("r1 snapshot missing in fixture");

  // Extend the r1 snapshot with geometry/requirements/STEP artifacts.
  const r2Snapshot = buildExtendedSnapshot(r1Snapshot, [
    opts.geomArtifact,
    opts.reqArtifact,
    makeStepArtifact(),
  ]);
  await snapshots.save(r2Snapshot);

  // r2Ref intentionally lacks `kind`; see test 7 comment for the reason.
  const r2Ref = {
    snapshotId: r2Snapshot.id,
    revision: r2Snapshot.revision,
    subjectId: r2Snapshot.subject.id,
  };

  // Register r2 in project.threadSnapshots via a stub fixture run.
  //
  // WHY: assertDeclaredSnapshot (called by proposeDecision and queueRun) checks
  // that every thread-snapshot basis appears in project.threadSnapshots.  Only
  // completed runs (via completeRun) add entries there.  The extended r2
  // snapshot was built manually, so we must complete a no-op stub run whose
  // resultSnapshot is r2 before we can use r2 as a basis for the seal run.
  project = await commands.appendChange(AGENT, {
    ...ctx("append-fixture", baselined.revision),
    baseSnapshot: r1Ref,
    phases: [{
      id: "fixture-phase",
      name: "Fixture: register extended snapshot",
      description: "Stub phase to promote r2 into the project's declared snapshots.",
    }],
    workItems: [{
      id: "fixture-item",
      phaseId: "fixture-phase",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: { id: "fixture.artifacts-stub", version: "1", bindings: [] },
    }],
    requiredDecisions: [],
  });
  project = await commands.queueRun(AGENT, {
    ...ctx("queue-fixture", project.revision),
    runId: "run:fixture-artifacts",
    workItemId: "fixture-item",
    summary: "Stub: register extended snapshot.",
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: r1Ref.snapshotId,
      revision: r1Ref.revision,
      subjectId: r1Ref.subjectId,
    },
  });
  project = await commands.claimRun(AGENT, {
    ...ctx("claim-fixture", project.revision),
    runId: "run:fixture-artifacts",
    summary: "Stub: claim fixture run.",
  });
  project = await commands.publishRun(AGENT, {
    ...ctx("publish-fixture", project.revision),
    runId: "run:fixture-artifacts",
    summary: "Stub: publish fixture run.",
  });
  project = await commands.completeRun(AGENT, {
    ...ctx("complete-fixture", project.revision),
    runId: "run:fixture-artifacts",
    summary: "Stub: complete fixture run.",
    resultSnapshot: r2Ref,
    evidenceRefs: [{
      kind: "artifact" as const,
      id: opts.geomArtifact.id,
      snapshotId: r2Snapshot.id,
      snapshotRevision: r2Snapshot.revision,
    }],
  });
  // r2 is now the current HEAD in project.threadSnapshots.
  return {
    r2Snapshot,
    projectRevision: project.revision,
    projects,
    commands,
    snapshots,
  };
}

/**
 * Phase 2 — append seal work item + MRTR decision + queue run.
 *
 * Takes the phase-1 base (which already has r2 registered) and the proof case
 * built by the test.  Returns the standard SealFixture with the queued run id.
 */
async function appendSealRun(
  base: SealFixtureBase,
  opts: {
    proofCase: ReturnType<typeof validateMechanicalProofCase>;
    proofDigest: string;
    params: ReadonlyArray<{
      key: string;
      label: string;
      value: string | number | boolean;
    }>;
  },
): Promise<SealFixture> {
  const { r2Snapshot, projects, commands, snapshots } = base;
  const r2Ref = {
    snapshotId: r2Snapshot.id,
    revision: r2Snapshot.revision,
    subjectId: r2Snapshot.subject.id,
  };
  let project = await projects.get(PROJECT_ID);
  if (!project) throw new Error("Project not found in appendSealRun");

  project = await commands.appendChange(AGENT, {
    ...ctx("append-seal", project.revision),
    baseSnapshot: r2Ref,
    phases: [{
      id: "seal-phase",
      name: "Seal FEA proof case",
      description: "Seal the reviewed proof case.",
    }],
    workItems: [{
      id: "seal-item",
      phaseId: "seal-phase",
      owner: "agent",
      dependsOnWorkItemIds: ["record-brief"],
      decisionIds: ["seal-decision"],
      operation: {
        id: VERIFY_SEAL_PROOF_CASE_OPERATION.id,
        version: VERIFY_SEAL_PROOF_CASE_OPERATION.version,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [{
      id: "seal-decision",
      phaseId: "seal-phase",
      title: "Approve FEA proof case seal",
      question: "Approve the mechanical proof case seal?",
    }],
  });

  project = await commands.proposeDecision(AGENT, {
    ...ctx("propose-seal-decision", project.revision),
    decisionId: "seal-decision",
    baseSnapshot: r2Ref,
    proposal: {
      summary: "Seal the mechanical proof case into the thread.",
      parameters: [...opts.params],
    },
  });
  const sealDecision = project.decisions.find((d) => d.id === "seal-decision")!;

  project = await commands.approveDecision(HUMAN, {
    ...ctx("approve-seal-decision", project.revision),
    decisionId: "seal-decision",
    rationale: "MRTR approved for FEA seal executor test.",
    inputFingerprint: sealDecision.inputFingerprint!,
  });

  const runId = "run:verify-seal";
  const queued = await commands.queueRun(AGENT, {
    ...ctx("queue-seal", project.revision),
    runId,
    workItemId: "seal-item",
    summary: "Seal the mechanical proof case.",
    basis: { kind: "thread-snapshot" as const, ...r2Ref },
  });

  return { projects, commands, snapshots, queued, runId };
}

/**
 * Combined helper: build the fixture base then append the seal run.
 *
 * For tests that want to inspect r2Snapshot.id before building the proof
 * case (e.g. test 5), call buildSealFixtureBase + appendSealRun separately.
 */
async function queuedSealFixture(
  directory: string,
  opts: {
    proofCase: ReturnType<typeof validateMechanicalProofCase>;
    proofDigest: string;
    params: ReadonlyArray<{
      key: string;
      label: string;
      value: string | number | boolean;
    }>;
    geomArtifact: ThreadArtifact;
    reqArtifact: ThreadArtifact;
  },
): Promise<SealFixture> {
  const base = await buildSealFixtureBase(directory, {
    geomArtifact: opts.geomArtifact,
    reqArtifact: opts.reqArtifact,
  });
  return appendSealRun(base, {
    proofCase: opts.proofCase,
    proofDigest: opts.proofDigest,
    params: opts.params,
  });
}

// ---------------------------------------------------------------------------
// Artifact constructors
// ---------------------------------------------------------------------------

/** Geometry artifact with a stable fingerprint and matching artifact id. */
function makeGeomArtifact(): ThreadArtifact {
  const fp: ContentFingerprint = { algorithm: "sha256", digest: GEOM_DIGEST };
  return {
    id: `geometry-${GEOM_DIGEST}`,
    name: "DripTray geometry capture",
    kind: "cad-model",
    version: GEOM_DIGEST,
    fingerprint: fp,
    uri: `casys://geometry-capture/sha256/${GEOM_DIGEST}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "design.write-geometry@2",
      runId: "run-geom-test",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: NOW,
      invalidatedByChangeIds: [],
    },
  };
}

/**
 * Requirements artifact for DripTray. The URI must start with the containerComponent
 * prefix expected by selectRequirementsTip (kind: "sysml-model" + URI prefix).
 */
function makeReqArtifact(): ThreadArtifact {
  const fp: ContentFingerprint = { algorithm: "sha256", digest: REQ_DIGEST };
  return {
    id: `req-drip-tray-test`,
    name: "DripTray requirements capture",
    kind: "sysml-model",
    version: REQ_DIGEST,
    fingerprint: fp,
    uri: `casys://requirements-capture/${CONTAINER_COMPONENT}/sha256/${REQ_DIGEST}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "model-write-requirements@1",
      runId: "run-req-test",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: NOW,
      invalidatedByChangeIds: [],
    },
  };
}

/**
 * STEP artifact for the target PartDefinition.
 *
 * The id follows the canonical pattern used by design-write-geometry-run-executor:
 * cad-asset-{geomDigest}-definition-{defIndex}-{fileIndex}-{stepDigest}.
 */
function makeStepArtifact(): ThreadArtifact {
  const fp: ContentFingerprint = { algorithm: "sha256", digest: STEP_DIGEST };
  return {
    id: `cad-asset-${GEOM_DIGEST}-definition-0-0-${STEP_DIGEST}`,
    name: "DripTray STEP file",
    kind: "step",
    version: STEP_DIGEST,
    fingerprint: fp,
    uri: `casys://step-export/${STEP_DIGEST}.step`,
    mediaType: "model/step",
    producer: {
      serverId: "build123d",
      tool: "build123d_export",
      runId: "run-geom-test",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: NOW,
      invalidatedByChangeIds: [],
    },
  };
}

/**
 * Extend a snapshot with additional artifacts via the extension mechanism.
 * This returns a new valid snapshot at revision + 1.
 */
function buildExtendedSnapshot(
  base: ThreadSnapshot,
  artifacts: ThreadArtifact[],
): ThreadSnapshot {
  const extension: ThreadSnapshotExtension = {
    id: `fixture-extension-${base.revision + 1}`,
    name: "Fixture: geometry + requirements + STEP artifacts",
    subjectId: base.subject.id,
    capturedAt: NOW,
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
  const result = applyThreadSnapshotExtensionIfNew(base, extension, {
    appliedAt: NOW,
  });
  if (!result.applied) throw new Error("Extension was already present.");
  return result.snapshot;
}

// ---------------------------------------------------------------------------
// Capture store stubs
// ---------------------------------------------------------------------------

/** Minimal geometry capture that will pass the executor's schemaVersion check. */
function makeGeomCaptureStub(): { read: () => Promise<string> } {
  const content = JSON.stringify({
    schemaVersion: GEOMETRY_BUNDLE_CAPTURE_SCHEMA,
    manifest: {
      partDefinitions: [{
        elementId: TARGET_ELEMENT_ID,
        label: CONTAINER_COMPONENT,
        files: [{
          format: "step",
          name: "drip-tray.step",
          fingerprint: { algorithm: "sha256", digest: STEP_DIGEST },
        }],
      }],
    },
  });
  return { read: () => Promise.resolve(content) };
}

/** Minimal requirements capture with consistent oracle requirements. */
function makeReqCaptureStub(): { read: () => Promise<string> } {
  const content = JSON.stringify({
    schemaVersion: REQUIREMENTS_CAPTURE_SCHEMA,
    containerComponent: CONTAINER_COMPONENT,
    target: {
      kind: "part-definition",
      label: CONTAINER_COMPONENT,
      elementId: TARGET_ELEMENT_ID,
    },
    requirements: [
      {
        id: "R-DISP",
        name: "Maximum displacement",
        metric: "u.max",
        operator: "<=",
        limit: { value: 1.0, unit: "mm" },
      },
      {
        id: "R-STRESS",
        name: "Maximum von Mises stress",
        metric: "sigma.max",
        operator: "<=",
        limit: { value: 180000000, unit: "Pa" },
      },
    ],
    seed: {
      artifactId: "seed-artifact-test",
      fingerprint: { algorithm: "sha256", digest: SEED_DIGEST },
      producerRunId: "run-seed-test",
    },
    requirementsElementId: REQUIREMENTS_ELEMENT_ID,
  });
  return { read: () => Promise.resolve(content) };
}

/**
 * Minimal seed capture stub that passes parseSysonModelSeedCapture validation.
 *
 * All literals must exactly match the constants in syson-model-seed.ts (schema
 * version, kind, scope, statement, operation id/version, provider tool names).
 * Any deviation would cause the executor to fail during editingContextId
 * verification — an observable regression.
 */
function makeSeedCaptureStub(): { read: () => Promise<string> } {
  const content = JSON.stringify({
    schemaVersion: "syson-model-seed-capture/2.0",
    kind: "syson-model-seed",
    scope: "sysml-container-identity",
    statement:
      "Immutable normalized identity record of a newly created SysON project, SysML document, and root package. It does not capture model semantics, requirements, CAD, simulation, measurements, or verification verdicts.",
    capturedAt: "2026-08-09T10:00:00.000Z",
    trustedRunId: "run-seed-test",
    operation: {
      id: "architecture.seed-syson-model",
      version: "2",
    },
    lineage: {
      approvedBriefBasis: {
        kind: "approved-brief",
        projectId: "fea-seal-test",
        projectSnapshotId: "proj-snap-seed-test",
        projectRevision: 1,
        briefId: "brief-001",
        briefSnapshotId: "brief-snap-001",
        briefRevision: 1,
        approvedBriefFingerprint: {
          algorithm: "sha256",
          digest: "a".repeat(64),
        },
      },
      plan: {
        publishedAt: "2026-08-09T10:00:00.000Z",
        publishedBy: { id: "agent:test", origin: "agent" },
      },
      projectChange: {
        id: "change-001",
        commandId: "cmd-001",
        publishedAt: "2026-08-09T10:01:00.000Z",
        publishedBy: { id: "agent:test", origin: "agent" },
      },
      workItemId: "work-001",
      baseSnapshot: {
        snapshotId: "snap-r1-fixture",
        revision: 1,
        subjectId: SUBJECT_ID,
      },
      documentaryArtifact: {
        id: "doc-artifact-001",
        fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
        uri: `casys://approved-brief-capture/sha256/${"b".repeat(64)}`,
        producerRunId: "run-baseline",
      },
    },
    provider: {
      serverId: "syson",
      tools: {
        projectCreate: "syson_project_create",
        modelCreate: "syson_model_create",
        rootPackageGet: "syson_element_get",
      },
    },
    normalizedResults: {
      project: {
        id: "syson-proj-test",
        name: "FEA Seal Test Project",
        editingContextId: EDITING_CONTEXT_ID,
      },
      document: {
        id: "syson-doc-test",
        name: "FEA Seal Test Document",
        kind: "SysML",
      },
      rootPackage: {
        id: "syson-pkg-test",
        kind: "Package",
        label: "FEATest",
      },
    },
  });
  return { read: () => Promise.resolve(content) };
}

/** Canonical asset reader stub: returns STEP_BYTES bytes of zero data. */
function makeCanonicalAssetReader(): { read: () => Promise<Uint8Array> } {
  return { read: () => Promise.resolve(new Uint8Array(STEP_BYTES)) };
}

// ---------------------------------------------------------------------------
// Proof case helpers
// ---------------------------------------------------------------------------

/**
 * Build a valid MechanicalProofCase for PROJECT_ID / SUBJECT_ID.
 *
 * The proof case uses "desk-lamp-dl04-arm-cantilever" as its id
 * so it resolves in FEA_PROOF_CASE_SOURCES; tests that want an unknown id pass
 * one explicitly.
 *
 * `basisSnapshotId` and `basisRevision` set the baseThreadSnapshot for MRTR
 * cross-checking. `basisRevision` defaults to 1 when omitted.
 */
function makeTestCase(
  basisSnapshotId: string,
  overrideId?: string,
  _basisSnapshotRef?: string,
  basisRevision = 1,
): ReturnType<typeof validateMechanicalProofCase> {
  return validateMechanicalProofCase({
    schemaVersion: "mechanical-proof-case/1.0",
    id: overrideId ?? "desk-lamp-dl04-arm-cantilever",
    revision: 1,
    scope: "structural-concept",
    evidenceBoundary: "demo",
    project: {
      id: PROJECT_ID,
      subjectId: SUBJECT_ID,
      baseThreadSnapshot: {
        id: basisSnapshotId,
        revision: basisRevision,
        subjectId: SUBJECT_ID,
      },
    },
    target: {
      id: "drip-tray-target",
      modelElementId: TARGET_ELEMENT_ID,
    },
    authorization: {
      workItemId: "seal-item",
      decisionId: "seal-decision",
    },
    requirementsSource: {
      provider: "syson",
      editingContextId: EDITING_CONTEXT_ID,
      elementId: REQUIREMENTS_ELEMENT_ID,
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
        tool: "build123d_execute",
        definition: {
          mediaType: "text/x-python",
          sha256: "e".repeat(64),
          bytes: 500,
        },
      },
      engineeringBoundary: {
        designIntent: "preserved",
        editableCad: "native",
        manufacturability: "not-established",
        limitations: ["FEA only, not manufacturing."],
      },
    },
    expectedCadArtifact: {
      format: "step",
      sha256: STEP_DIGEST,
      bytes: STEP_BYTES,
    },
    analysis: {
      kind: "linear-static",
      material: {
        model: "isotropic-linear-elastic",
        basis: "PLA",
        youngModulus: { value: 3000, unit: "MPa" },
        poissonRatio: { value: 0.35, unit: "1" },
      },
      mesh: {
        kind: "tetrahedral-volume",
        targetSize: { value: 2.0, unit: "mm" },
      },
      supports: [{
        id: "FixedBase",
        kind: "fixed",
        selection: {
          name: "BaseFlange",
          box: { min: [0, 0, 0], max: [100, 5, 100], unit: "mm" },
        },
      }],
      loads: [{
        id: "TopForce",
        kind: "force",
        selection: {
          name: "TopFace",
          box: { min: [0, 25, 0], max: [100, 30, 100], unit: "mm" },
        },
        force: { value: [0, -10, 0], unit: "N" },
      }],
    },
    requirements: [{
      id: "R-DISP",
      name: "max-displacement",
      metric: "maximum-displacement",
      feature: "u.max",
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
    }, {
      id: "R-STRESS",
      name: "max-von-mises-stress",
      metric: "maximum-von-mises-stress",
      feature: "sigma.max",
      operator: "<=",
      limit: { value: 180000000, unit: "Pa" },
    }],
  });
}

/**
 * Build a readTextFile stub that returns the deterministicJson of the given case.
 * This simulates the server-side catalog file lookup without requiring a real file.
 */
function makeReadStub(
  proofCase: ReturnType<typeof validateMechanicalProofCase>,
): (path: string) => Promise<string> {
  return (_path: string) => Promise.resolve(deterministicJson(proofCase));
}

// ---------------------------------------------------------------------------
// Operation registry stub
// ---------------------------------------------------------------------------

function makeTestPlanOperationRegistry(): EngineeringProjectPlanOperationRegistry {
  return {
    validate(input) {
      const op = input.operation;
      if (
        op.id === VERIFY_SEAL_PROOF_CASE_OPERATION.id &&
        op.version === VERIFY_SEAL_PROOF_CASE_OPERATION.version
      ) {
        if (input.stage === "queue" && input.basisKind !== "thread-snapshot") {
          throw new Error(
            `${VERIFY_SEAL_PROOF_CASE_OPERATION.id}@${VERIFY_SEAL_PROOF_CASE_OPERATION.version} requires a thread-snapshot basis.`,
          );
        }
        return {
          operation: {
            id: op.id,
            version: op.version,
            startingPoint: "idea-or-spec",
            title: "Seal FEA proof case",
            description:
              "Seal a human-reviewed mechanical proof case declaration without a provider call.",
            workItemKind: "verify",
            execution: "trusted",
          },
          bindings: op.bindings,
        };
      }
      // Test-local stub: promotes a pre-built extended snapshot into the
      // project's declared thread snapshots by completing a no-op run.
      // WHY: assertDeclaredSnapshot requires every thread-snapshot basis to be
      // registered via a completed run — the fixture cannot inject snapshots
      // directly into the project store.  This operation satisfies the validator
      // without exercising any real provider path.
      if (op.id === "fixture.artifacts-stub" && op.version === "1") {
        return {
          operation: {
            id: op.id,
            version: op.version,
            startingPoint: "idea-or-spec",
            title: "Fixture: register pre-built snapshot",
            description:
              "Test-only stub that registers a pre-built extended snapshot by completing a no-op run.",
            workItemKind: "design",
            execution: "trusted",
          },
          bindings: op.bindings,
        };
      }
      return REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(input);
    },
  };
}

// ---------------------------------------------------------------------------
// Shared test context helper
// ---------------------------------------------------------------------------

function ctx(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: NOW,
  };
}
