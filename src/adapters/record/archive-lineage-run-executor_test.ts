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
 *  - Lost save ACK: exact retry reuses one byte-identical successor
 *  - Idempotent replay: same command on a completed run returns same project revision
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  archivedRefKeys,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../validators/engineering-project-completion-evidence-validator.ts";
import { ExactInitialBaselineEvidenceValidator } from "../project/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "../project/approved-brief-baseline-run-executor.ts";
import { approvedBriefSourceAnalysisFixture } from "../../testing/approved-brief-source-analysis-fixture.ts";
import {
  ARCHIVE_LINEAGE_OPERATION,
  ArchiveLineageRunExecutor,
  type ArchiveLineageThreadSnapshotStore,
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
            schemaVersion: "4.0",
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

Deno.test(
  "archive-lineage executor rejects mutated MRTR and run fingerprints before snapshot save",
  async () => {
    const mutations: ReadonlyArray<{
      readonly label: string;
      readonly mutate: (project: DeepMutable<EngineeringProjectSnapshot>) => void;
    }> = [{
      label: "decision fingerprint",
      mutate(project) {
        const decision = requiredArchiveDecision(project);
        const approval = requiredArchiveApproval(project, decision.approvalIds[0]!);
        decision.inputFingerprint!.digest = "f".repeat(64);
        approval.inputFingerprint!.digest = "f".repeat(64);
      },
    }, {
      label: "proposal",
      mutate(project) {
        requiredArchiveDecision(project).proposal!.summary =
          "Mutated after human approval.";
      },
    }, {
      label: "approval evidence",
      mutate(project) {
        const decision = requiredArchiveDecision(project);
        const approval = requiredArchiveApproval(project, decision.approvalIds[0]!);
        approval.inputEvidenceRefs[0]!.id = "foreign-artifact";
      },
    }, {
      label: "duplicate current approval",
      mutate(project) {
        const decision = requiredArchiveDecision(project);
        const approval = requiredArchiveApproval(project, decision.approvalIds[0]!);
        const duplicate = mutableClone(approval);
        duplicate.id = "approval:archive-duplicate";
        project.approvals.push(duplicate);
        decision.approvalIds.push(duplicate.id);
      },
    }, {
      label: "duplicate approved decision",
      mutate(project) {
        const decision = requiredArchiveDecision(project);
        const approval = requiredArchiveApproval(project, decision.approvalIds[0]!);
        const duplicateDecision = mutableClone(decision);
        duplicateDecision.id = "archive-decision-duplicate";
        duplicateDecision.approvalIds = ["approval:archive-decision-duplicate"];
        const duplicateApproval = mutableClone(approval);
        duplicateApproval.id = duplicateDecision.approvalIds[0]!;
        duplicateApproval.decisionId = duplicateDecision.id;
        project.decisions.push(duplicateDecision);
        project.approvals.push(duplicateApproval);
        const workItem = project.workItems.find((item) =>
          item.id === "archive-work-item"
        )!;
        workItem.decisionIds.push(duplicateDecision.id);
      },
    }, {
      label: "run fingerprint",
      mutate(project) {
        const run = project.agentRuns.find((item) =>
          item.id === "run:archive-lineage"
        )!;
        run.inputFingerprint!.digest = "e".repeat(64);
      },
    }];

    for (const mutation of mutations) {
      const directory = await Deno.makeTempDir({
        prefix: `casys-generic-archive-mrtr-${mutation.label.replaceAll(" ", "-")}-`,
      });
      try {
        const fixture = await queuedArchiveLineage(directory);
        let snapshotSaves = 0;
        const projects = {
          async get(projectId: string) {
            const project = await fixture.projects.get(projectId);
            if (!project) return undefined;
            const mutated = mutableClone(project);
            mutation.mutate(mutated);
            return mutated;
          },
        } as never;
        const snapshots: ArchiveLineageThreadSnapshotStore = {
          get: (snapshotId) => fixture.snapshots.get(snapshotId),
          getFresh: (snapshotId) => fixture.snapshots.getFresh(snapshotId),
          latest: (subjectId) => fixture.snapshots.latest(subjectId),
          async save(snapshot) {
            snapshotSaves += 1;
            await fixture.snapshots.save(snapshot);
          },
        };
        const executor = new ArchiveLineageRunExecutor({
          projects,
          commands: fixture.commands,
          snapshots,
          lease: new FileEngineeringProjectRunLease(`${directory}/archive-leases`),
          now: () => "2026-08-09T10:30:00.000Z",
        });

        await assertRejects(
          () =>
            executor.execute(AGENT, {
              commandId: `agent-archive-mutated-${mutation.label}`,
              projectId: PROJECT_ID,
              expectedRevision: fixture.queued.revision,
              issuedAt: "2026-08-09T10:30:00.000Z",
              runId: fixture.runId,
            }),
          EngineeringProjectCommandError,
        );
        assertEquals(
          snapshotSaves,
          0,
          `${mutation.label} must be rejected before any ThreadSnapshot save.`,
        );
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
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

      const command = {
        commandId: "agent-archive-cmd",
        projectId: PROJECT_ID,
        expectedRevision: fixture.queued.revision,
        issuedAt: "2026-08-09T10:30:00.000Z",
        runId: fixture.runId,
      };
      const completed = await executor.execute(AGENT, command);

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
      const replay = await executor.execute(AGENT, command);
      assertEquals(
        replay.revision,
        revisionBefore,
        "Idempotent replay must not advance the project revision.",
      );
      await assertRejects(
        () =>
          executor.execute(AGENT, {
            ...command,
            issuedAt: "2026-08-09T10:31:00.000Z",
          }),
        EngineeringProjectCommandError,
        "already used for a different request",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "archive-lineage executor recovers a lost save ACK on one byte-identical successor",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-generic-archive-lost-ack-",
    });
    try {
      const fixture = await queuedArchiveLineage(directory);
      const saveAttempts: ThreadSnapshot[] = [];
      let loseFirstSaveAck = true;
      const snapshots: ArchiveLineageThreadSnapshotStore = {
        get: (snapshotId) => fixture.snapshots.get(snapshotId),
        latest: (subjectId) => fixture.snapshots.latest(subjectId),
        async save(snapshot) {
          saveAttempts.push(structuredClone(snapshot));
          await fixture.snapshots.save(snapshot);
          if (loseFirstSaveAck) {
            loseFirstSaveAck = false;
            throw new Error("snapshot ACK lost after durable commit");
          }
        },
        getFresh: (snapshotId) => fixture.snapshots.getFresh(snapshotId),
      };
      const executor = new ArchiveLineageRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots,
        lease: new FileEngineeringProjectRunLease(`${directory}/archive-leases`),
        now: () => "2026-08-09T10:30:00.000Z",
      });
      const command = {
        commandId: "agent-archive-lost-ack",
        projectId: PROJECT_ID,
        expectedRevision: fixture.queued.revision,
        issuedAt: "2026-08-09T10:30:00.000Z",
        runId: fixture.runId,
      };

      await assertRejects(
        () => executor.execute(AGENT, command),
        EngineeringProjectCommandError,
        "may be durable",
      );

      const afterLostAck = await fixture.projects.get(PROJECT_ID);
      assertExists(afterLostAck);
      const activeRun = afterLostAck.agentRuns.find((run) => run.id === fixture.runId);
      assertExists(activeRun);
      assertEquals(
        activeRun.status === "running" || activeRun.status === "publishing",
        true,
        "A post-save uncertainty must remain retryable, never become failed.",
      );
      assertEquals(saveAttempts.length, 1);
      const durablySaved = await fixture.snapshots.get(saveAttempts[0]!.id);
      assertExists(durablySaved, "The lost ACK follows a durable snapshot save.");
      assertEquals(deterministicJson(durablySaved), deterministicJson(saveAttempts[0]));

      await assertRejects(
        () =>
          executor.execute(AGENT, {
            ...command,
            issuedAt: "2026-08-09T10:30:01.000Z",
          }),
        EngineeringProjectCommandError,
        "already used for a different request",
      );
      const afterAlteredRetry = await fixture.projects.get(PROJECT_ID);
      assertExists(afterAlteredRetry);
      assertEquals(
        afterAlteredRetry.agentRuns.find((run) => run.id === fixture.runId)?.status,
        "running",
      );

      const completed = await executor.execute(AGENT, command);
      const completedRun = completed.agentRuns.find((run) => run.id === fixture.runId);
      assertExists(completedRun);
      assertEquals(completedRun.status, "completed");
      assertExists(completedRun.resultSnapshot);
      assertEquals(completedRun.resultSnapshot.snapshotId, saveAttempts[0]!.id);
      assertEquals(
        completed.threadSnapshots.filter((snapshot) =>
          snapshot.snapshotId === saveAttempts[0]!.id
        ).length,
        1,
        "The recovered project must attach the deterministic successor once.",
      );
      assertEquals(saveAttempts.length, 2);
      assertEquals(
        new Set(saveAttempts.map((snapshot) => snapshot.id)).size,
        1,
        "Exact retry must not mint a second successor id.",
      );
      assertEquals(
        new Set(saveAttempts.map((snapshot) => deterministicJson(snapshot))).size,
        1,
        "Every retry must submit byte-identical snapshot content.",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "archive-lineage executor recovers publish and completion ACK loss after durable commit",
  async () => {
    for (const lostAck of ["publish", "complete"] as const) {
      const directory = await Deno.makeTempDir({
        prefix: `casys-generic-archive-${lostAck}-ack-`,
      });
      try {
        const fixture = await queuedArchiveLineage(directory);
        let loseAck = true;
        let publishCalls = 0;
        let completeCalls = 0;
        const commands: Pick<
          EngineeringProjectCommandService,
          "claimRun" | "publishRun" | "completeRun" | "failRun"
        > = {
          claimRun: (origin, command) => fixture.commands.claimRun(origin, command),
          failRun: (origin, command) => fixture.commands.failRun(origin, command),
          publishRun: async (origin, command) => {
            publishCalls += 1;
            const published = await fixture.commands.publishRun(origin, command);
            if (lostAck === "publish" && loseAck) {
              loseAck = false;
              throw new Error("publish ACK lost after durable commit");
            }
            return published;
          },
          completeRun: async (origin, command) => {
            completeCalls += 1;
            const completed = await fixture.commands.completeRun(origin, command);
            if (lostAck === "complete" && loseAck) {
              loseAck = false;
              throw new Error("complete ACK lost after durable commit");
            }
            return completed;
          },
        };
        const saveAttempts: ThreadSnapshot[] = [];
        const snapshots: ArchiveLineageThreadSnapshotStore = {
          get: (snapshotId) => fixture.snapshots.get(snapshotId),
          getFresh: (snapshotId) => fixture.snapshots.getFresh(snapshotId),
          latest: (subjectId) => fixture.snapshots.latest(subjectId),
          async save(snapshot) {
            saveAttempts.push(structuredClone(snapshot));
            await fixture.snapshots.save(snapshot);
          },
        };
        const executor = new ArchiveLineageRunExecutor({
          projects: fixture.projects,
          commands,
          snapshots,
          lease: new FileEngineeringProjectRunLease(`${directory}/archive-leases`),
          now: () => "2026-08-09T10:30:00.000Z",
        });
        const command = {
          commandId: `agent-archive-${lostAck}-ack`,
          projectId: PROJECT_ID,
          expectedRevision: fixture.queued.revision,
          issuedAt: "2026-08-09T10:30:00.000Z",
          runId: fixture.runId,
        };

        let completed;
        if (lostAck === "publish") {
          await assertRejects(
            () => executor.execute(AGENT, command),
            EngineeringProjectCommandError,
            "may be durable",
          );
          const publishing = await fixture.projects.get(PROJECT_ID);
          assertExists(publishing);
          assertEquals(
            publishing.agentRuns.find((run) => run.id === fixture.runId)?.status,
            "publishing",
          );
          completed = await executor.execute(AGENT, command);
        } else {
          completed = await executor.execute(AGENT, command);
        }

        const run = completed.agentRuns.find((candidate) =>
          candidate.id === fixture.runId
        );
        assertExists(run);
        assertEquals(run.status, "completed");
        assertExists(run.resultSnapshot);
        assertEquals(
          completed.threadSnapshots.filter((reference) =>
            reference.snapshotId === run.resultSnapshot!.snapshotId
          ).length,
          1,
        );
        assertEquals(
          completed.commandReceipts?.filter((receipt) =>
            receipt.commandId ===
              `${command.commandId}:record-archive-lineage:complete`
          ).length,
          1,
          "Lost completion ACK recovery must reuse the immutable receipt.",
        );
        assertEquals(
          new Set(saveAttempts.map((snapshot) => snapshot.id)).size,
          1,
        );
        assertEquals(
          new Set(saveAttempts.map((snapshot) => deterministicJson(snapshot))).size,
          1,
        );
        assertEquals(publishCalls >= 1, true);
        assertEquals(completeCalls >= 1, true);
        if (lostAck === "complete") {
          assertEquals(
            completeCalls,
            2,
            "A lost completion ACK must be proven by exact completeRun replay.",
          );
        }
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
);

Deno.test(
  "completed archive-lineage replay rejects drift in its persisted successor",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-generic-archive-completed-drift-",
    });
    try {
      const fixture = await queuedArchiveLineage(directory);
      let driftSuccessor = false;
      const snapshots: ArchiveLineageThreadSnapshotStore = {
        get: (snapshotId) => fixture.snapshots.get(snapshotId),
        latest: (subjectId) => fixture.snapshots.latest(subjectId),
        save: (snapshot) => fixture.snapshots.save(snapshot),
        async getFresh(snapshotId) {
          const snapshot = await fixture.snapshots.getFresh(snapshotId);
          if (!snapshot || !driftSuccessor || snapshot.revision === 1) {
            return snapshot;
          }
          return {
            ...structuredClone(snapshot),
            changeSet: {
              ...structuredClone(snapshot.changeSet),
              name: "Tampered archive lineage",
            },
          };
        },
      };
      const executor = new ArchiveLineageRunExecutor({
        projects: fixture.projects,
        commands: fixture.commands,
        snapshots,
        lease: new FileEngineeringProjectRunLease(`${directory}/archive-leases`),
        now: () => "2026-08-09T10:30:00.000Z",
      });
      const command = {
        commandId: "agent-archive-completed-drift",
        projectId: PROJECT_ID,
        expectedRevision: fixture.queued.revision,
        issuedAt: "2026-08-09T10:30:00.000Z",
        runId: fixture.runId,
      };
      const completed = await executor.execute(AGENT, command);
      assertEquals(
        completed.agentRuns.find((run) => run.id === fixture.runId)?.status,
        "completed",
      );

      driftSuccessor = true;
      await assertRejects(
        () => executor.execute(AGENT, command),
        EngineeringProjectCommandError,
        "no longer equals the exact deterministic snapshot",
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

type DeepMutable<T> = T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer Item)[] ? DeepMutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
  : T;

function mutableClone<T>(value: T): DeepMutable<T> {
  return structuredClone(value) as DeepMutable<T>;
}

function requiredArchiveDecision(project: DeepMutable<EngineeringProjectSnapshot>) {
  const decision = project.decisions.find((item) => item.id === "archive-decision");
  if (!decision) throw new Error("archive decision fixture is absent");
  return decision;
}

function requiredArchiveApproval(
  project: DeepMutable<EngineeringProjectSnapshot>,
  approvalId: string,
) {
  const approval = project.approvals.find((item) => item.id === approvalId);
  if (!approval) throw new Error("archive approval fixture is absent");
  return approval;
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
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      baselineCaptures,
      approvedBriefSourceAnalysisFixture(directory),
    ),
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
    ...approvedBriefSourceAnalysisFixture(directory),
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
