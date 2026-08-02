import { assertEquals, assertRejects } from "@std/assert";
import { deterministicJson } from "../domain/deterministic-json.ts";
import {
  ProjectDiscoveryCommandError,
  ProjectDiscoveryCommandService,
  ProjectDiscoveryStoreConflictError,
} from "../domain/project-discovery-command-service.ts";
import { FileProjectDiscoveryRevisionStore } from "./project-discovery-store.ts";

const AGENT = { kind: "agent" as const, actorId: "agent:store-test" };
const DISCOVERY_ID = "store-discovery-1";

Deno.test("FileProjectDiscoveryRevisionStore writes deterministic immutable revisions", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileProjectDiscoveryRevisionStore(directory);
    const discovery = await serviceFor(store, "2026-08-02T10:00:00.000Z").start(
      AGENT,
      startCommand(),
    );

    const raw = await Deno.readTextFile(
      `${directory}/${encodeURIComponent(DISCOVERY_ID)}/0000000001.json`,
    );
    assertEquals(raw, `${deterministicJson(discovery)}\n`);
    assertEquals(
      (await store.contentFingerprint(DISCOVERY_ID, 1))?.digest.length,
      64,
    );
    assertEquals((await store.get(DISCOVERY_ID))?.id, discovery.id);
  });
});

Deno.test("same start command racing across stores is idempotent", async () => {
  await withTempDirectory(async (directory) => {
    const firstStore = new FileProjectDiscoveryRevisionStore(directory);
    const secondStore = new FileProjectDiscoveryRevisionStore(directory);
    const [left, right] = await Promise.all([
      serviceFor(firstStore, "2026-08-02T10:00:00.000Z").start(
        AGENT,
        startCommand(),
      ),
      serviceFor(secondStore, "2026-08-02T10:00:01.000Z").start(
        AGENT,
        startCommand(),
      ),
    ]);

    assertEquals(left.id, right.id);
    assertEquals((await firstStore.get(DISCOVERY_ID))?.revision, 1);
  });
});

Deno.test("cross-process discovery CAS admits one mutation per expected revision", async () => {
  await withTempDirectory(async (directory) => {
    const firstStore = new FileProjectDiscoveryRevisionStore(directory);
    const secondStore = new FileProjectDiscoveryRevisionStore(directory);
    const initial = await serviceFor(
      firstStore,
      "2026-08-02T10:00:00.000Z",
    ).start(AGENT, startCommand());
    const results = await Promise.allSettled([
      serviceFor(firstStore, "2026-08-02T10:00:01.000Z").proposeQuestion(
        AGENT,
        questionCommand(initial.revision, "question-a", "command-a"),
      ),
      serviceFor(secondStore, "2026-08-02T10:00:02.000Z").proposeQuestion(
        AGENT,
        questionCommand(initial.revision, "question-b", "command-b"),
      ),
    ]);

    assertEquals(results.filter((item) => item.status === "fulfilled").length, 1);
    const rejected = results.find((item) =>
      item.status === "rejected"
    ) as PromiseRejectedResult;
    assertEquals(rejected.reason instanceof ProjectDiscoveryCommandError, true);
    assertEquals(rejected.reason.code, "stale_revision");
    assertEquals((await firstStore.get(DISCOVERY_ID))?.revision, 2);
  });
});

Deno.test("project discovery store rejects unsafe path ids", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileProjectDiscoveryRevisionStore(directory);
    await assertRejects(() => store.get(".."), TypeError);
    await assertRejects(() => store.get(".hidden"), TypeError);
    await assertRejects(() => store.get("-option"), TypeError);
    await assertRejects(() => store.get("latest"), TypeError);
  });
});

Deno.test("an unpublished revision claim fails closed instead of forking history", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileProjectDiscoveryRevisionStore(directory);
    const discovery = await serviceFor(
      store,
      "2026-08-02T10:00:00.000Z",
    ).start(AGENT, startCommand());
    await Deno.writeTextFile(
      `${directory}/${encodeURIComponent(DISCOVERY_ID)}/0000000002.claim`,
      `${discovery.id}\n`,
      { createNew: true },
    );

    await assertRejects(
      () => store.get(DISCOVERY_ID),
      ProjectDiscoveryStoreConflictError,
      "claimed but not durably published",
    );
  });
});

function serviceFor(
  store: FileProjectDiscoveryRevisionStore,
  appliedAt: string,
) {
  return new ProjectDiscoveryCommandService(store, () => appliedAt);
}

function startCommand() {
  return {
    commandId: "start-store-discovery",
    discoveryId: DISCOVERY_ID,
    issuedAt: "2026-08-02T09:59:00.000Z",
    intent: "Build a new inspection product.",
  };
}

function questionCommand(
  expectedRevision: number,
  questionId: string,
  commandId: string,
) {
  return {
    commandId,
    discoveryId: DISCOVERY_ID,
    expectedRevision,
    issuedAt: "2026-08-02T09:59:30.000Z",
    question: {
      id: questionId,
      prompt: "What is the intended mission?",
      whyItMatters: "Mission determines the engineering scope.",
      recommendation: {
        value: "bounded-mission",
        rationale: "A bounded mission is reversible.",
        confidence: "medium" as const,
      },
      options: [{
        value: "bounded-mission",
        label: "Bounded mission",
        consequences: "Reduces early uncertainty.",
      }],
      allowUnknown: true,
      risk: "reversible" as const,
      evidenceNeeded: [],
    },
  };
}

async function withTempDirectory(
  operation: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "project-discovery-store-" });
  try {
    await operation(directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
