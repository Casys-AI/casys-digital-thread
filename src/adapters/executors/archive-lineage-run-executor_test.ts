/**
 * Tests for the generic archive-lineage executor.
 *
 * WHY A FICTITIOUS NON-CM01 PROJECT — the generic executor must not depend on
 * coffee-machine-cm01-v3. Using "acme-widget-alpha" as the project id proves
 * that no project.id guard leaks from the CM-01 origin.
 *
 * Coverage:
 *  - Human-origin rejection (no I/O touched)
 *  - Non-canonical operation rejection (wrong id/version)
 *  - Missing MRTR decision bound to exact targets → invalid_transition
 *  - Happy path: retires one artifact and its cascade; publishes a valid snapshot
 *  - Fail-closed: a fully already-retired cascade is refused, never duplicated
 *  - CAS readback: result snapshot readable after save
 *  - Idempotent replay: same command on a completed run returns same project revision
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "../../domain/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../domain/project/project-brief-command-service.ts";
import { archivedRefKeys } from "../../domain/thread/thread-snapshot.ts";
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
  ARCHIVE_LINEAGE_OPERATION,
  ArchiveLineageRunExecutor,
} from "./archive-lineage-run-executor.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT = { kind: "agent" as const, actorId: "agent:engineering" };
const HUMAN = { kind: "human" as const, actorId: "human:reviewer" };

/** Fictitious non-CM01 project id — proves no project.id hardcoding leaks. */
const PROJECT_ID = "acme-widget-alpha";

// ---------------------------------------------------------------------------
// Human rejection — no I/O touched
// ---------------------------------------------------------------------------

Deno.test(
  "archive-lineage executor rejects a human origin before any store access",
  async () => {
    const executor = new ArchiveLineageRunExecutor({
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
          projectId: PROJECT_ID,
          expectedRevision: 1,
          issuedAt: "2026-08-09T10:00:00.000Z",
          runId: "run:archive-lineage",
        }),
      EngineeringProjectCommandError,
      "Only an authenticated agent",
    );
  },
);

// ---------------------------------------------------------------------------
// Non-canonical operation — no snapshot access
// ---------------------------------------------------------------------------

Deno.test(
  "archive-lineage executor rejects a wrong operation id before any snapshot access",
  async () => {
    let snapshotCalled = false;
    const executor = new ArchiveLineageRunExecutor({
      projects: {
        get: () =>
          Promise.resolve({
            schemaVersion: "3.0",
            project: { id: PROJECT_ID, subjectId: `project:${PROJECT_ID}` },
            agentRuns: [{
              id: "run:archive-lineage",
              workItemId: "archive-item",
              basis: { kind: "thread-snapshot" },
            }],
            workItems: [{
              id: "archive-item",
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
          projectId: PROJECT_ID,
          expectedRevision: 1,
          issuedAt: "2026-08-09T10:00:00.000Z",
          runId: "run:archive-lineage",
        }),
      EngineeringProjectCommandError,
      "record.archive-lineage@1",
    );
    assertEquals(snapshotCalled, false);
  },
);

// ---------------------------------------------------------------------------
// Missing MRTR — proposal without target-bound decision
// ---------------------------------------------------------------------------

Deno.test(
  "archive-lineage executor rejects an approved decision not bound to the exact archive targets",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-generic-archive-mrtr-",
    });
    try {
      const fixture = await queuedArchiveLineage(
        directory,
        undefined,
        // Wrong proposal: missing archiveOperation parameter.
        [{
          key: "retirementScope",
          label: "Retirement scope",
          value: "exact-bound-lineage",
        }],
      );
      const executor = new ArchiveLineageRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        lease: new FileEngineeringProjectRunLease(`${directory}/archive-leases`),
        now: () => "2026-08-09T10:30:00.000Z",
      });
      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-archive-mrtr",
            projectId: PROJECT_ID,
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-09T10:30:00.000Z",
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
// Happy path + CAS readback + idempotent replay
// ---------------------------------------------------------------------------

Deno.test(
  "archive-lineage executor retires one artifact and its cascade; publishes a valid snapshot",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-generic-archive-happy-",
    });
    try {
      const fixture = await queuedArchiveLineage(directory);

      const executor = new ArchiveLineageRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        lease: new FileEngineeringProjectRunLease(`${directory}/archive-leases`),
        now: () => "2026-08-09T10:30:00.000Z",
      });

      const completed = await executor.execute(AGENT, {
        commandId: "agent-archive-cmd",
        projectId: PROJECT_ID,
        expectedRevision: fixture.queued.revision,
        issuedAt: "2026-08-09T10:30:00.000Z",
        runId: fixture.runId,
      });

      const run = completed.agentRuns.at(-1)!;
      assertEquals(run.status, "completed");
      assertExists(run.resultSnapshot);

      // CAS readback: result snapshot must be readable and valid.
      const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
      assertExists(snapshot, "Result snapshot must be readable after CAS save.");
      validateThreadSnapshot(snapshot);

      const retired = archivedRefKeys(snapshot);
      assertEquals(
        retired.has(`artifact:${fixture.briefArtifactId}`),
        true,
        "The target artifact must be recorded as archived.",
      );

      // Idempotent replay: same command, same revision returned, no new snapshot.
      const revisionBefore = completed.revision;
      const replay = await executor.execute(AGENT, {
        commandId: "agent-archive-cmd",
        projectId: PROJECT_ID,
        expectedRevision: completed.revision,
        issuedAt: "2026-08-09T10:31:00.000Z",
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
// Fail-closed — whole cascade already retired
// ---------------------------------------------------------------------------

Deno.test(
  "archive-lineage executor refuses a second run whose whole cascade is already retired",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-generic-archive-idem-",
    });
    try {
      const fixture = await queuedArchiveLineage(directory);

      const executor = new ArchiveLineageRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        lease: new FileEngineeringProjectRunLease(`${directory}/archive-leases`),
        now: () => "2026-08-09T10:30:00.000Z",
      });

      // First execution retires the target.
      const first = await executor.execute(AGENT, {
        commandId: "agent-archive-first",
        projectId: PROJECT_ID,
        expectedRevision: fixture.queued.revision,
        issuedAt: "2026-08-09T10:30:00.000Z",
        runId: fixture.runId,
      });
      const firstRun = first.agentRuns.at(-1)!;
      assertEquals(firstRun.status, "completed");
      assertExists(firstRun.resultSnapshot);
      const resultRef = firstRun.resultSnapshot!;

      // Queue a second run targeting the same (already retired) artifact.
      let project = await fixture.projects.get(PROJECT_ID);
      assertExists(project);

      project = await fixture.commands.appendChange(AGENT, {
        ...ctx("append-archive-idem", first.revision),
        baseSnapshot: resultRef,
        phases: [{
          id: "archive-idem-phase",
          name: "Archive lineage (idempotence)",
          description: "Target already retired — must refuse without new snapshot.",
        }],
        workItems: [{
          id: "archive-idem-work-item",
          phaseId: "archive-idem-phase",
          owner: "agent",
          dependsOnWorkItemIds: [],
          decisionIds: ["archive-idem-decision"],
          operation: {
            ...ARCHIVE_LINEAGE_OPERATION,
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
          question: "Approve the review of the already-retired lineage?",
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
      const executor2 = new ArchiveLineageRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        lease: new FileEngineeringProjectRunLease(`${directory}/archive-leases-2`),
        now: () => "2026-08-09T10:35:00.000Z",
      });
      await assertRejects(
        () =>
          executor2.execute(AGENT, {
            commandId: "agent-archive-idem",
            projectId: PROJECT_ID,
            expectedRevision: queued2.revision,
            issuedAt: "2026-08-09T10:35:00.000Z",
            runId: idemRunId,
          }),
        EngineeringProjectCommandError,
        "already archived",
      );

      // The refusal never touched the record: the target stays archived
      // exactly once, in the first run's result snapshot.
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
  "archive-lineage executor fails with invalid_input when the target does not exist in the basis",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-generic-archive-missing-",
    });
    try {
      const fixture = await queuedArchiveLineage(directory, "nonexistent-art");

      const executor = new ArchiveLineageRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots: fixture.snapshots,
        lease: new FileEngineeringProjectRunLease(
          `${directory}/archive-leases-missing`,
        ),
        now: () => "2026-08-09T10:30:00.000Z",
      });

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            commandId: "agent-archive-missing",
            projectId: PROJECT_ID,
            expectedRevision: fixture.queued.revision,
            issuedAt: "2026-08-09T10:30:00.000Z",
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
 * Build the acme-widget-alpha project state through a brief baseline run, then
 * queue a generic archive-lineage run targeting the given artifact id.
 *
 * Uses `record.archive-lineage@1` (generic), never the CM-01 operation id.
 * Pass `undefined` for targetArtifactId to use the brief artifact (guaranteed
 * to exist). For missing-target tests, pass an id absent from the baseline.
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
    new Date(Date.parse("2026-08-09T10:00:00.000Z") + ++tick * 1_000).toISOString();

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start-acme-archive",
    projectId: PROJECT_ID,
    projectName: "ACME widget alpha",
    issuedAt: "2026-08-09T09:59:00.000Z",
    intent: "Create a reviewable generic engineering record.",
    intentSource: { kind: "human", reference: "conversation:acme" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...ctx("propose-brief-archive", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Create a reviewable ACME widget engineering record.",
      sourceRefs: [{ kind: "intent", reference: "conversation:acme" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Represent the reviewed ACME widget boundaries.",
      sourceRefs: [{ kind: "intent", reference: "conversation:acme" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Capture a traceable SysON architecture read-back.",
      sourceRefs: [{ kind: "intent", reference: "conversation:acme" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...ctx("approve-brief-archive", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "The bounded ACME widget record is clear.",
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
    summary: "Record the approved ACME widget brief.",
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
    commandId: "agent-brief-baseline-archive",
    projectId: PROJECT_ID,
    expectedRevision: project.revision,
    issuedAt: "2026-08-09T10:01:00.000Z",
    runId: "run:brief-baseline-archive",
  });

  const r1Ref = baselined.threadSnapshots[0]!;
  const basisRef = { kind: "thread-snapshot" as const, ...r1Ref };

  const r1 = await snapshots.get(r1Ref.snapshotId);
  assertExists(r1, "Brief baseline snapshot must exist.");
  const briefArtifactId = r1.artifacts[0]!.id;

  const resolvedTargetId = targetArtifactId ?? briefArtifactId;

  // Register the archive-lineage phase and work item with the GENERIC operation.
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
        ...ARCHIVE_LINEAGE_OPERATION,
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
  project = await commands.approveDecision(HUMAN, {
    ...ctx("approve-archive-decision", project.revision),
    decisionId: archiveDecision.id,
    rationale: "MRTR approved after reviewing exact targets.",
    inputFingerprint: archiveDecision.inputFingerprint!,
  });

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
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-09T10:00:00.000Z",
  };
}

function archiveProposalParameters(targetCount: number) {
  return [
    { key: "archiveAction", label: "Archive action", value: "retire-lineage" },
    {
      key: "archiveOperation",
      label: "Archive operation",
      value: `${ARCHIVE_LINEAGE_OPERATION.id}@${ARCHIVE_LINEAGE_OPERATION.version}`,
    },
    { key: "archiveTargetCount", label: "Archive target count", value: targetCount },
  ];
}
