import { assertEquals, assertRejects } from "@std/assert";
import {
  type EngineeringProjectFileIo,
  FileEngineeringProjectRevisionStore,
  FileEngineeringProjectStore,
} from "./engineering-project-store.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../../application/use-cases/project/project-brief-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../../orchestration/operations/registry.ts";
import { EngineeringProjectValidationError } from "../../../domain/project/engineering-project-validation.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";

Deno.test("FileEngineeringProjectStore loads a validated project manifest read-only", async () => {
  await withTempDirectory(async (directory) => {
    const fixture = projectFixture();
    const path = `${directory}/generic-project.json`;
    await Deno.writeTextFile(path, `${deterministicJson(fixture)}\n`);
    const store = new FileEngineeringProjectStore(path);

    const project = await store.get();

    assertEquals(project?.schemaVersion, "4.0");
    assertEquals(project?.project.id, "generic-project");
    assertEquals(project?.project.subjectId, "generic-subject");
    assertEquals("save" in store, false);
  });
});

Deno.test("FileEngineeringProjectStore reports an absent manifest without manufacturing a fixture", async () => {
  const store = new FileEngineeringProjectStore(
    "missing.json",
    new StubFileIo(() => {
      throw new Deno.errors.NotFound("missing");
    }),
  );

  assertEquals(await store.get(), undefined);
});

Deno.test("FileEngineeringProjectStore rejects JSON outside the project domain contract", async () => {
  const store = new FileEngineeringProjectStore(
    "invalid.json",
    new StubFileIo(() => '{"schemaVersion":"not-supported"}'),
  );

  await assertRejects(
    () => store.get(),
    Error,
    "Invalid EngineeringProjectSnapshot",
  );
});

Deno.test("FileEngineeringProjectStore does not hide malformed JSON", async () => {
  const store = new FileEngineeringProjectStore(
    "broken.json",
    new StubFileIo(() => "{"),
  );

  await assertRejects(() => store.get(), SyntaxError);
});

class StubFileIo implements EngineeringProjectFileIo {
  constructor(private readonly read: () => string) {}

  readTextFile(): Promise<string> {
    return Promise.resolve(this.read());
  }
}

Deno.test("FileEngineeringProjectRevisionStore writes deterministic immutable revisions", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    const initial = intentProjectFixture();
    await store.createInitial(initial);

    const raw = await Deno.readTextFile(
      `${directory}/${encodeURIComponent(initial.project.id)}/0000000001.json`,
    );
    assertEquals(raw, `${deterministicJson(initial)}\n`);
    assertEquals(
      (await store.contentFingerprint(initial.project.id, initial.revision))
        ?.digest.length,
      64,
    );
    assertEquals((await store.get(initial.project.id))?.id, initial.id);
  });
});

Deno.test("cross-process createNew CAS admits only one command at the same expected revision", async () => {
  await withTempDirectory(async (directory) => {
    const firstStore = new FileEngineeringProjectRevisionStore(directory);
    const secondStore = new FileEngineeringProjectRevisionStore(directory);
    const initial = await seedReviewableProject(firstStore);
    const first = commandService(firstStore, "2026-08-01T11:00:01.000Z");
    const second = commandService(secondStore, "2026-08-01T11:00:02.000Z");

    const results = await Promise.allSettled([
      first.proposeDecision(
        HUMAN,
        proposalCommand(initial, "command-a", "review-generic-input"),
      ),
      second.proposeDecision(
        HUMAN,
        proposalCommand(initial, "command-b", "review-generic-input"),
      ),
    ]);

    assertEquals(results.filter((item) => item.status === "fulfilled").length, 1);
    assertEquals(results.filter((item) => item.status === "rejected").length, 1);
    const rejection = results.find((item) =>
      item.status === "rejected"
    ) as PromiseRejectedResult;
    assertEquals(rejection.reason instanceof EngineeringProjectCommandError, true);
    assertEquals(rejection.reason.code, "stale_revision");
    const current = await firstStore.get(initial.project.id);
    assertEquals(current?.revision, initial.revision + 1);
    assertEquals(
      current?.commandReceipts?.length,
      (initial.commandReceipts?.length ?? 0) + 1,
    );
  });
});

Deno.test("same command id racing across stores is idempotent", async () => {
  await withTempDirectory(async (directory) => {
    const firstStore = new FileEngineeringProjectRevisionStore(directory);
    const secondStore = new FileEngineeringProjectRevisionStore(directory);
    const initial = await seedReviewableProject(firstStore);
    const command = proposalCommand(
      initial,
      "same-command",
      "review-generic-input",
    );
    const [left, right] = await Promise.all([
      commandService(firstStore, "2026-08-01T11:00:01.000Z").proposeDecision(
        HUMAN,
        command,
      ),
      commandService(secondStore, "2026-08-01T11:00:02.000Z").proposeDecision(
        HUMAN,
        command,
      ),
    ]);

    assertEquals(left.id, right.id);
    assertEquals(
      (await firstStore.get(initial.project.id))?.revision,
      initial.revision + 1,
    );
  });
});

Deno.test("highest claimed corrupt revision fails closed instead of falling back", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    const initial = intentProjectFixture();
    await store.createInitial(initial);
    await Deno.writeTextFile(
      `${directory}/${encodeURIComponent(initial.project.id)}/0000000002.json`,
      "{",
      { createNew: true },
    );

    await assertRejects(() => store.get(initial.project.id), SyntaxError);
  });
});

Deno.test("FileEngineeringProjectRevisionStore accepts a legal project extension", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    const current = await seedReviewableProject(store);
    const next = successorOf(current, () => {});
    const committed = await store.commit(next, current.revision);
    assertEquals(committed.revision, current.revision + 1);
    assertEquals(committed.phases[0]?.name, current.phases[0]?.name);
  });
});

Deno.test("FileEngineeringProjectRevisionStore rejects renaming an existing phase", async () => {
  await assertStoreRejectsExtension(
    (draft) => {
      draft.phases[0]!.name = "Renamed verification";
    },
    "an existing phase cannot be renamed",
  );
});

Deno.test("FileEngineeringProjectRevisionStore rejects reordering existing phases", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await store.createInitial(intentProjectFixture());
    const current = await store.commit(twoPhaseProjectFixture(), 1);
    const next = successorOf(current, (draft) => {
      const [first, second] = draft.phases;
      draft.phases = [
        { ...second!, order: 1 },
        { ...first!, order: 2 },
      ];
    });
    await assertRejects(
      () => store.commit(next, current.revision),
      EngineeringProjectValidationError,
      "existing phases must remain a prefix of the next revision",
    );
  });
});

Deno.test("FileEngineeringProjectRevisionStore rejects rewriting an existing phase description", async () => {
  await assertStoreRejectsExtension(
    (draft) => {
      draft.phases[0]!.description = "Rewritten description.";
    },
    "an existing phase description cannot be rewritten",
  );
});

Deno.test("FileEngineeringProjectRevisionStore rejects removing a phase member", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await store.createInitial(intentProjectFixture());
    const current = await store.commit(twoPhaseProjectFixture(), 1);
    const next = successorOf(current, (draft) => {
      draft.phases[1]!.workItemIds = [];
      draft.workItems = draft.workItems.filter((item) => item.id !== "close-record");
    });
    await assertRejects(
      () => store.commit(next, current.revision),
      EngineeringProjectValidationError,
      "phase work-item membership is append-only",
    );
  });
});

Deno.test(
  "FileEngineeringProjectRevisionStore rejects reclassifying an initial phase as change-created",
  async () => {
    await withTempDirectory(async (directory) => {
      const store = new FileEngineeringProjectRevisionStore(directory);
      await store.createInitial(intentProjectFixture());
      const current = await store.commit(twoPhaseProjectFixture(), 1);
      const planned = successorOf(current, (draft) => {
        draft.plan = {
          startingPoint: "idea-or-spec",
          basis: structuredClone(current.commandReceipts![1]!.approvedBriefBasis!),
          publishedAt: "2026-08-01T12:00:00.000Z",
          publishedBy: { id: "agent:planner", origin: "agent" },
        };
        const receipts = draft.commandReceipts ?? [];
        receipts[receipts.length - 1] = {
          commandId: "publish-generic-plan",
          type: "project.plan-publish",
          actor: { id: "agent:planner", origin: "agent" },
          issuedAt: "2026-08-01T12:00:00.000Z",
          appliedAt: "2026-08-01T12:00:00.000Z",
          requestFingerprint: { algorithm: "sha256", digest: "3".repeat(64) },
          resultingSnapshot: { snapshotId: draft.id, revision: draft.revision },
        };
      });
      const published = await store.commit(planned, current.revision);
      const reclassified = successorOf(published, (draft) => {
        draft.phases[0]!.workItemIds = [
          ...draft.phases[0]!.workItemIds,
          "review-geometry",
        ];
        draft.workItems.push({
          id: "review-geometry",
          activityId: "activity:review-geometry",
          phaseId: "verification",
          title: "Review the geometry",
          description: "Appended onto the existing verification phase.",
          kind: "verify",
          operation: {
            id: "verify.run-fea-static-proof",
            version: "3",
            bindings: [],
          },
          status: "planned",
          owner: "agent",
          dependsOnWorkItemIds: [],
          evidenceRefs: [],
          decisionIds: [],
          blockerIds: [],
        });
        draft.planChanges = [{
          id: "change:reclassify-verification",
          commandId: "reclassify-verification",
          approvedBriefBasis: structuredClone(draft.plan!.basis),
          baseSnapshot: structuredClone(draft.threadSnapshots[0]!),
          phaseIds: ["verification"],
          workItemIds: ["review-geometry"],
          decisionIds: [],
          publishedAt: "2026-08-01T13:00:00.000Z",
          publishedBy: { id: "agent:planner", origin: "agent" },
        }];
        const receipts = draft.commandReceipts ?? [];
        receipts[receipts.length - 1] = {
          commandId: "reclassify-verification",
          type: "project.change-append",
          actor: { id: "agent:planner", origin: "agent" },
          issuedAt: "2026-08-01T13:00:00.000Z",
          appliedAt: "2026-08-01T13:00:00.000Z",
          requestFingerprint: { algorithm: "sha256", digest: "4".repeat(64) },
          resultingSnapshot: { snapshotId: draft.id, revision: draft.revision },
        };
        draft.generatedAt = "2026-08-01T13:00:00.000Z";
      });
      await assertRejects(
        () => store.commit(reclassified, published.revision),
        EngineeringProjectValidationError,
        "an existing phase cannot be reclassified as created by a later change",
      );
    });
  },
);

Deno.test(
  "File store persists a brief-approve that changes project.objective from the canonical brief",
  async () => {
    await withTempDirectory(async (directory) => {
      const store = new FileEngineeringProjectRevisionStore(directory);
      let tick = 0;
      const now = () =>
        new Date(Date.parse("2026-08-03T09:00:00.000Z") + ++tick * 1000)
          .toISOString();
      const briefs = new ProjectBriefCommandService(store, now);
      const started = await briefs.startProject(HUMAN, {
        commandId: "start-objective-project",
        projectId: "objective-project",
        projectName: "Objective project",
        issuedAt: "2026-08-03T09:00:00.000Z",
        intent: "Build a reviewable engineering system.",
        intentSource: { kind: "human", reference: "conversation:turn-1" },
      });
      assertEquals(
        started.project.objective.statement,
        "Build a reviewable engineering system.",
      );
      const proposed = await briefs.proposeBrief(AGENT, {
        commandId: "propose-objective-brief",
        projectId: started.project.id,
        expectedRevision: started.revision,
        issuedAt: started.generatedAt,
        items: liveBriefItems("Demonstrate a reviewable system safely."),
      });
      const approved = await briefs.approveBrief(HUMAN, {
        commandId: "approve-objective-brief",
        projectId: proposed.project.id,
        expectedRevision: proposed.revision,
        issuedAt: proposed.generatedAt,
        briefSnapshotId: proposed.framing!.proposedBrief!.id,
        briefRevision: proposed.framing!.proposedBrief!.revision,
        rationale: "The objective is the reviewed canonical brief.",
        inputFingerprint: proposed.framing!.proposalReview!.inputFingerprint,
      });
      const persisted = await store.get(approved.project.id);
      assertEquals(
        persisted?.project.objective.statement,
        "Demonstrate a reviewable system safely.",
      );
      assertEquals(persisted?.framing?.currentBriefApproval?.status, "approved");
    });
  },
);

Deno.test(
  "File store allows two unexecuted plan publications and rejects replacement after a queued run",
  async () => {
    await withTempDirectory(async (directory) => {
      const store = new FileEngineeringProjectRevisionStore(directory);
      let tick = 0;
      const now = () =>
        new Date(Date.parse("2026-08-03T09:00:00.000Z") + ++tick * 1000)
          .toISOString();
      const briefs = new ProjectBriefCommandService(store, now);
      const commands = new EngineeringProjectCommandService(
        store,
        undefined,
        now,
        { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
      );
      const started = await briefs.startProject(HUMAN, {
        commandId: "start-replaceable-plan",
        projectId: "replaceable-plan",
        projectName: "Replaceable plan",
        issuedAt: "2026-08-03T09:00:00.000Z",
        intent: "Build a reviewable engineering system.",
        intentSource: { kind: "human", reference: "conversation:turn-1" },
      });
      const proposed = await briefs.proposeBrief(AGENT, {
        commandId: "propose-replaceable-plan-brief",
        projectId: started.project.id,
        expectedRevision: started.revision,
        issuedAt: started.generatedAt,
        items: liveBriefItems("Demonstrate a reviewable system safely."),
      });
      const approved = await briefs.approveBrief(HUMAN, {
        commandId: "approve-replaceable-plan-brief",
        projectId: proposed.project.id,
        expectedRevision: proposed.revision,
        issuedAt: proposed.generatedAt,
        briefSnapshotId: proposed.framing!.proposedBrief!.id,
        briefRevision: proposed.framing!.proposedBrief!.revision,
        rationale: "Approved for planning.",
        inputFingerprint: proposed.framing!.proposalReview!.inputFingerprint,
      });
      const first = await commands.publishPlan(AGENT, {
        commandId: "publish-plan-1",
        projectId: approved.project.id,
        expectedRevision: approved.revision,
        issuedAt: approved.generatedAt,
        startingPoint: "idea-or-spec",
        phases: [{
          id: "phase-baseline",
          name: "Engineering baseline",
          description: "First unexecuted plan.",
        }],
        workItems: [baselineWork("record-approved-brief")],
        requiredDecisions: [],
      });
      assertEquals(first.workItems.map((item) => item.id), [
        "record-approved-brief",
      ]);
      const second = await commands.publishPlan(AGENT, {
        commandId: "publish-plan-2",
        projectId: first.project.id,
        expectedRevision: first.revision,
        issuedAt: first.generatedAt,
        startingPoint: "idea-or-spec",
        phases: [{
          id: "phase-baseline",
          name: "Engineering baseline",
          description: "Replacement unexecuted plan.",
        }],
        workItems: [baselineWork("record-approved-brief-revised")],
        requiredDecisions: [],
      });
      assertEquals(second.workItems.map((item) => item.id), [
        "record-approved-brief-revised",
      ]);
      const queued = await commands.queueRun(AGENT, {
        commandId: "queue-lock-plan",
        projectId: second.project.id,
        expectedRevision: second.revision,
        issuedAt: second.generatedAt,
        runId: "run:lock-plan",
        workItemId: "record-approved-brief-revised",
        summary: "Queue the reviewed documentary baseline.",
        basis: second.plan!.basis,
      });
      await assertRejects(
        () =>
          commands.publishPlan(AGENT, {
            commandId: "publish-plan-after-lock",
            projectId: queued.project.id,
            expectedRevision: queued.revision,
            issuedAt: queued.generatedAt,
            startingPoint: "idea-or-spec",
            phases: [{
              id: "phase-baseline",
              name: "Engineering baseline",
              description: "Locked plan.",
            }],
            workItems: [baselineWork("record-approved-brief-locked")],
            requiredDecisions: [],
          }),
        EngineeringProjectCommandError,
      );
      const forgedAt = new Date(Date.parse(queued.generatedAt) + 1000)
        .toISOString();
      const forgedDraft = structuredClone(queued) as Mutable<
        EngineeringProjectSnapshot
      >;
      forgedDraft.id = `${queued.project.id}:r${queued.revision + 1}`;
      forgedDraft.revision = queued.revision + 1;
      forgedDraft.generatedAt = forgedAt;
      forgedDraft.previous = {
        snapshotId: queued.id,
        revision: queued.revision,
      };
      forgedDraft.plan = {
        ...queued.plan!,
        publishedAt: forgedAt,
        publishedBy: { id: "agent:planner", origin: "agent" },
      };
      forgedDraft.commandReceipts = [
        ...(queued.commandReceipts ?? []),
        {
          commandId: "forged-plan-publish",
          type: "project.plan-publish",
          actor: { id: "agent:planner", origin: "agent" },
          issuedAt: forgedAt,
          appliedAt: forgedAt,
          requestFingerprint: { algorithm: "sha256", digest: "9".repeat(64) },
          resultingSnapshot: {
            snapshotId: forgedDraft.id,
            revision: forgedDraft.revision,
          },
        },
      ];
      const forged = validateEngineeringProjectSnapshot(forgedDraft);
      await assertRejects(
        () => store.commit(forged, queued.revision),
        EngineeringProjectValidationError,
        "a published plan cannot be rewritten",
      );
    });
  },
);

function liveBriefItems(objective: string) {
  return [{
    id: "objective",
    kind: "objective" as const,
    statement: objective,
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:turn-1" }],
  }, {
    id: "mission-bounded-demonstration",
    kind: "mission-scenario" as const,
    statement: "Demonstrate a bounded operating scenario with traceable evidence.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:turn-1" }],
  }, {
    id: "success-reviewed-system",
    kind: "success-criterion" as const,
    statement: "Complete the reviewed scenario with a traceable engineering record.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:turn-1" }],
    dependsOnItemIds: [],
  }, {
    id: "verify-traceable-record",
    kind: "verification-activity" as const,
    statement: "Verify the reviewed record against the declared success criterion.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:turn-1" }],
    dependsOnItemIds: ["success-reviewed-system"],
  }];
}

function baselineWork(id: string) {
  return {
    id,
    phaseId: "phase-baseline",
    owner: "agent" as const,
    dependsOnWorkItemIds: [] as string[],
    decisionIds: [] as string[],
    operation: {
      id: "baseline.from-approved-brief",
      version: "1",
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    },
  };
}

async function assertStoreRejectsExtension(
  mutate: (draft: Mutable<EngineeringProjectSnapshot>) => void,
  message: string,
): Promise<void> {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    const current = await seedReviewableProject(store);
    const next = successorOf(current, mutate);
    await assertRejects(
      () => store.commit(next, current.revision),
      EngineeringProjectValidationError,
      message,
    );
  });
}

function successorOf(
  previous: EngineeringProjectSnapshot,
  mutate: (draft: Mutable<EngineeringProjectSnapshot>) => void,
): EngineeringProjectSnapshot {
  const next = structuredClone(previous) as Mutable<EngineeringProjectSnapshot>;
  next.id = `${previous.project.id}:r${previous.revision + 1}`;
  next.revision = previous.revision + 1;
  next.generatedAt = "2026-08-01T12:00:00.000Z";
  next.previous = { snapshotId: previous.id, revision: previous.revision };
  next.commandReceipts = [
    ...(previous.commandReceipts ?? []),
    {
      commandId: `extension-${next.revision}`,
      type: "decision.propose",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: next.generatedAt,
      appliedAt: next.generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
      resultingSnapshot: { snapshotId: next.id, revision: next.revision },
    },
  ];
  mutate(next);
  return validateEngineeringProjectSnapshot(next);
}

function twoPhaseProjectFixture(): EngineeringProjectSnapshot {
  const extra = structuredClone(projectFixture()) as Mutable<
    EngineeringProjectSnapshot
  >;
  extra.workItems[0] = {
    ...extra.workItems[0]!,
    operation: {
      id: "verify.lifecycle-fixture",
      version: "1",
      bindings: [],
    },
  };
  extra.phases.push({
    id: "closeout",
    name: "Closeout",
    order: 2,
    description: "Close the manufacturing record.",
    workItemIds: ["close-record"],
    requiredDecisionIds: [],
    evidenceRefs: [],
  });
  extra.workItems.push({
    id: "close-record",
    activityId: "activity:close-record",
    phaseId: "closeout",
    title: "Close the record",
    description: "Keep a second phase so order mutations are observable.",
    kind: "industrialize",
    operation: {
      id: "record.archive-lineage",
      version: "1",
      bindings: [],
    },
    status: "planned",
    owner: "shared",
    dependsOnWorkItemIds: ["verify-generic-input"],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
  });
  return validateEngineeringProjectSnapshot(extra);
}

Deno.test("active project paths reject dot-segment and non-alphanumeric prefixes", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await assertRejects(() => store.get(".."), TypeError);
    await assertRejects(() => store.get(".hidden"), TypeError);
    await assertRejects(() => store.get("-option"), TypeError);

    const unsafe = structuredClone(intentProjectFixture()) as Mutable<
      EngineeringProjectSnapshot
    >;
    unsafe.project.id = "..";
    await assertRejects(() => store.createInitial(unsafe), TypeError);
  });
});

const HUMAN = { kind: "human" as const, actorId: "store-test-human" };
const AGENT = { kind: "agent" as const, actorId: "store-test-agent" };
const GENERATED_AT = "2026-08-01T10:36:58.345Z";
const OBJECTIVE = "Exercise immutable project storage without a product fixture.";

function intentProjectFixture(): EngineeringProjectSnapshot {
  return validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: "engineering-project-generic-r0-start",
    revision: 1,
    generatedAt: GENERATED_AT,
    project: {
      id: "generic-project",
      name: "Generic project",
      subjectId: "generic-subject",
      objective: {
        title: OBJECTIVE,
        statement: OBJECTIVE,
      },
    },
    framing: {
      intent: {
        statement: OBJECTIVE,
        source: { kind: "human", reference: "paired-conversation" },
        capturedAt: GENERATED_AT,
        capturedBy: { id: "human:owner", origin: "human" },
      },
      questions: [],
      answers: [],
    },
    threadSnapshots: [],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "start-generic-project",
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: GENERATED_AT,
      appliedAt: GENERATED_AT,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: {
        snapshotId: "engineering-project-generic-r0-start",
        revision: 1,
      },
    }],
  });
}

async function seedReviewableProject(
  store: FileEngineeringProjectRevisionStore,
): Promise<EngineeringProjectSnapshot> {
  await store.createInitial(intentProjectFixture());
  return await store.commit(projectFixture(), 1);
}

function projectFixture(): EngineeringProjectSnapshot {
  const generatedAt = "2026-08-01T10:36:58.345Z";
  const briefFingerprint = {
    algorithm: "sha256" as const,
    digest: "e".repeat(64),
  };
  const approvedBriefBasis = {
    kind: "approved-brief" as const,
    projectId: "generic-project",
    projectSnapshotId: "engineering-project-generic-r1",
    projectRevision: 2,
    briefId: "generic-project:brief",
    briefSnapshotId: "generic-project:brief:r1:fixture",
    briefRevision: 1,
    approvedBriefFingerprint: briefFingerprint,
  };
  return validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: "engineering-project-generic-r1",
    revision: 2,
    generatedAt,
    previous: {
      snapshotId: "engineering-project-generic-r0-start",
      revision: 1,
    },
    project: {
      id: "generic-project",
      name: "Generic project",
      subjectId: "generic-subject",
      objective: {
        title: "Exercise immutable project storage without a product fixture.",
        statement: "Exercise immutable project storage without a product fixture.",
      },
    },
    framing: {
      intent: {
        statement: "Exercise immutable project storage without a product fixture.",
        source: { kind: "human", reference: "paired-conversation" },
        capturedAt: generatedAt,
        capturedBy: { id: "human:owner", origin: "human" },
      },
      questions: [],
      answers: [],
      currentBrief: {
        briefId: "generic-project:brief",
        id: "generic-project:brief:r1:fixture",
        revision: 1,
        items: [{
          id: "objective",
          kind: "objective",
          statement: "Exercise immutable project storage without a product fixture.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement: "Persist and reread an exact project revision.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement: "The stored revision validates and round-trips unchanged.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }],
        proposedAt: generatedAt,
        proposedBy: { id: "agent:planner", origin: "agent" },
      },
      currentBriefApproval: {
        briefSnapshotId: "generic-project:brief:r1:fixture",
        briefRevision: 1,
        status: "approved",
        inputFingerprint: briefFingerprint,
        requestedAt: generatedAt,
        decidedAt: generatedAt,
        decidedBy: { id: "human:owner", origin: "human" },
        rationale: "Confirmed in the paired conversation.",
      },
    },
    threadSnapshots: [{
      snapshotId: "generic-thread-r1",
      revision: 1,
      subjectId: "generic-subject",
    }],
    phases: [{
      id: "verification",
      name: "Verification",
      order: 1,
      description: "Review the bounded verification input.",
      workItemIds: ["verify-generic-input"],
      requiredDecisionIds: ["review-generic-input"],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "verify-generic-input",
      activityId: "activity:verify-generic-input",
      phaseId: "verification",
      title: "Verify the generic input",
      description: "Wait for the exact input decision before execution.",
      kind: "verify",
      status: "waiting-for-decision",
      owner: "shared",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: ["review-generic-input"],
      blockerIds: [],
    }],
    agentRuns: [],
    decisions: [{
      id: "review-generic-input",
      phaseId: "verification",
      title: "Review the generic input",
      question: "Which exact input should govern the generic verification?",
      status: "required",
      requestedAt: generatedAt,
      inputEvidenceRefs: [],
      approvalIds: [],
    }],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "start-generic-project",
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: {
        snapshotId: "engineering-project-generic-r0-start",
        revision: 1,
      },
    }, {
      commandId: "approve-generic-brief",
      type: "project.brief-approve",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: {
        snapshotId: "engineering-project-generic-r1",
        revision: 2,
      },
      approvedBriefBasis,
    }],
  });
}

function proposalCommand(
  project: EngineeringProjectSnapshot,
  commandId: string,
  decisionId: string,
) {
  return {
    commandId,
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-01T10:59:00.000Z",
    decisionId,
    proposal: {
      summary: "Store concurrency fixture.",
      parameters: [{ key: "choice", label: "Choice", value: commandId }],
    },
    baseSnapshot: structuredClone(project.threadSnapshots[0]),
  };
}

function commandService(
  store: FileEngineeringProjectRevisionStore,
  appliedAt: string,
) {
  return new EngineeringProjectCommandService(store, undefined, () => appliedAt);
}

async function withTempDirectory(
  operation: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "engineering-project-store-" });
  try {
    await operation(directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
