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
