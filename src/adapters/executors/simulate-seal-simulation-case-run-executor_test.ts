/**
 * Tests for simulate-seal-simulation-case-run-executor.
 *
 * WHY A FICTITIOUS NON-CM01 PROJECT — the executor is generic; "cm01-seal-test"
 * proves that no project.id hardcoding leaks from the CM-01 path.
 *
 * WHY STUB readTextFile — the server-side catalog points to
 * config/simulation-cases/… which does not yet exist on disk.  Tests supply
 * an in-memory function instead of a real file so the test suite can run on any
 * checkout without a matching fixture on disk.
 *
 * WHY A STUB OPERATION REGISTRY — simulate.seal-simulation-case@1 is not yet
 * in the main registry (modifying registry.ts is out of scope).  The stub
 * accepts it as trusted + thread-snapshot basis and delegates every other
 * operation to the real registry.  This preserves the planning validation path
 * without silencing the constraint.
 *
 * Coverage:
 *  - Human-origin rejection (no I/O touched)
 *  - MRTR absent: run with no approved decision → invalid_transition
 *  - Catalog absent: case ID not in SIMULATION_CASE_SOURCES → invalid_input
 *  - Digest divergent: MRTR caseDigest differs from computed digest → invalid_input
 *  - Recroisement divergent: MRTR field cross-check fails → invalid_input
 *  - Project/subject guard: case.project.id != command.projectId → invalid_input
 *  - Happy path: sealed artifact in snapshot; validateThreadSnapshot passes; idempotent
 *    replay returns the same project revision without writing a new snapshot
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  canonicalSimulationCaseText,
  validateSimulationCase,
} from "../../domain/analysis/simulation-case.ts";
import {
  encodeSimulationCaseDecisionParameters,
  SIMULATE_SEAL_SIMULATION_CASE_OPERATION,
} from "../../domain/analysis/simulation-case-proposal.ts";
import type {
  EngineeringProjectCommandOrigin,
  EngineeringProjectPlanOperationRegistry,
} from "../../domain/project/engineering-project-command-service.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "../../domain/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../domain/project/project-brief-command-service.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../captures/file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../stores/file-thread-snapshot-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../validators/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "./approved-brief-baseline-run-executor.ts";
import {
  SimulateSealSimulationCaseRunExecutor,
  SIMULATION_CASE_CAPTURE_DESCRIPTOR,
} from "./simulate-seal-simulation-case-run-executor.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT: EngineeringProjectCommandOrigin = {
  kind: "agent",
  actorId: "agent:engineering",
};
const HUMAN: EngineeringProjectCommandOrigin = {
  kind: "human",
  actorId: "human:reviewer",
};

/** Fictitious non-CM01 project id — proves no project.id hardcoding leaks. */
const PROJECT_ID = "cm01-seal-test";
const SUBJECT_ID = `project:${PROJECT_ID}`;

// ---------------------------------------------------------------------------
// Test 1: Human-origin rejection — no I/O touched
// ---------------------------------------------------------------------------

Deno.test(
  "simulate-seal executor rejects a human origin before any store access",
  async () => {
    const executor = new SimulateSealSimulationCaseRunExecutor({
      projects: {
        get: () => Promise.reject(new Error("must not read")),
      } as never,
      commands: {} as never,
      snapshots: {} as never,
      simulationCaseCaptures: {} as never,
      lease: {} as never,
    });
    await assertRejects(
      () =>
        executor.execute(HUMAN, {
          commandId: "human-cmd",
          projectId: PROJECT_ID,
          expectedRevision: 1,
          issuedAt: "2026-08-09T10:00:00.000Z",
          runId: "run:seal",
        }),
      EngineeringProjectCommandError,
      "Only an authenticated agent",
    );
  },
);

// ---------------------------------------------------------------------------
// Test 2: MRTR absent — run has no approved decision
// ---------------------------------------------------------------------------

Deno.test(
  "simulate-seal executor rejects a run bound to no approved simulation-case MRTR decision",
  async () => {
    const executor = new SimulateSealSimulationCaseRunExecutor({
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
              phaseId: "sim-phase",
              title: "Seal simulation case",
              description: "Seal the approved case.",
              kind: "simulate",
              status: "in-progress",
              owner: "agent",
              dependsOnWorkItemIds: [],
              evidenceRefs: [],
              decisionIds: [],
              blockerIds: [],
              operation: {
                id: SIMULATE_SEAL_SIMULATION_CASE_OPERATION.id,
                version: SIMULATE_SEAL_SIMULATION_CASE_OPERATION.version,
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
      simulationCaseCaptures: {} as never,
      lease: {} as never,
    });
    await assertRejects(
      () =>
        executor.execute(AGENT, {
          commandId: "agent-no-mrtr",
          projectId: PROJECT_ID,
          expectedRevision: 1,
          issuedAt: "2026-08-09T10:00:00.000Z",
          runId: "run:seal",
        }),
      EngineeringProjectCommandError,
      "simulation-case MRTR decision",
    );
  },
);

// ---------------------------------------------------------------------------
// Test 3: Catalog absent — case ID not in SIMULATION_CASE_SOURCES
// ---------------------------------------------------------------------------

Deno.test(
  "simulate-seal executor rejects when the case ID is absent from the server-side catalog",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-seal-catalog-absent-",
    });
    try {
      // Build a case whose ID is NOT in SIMULATION_CASE_SOURCES.
      const unknownId = "unknown-case-not-in-catalog";
      const unknownCase = validateSimulationCase({
        schemaVersion: "simulation-case/1.0",
        id: unknownId,
        revision: 1,
        scope: "test",
        evidenceBoundary: "demo",
        project: {
          id: PROJECT_ID,
          subjectId: SUBJECT_ID,
          baseThreadSnapshot: {
            id: "snap-001",
            revision: 1,
            subjectId: SUBJECT_ID,
          },
        },
        kit: {
          modelId: "test-model",
          modelVersion: "1.0.0",
          modelSha256: "a".repeat(64),
        },
        scenario: { id: "test-scenario", sha256: "b".repeat(64) },
        parameters: [],
        expectedMetrics: [{ id: "T_max", unit: "K" }],
        parameterMode: "explicit-overrides",
        timeoutMs: 60000,
      });
      const caseFp = await sha256Fingerprint(unknownCase);
      const caseDigest = caseFp.digest;

      const fixture = await queuedSealFixture(directory, {
        caseDigest,
        simulationCase: unknownCase,
        readTextFile: () =>
          Promise.reject(new Error("must not reach readTextFile for unknown case")),
      });

      const executor = new SimulateSealSimulationCaseRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        simulationCaseCaptures: fixture.simulationCaseCaptures,
        lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
        readTextFile: () =>
          Promise.reject(new Error("must not reach readTextFile for unknown case")),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-catalog-absent",
            projectId: PROJECT_ID,
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-09T10:30:00.000Z",
            runId: fixture.runId,
          }),
        EngineeringProjectCommandError,
        "server-side catalog",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 4: Digest divergent — MRTR caseDigest differs from computed digest
// ---------------------------------------------------------------------------

Deno.test(
  "simulate-seal executor rejects when the MRTR caseDigest diverges from the computed case digest",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-seal-digest-divergent-",
    });
    try {
      const realCase = makeTestCase("snap-001");
      // Use a wrong digest in the MRTR — the proposal is valid per grammar but
      // will not match what the executor computes from the loaded case.
      const wrongDigest = "f".repeat(64);

      const fixture = await queuedSealFixture(directory, {
        caseDigest: wrongDigest,
        simulationCase: realCase,
        readTextFile: makeReadStub(realCase),
      });

      const executor = new SimulateSealSimulationCaseRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        simulationCaseCaptures: fixture.simulationCaseCaptures,
        lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
        readTextFile: makeReadStub(realCase),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-digest-divergent",
            projectId: PROJECT_ID,
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-09T10:30:00.000Z",
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
// Test 5: Recroisement divergent — MRTR field cross-check fails
// ---------------------------------------------------------------------------

Deno.test(
  "simulate-seal executor rejects when the MRTR scenario.sha256 diverges from the live simulation case",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-seal-mismatch-",
    });
    try {
      const realCase = makeTestCase("snap-001");
      const realCaseFp = await sha256Fingerprint(realCase);
      const realDigest = realCaseFp.digest;

      // Encode params normally, then replace scenario.sha256 with a wrong value.
      const correctParams = encodeSimulationCaseDecisionParameters(
        realDigest,
        realCase,
      );
      const tamperedParams = correctParams.map((p) =>
        p.key === "sim.case.scenario.sha256" ? { ...p, value: "c".repeat(64) } : p
      );

      // The tampered proposal carries a different digest too because the wrong
      // scenario hash was signed, but we must keep caseDigest correct so the
      // catalog + file path logic passes and reaches verifySimulationCaseParametersMatchCase.
      // NOTE: the MRTR caseDigest stays correct so the digest guard passes;
      // only the scenario.sha256 field mismatches the live case.
      const fixture = await queuedSealFixture(directory, {
        caseDigest: realDigest,
        simulationCase: realCase,
        readTextFile: makeReadStub(realCase),
        overrideProposalParameters: tamperedParams,
      });

      const executor = new SimulateSealSimulationCaseRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        simulationCaseCaptures: fixture.simulationCaseCaptures,
        lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
        readTextFile: makeReadStub(realCase),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-mismatch",
            projectId: PROJECT_ID,
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-09T10:30:00.000Z",
            runId: fixture.runId,
          }),
        EngineeringProjectCommandError,
        "MRTR parameters diverge",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 6: Project/subject guard — case.project.id != command.projectId
// ---------------------------------------------------------------------------

Deno.test(
  "simulate-seal executor rejects when the case project.id differs from the command project",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-seal-project-guard-",
    });
    try {
      // Build a case that names a different project.
      const wrongProjectId = "other-project";
      const wrongSubjectId = `project:${wrongProjectId}`;
      const wrongCase = validateSimulationCase({
        schemaVersion: "simulation-case/1.0",
        id: "coffee-machine-cm01-thermal-nominal-v1",
        revision: 1,
        scope: "thermal-nominal",
        evidenceBoundary: "demo",
        project: {
          id: wrongProjectId,
          subjectId: wrongSubjectId,
          baseThreadSnapshot: {
            id: "snap-001",
            revision: 1,
            subjectId: wrongSubjectId,
          },
        },
        kit: {
          modelId: "cm01-thermal-model",
          modelVersion: "1.0.0",
          modelSha256: "a".repeat(64),
        },
        scenario: { id: "nominal-heatup", sha256: "b".repeat(64) },
        parameters: [],
        expectedMetrics: [{ id: "T_max", unit: "K" }],
        parameterMode: "explicit-overrides",
        timeoutMs: 60000,
      });
      const wrongCaseFp = await sha256Fingerprint(wrongCase);
      const wrongDigest = wrongCaseFp.digest;

      const fixture = await queuedSealFixture(directory, {
        caseDigest: wrongDigest,
        simulationCase: wrongCase,
        readTextFile: makeReadStub(wrongCase),
      });

      const executor = new SimulateSealSimulationCaseRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        simulationCaseCaptures: fixture.simulationCaseCaptures,
        lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
        readTextFile: makeReadStub(wrongCase),
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-project-guard",
            projectId: PROJECT_ID,
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-09T10:30:00.000Z",
            runId: fixture.runId,
          }),
        EngineeringProjectCommandError,
        "project.id",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 7: Happy path + snapshot validation + idempotent replay
// ---------------------------------------------------------------------------

Deno.test(
  "simulate-seal executor seals a simulation case; published snapshot passes validateThreadSnapshot; idempotent replay returns the same project revision",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-seal-happy-" });
    try {
      let tick = 0;
      const baseTime = Date.parse("2026-08-09T10:00:00.000Z");
      const nowFn = () => new Date(baseTime + ++tick * 1_000).toISOString();

      // Build the baseline fixture first to get the real r1 snapshot ID.
      const projects = new FileEngineeringProjectRevisionStore(
        `${directory}/projects`,
      );
      const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
      const baselineCaptures = new FileCaptureStore({
        ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
        directory: `${directory}/baseline-captures`,
      });
      const simulationCaseCaptures = new FileCaptureStore({
        ...SIMULATION_CASE_CAPTURE_DESCRIPTOR,
        directory: `${directory}/simulation-case-captures`,
      });

      const briefs = new ProjectBriefCommandService(projects, nowFn);
      let project = await briefs.startProject(AGENT, {
        commandId: "start-seal-test",
        projectId: PROJECT_ID,
        projectName: "CM-01 seal test",
        issuedAt: "2026-08-09T09:59:00.000Z",
        intent: "Test the simulation-case seal executor.",
        intentSource: { kind: "human", reference: "conversation:seal-test" },
      });
      project = await briefs.proposeBrief(AGENT, {
        ...ctx("propose-brief", project.revision),
        items: [{
          id: "objective",
          kind: "objective",
          statement: "Validate the simulate-seal executor in isolation.",
          sourceRefs: [{ kind: "intent", reference: "conversation:seal-test" }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement: "Run the thermal nominal simulation case.",
          sourceRefs: [{ kind: "intent", reference: "conversation:seal-test" }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement: "Simulation case sealed into the thread.",
          sourceRefs: [{ kind: "intent", reference: "conversation:seal-test" }],
          dependsOnItemIds: [],
        }],
      });
      project = await briefs.approveBrief(HUMAN, {
        ...ctx("approve-brief", project.revision),
        briefSnapshotId: project.framing!.proposedBrief!.id,
        briefRevision: project.framing!.proposedBrief!.revision,
        rationale: "Brief is clear for the seal executor test.",
        inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
      });

      const commands = new EngineeringProjectCommandService(
        projects,
        new ExactThreadCompletionEvidenceValidator(snapshots),
        nowFn,
        { operations: makeTestPlanOperationRegistry() },
        new ExactInitialBaselineEvidenceValidator(snapshots, baselineCaptures),
      );

      project = await commands.publishPlan(AGENT, {
        ...ctx("publish-plan", project.revision),
        startingPoint: "idea-or-spec",
        phases: [{
          id: "baseline",
          name: "Baseline",
          description: "Record the approved brief.",
        }],
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
        snapshots,
        lease: new FileEngineeringProjectRunLease(
          `${directory}/baseline-leases`,
        ),
        now: () => "2026-08-09T10:01:00.000Z",
      }).execute(AGENT, {
        commandId: "agent-brief-baseline",
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: "2026-08-09T10:01:00.000Z",
        runId: "run:brief-baseline",
      });

      const r1Ref = baselined.threadSnapshots[0]!;
      const basisRef = { kind: "thread-snapshot" as const, ...r1Ref };

      // Build the simulation case with the real r1 snapshot as reviewBasis.
      const simulationCase = validateSimulationCase({
        schemaVersion: "simulation-case/1.0",
        id: "coffee-machine-cm01-thermal-nominal-v1",
        revision: 1,
        scope: "thermal-nominal",
        evidenceBoundary: "demo",
        project: {
          id: PROJECT_ID,
          subjectId: SUBJECT_ID,
          baseThreadSnapshot: {
            id: r1Ref.snapshotId,
            revision: r1Ref.revision,
            subjectId: r1Ref.subjectId,
          },
        },
        kit: {
          modelId: "cm01-thermal-model",
          modelVersion: "1.0.0",
          modelSha256: "a".repeat(64),
        },
        scenario: { id: "nominal-heatup", sha256: "b".repeat(64) },
        parameters: [],
        expectedMetrics: [{ id: "T_max", unit: "K" }],
        parameterMode: "explicit-overrides",
        timeoutMs: 60000,
      });
      const caseFp = await sha256Fingerprint(simulationCase);
      const caseDigest = caseFp.digest;
      const proposalParameters = encodeSimulationCaseDecisionParameters(
        caseDigest,
        simulationCase,
      );

      // Register the seal work item and queue the run.
      project = await commands.appendChange(AGENT, {
        ...ctx("append-seal", baselined.revision),
        baseSnapshot: r1Ref,
        phases: [{
          id: "seal-phase",
          name: "Seal simulation case",
          description: "Seal the approved thermal-nominal case.",
        }],
        workItems: [{
          id: "seal-item",
          phaseId: "seal-phase",
          owner: "agent",
          dependsOnWorkItemIds: ["record-brief"],
          decisionIds: ["seal-decision"],
          operation: {
            id: SIMULATE_SEAL_SIMULATION_CASE_OPERATION.id,
            version: SIMULATE_SEAL_SIMULATION_CASE_OPERATION.version,
            bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
          },
        }],
        requiredDecisions: [{
          id: "seal-decision",
          phaseId: "seal-phase",
          title: "Approve simulation case seal",
          question: "Approve the seal of the thermal-nominal simulation case?",
        }],
      });

      project = await commands.proposeDecision(AGENT, {
        ...ctx("propose-seal-decision", project.revision),
        decisionId: "seal-decision",
        baseSnapshot: r1Ref,
        proposal: {
          summary: "Seal the coffee-machine-cm01-thermal-nominal-v1 simulation case.",
          parameters: [...proposalParameters],
        },
      });
      const sealDecision = project.decisions.find((d) => d.id === "seal-decision")!;
      assertExists(sealDecision.inputFingerprint, "Decision must have a fingerprint.");

      project = await commands.approveDecision(HUMAN, {
        ...ctx("approve-seal-decision", project.revision),
        decisionId: "seal-decision",
        rationale: "MRTR approved: seal the exact thermal-nominal simulation case.",
        inputFingerprint: sealDecision.inputFingerprint!,
      });

      const runId = "run:simulate-seal";
      project = await commands.queueRun(AGENT, {
        ...ctx("queue-seal", project.revision),
        runId,
        workItemId: "seal-item",
        summary: "Seal coffee-machine-cm01-thermal-nominal-v1 into the thread.",
        basis: basisRef,
      });

      const readTextFile = makeReadStub(simulationCase);
      const executor = new SimulateSealSimulationCaseRunExecutor({
        projects,
        commands,
        snapshots,
        simulationCaseCaptures,
        lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
        readTextFile,
        now: nowFn,
      });

      const completed = await executor.execute(AGENT, {
        commandId: "agent-seal",
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: "2026-08-09T10:30:00.000Z",
        runId,
      });

      // Run must be completed with a result snapshot.
      const run = completed.agentRuns.find((r) => r.id === runId)!;
      assertEquals(run.status, "completed", "Run must be completed.");
      assertExists(
        run.resultSnapshot,
        "Completed run must carry a result snapshot ref.",
      );

      // The published snapshot must be both readable and valid.
      const resultSnapshot = await snapshots.get(run.resultSnapshot!.snapshotId);
      assertExists(resultSnapshot, "Result snapshot must be readable after CAS save.");
      validateThreadSnapshot(resultSnapshot); // Throws if invalid — proves structural correctness.

      // The snapshot must carry exactly one simulation-case artifact.
      const sealArtifacts = resultSnapshot.artifacts.filter(
        (a) =>
          a.kind === "document" &&
          a.uri?.startsWith("casys://simulation-case-capture/"),
      );
      assertEquals(
        sealArtifacts.length,
        1,
        "Snapshot must carry exactly one sealed simulation-case artifact.",
      );
      assertEquals(
        sealArtifacts[0]!.version,
        caseDigest,
        "Artifact version must equal the caseDigest (cliquet key).",
      );

      // The capture must be readable and byte-stable (CAS integrity).
      const captureUri = sealArtifacts[0]!.uri!;
      const captureFp = {
        algorithm: "sha256" as const,
        digest: captureUri.replace("casys://simulation-case-capture/sha256/", ""),
      };
      const storedCapture = await simulationCaseCaptures.read(captureFp);
      assertExists(
        storedCapture,
        "Simulation-case capture must be readable after the run.",
      );
      const parsedCapture = JSON.parse(storedCapture);
      assertEquals(
        parsedCapture.caseDigest,
        caseDigest,
        "Stored capture must carry the correct caseDigest.",
      );
      assertEquals(
        parsedCapture.canonicalCaseText,
        canonicalSimulationCaseText(simulationCase),
        "Stored capture must carry the canonical case text.",
      );

      // Idempotent replay: same command on a completed run must return the same
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
// Fixture helpers
// ---------------------------------------------------------------------------

interface SealFixture {
  projects: FileEngineeringProjectRevisionStore;
  commands: EngineeringProjectCommandService;
  snapshots: FileThreadSnapshotStore;
  simulationCaseCaptures: FileCaptureStore<"simulation-case">;
  queued: Awaited<ReturnType<EngineeringProjectCommandService["queueRun"]>>;
  runId: string;
}

/**
 * Build the fixture project through a brief baseline run, then queue a
 * simulate-seal run. Accepts a custom readTextFile so callers can control
 * what the catalog path resolves to.
 *
 * `overrideProposalParameters` replaces the auto-encoded MRTR parameters; use
 * it to inject a tampered field for the cross-check divergence test.
 */
async function queuedSealFixture(
  directory: string,
  opts: {
    caseDigest: string;
    simulationCase: Awaited<ReturnType<typeof validateSimulationCase>>;
    readTextFile: (path: string) => Promise<string>;
    overrideProposalParameters?: ReadonlyArray<{
      key: string;
      label: string;
      value: string | number | boolean;
    }>;
  },
): Promise<SealFixture> {
  const projects = new FileEngineeringProjectRevisionStore(
    `${directory}/projects`,
  );
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });
  const simulationCaseCaptures = new FileCaptureStore({
    ...SIMULATION_CASE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/simulation-case-captures`,
  });

  let tick = 0;
  const baseTime = Date.parse("2026-08-09T10:00:00.000Z");
  const nowFn = () => new Date(baseTime + ++tick * 1_000).toISOString();

  const briefs = new ProjectBriefCommandService(projects, nowFn);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-proj",
    projectId: PROJECT_ID,
    projectName: "CM-01 seal test",
    issuedAt: "2026-08-09T09:59:00.000Z",
    intent: "Test the simulate-seal executor.",
    intentSource: { kind: "human", reference: "conversation:seal" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...ctx("propose-brief", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Test the simulation-case seal executor.",
      sourceRefs: [{ kind: "intent", reference: "conversation:seal" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Seal a thermal simulation case.",
      sourceRefs: [{ kind: "intent", reference: "conversation:seal" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Simulation case sealed into the evidence thread.",
      sourceRefs: [{ kind: "intent", reference: "conversation:seal" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...ctx("approve-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Approved for seal executor test.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });

  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    nowFn,
    { operations: makeTestPlanOperationRegistry() },
    new ExactInitialBaselineEvidenceValidator(snapshots, baselineCaptures),
  );

  project = await commands.publishPlan(AGENT, {
    ...ctx("publish-plan", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Baseline",
      description: "Record approved brief.",
    }],
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
  const basisRef = { kind: "thread-snapshot" as const, ...r1Ref };

  const proposalParameters = opts.overrideProposalParameters ??
    encodeSimulationCaseDecisionParameters(opts.caseDigest, opts.simulationCase);

  project = await commands.appendChange(AGENT, {
    ...ctx("append-seal", baselined.revision),
    baseSnapshot: r1Ref,
    phases: [{
      id: "seal-phase",
      name: "Seal simulation case",
      description: "Seal the approved case.",
    }],
    workItems: [{
      id: "seal-item",
      phaseId: "seal-phase",
      owner: "agent",
      dependsOnWorkItemIds: ["record-brief"],
      decisionIds: ["seal-decision"],
      operation: {
        id: SIMULATE_SEAL_SIMULATION_CASE_OPERATION.id,
        version: SIMULATE_SEAL_SIMULATION_CASE_OPERATION.version,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [{
      id: "seal-decision",
      phaseId: "seal-phase",
      title: "Approve simulation case seal",
      question: "Approve the simulation case seal?",
    }],
  });

  project = await commands.proposeDecision(AGENT, {
    ...ctx("propose-seal-decision", project.revision),
    decisionId: "seal-decision",
    baseSnapshot: r1Ref,
    proposal: {
      summary: "Seal the approved simulation case into the thread.",
      parameters: [...proposalParameters],
    },
  });
  const sealDecision = project.decisions.find((d) => d.id === "seal-decision")!;

  project = await commands.approveDecision(HUMAN, {
    ...ctx("approve-seal-decision", project.revision),
    decisionId: "seal-decision",
    rationale: "MRTR approved for seal executor test.",
    inputFingerprint: sealDecision.inputFingerprint!,
  });

  const runId = "run:simulate-seal";
  const queued = await commands.queueRun(AGENT, {
    ...ctx("queue-seal", project.revision),
    runId,
    workItemId: "seal-item",
    summary: "Seal the simulation case.",
    basis: basisRef,
  });

  return { projects, commands, snapshots, simulationCaseCaptures, queued, runId };
}

// ---------------------------------------------------------------------------
// Test-local helpers
// ---------------------------------------------------------------------------

/**
 * Build a valid SimulationCase for PROJECT_ID / SUBJECT_ID using the given
 * snapshot ID as the reviewBasis.  This is the canonical case used by
 * tests that need a correctly shaped case without the full fixture chain.
 */
function makeTestCase(
  basisSnapshotId: string,
): ReturnType<typeof validateSimulationCase> {
  return validateSimulationCase({
    schemaVersion: "simulation-case/1.0",
    id: "coffee-machine-cm01-thermal-nominal-v1",
    revision: 1,
    scope: "thermal-nominal",
    evidenceBoundary: "demo",
    project: {
      id: PROJECT_ID,
      subjectId: SUBJECT_ID,
      baseThreadSnapshot: {
        id: basisSnapshotId,
        revision: 1,
        subjectId: SUBJECT_ID,
      },
    },
    kit: {
      modelId: "cm01-thermal-model",
      modelVersion: "1.0.0",
      modelSha256: "a".repeat(64),
    },
    scenario: { id: "nominal-heatup", sha256: "b".repeat(64) },
    parameters: [],
    expectedMetrics: [{ id: "T_max", unit: "K" }],
    parameterMode: "explicit-overrides",
    timeoutMs: 60000,
  });
}

/**
 * Build a readTextFile stub that returns the JSON of the given case when the
 * executor asks for the catalog path of "coffee-machine-cm01-thermal-nominal-v1".
 */
function makeReadStub(
  simulationCase: ReturnType<typeof validateSimulationCase>,
): (path: string) => Promise<string> {
  return (_path: string) => Promise.resolve(deterministicJson(simulationCase));
}

/**
 * Stub operation registry that accepts both the real registry's operations and
 * simulate.seal-simulation-case@1 (not yet in the main registry).
 *
 * WHY THIS EXISTS — modifying registry.ts is out of scope for Op 1.  The stub
 * proves that the executor can be integration-tested without a full registry
 * registration, while keeping planning + queueing validation alive for all other
 * operations (including baseline.from-approved-brief@1).
 */
function makeTestPlanOperationRegistry(): EngineeringProjectPlanOperationRegistry {
  return {
    validate(input) {
      const op = input.operation;
      if (
        op.id === SIMULATE_SEAL_SIMULATION_CASE_OPERATION.id &&
        op.version === SIMULATE_SEAL_SIMULATION_CASE_OPERATION.version
      ) {
        if (input.stage === "queue" && input.basisKind !== "thread-snapshot") {
          throw new Error(
            `${SIMULATE_SEAL_SIMULATION_CASE_OPERATION.id}@${SIMULATE_SEAL_SIMULATION_CASE_OPERATION.version} requires a thread-snapshot basis.`,
          );
        }
        return {
          operation: {
            id: op.id,
            version: op.version,
            startingPoint: "idea-or-spec",
            title: "Seal simulation case",
            description: "Seal a human-reviewed simulation case declaration.",
            workItemKind: "simulate",
            execution: "trusted",
          },
          bindings: op.bindings,
        };
      }
      return REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(input);
    },
  };
}

function ctx(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-09T10:00:00.000Z",
  };
}
