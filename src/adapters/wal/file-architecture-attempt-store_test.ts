import { assertEquals, assertRejects } from "@std/assert";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  ArchitectureWriteOutcomeUnknownError,
  FileArchitectureAttemptStore,
} from "./file-architecture-attempt-store.ts";

const AT = "2026-08-08T12:00:00.000Z";
const ID = { projectId: "project:architecture", runId: "run:architecture" };

function input(planDigest = "a".repeat(64)) {
  return { ...ID, planDigest, dispatchedAt: AT };
}

async function withStore(
  body: (directory: string, store: FileArchitectureAttemptStore) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "casys-architecture-wal-" });
  try {
    await body(directory, new FileArchitectureAttemptStore(directory));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("architecture WAL permits exactly one plan digest for a run", async () => {
  await withStore(async (_directory, store) => {
    assertEquals(await store.begin(input()), { action: "dispatch" });
    await store.complete(input());

    // A changed live preflight must recover from the original acknowledged
    // mutation instead of opening a second dispatch for this run.
    assertEquals(await store.begin(input("b".repeat(64))), { action: "completed" });
    assertEquals(await store.readRun(ID.projectId, ID.runId), {
      schemaVersion: "architecture-write-attempt/1.0",
      ...ID,
      planDigest: "a".repeat(64),
      status: "completed",
      dispatchedAt: AT,
      result: { inserted: "true" },
    });
  });
});

Deno.test("architecture WAL blocks a changed plan after a dispatched crash", async () => {
  await withStore(async (_directory, store) => {
    assertEquals(await store.begin(input()), { action: "dispatch" });
    await assertRejects(
      () => store.begin(input("b".repeat(64))),
      ArchitectureWriteOutcomeUnknownError,
    );
  });
});

Deno.test("architecture WAL atomically elects one concurrent identical dispatcher", async () => {
  await withStore(async (directory) => {
    const first = new FileArchitectureAttemptStore(directory);
    const second = new FileArchitectureAttemptStore(directory);
    const results = await Promise.allSettled([
      first.begin(input()),
      second.begin(input()),
    ]);
    assertEquals(
      results.filter((result) =>
        result.status === "fulfilled" && result.value.action === "dispatch"
      ).length,
      1,
    );
    assertEquals(
      results.filter((result) =>
        result.status === "rejected" &&
        result.reason instanceof ArchitectureWriteOutcomeUnknownError
      ).length,
      1,
    );
    const names = await Array.fromAsync(Deno.readDir(directory));
    assertEquals(names.some((entry) => entry.name.endsWith(".tmp")), false);
  });
});

Deno.test("architecture WAL keeps final filenames bounded for long run identities", async () => {
  await withStore(async (directory, store) => {
    const long = "x".repeat(1_000);
    await store.begin({
      projectId: `project:${long}`,
      runId: `run:${long}`,
      planDigest: "a".repeat(64),
      dispatchedAt: AT,
    });
    const names: string[] = [];
    for await (const entry of Deno.readDir(directory)) names.push(entry.name);
    assertEquals(names.length, 1);
    assertEquals(names[0]!.startsWith("run-"), true);
    assertEquals(new TextEncoder().encode(names[0]!).length <= 255, true);
    assertEquals(
      (await store.readRun(`project:${long}`, `run:${long}`))?.status,
      "dispatched",
    );
  });
});

Deno.test("architecture WAL treats a torn run record as unknown, not dispatchable", async () => {
  await withStore(async (directory, store) => {
    await store.begin(input());
    const [entry] = [
      ...(await Array.fromAsync(Deno.readDir(directory))),
    ];
    await Deno.writeTextFile(`${directory}/${entry!.name}`, "{");
    await assertRejects(
      () => store.begin(input()),
      ArchitectureWriteOutcomeUnknownError,
    );
  });
});

Deno.test("architecture quarantine validates an EEXIST sentinel before trusting it", async () => {
  await withStore(async (directory, store) => {
    await Promise.all([
      store.quarantine({ ...ID, quarantinedAt: AT }),
      store.quarantine({ ...ID, quarantinedAt: AT }),
    ]);
    assertEquals(await store.isQuarantined(ID.projectId, ID.runId), true);

    const entries = await Array.fromAsync(Deno.readDir(directory));
    const marker = entries.find((entry) => entry.name.startsWith("quarantine-"));
    await Deno.writeTextFile(`${directory}/${marker!.name}`, "{}");
    await assertRejects(() => store.isQuarantined(ID.projectId, ID.runId));
  });
});

Deno.test("architecture WAL resumes a completed legacy run after its plan digest changed", async () => {
  await withStore(async (directory, store) => {
    await writeLegacy(directory, completedLegacy("a".repeat(64)));
    assertEquals(await store.begin(input("b".repeat(64))), { action: "completed" });
    assertEquals((await Array.fromAsync(Deno.readDir(directory))).length, 1);
  });
});

Deno.test("architecture WAL fails closed for a dispatched legacy marker under another digest", async () => {
  await withStore(async (directory, store) => {
    await writeLegacy(directory, dispatchedLegacy("a".repeat(64)));
    await assertRejects(
      () => store.begin(input("b".repeat(64))),
      ArchitectureWriteOutcomeUnknownError,
    );
  });
});

Deno.test("architecture WAL fails closed for a malformed matching legacy marker", async () => {
  await withStore(async (directory, store) => {
    await Deno.writeTextFile(
      `${directory}/${legacyName("a".repeat(64))}`,
      "{",
    );
    await assertRejects(
      () => store.begin(input("b".repeat(64))),
      ArchitectureWriteOutcomeUnknownError,
    );
  });
});

Deno.test("architecture WAL resumes only duplicate encodings of one completed legacy marker", async () => {
  await withStore(async (directory, store) => {
    const record = completedLegacy("a".repeat(64));
    await writeLegacy(directory, record);
    // `encodeURIComponent` has one canonical form, but old deployments can
    // still leave an equivalent percent-encoding spelling after a migration.
    await Deno.writeTextFile(
      `${directory}/${legacyName(record.planDigest).replace(/%3A/g, ":")}`,
      `${deterministicJson(record)}\n`,
    );
    assertEquals(await store.begin(input("b".repeat(64))), { action: "completed" });
  });
});

Deno.test("architecture WAL fails closed for contradictory completed legacy markers", async () => {
  await withStore(async (directory, store) => {
    await writeLegacy(directory, completedLegacy("a".repeat(64)));
    await writeLegacy(directory, completedLegacy("b".repeat(64)));
    await assertRejects(
      () => store.begin(input("c".repeat(64))),
      ArchitectureWriteOutcomeUnknownError,
    );
  });
});

Deno.test("architecture WAL gives a hash-format record priority over legacy debris", async () => {
  await withStore(async (directory, store) => {
    await store.begin(input("c".repeat(64)));
    await store.complete(input("c".repeat(64)));
    await writeLegacy(directory, dispatchedLegacy("a".repeat(64)));
    await Deno.writeTextFile(`${directory}/${legacyName("b".repeat(64))}`, "{");

    assertEquals(await store.begin(input("d".repeat(64))), { action: "completed" });
  });
});

function legacyName(planDigest: string): string {
  return `${
    encodeURIComponent(JSON.stringify([
      ID.projectId,
      ID.runId,
      planDigest,
    ]))
  }.json`;
}

function completedLegacy(planDigest: string) {
  return {
    schemaVersion: "architecture-write-attempt/1.0" as const,
    ...ID,
    planDigest,
    status: "completed" as const,
    dispatchedAt: AT,
    result: { inserted: "true" as const },
  };
}

function dispatchedLegacy(planDigest: string) {
  return {
    schemaVersion: "architecture-write-attempt/1.0" as const,
    ...ID,
    planDigest,
    status: "dispatched" as const,
    dispatchedAt: AT,
  };
}

async function writeLegacy(
  directory: string,
  record: ReturnType<typeof completedLegacy> | ReturnType<typeof dispatchedLegacy>,
): Promise<void> {
  await Deno.writeTextFile(
    `${directory}/${legacyName(record.planDigest)}`,
    `${deterministicJson(record)}\n`,
  );
}
