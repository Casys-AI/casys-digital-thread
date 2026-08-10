/**
 * Tests for the CM-01 archive-lineage executor.
 *
 * Coverage:
 *  - Human-origin rejection (no I/O touched)
 *  - Non-canonical operation rejection (wrong id/version or missing binding)
 *  - Missing target (invalid_input before snapshot write)
 *  - Happy path: retires one artifact and its cascade; publishes a valid snapshot
 *  - Fail-closed: a fully already-retired cascade is refused, never duplicated
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "../../../domain/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../../domain/project/project-brief-command-service.ts";
import { archivedRefKeys } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../../orchestration/operations/registry.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../../captures/file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../../stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../../stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../../stores/file-thread-snapshot-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../../validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../../validators/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "../approved-brief-baseline-run-executor.ts";
import {
  CoffeeMachineCm01V3ArchiveLineageRunExecutor,
} from "./coffee-machine-cm01-v3-archive-lineage-run-executor.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };
const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };

// ---------------------------------------------------------------------------
// Human rejection — no I/O touched
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 archive-lineage executor rejects a human before any store access",
  async () => {
    const executor = new CoffeeMachineCm01V3ArchiveLineageRunExecutor({
      projects: {
        get: () => Promise.reject(new Error("must not read")),
      } as never,
      commands: {} as never,
      snapshots: {} as never,
      lease: {} as never,
    });
    await assertRejects(
      () =>
        executor.execute(HUMAN, {
          commandId: "human-cmd",
          projectId: "coffee-machine-cm01-v3",
          expectedRevision: 1,
          issuedAt: "2026-08-08T10:00:00.000Z",
          runId: "run:archive-lineage",
        }),
      EngineeringProjectCommandError,
      "Only an authenticated agent",
    );
  },
);

// ---------------------------------------------------------------------------
// Non-canonical operation — no provider call
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 archive-lineage executor rejects a wrong operation before any snapshot access",
  async () => {
    let snapshotCalled = false;
    const executor = new CoffeeMachineCm01V3ArchiveLineageRunExecutor({
      projects: {
        get: () =>
          Promise.resolve({
            schemaVersion: "3.0",
            project: {
              id: "coffee-machine-cm01-v3",
              subjectId: "project:coffee-machine-cm01-v3",
            },
            agentRuns: [{
              id: "run:archive-lineage",
              workItemId: "archive-item",
              basis: { kind: "thread-snapshot" },
            }],
            workItems: [{
              id: "archive-item",
              // Wrong operation id.
              operation: {
                id: "wrong.operation",
                version: "1",
                bindings: [
                  { name: "approvedBrief", source: { kind: "approved-brief" } },
                  {
                    name: "archiveTarget",
                    source: {
                      kind: "thread-entity",
                      reference: {
                        snapshotId: "s1",
                        snapshotRevision: 1,
                        kind: "artifact",
                        id: "art-1",
                      },
                    },
                  },
                ],
              },
            }],
          } as never),
      } as never,
      commands: {} as never,
      snapshots: {
        get: () => {
          snapshotCalled = true;
          return Promise.reject(new Error("must not access snapshot store"));
        },
      } as never,
      lease: {} as never,
    });
    await assertRejects(
      () =>
        executor.execute(AGENT, {
          commandId: "agent-cmd",
          projectId: "coffee-machine-cm01-v3",
          expectedRevision: 1,
          issuedAt: "2026-08-08T10:00:00.000Z",
          runId: "run:archive-lineage",
        }),
      EngineeringProjectCommandError,
      "canonical CM-01 V3 archive-lineage",
    );
    assertEquals(snapshotCalled, false);
  },
);

Deno.test(
  "CM-01 archive-lineage executor rejects an approved non-archive MRTR proposal",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-archive-mrtr-" });
    try {
      const fixture = await queuedArchiveLineage(
        directory,
        undefined,
        [{
          key: "retirementScope",
          label: "Retirement scope",
          value: "exact-bound-lineage",
        }],
      );
      const executor = new CoffeeMachineCm01V3ArchiveLineageRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        lease: new FileEngineeringProjectRunLease(`${directory}/archive-leases`),
        now: () => "2026-08-08T10:30:00.000Z",
      });
      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-archive-mrtr",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-08T10:30:00.000Z",
            runId: fixture.runId,
          }),
        EngineeringProjectCommandError,
        "exact target entity references",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Integration — happy path + idempotent replay
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 archive-lineage executor retires one artifact and its cascade; publishes a valid snapshot",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-archive-lineage-happy-",
    });
    try {
      const fixture = await queuedArchiveLineage(directory);

      const executor = new CoffeeMachineCm01V3ArchiveLineageRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        lease: new FileEngineeringProjectRunLease(`${directory}/archive-leases`),
        now: () => "2026-08-08T10:30:00.000Z",
      });

      const completed = await executor.execute(AGENT, {
        commandId: "agent-archive-cmd",
        projectId: "coffee-machine-cm01-v3",
        expectedRevision: fixture.queued.revision,
        issuedAt: "2026-08-08T10:30:00.000Z",
        runId: fixture.runId,
      });

      const run = completed.agentRuns.at(-1)!;
      assertEquals(run.status, "completed");
      assertExists(run.resultSnapshot);

      // The result snapshot must be valid and carry the "archived" change.
      const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
      assertExists(snapshot, "Result snapshot must be readable.");
      validateThreadSnapshot(snapshot);

      const retired = archivedRefKeys(snapshot);
      assertEquals(
        retired.has(`artifact:${fixture.briefArtifactId}`),
        true,
        "The target artifact must be recorded as archived.",
      );

      // Idempotent replay: same command, same result, no new snapshot.
      const revisionBefore = completed.revision;
      const replay = await executor.execute(AGENT, {
        commandId: "agent-archive-cmd",
        projectId: "coffee-machine-cm01-v3",
        expectedRevision: completed.revision,
        issuedAt: "2026-08-08T10:31:00.000Z",
        runId: fixture.runId,
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
// Fail-closed — target already retired in basis snapshot is refused
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 archive-lineage executor refuses a second run whose whole cascade is already retired",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-archive-idem-" });
    try {
      // Build the project state and queue the first archive run.
      const fixture = await queuedArchiveLineage(directory);

      const executor = new CoffeeMachineCm01V3ArchiveLineageRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        lease: new FileEngineeringProjectRunLease(`${directory}/archive-leases`),
        now: () => "2026-08-08T10:30:00.000Z",
      });

      // First execution retires the target and registers the result snapshot.
      const first = await executor.execute(AGENT, {
        commandId: "agent-archive-first",
        projectId: "coffee-machine-cm01-v3",
        expectedRevision: fixture.queued.revision,
        issuedAt: "2026-08-08T10:30:00.000Z",
        runId: fixture.runId,
      });
      const firstRun = first.agentRuns.at(-1)!;
      assertEquals(firstRun.status, "completed");
      assertExists(firstRun.resultSnapshot);

      // The result snapshot is now in project.threadSnapshots.
      const resultRef = firstRun.resultSnapshot!;

      // Queue a second archive run targeting the same artifact. The basis for
      // this run is the result snapshot, which already has the artifact archived.
      let project = await fixture.projects.get("coffee-machine-cm01-v3");
      assertExists(project);

      project = await fixture.commands.appendChange(AGENT, {
        ...ctx("append-archive-idem", first.revision),
        baseSnapshot: resultRef,
        phases: [{
          id: "archive-idem-phase",
          name: "Archive lineage (idempotence)",
          description: "Target already retired — must complete without new snapshot.",
        }],
        workItems: [{
          id: "archive-idem-work-item",
          phaseId: "archive-idem-phase",
          owner: "agent",
          dependsOnWorkItemIds: [],
          decisionIds: ["archive-idem-decision"],
          operation: {
            ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.archiveLineage,
            bindings: [
              { name: "approvedBrief", source: { kind: "approved-brief" } },
              {
                name: "archiveTarget",
                source: {
                  kind: "thread-entity",
                  reference: {
                    snapshotId: resultRef.snapshotId,
                    snapshotRevision: resultRef.revision,
                    kind: "artifact" as const,
                    id: fixture.briefArtifactId,
                  },
                },
              },
            ],
          },
        }],
        requiredDecisions: [{
          id: "archive-idem-decision",
          phaseId: "archive-idem-phase",
          title: "Retire already archived lineage",
          question: "Approve review of the exact already-retired lineage?",
        }],
      });

      project = await fixture.commands.proposeDecision(AGENT, {
        ...ctx("propose-archive-idem-decision", project.revision),
        decisionId: "archive-idem-decision",
        baseSnapshot: resultRef,
        proposal: {
          summary: "Review the exact already-retired lineage.",
          parameters: archiveProposalParameters(1),
        },
      });
      const idemDecision = project.decisions.find((item) =>
        item.id === "archive-idem-decision"
      )!;
      project = await fixture.commands.approveDecision(HUMAN, {
        ...ctx("approve-archive-idem-decision", project.revision),
        decisionId: idemDecision.id,
        rationale: "MRTR approved after reviewing exact targets.",
        inputFingerprint: idemDecision.inputFingerprint!,
      });

      const idemRunId = "run:archive-lineage-idem";
      const queued2 = await fixture.commands.queueRun(AGENT, {
        ...ctx("queue-archive-idem", project.revision),
        runId: idemRunId,
        workItemId: "archive-idem-work-item",
        summary: "Retire already-retired target (idempotence test).",
        basis: { kind: "thread-snapshot" as const, ...resultRef },
      });

      // Second execution — the target is already in archivedRefKeys(basis).
      const executor2 = new CoffeeMachineCm01V3ArchiveLineageRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        lease: new FileEngineeringProjectRunLease(`${directory}/archive-leases-2`),
        now: () => "2026-08-08T10:35:00.000Z",
      });
      // FAIL-CLOSED (operator decision 2026-08-08): a second run whose whole
      // closure is already archived records nothing new — it must REFUSE
      // instead of minting duplicate archived changes. The record states a
      // fact exactly once.
      await assertRejects(
        () =>
          executor2.execute(AGENT, {
            commandId: "agent-archive-idem",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: queued2.revision,
            issuedAt: "2026-08-08T10:35:00.000Z",
            runId: idemRunId,
          }),
        EngineeringProjectCommandError,
        "already archived",
      );

      // The refusal never touched the record: the target stays archived
      // exactly once, in the FIRST run's result snapshot.
      const firstSnapshot = await fixture.snapshots.get(resultRef.snapshotId);
      assertExists(firstSnapshot);
      const archivedEntries = firstSnapshot.changeSet.changes.filter(
        (change) =>
          change.kind === "archived" &&
          change.target.id === fixture.briefArtifactId,
      );
      assertEquals(
        archivedEntries.length,
        1,
        "The archived fact must be recorded exactly once, never duplicated.",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Missing target — invalid_input before any snapshot write
// ---------------------------------------------------------------------------

Deno.test(
  "CM-01 archive-lineage executor fails with invalid_input when the target does not exist in the basis",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-archive-missing-" });
    try {
      // Use a non-existent artifact id as the target.
      const fixture = await queuedArchiveLineage(directory, "nonexistent-art");

      const executor = new CoffeeMachineCm01V3ArchiveLineageRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        lease: new FileEngineeringProjectRunLease(
          `${directory}/archive-leases-missing`,
        ),
        now: () => "2026-08-08T10:30:00.000Z",
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-archive-missing",
            projectId: "coffee-machine-cm01-v3",
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-08T10:30:00.000Z",
            runId: fixture.runId,
          }),
        EngineeringProjectCommandError,
        "does not exist",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface ArchiveLineageFixture {
  projects: FileEngineeringProjectRevisionStore;
  commands: EngineeringProjectCommandService;
  snapshots: FileThreadSnapshotStore;
  queued: Awaited<ReturnType<EngineeringProjectCommandService["queueRun"]>>;
  runId: string;
  basisRef: {
    kind: "thread-snapshot";
    snapshotId: string;
    revision: number;
    subjectId: string;
  };
  /** The actual ID of the brief artifact produced by the baseline run. */
  briefArtifactId: string;
}

/**
 * Build the project state through a brief baseline run, then queue an
 * archive-lineage run targeting the given artifact id.
 *
 * The thread-entity binding and run basis both reference the BASELINE snapshot
 * (r1Ref), which is already registered in project.threadSnapshots. This
 * satisfies the engineering-project validator without requiring an out-of-band
 * snapshot registration.
 *
 * The artifact identified by `targetArtifactId` must exist in the baseline
 * snapshot for cascade tests. Pass `undefined` to use the brief artifact
 * produced by the baseline run (guaranteed to exist). For missing-target
 * tests, pass an id that does not exist in the baseline.
 */
async function queuedArchiveLineage(
  directory: string,
  targetArtifactId?: string,
  proposalParameters = archiveProposalParameters(1),
): Promise<ArchiveLineageFixture> {
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });

  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-08T10:00:00.000Z") + ++tick * 1_000).toISOString();

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-cm01-archive",
    projectId: "coffee-machine-cm01-v3",
    projectName: "CM-01 coffee machine",
    issuedAt: "2026-08-08T09:59:00.000Z",
    intent: "Create a reviewable CM-01 engineering record.",
    intentSource: { kind: "human", reference: "conversation:cm01" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...ctx("propose-brief-archive", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Create a reviewable CM-01 coffee-machine engineering record.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Represent the reviewed CM-01 machine boundaries.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Capture a traceable SysON architecture read-back.",
      sourceRefs: [{ kind: "intent", reference: "conversation:cm01" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...ctx("approve-brief-archive", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The bounded CM-01 record is clear.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });

  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(snapshots, baselineCaptures),
  );

  project = await commands.publishPlan(AGENT, {
    ...ctx("publish-plan-archive", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Baseline",
      description: "Record approved brief.",
    }],
    workItems: [{
      id: "record-brief-archive",
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
    ...ctx("queue-brief-archive", project.revision),
    runId: "run:brief-baseline-archive",
    workItemId: "record-brief-archive",
    summary: "Record the approved CM-01 brief.",
    basis: project.plan!.basis,
  });

  const baselined = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-08T10:01:00.000Z",
  }).execute(AGENT, {
    commandId: "agent-brief-baseline-archive",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: project.revision,
    issuedAt: "2026-08-08T10:01:00.000Z",
    runId: "run:brief-baseline-archive",
  });

  // Use the baseline snapshot ref directly. It is already declared in
  // project.threadSnapshots, satisfying the engineering-project validator for
  // both the thread-entity binding reference and the run basis.
  const r1Ref = baselined.threadSnapshots[0]!;
  const basisRef = { kind: "thread-snapshot" as const, ...r1Ref };

  // Read the baseline snapshot to find the brief artifact id. The id is
  // content-addressed (sha256 digest), so it is not known at call time.
  const r1 = await snapshots.get(r1Ref.snapshotId);
  assertExists(r1, "Brief baseline snapshot must exist.");
  const briefArtifactId = r1.artifacts[0]!.id;

  // Use the supplied override, or the brief artifact for normal cascade tests.
  const resolvedTargetId = targetArtifactId ?? briefArtifactId;

  // Register the archive-lineage phase and work item.
  project = await commands.appendChange(AGENT, {
    ...ctx("append-archive", baselined.revision),
    baseSnapshot: r1Ref,
    phases: [{
      id: "archive-phase",
      name: "Archive lineage",
      description: "Retire the target artifact.",
    }],
    workItems: [{
      id: "archive-work-item",
      phaseId: "archive-phase",
      owner: "agent",
      dependsOnWorkItemIds: ["record-brief-archive"],
      decisionIds: ["archive-decision"],
      operation: {
        ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.archiveLineage,
        bindings: [
          { name: "approvedBrief", source: { kind: "approved-brief" } },
          {
            name: "archiveTarget",
            source: {
              kind: "thread-entity",
              reference: {
                snapshotId: r1Ref.snapshotId,
                snapshotRevision: r1Ref.revision,
                kind: "artifact" as const,
                id: resolvedTargetId,
              },
            },
          },
        ],
      },
    }],
    requiredDecisions: [{
      id: "archive-decision",
      phaseId: "archive-phase",
      title: "Retire archived lineage",
      question:
        "Approve the irreversible current-state retirement of this exact lineage?",
    }],
  });

  project = await commands.proposeDecision(AGENT, {
    ...ctx("propose-archive-decision", project.revision),
    decisionId: "archive-decision",
    baseSnapshot: r1Ref,
    proposal: {
      summary: "Retire the exact bound thread entities.",
      parameters: proposalParameters,
    },
  });
  const archiveDecision = project.decisions.find((item) =>
    item.id === "archive-decision"
  )!;
  assertEquals(archiveDecision.inputEvidenceRefs, [{
    snapshotId: r1Ref.snapshotId,
    snapshotRevision: r1Ref.revision,
    kind: "artifact",
    id: resolvedTargetId,
  }]);
  project = await commands.approveDecision(HUMAN, {
    ...ctx("approve-archive-decision", project.revision),
    decisionId: archiveDecision.id,
    rationale: "MRTR approved after reviewing exact targets.",
    inputFingerprint: archiveDecision.inputFingerprint!,
  });
  assertEquals(
    project.approvals.find((item) => item.decisionId === "archive-decision")
      ?.inputEvidenceRefs,
    archiveDecision.inputEvidenceRefs,
  );

  const runId = "run:archive-lineage";
  const queued = await commands.queueRun(AGENT, {
    ...ctx("queue-archive", project.revision),
    runId,
    workItemId: "archive-work-item",
    summary: "Retire the target artifact and its cascade.",
    basis: basisRef,
  });

  return { projects, commands, snapshots, queued, runId, basisRef, briefArtifactId };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ctx(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: "coffee-machine-cm01-v3",
    expectedRevision,
    issuedAt: "2026-08-08T10:00:00.000Z",
  };
}

function archiveProposalParameters(targetCount: number) {
  return [
    { key: "archiveAction", label: "Archive action", value: "retire-lineage" },
    {
      key: "archiveOperation",
      label: "Archive operation",
      value:
        `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.archiveLineage.id}@${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.archiveLineage.version}`,
    },
    { key: "archiveTargetCount", label: "Archive target count", value: targetCount },
  ];
}
