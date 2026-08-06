import { assertEquals, assertRejects } from "@std/assert";
import {
  type EngineeringProjectFileIo,
  FileEngineeringProjectRevisionStore,
  FileEngineeringProjectStore,
} from "./engineering-project-store.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/engineering-project.ts";
import {
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
} from "../../domain/engineering-project-command-service.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/engineering-project-validation.ts";

Deno.test("FileEngineeringProjectStore loads the validated CM-01 project manifest read-only", async () => {
  const store = new FileEngineeringProjectStore(
    "config/projects/coffee-machine-cm01.project.json",
  );

  const project = await store.get();

  assertEquals(project?.schemaVersion, "1.0");
  assertEquals(project?.project.id, "coffee-machine-cm01");
  assertEquals(project?.project.subjectId, "coffee-machine-cm01");
  assertEquals("save" in store, false);
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
    const initial = await projectFixture();
    await store.createInitial(initial);

    const raw = await Deno.readTextFile(
      `${directory}/${encodeURIComponent(initial.project.id)}/0000000001.json`,
    );
    assertEquals(raw, `${deterministicJson(initial)}\n`);
    assertEquals(
      (await store.contentFingerprint(initial.project.id, 1))?.digest.length,
      64,
    );
    assertEquals((await store.get(initial.project.id))?.id, initial.id);
  });
});

Deno.test("cross-process createNew CAS admits only one command at the same expected revision", async () => {
  await withTempDirectory(async (directory) => {
    const initial = await projectFixture();
    const firstStore = new FileEngineeringProjectRevisionStore(directory);
    const secondStore = new FileEngineeringProjectRevisionStore(directory);
    await firstStore.createInitial(initial);
    const first = commandService(firstStore, "2026-08-01T11:00:01.000Z");
    const second = commandService(secondStore, "2026-08-01T11:00:02.000Z");

    const results = await Promise.allSettled([
      first.proposeDecision(
        HUMAN,
        proposalCommand(initial, "command-a", "review-mechanical-proof-case"),
      ),
      second.proposeDecision(
        HUMAN,
        proposalCommand(initial, "command-b", "review-mechanical-proof-case"),
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
    assertEquals(current?.revision, 2);
    assertEquals(current?.commandReceipts?.length, 1);
  });
});

Deno.test("same command id racing across stores is idempotent", async () => {
  await withTempDirectory(async (directory) => {
    const initial = await projectFixture();
    const firstStore = new FileEngineeringProjectRevisionStore(directory);
    const secondStore = new FileEngineeringProjectRevisionStore(directory);
    await firstStore.createInitial(initial);
    const command = proposalCommand(
      initial,
      "same-command",
      "review-mechanical-proof-case",
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
    assertEquals((await firstStore.get(initial.project.id))?.revision, 2);
  });
});

Deno.test("highest claimed corrupt revision fails closed instead of falling back", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    const initial = await projectFixture();
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

    const unsafe = structuredClone(await projectFixture()) as Mutable<
      EngineeringProjectSnapshot
    >;
    unsafe.project.id = "..";
    await assertRejects(() => store.createInitial(unsafe), TypeError);
  });
});

const PROJECT_CONFIG = new URL(
  "../../../config/projects/coffee-machine-cm01.project.json",
  import.meta.url,
);
const HUMAN = { kind: "human" as const, actorId: "store-test-human" };

async function projectFixture(): Promise<EngineeringProjectSnapshot> {
  return validateEngineeringProjectSnapshot(
    JSON.parse(await Deno.readTextFile(PROJECT_CONFIG)),
  );
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
