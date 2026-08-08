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

Deno.test("architecture WAL reads an exact valid legacy record without creating a new dispatch", async () => {
  await withStore(async (directory, store) => {
    const legacyName = `${
      encodeURIComponent(JSON.stringify([
        ID.projectId,
        ID.runId,
        "a".repeat(64),
      ]))
    }.json`;
    await Deno.writeTextFile(
      `${directory}/${legacyName}`,
      `${
        deterministicJson({
          schemaVersion: "architecture-write-attempt/1.0",
          ...ID,
          planDigest: "a".repeat(64),
          status: "completed",
          dispatchedAt: AT,
          result: { inserted: "true" },
        })
      }\n`,
    );
    assertEquals(await store.begin(input()), { action: "completed" });
    assertEquals((await Array.fromAsync(Deno.readDir(directory))).length, 1);
  });
});
