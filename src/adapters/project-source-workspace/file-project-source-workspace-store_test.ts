import { assertEquals, assertRejects } from "@std/assert";
import {
  FileProjectSourceWorkspaceStore,
  type ProjectSourceWorkspaceRevisionFileIo,
} from "./file-project-source-workspace-store.ts";
import { ProjectSourceWorkspaceStoreError } from "../../application/ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import {
  applyProjectSourceWorkspaceCommand,
  emptyProjectSourceWorkspace,
  eventBodyFingerprint,
} from "../../domain/project-source-workspace/transitions.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  ProjectSourceWorkspaceError,
  type ProjectSourceWorkspaceEvent,
} from "../../domain/project-source-workspace/types.ts";

const PROJECT = "generic-project";

Deno.test("append-only store writes one event per revision and rebuilds without a snapshot file", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-store-" });
  try {
    const store = new FileProjectSourceWorkspaceStore(root);
    const first = await eventFor(
      emptyProjectSourceWorkspace(PROJECT),
      modulePut("m1", 0),
    );
    await store.append(first);
    const secondState = await store.load(PROJECT);
    const second = await eventFor(secondState, modulePut("m2", 1, "mod-b", "drive"));
    await store.append(second);
    const names = [];
    for await (const entry of Deno.readDir(`${root}/${PROJECT}`)) {
      names.push(entry.name);
    }
    names.sort();
    assertEquals(names, [
      "0000000001.claim",
      "0000000001.json",
      "0000000002.claim",
      "0000000002.json",
    ]);
    const rebuilt = new FileProjectSourceWorkspaceStore(root);
    const loaded = await rebuilt.load(PROJECT);
    assertEquals(loaded.workspaceRevision, 2);
    assertEquals(loaded.modules.get("mod-b")?.slug, "drive");
    const historical = await rebuilt.loadAt(PROJECT, 1);
    assertEquals(historical.workspaceRevision, 1);
    assertEquals(historical.modules.has("mod-b"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("claim without a published event fails closed", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-claim-" });
  try {
    const store = new FileProjectSourceWorkspaceStore(root);
    await store.append(
      await eventFor(emptyProjectSourceWorkspace(PROJECT), modulePut("m1", 0)),
    );
    await Deno.writeTextFile(
      `${root}/${PROJECT}/0000000002.claim`,
      "m2\n",
      { createNew: true },
    );
    const error = await assertRejects(
      () => store.load(PROJECT),
      ProjectSourceWorkspaceStoreError,
    );
    assertEquals(error.code, "incomplete_claim");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("gapped and corrupt event logs fail closed", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-gap-" });
  try {
    const first = await eventFor(
      emptyProjectSourceWorkspace(PROJECT),
      modulePut("m1", 0),
    );
    const store = new FileProjectSourceWorkspaceStore(root);
    await store.append(first);
    await Deno.writeTextFile(
      `${root}/${PROJECT}/0000000003.json`,
      `${deterministicJson({ ...first, workspaceRevision: 3 })}\n`,
    );
    await Deno.writeTextFile(`${root}/${PROJECT}/0000000003.claim`, "m3\n");
    const gap = await assertRejects(
      () => new FileProjectSourceWorkspaceStore(root).load(PROJECT),
      ProjectSourceWorkspaceStoreError,
    );
    assertEquals(gap.code, "log_gap");

    const corruptRoot = await Deno.makeTempDir({ prefix: "psw-corrupt-" });
    try {
      await Deno.mkdir(`${corruptRoot}/${PROJECT}`);
      await Deno.writeTextFile(`${corruptRoot}/${PROJECT}/0000000001.claim`, "m1\n");
      await Deno.writeTextFile(
        `${corruptRoot}/${PROJECT}/0000000001.json`,
        "{not-json\n",
      );
      const corrupt = await assertRejects(
        () => new FileProjectSourceWorkspaceStore(corruptRoot).load(PROJECT),
        ProjectSourceWorkspaceStoreError,
      );
      assertEquals(corrupt.code, "corrupt_log");
    } finally {
      await Deno.remove(corruptRoot, { recursive: true });
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cached load still fails closed on an incomplete claim created after the cache", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-cache-claim-" });
  try {
    const store = new FileProjectSourceWorkspaceStore(root);
    await store.append(
      await eventFor(emptyProjectSourceWorkspace(PROJECT), modulePut("m1", 0)),
    );
    await store.load(PROJECT);
    await Deno.writeTextFile(
      `${root}/${PROJECT}/0000000002.claim`,
      "m2\n",
      { createNew: true },
    );
    const error = await assertRejects(
      () => store.load(PROJECT),
      ProjectSourceWorkspaceStoreError,
    );
    assertEquals(error.code, "incomplete_claim");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cached load observes an external append instead of masking it", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-cache-append-" });
  try {
    const cached = new FileProjectSourceWorkspaceStore(root);
    const writer = new FileProjectSourceWorkspaceStore(root);
    const first = await eventFor(
      emptyProjectSourceWorkspace(PROJECT),
      modulePut("m1", 0),
    );
    await writer.append(first);
    assertEquals((await cached.load(PROJECT)).workspaceRevision, 1);
    const second = await eventFor(
      await writer.load(PROJECT),
      modulePut("m2", 1, "mod-b", "drive"),
    );
    await writer.append(second);
    const seen = await cached.load(PROJECT);
    assertEquals(seen.workspaceRevision, 2);
    assertEquals(seen.modules.get("mod-b")?.slug, "drive");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("two store instances replay the same mutation after CAS and isolate cache maps", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-two-instance-" });
  try {
    const left = new FileProjectSourceWorkspaceStore(root);
    const right = new FileProjectSourceWorkspaceStore(root);
    await left.load(PROJECT);
    await right.load(PROJECT);
    const event = await eventFor(
      emptyProjectSourceWorkspace(PROJECT),
      modulePut("m-shared", 0),
    );
    const results = await Promise.allSettled([
      left.append(event),
      right.append(event),
    ]);
    assertEquals(results.filter((item) => item.status === "fulfilled").length, 1);
    assertEquals(results.filter((item) => item.status === "rejected").length, 1);
    const loadedLeft = await left.load(PROJECT);
    const loadedRight = await right.load(PROJECT);
    assertEquals(loadedLeft.workspaceRevision, 1);
    assertEquals(loadedRight.workspaceRevision, 1);
    assertEquals(
      loadedLeft.mutations.get("m-shared")?.event.fingerprint,
      event.fingerprint,
    );
    assertEquals(
      loadedRight.mutations.get("m-shared")?.event.fingerprint,
      event.fingerprint,
    );
    (loadedLeft.modules as Map<
      string,
      { moduleId: string; slug: string; displayName: string }
    >)
      .set("hijack", {
        moduleId: "hijack",
        slug: "hijack",
        displayName: "Hijack",
      });
    assertEquals((await left.load(PROJECT)).modules.has("hijack"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("an invalid successor event is refused before a claim is created", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-invalid-event-" });
  try {
    const store = new FileProjectSourceWorkspaceStore(root);
    const first = await eventFor(
      emptyProjectSourceWorkspace(PROJECT),
      modulePut("m1", 0),
    );
    await store.append(first);
    const bogusBody = {
      ...first,
      workspaceRevision: 2,
      previousWorkspaceRevision: 0,
      mutationId: "m-bad",
    };
    const bogus: ProjectSourceWorkspaceEvent = {
      ...bogusBody,
      fingerprint: await eventBodyFingerprint(bogusBody),
    };
    const error = await assertRejects(
      () => store.append(bogus),
      ProjectSourceWorkspaceError,
    );
    assertEquals(error.code, "event_sequence_mismatch");
    const names = [];
    for await (const entry of Deno.readDir(`${root}/${PROJECT}`)) {
      names.push(entry.name);
    }
    names.sort();
    assertEquals(names, ["0000000001.claim", "0000000001.json"]);
    assertEquals((await store.load(PROJECT)).workspaceRevision, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("append with a populated cache refuses a tampered earlier event before creating a claim", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-append-history-tamper-" });
  try {
    const store = new FileProjectSourceWorkspaceStore(root);
    const first = await eventFor(
      emptyProjectSourceWorkspace(PROJECT),
      modulePut("m1", 0),
    );
    await store.append(first);
    const second = await eventFor(
      await store.load(PROJECT),
      modulePut("m2", 1, "mod-b", "drive"),
    );
    await store.append(second);
    const head = await store.load(PROJECT);
    assertEquals(head.workspaceRevision, 2);
    const third = await eventFor(head, modulePut("m3", 2, "mod-c", "clamp"));

    const raw = JSON.parse(
      await Deno.readTextFile(`${root}/${PROJECT}/0000000001.json`),
    );
    const { fingerprint: _ignored, ...tamperedBody } = {
      ...raw,
      mutation: { ...raw.mutation, displayName: "Tampered" },
    };
    const tampered = {
      ...tamperedBody,
      fingerprint: await eventBodyFingerprint(tamperedBody),
    };
    await Deno.writeTextFile(
      `${root}/${PROJECT}/0000000001.json`,
      `${deterministicJson(tampered)}\n`,
    );

    const error = await assertRejects(
      () => store.append(third),
      ProjectSourceWorkspaceStoreError,
    );
    assertEquals(error.code, "corrupt_log");
    const names = [];
    for await (const entry of Deno.readDir(`${root}/${PROJECT}`)) {
      names.push(entry.name);
    }
    names.sort();
    assertEquals(names, [
      "0000000001.claim",
      "0000000001.json",
      "0000000002.claim",
      "0000000002.json",
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("fresh reload fails when a historical event is tampered and individually rehashed", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-history-tamper-" });
  try {
    const cached = new FileProjectSourceWorkspaceStore(root);
    const first = await eventFor(
      emptyProjectSourceWorkspace(PROJECT),
      modulePut("m1", 0),
    );
    await cached.append(first);
    const second = await eventFor(
      await cached.load(PROJECT),
      modulePut("m2", 1, "mod-b", "drive"),
    );
    await cached.append(second);
    assertEquals((await cached.load(PROJECT)).workspaceRevision, 2);

    const raw = JSON.parse(
      await Deno.readTextFile(`${root}/${PROJECT}/0000000001.json`),
    );
    const { fingerprint: _ignored, ...tamperedBody } = {
      ...raw,
      mutation: { ...raw.mutation, displayName: "Tampered" },
    };
    const tampered = {
      ...tamperedBody,
      fingerprint: await eventBodyFingerprint(tamperedBody),
    };
    await Deno.writeTextFile(
      `${root}/${PROJECT}/0000000001.json`,
      `${deterministicJson(tampered)}\n`,
    );

    assertEquals((await cached.load(PROJECT)).workspaceRevision, 2);
    const cachedFresh = await assertRejects(
      () => cached.loadAtFresh(PROJECT, 2),
      ProjectSourceWorkspaceStoreError,
    );
    assertEquals(cachedFresh.code, "corrupt_log");
    const fresh = await assertRejects(
      () => new FileProjectSourceWorkspaceStore(root).load(PROJECT),
      ProjectSourceWorkspaceStoreError,
    );
    assertEquals(fresh.code, "corrupt_log");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("append refuses a durable predecessor fingerprint mismatch", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-pred-mismatch-" });
  try {
    let revision1Reads = 0;
    const store = new FileProjectSourceWorkspaceStore(
      root,
      denoFileIo(async (path) => {
        const text = await Deno.readTextFile(path);
        if (!path.endsWith("0000000001.json")) return text;
        revision1Reads += 1;
        if (revision1Reads < 2) return text;
        const event = JSON.parse(text);
        return `${
          deterministicJson({
            ...event,
            fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
          })
        }\n`;
      }),
    );
    const first = await eventFor(
      emptyProjectSourceWorkspace(PROJECT),
      modulePut("m1", 0),
    );
    await store.append(first);
    const firstState = (await applyProjectSourceWorkspaceCommand(
      emptyProjectSourceWorkspace(PROJECT),
      modulePut("m1", 0),
    )).state;
    const second = await eventFor(
      firstState,
      modulePut("m2", 1, "mod-b", "drive"),
    );
    const error = await assertRejects(
      () => store.append(second),
      ProjectSourceWorkspaceError,
    );
    assertEquals(error.code, "event_chain_mismatch");
    const names = [];
    for await (const entry of Deno.readDir(`${root}/${PROJECT}`)) {
      names.push(entry.name);
    }
    names.sort();
    assertEquals(names, ["0000000001.claim", "0000000001.json"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("concurrent append at the same revision admits only one event", async () => {
  const root = await Deno.makeTempDir({ prefix: "psw-cas-" });
  try {
    const left = new FileProjectSourceWorkspaceStore(root);
    const right = new FileProjectSourceWorkspaceStore(root);
    const empty = emptyProjectSourceWorkspace(PROJECT);
    const a = await eventFor(empty, modulePut("m-a", 0, "mod-a", "rail"));
    const b = await eventFor(empty, modulePut("m-b", 0, "mod-b", "drive"));
    const results = await Promise.allSettled([left.append(a), right.append(b)]);
    assertEquals(results.filter((item) => item.status === "fulfilled").length, 1);
    assertEquals(results.filter((item) => item.status === "rejected").length, 1);
    const rejection = results.find((item) =>
      item.status === "rejected"
    ) as PromiseRejectedResult;
    assertEquals(rejection.reason instanceof ProjectSourceWorkspaceStoreError, true);
    assertEquals(rejection.reason.code, "cas_conflict");
    const loaded = await new FileProjectSourceWorkspaceStore(root).load(PROJECT);
    assertEquals(loaded.workspaceRevision, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

function modulePut(
  mutationId: string,
  expected: number,
  moduleId = "mod-a",
  slug = "rail",
) {
  return {
    projectId: PROJECT,
    mutationId,
    expectedWorkspaceRevision: expected,
    mutation: {
      kind: "module_put" as const,
      moduleId,
      slug,
      displayName: slug,
    },
  };
}

async function eventFor(
  state: Parameters<typeof applyProjectSourceWorkspaceCommand>[0],
  command: unknown,
): Promise<ProjectSourceWorkspaceEvent> {
  return (await applyProjectSourceWorkspaceCommand(state, command)).event;
}

function denoFileIo(
  readTextFile: (path: string) => Promise<string>,
): ProjectSourceWorkspaceRevisionFileIo {
  return {
    mkdir: (path) => Deno.mkdir(path, { recursive: true }),
    readTextFile,
    writeTextFileCreateNew: (path, contents) =>
      Deno.writeTextFile(path, contents, { createNew: true }),
    rename: (from, to) => Deno.rename(from, to),
    readDir: async function* (path) {
      for await (const entry of Deno.readDir(path)) {
        yield { name: entry.name, isFile: entry.isFile };
      }
    },
  };
}
