import { assertEquals, assertRejects } from "@std/assert";
import { EngineeringProjectStoreConflictError } from "../../application/ports/out/engineering-project-revision-store.ts";
import { sha256Hex } from "../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import { readPersistedProjectCatalog } from "../../../scripts/serve/serve-native-workbench.ts";
import {
  type NativeWorkbenchProjectDiscovery,
  nativeWorkbenchProjectDiscoveryFileIo,
  nativeWorkbenchProjectDiscoveryHttpStatus,
  type NativeWorkbenchProjectDiscoveryUnavailableEntry,
  type ProjectDiscoveryFileIo,
  readNativeWorkbenchProjectDiscovery,
  renderNativeWorkbenchProjectDiscoveryHtml,
} from "./native-workbench-project-discovery.ts";

const AT = "2026-08-01T10:36:58.345Z";
const OBJECTIVE = "Exercise read-only project discovery without a product fixture.";
const LEAK_PASSWORD = "hunter2-credential";
const LEAK_PATH = "/Volumes/DEV/secret/id_rsa";
const LEAK_STACK = "Error: boom\n    at /private/tmp/hidden.ts";
const LEAK_TOKEN = "sk-live-secret-token";
const LEAK_JSON = JSON.stringify({
  schemaVersion: "1.0",
  password: LEAK_PASSWORD,
  path: LEAK_PATH,
  stack: LEAK_STACK,
  token: LEAK_TOKEN,
  name: "Should-Not-Surface",
  revision: 99,
  subjectId: "should-not-surface",
  status: "pass",
  verdict: "pass",
});

Deno.test("all-good project directories yield complete discovery", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    const writes = trackWrites(directory);
    await store.createInitial(projectFixture("good-a", "Alpha"));
    await store.createInitial(projectFixture("good-b", "Beta"));
    await writes.mark();

    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory);

    assertEquals(discovery.state, "complete");
    assertEquals(discovery.enumeration, { complete: true, truncated: false });
    assertEquals(discovery.counts, {
      available: 2,
      unavailable: 0,
      candidates: 2,
    });
    assertEquals(discovery.entries, [
      availableEntry("good-a", "Alpha"),
      availableEntry("good-b", "Beta"),
    ]);
    assertEquals(nativeWorkbenchProjectDiscoveryHttpStatus(discovery), 200);
    await writes.assertUnchanged();
  });
});

Deno.test("missing configured directory is complete empty, unreadable root is not empty", async () => {
  const missing = await Deno.makeTempDir({
    prefix: "native-workbench-project-discovery-missing-",
  });
  await Deno.remove(missing);
  const discovery = await readNativeWorkbenchProjectDiscovery(
    new FileEngineeringProjectRevisionStore(missing),
    missing,
  );
  assertEquals(discovery.state, "complete");
  assertEquals(discovery.counts, {
    available: 0,
    unavailable: 0,
    candidates: 0,
  });
  assertEquals(discovery.entries, []);

  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await store.createInitial(projectFixture("kept"));
    const io: ProjectDiscoveryFileIo = {
      ...nativeWorkbenchProjectDiscoveryFileIo,
      readDir: () => {
        throw new Deno.errors.PermissionDenied("injected");
      },
    };
    const unavailable = await readNativeWorkbenchProjectDiscovery(
      store,
      directory,
      { io },
    );
    assertEquals(unavailable.state, "unavailable");
    if (unavailable.state !== "unavailable") return;
    assertEquals(unavailable.reasonCode, "root-unreadable");
    assertEquals(unavailable.enumeration.complete, false);
    assertEquals(unavailable.counts.candidates, 0);
    assertEquals(nativeWorkbenchProjectDiscoveryHttpStatus(unavailable), 503);
    assertEquals(await store.get("kept") !== undefined, true);
  });
});

Deno.test("existing empty directory is complete empty", async () => {
  await withTempDirectory(async (directory) => {
    const discovery = await readNativeWorkbenchProjectDiscovery(
      new FileEngineeringProjectRevisionStore(directory),
      directory,
    );
    assertEquals(discovery.state, "complete");
    assertEquals(discovery.entries, []);
    assertEquals(
      renderNativeWorkbenchProjectDiscoveryHtml(discovery).includes(
        "No persisted engineering project is available.",
      ),
      true,
    );
  });
});

Deno.test("mixed valid and unsupported heads are partial while v1 catalog stays unavailable", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    const writes = trackWrites(directory);
    const valid = await store.createInitial(
      projectFixture("healthy-id01", "Healthy ID01"),
    );
    await Deno.mkdir(`${directory}/legacy-unsupported`);
    await Deno.writeTextFile(
      `${directory}/legacy-unsupported/0000000001.json`,
      LEAK_JSON,
    );
    await writes.mark();

    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory);
    const catalog = await readPersistedProjectCatalog(store, directory);

    assertEquals(discovery.state, "partial");
    assertEquals(discovery.counts, {
      available: 1,
      unavailable: 1,
      candidates: 2,
    });
    assertEquals(discovery.entries[0], availableEntry("healthy-id01", "Healthy ID01"));
    const unavailable = discovery.entries[1];
    assertEquals(unavailable.kind, "unavailable");
    if (unavailable.kind !== "unavailable") return;
    assertEquals(unavailable.observedStorageIdentifier, "legacy-unsupported");
    assertEquals(unavailable.identityAuthority, "observed-storage");
    assertEquals(unavailable.reasonCode, "validation-failure");
    assertEquals(
      unavailable.observedHead?.filename,
      "0000000001.json",
    );
    assertEquals(
      unavailable.observedHead?.digest,
      {
        algorithm: "sha256",
        digest: await sha256Hex(new TextEncoder().encode(LEAK_JSON)),
      },
    );
    assertNoLeak(discovery, unavailable.message);
    assertEquals(catalog, {
      schemaVersion: "native-workbench-project-catalog/1.0",
      state: "unavailable",
      projects: [],
      reason: "Persisted project revisions could not be reopened exactly.",
    });
    assertEquals((await store.get("healthy-id01"))?.id, valid.id);
    await assertRejects(() => store.get("legacy-unsupported"));
    await writes.assertUnchanged();
  });
});

Deno.test("five valid and five invalid directories remain ten truthful entries", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    for (let index = 1; index <= 5; index++) {
      await store.createInitial(
        projectFixture(`good-${index}`, `Good ${index}`),
      );
    }
    for (let index = 1; index <= 5; index++) {
      const name = `bad-${index}`;
      await Deno.mkdir(`${directory}/${name}`);
      await Deno.writeTextFile(
        `${directory}/${name}/0000000001.json`,
        `{${LEAK_JSON.slice(1)}`,
      );
    }

    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory);
    assertEquals(discovery.state, "partial");
    assertEquals(discovery.counts, {
      available: 5,
      unavailable: 5,
      candidates: 10,
    });
    assertEquals(
      discovery.entries.filter((entry) => entry.kind === "available").map(
        (entry) => entry.kind === "available" ? entry.id : "",
      ),
      ["good-1", "good-2", "good-3", "good-4", "good-5"],
    );
    assertEquals(
      discovery.entries.filter((entry) => entry.kind === "unavailable").map(
        (entry) => entry.kind === "unavailable" ? entry.observedStorageIdentifier : "",
      ),
      ["bad-1", "bad-2", "bad-3", "bad-4", "bad-5"],
    );

    const html = renderNativeWorkbenchProjectDiscoveryHtml(discovery);
    for (let index = 1; index <= 5; index++) {
      assertEquals(
        html.includes(`data-discovery-kind="available"`),
        true,
      );
      assertEquals(html.includes(`Good ${index}`), true);
      assertEquals(html.includes(`<code>good-${index}</code>`), true);
      assertEquals(
        html.includes(`<code>bad-${index}</code>`),
        true,
      );
    }
    assertEquals(html.includes("<a href="), false);
    assertEquals(html.includes("/projects/"), false);
    assertEquals(html.includes("<form"), false);
    assertEquals(html.includes("<button"), false);
    assertEquals(html.includes("focus"), false);
    assertEquals(html.includes("migrate"), false);
    assertNoLeak(discovery, html);
  });
});

Deno.test("higher unpublished claim stays unavailable and does not fall back", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    const initial = await store.createInitial(projectFixture("claimed"));
    await Deno.writeTextFile(
      `${directory}/claimed/0000000002.claim`,
      `${initial.id}\n`,
    );
    await store.createInitial(projectFixture("healthy"));

    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory);
    assertEquals(discovery.state, "partial");
    const claimed = findUnavailable(discovery, "claimed");
    assertEquals(claimed.reasonCode, "unpublished-claim");
    assertEquals(claimed.observedHead, { filename: "0000000002.claim" });
    assertEquals("digest" in (claimed.observedHead ?? {}), false);
    await assertRejects(
      () => store.get("claimed"),
      EngineeringProjectStoreConflictError,
    );
    assertEquals((await store.get("healthy"))?.project.id, "healthy");
    assertEquals((await store.getRevision("claimed", 1))?.id, initial.id);
  });
});

Deno.test("malformed encoded folder remains an observed-storage placeholder", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await store.createInitial(projectFixture("healthy"));
    await Deno.mkdir(`${directory}/%E0%A4%A`);

    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory);
    const encoded = findUnavailable(discovery, "%E0%A4%A");
    assertEquals(encoded.reasonCode, "invalid-uri-encoding");
    assertEquals(encoded.identityAuthority, "observed-storage");
    assertEquals("id" in encoded, false);
    assertEquals(
      discovery.entries.some((entry) =>
        entry.kind === "available" && entry.id === "healthy"
      ),
      true,
    );
  });
});

Deno.test("mismatching validated project id does not extract rejected JSON fields", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await store.createInitial(
      projectFixture("beta", "SECRET-PROJECT-TITLE"),
    );
    await Deno.mkdir(`${directory}/alpha`);
    await Deno.copyFile(
      `${directory}/beta/0000000001.json`,
      `${directory}/alpha/0000000001.json`,
    );

    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory);
    const alpha = findUnavailable(discovery, "alpha");
    assertEquals(alpha.reasonCode, "identity-mismatch");
    assertEquals("name" in alpha, false);
    assertEquals("revision" in alpha, false);
    assertEquals("subjectId" in alpha, false);
    assertEquals("status" in alpha, false);
    assertEquals("verdict" in alpha, false);
    assertEquals(serialized(alpha).includes("SECRET-PROJECT-TITLE"), false);
    assertEquals(
      discovery.entries.some((entry) =>
        entry.kind === "available" && entry.name === "SECRET-PROJECT-TITLE"
      ),
      true,
    );
  });
});

Deno.test("directory without published JSON is an explicit placeholder", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await Deno.mkdir(`${directory}/empty-project`);
    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory);
    assertEquals(
      findUnavailable(discovery, "empty-project").reasonCode,
      "no-published-json",
    );
    assertEquals(await store.get("empty-project"), undefined);
  });
});

Deno.test("injected unreadable and oversized heads omit digest and do not chmod", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await Deno.mkdir(`${directory}/unreadable`);
    await Deno.writeTextFile(
      `${directory}/unreadable/0000000001.json`,
      LEAK_JSON,
    );
    await Deno.mkdir(`${directory}/oversized`);
    await Deno.writeTextFile(
      `${directory}/oversized/0000000001.json`,
      "x".repeat(32),
    );

    const unreadablePath = `${directory}/unreadable/0000000001.json`;
    let boundedReads = 0;
    const io: ProjectDiscoveryFileIo = {
      ...nativeWorkbenchProjectDiscoveryFileIo,
      lstat: async (path) => {
        if (path === unreadablePath) {
          throw new Deno.errors.PermissionDenied("injected-permission");
        }
        return await nativeWorkbenchProjectDiscoveryFileIo.lstat(path);
      },
      readBoundedFile: async (path, maxBytes) => {
        boundedReads += 1;
        return await nativeWorkbenchProjectDiscoveryFileIo.readBoundedFile(
          path,
          maxBytes,
        );
      },
    };

    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory, {
      io,
      maxHeadBytes: 8,
    });
    const unreadable = findUnavailable(discovery, "unreadable");
    assertEquals(unreadable.reasonCode, "read-permission-failure");
    assertEquals(unreadable.observedHead?.digest, undefined);
    assertEquals(serialized(unreadable).includes("injected-permission"), false);
    const oversized = findUnavailable(discovery, "oversized");
    assertEquals(oversized.reasonCode, "oversized-head");
    assertEquals(oversized.observedHead, { filename: "0000000001.json" });
    assertEquals(oversized.observedHead?.digest, undefined);
    assertEquals(boundedReads, 0);
    assertNoLeak(discovery);
  });
});

Deno.test("symlink candidates stay unavailable and do not traverse the root", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await store.createInitial(projectFixture("healthy", "Healthy"));
    const outside = await Deno.makeTempDir({
      prefix: "native-workbench-project-discovery-outside-",
    });
    try {
      await Deno.writeTextFile(
        `${outside}/0000000001.json`,
        `${JSON.stringify(projectFixture("escaped", "Escaped"))}\n`,
      );
      await Deno.symlink(outside, `${directory}/escaped`);
      await Deno.symlink(
        `${directory}/healthy/0000000001.json`,
        `${directory}/healthy-link`,
      );

      const discovery = await readNativeWorkbenchProjectDiscovery(store, directory);
      assertEquals(findUnavailable(discovery, "escaped").reasonCode, "symlink");
      assertEquals(findUnavailable(discovery, "healthy-link").reasonCode, "symlink");
      assertEquals(
        discovery.entries.some((entry) =>
          entry.kind === "available" && entry.id === "escaped"
        ),
        false,
      );
      assertEquals(
        discovery.entries.some((entry) =>
          entry.kind === "available" && entry.id === "healthy"
        ),
        true,
      );
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});

Deno.test("newer symlink revision head stays unavailable and does not fall back to older json", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await store.createInitial(projectFixture("linked", "Linked"));
    const jsonPath = `${directory}/linked/0000000001.json`;
    const symlinkJson = `${directory}/linked/0000000002.json`;
    await Deno.symlink(jsonPath, symlinkJson);
    const reads: string[] = [];
    const io: ProjectDiscoveryFileIo = {
      ...nativeWorkbenchProjectDiscoveryFileIo,
      readBoundedFile: async (path, maxBytes) => {
        reads.push(path);
        return await nativeWorkbenchProjectDiscoveryFileIo.readBoundedFile(
          path,
          maxBytes,
        );
      },
    };

    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory, {
      io,
    });
    const linked = findUnavailable(discovery, "linked");
    assertEquals(linked.reasonCode, "symlink");
    assertEquals(linked.observedHead, { filename: "0000000002.json" });
    assertEquals(linked.observedHead?.digest, undefined);
    assertEquals(reads.includes(symlinkJson), false);
    assertEquals(
      discovery.entries.some((entry) =>
        entry.kind === "available" && entry.id === "linked"
      ),
      false,
    );
    assertEquals((await store.get("linked"))?.revision, 1);
  });
});

Deno.test("newer symlink claim head stays unavailable and is not digested", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    const initial = await store.createInitial(projectFixture("claimed"));
    await Deno.symlink(
      `${directory}/claimed/0000000001.json`,
      `${directory}/claimed/0000000002.claim`,
    );
    const reads: string[] = [];
    const io: ProjectDiscoveryFileIo = {
      ...nativeWorkbenchProjectDiscoveryFileIo,
      readBoundedFile: async (path, maxBytes) => {
        reads.push(path);
        return await nativeWorkbenchProjectDiscoveryFileIo.readBoundedFile(
          path,
          maxBytes,
        );
      },
    };

    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory, {
      io,
    });
    const claimed = findUnavailable(discovery, "claimed");
    assertEquals(claimed.reasonCode, "symlink");
    assertEquals(claimed.observedHead, { filename: "0000000002.claim" });
    assertEquals(claimed.observedHead?.digest, undefined);
    assertEquals(
      reads.some((path) => path.endsWith("0000000002.claim")),
      false,
    );
    assertEquals(initial.revision, 1);
  });
});

Deno.test("unsafe observed names are root-escape and never joined as decoded paths", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await store.createInitial(projectFixture("healthy"));
    const requested: string[] = [];
    const io: ProjectDiscoveryFileIo = {
      ...nativeWorkbenchProjectDiscoveryFileIo,
      readDir: async function* (path) {
        if (path === directory) {
          yield {
            name: "healthy",
            isFile: false,
            isDirectory: true,
            isSymlink: false,
          };
          yield {
            name: "..",
            isFile: false,
            isDirectory: true,
            isSymlink: false,
          };
          yield {
            name: "foo/bar",
            isFile: false,
            isDirectory: true,
            isSymlink: false,
          };
          return;
        }
        yield* nativeWorkbenchProjectDiscoveryFileIo.readDir(path);
      },
      lstat: async (path) => {
        requested.push(path);
        return await nativeWorkbenchProjectDiscoveryFileIo.lstat(path);
      },
    };

    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory, {
      io,
    });
    assertEquals(findUnavailable(discovery, "..").reasonCode, "root-escape");
    assertEquals(findUnavailable(discovery, "foo/bar").reasonCode, "root-escape");
    assertEquals(requested.some((path) => path === `${directory}/..`), false);
    assertEquals(requested.some((path) => path.includes("/foo/bar")), false);
    assertEquals(
      discovery.entries.some((entry) =>
        entry.kind === "available" && entry.id === "healthy"
      ),
      true,
    );
  });
});

Deno.test("head that changes during observation is unavailable rather than mixed", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await store.createInitial(projectFixture("moving", "Moving"));
    const jsonPath = `${directory}/moving/0000000001.json`;
    let jsonStats = 0;
    const io: ProjectDiscoveryFileIo = {
      ...nativeWorkbenchProjectDiscoveryFileIo,
      lstat: async (path) => {
        const stat = await nativeWorkbenchProjectDiscoveryFileIo.lstat(path);
        if (path === jsonPath) {
          jsonStats += 1;
          return { ...stat, mtimeMs: jsonStats };
        }
        return stat;
      },
    };

    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory, {
      io,
    });
    assertEquals(
      findUnavailable(discovery, "moving").reasonCode,
      "changed-during-read",
    );
    assertEquals(
      discovery.entries.some((entry) =>
        entry.kind === "available" && entry.id === "moving"
      ),
      false,
    );
    assertEquals((await store.get("moving"))?.project.name, "Moving");
  });
});

Deno.test("same-metadata different bytes is changed-during-read without an available summary", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await store.createInitial(projectFixture("moving", "Before"));
    let reads = 0;
    const io: ProjectDiscoveryFileIo = {
      ...nativeWorkbenchProjectDiscoveryFileIo,
      readBoundedFile: async (path, maxBytes) => {
        const bytes = await nativeWorkbenchProjectDiscoveryFileIo.readBoundedFile(
          path,
          maxBytes,
        );
        reads += 1;
        if (reads !== 2) return bytes;
        return new TextEncoder().encode(
          new TextDecoder().decode(bytes).replace("Before", "After!"),
        );
      },
    };

    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory, {
      io,
    });
    const moving = findUnavailable(discovery, "moving");
    assertEquals(moving.reasonCode, "changed-during-read");
    assertEquals(moving.observedHead, undefined);
    assertEquals(
      discovery.entries.some((entry) =>
        entry.kind === "available" && entry.id === "moving"
      ),
      false,
    );
    assertEquals(serialized(discovery).includes("After!"), false);
    assertEquals(serialized(discovery).includes("Before"), false);
    assertEquals((await store.get("moving"))?.project.name, "Before");
    assertEquals(reads >= 2, true);
  });
});

Deno.test("enumeration truncation is unavailable and does not claim a complete list", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await store.createInitial(projectFixture("one"));
    await store.createInitial(projectFixture("two"));
    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory, {
      maxEntries: 1,
    });
    assertEquals(discovery.state, "unavailable");
    if (discovery.state !== "unavailable") return;
    assertEquals(discovery.reasonCode, "enumeration-truncated");
    assertEquals(discovery.enumeration, { complete: false, truncated: true });
    assertEquals(discovery.entries.length, 1);
    assertEquals(discovery.counts.candidates, 1);
    assertEquals(nativeWorkbenchProjectDiscoveryHttpStatus(discovery), 503);
  });
});

Deno.test("unexpected non-project files stay classified and do not hide a folder", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await store.createInitial(projectFixture("healthy", "Healthy"));
    await Deno.writeTextFile(`${directory}/README.md`, LEAK_JSON);
    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory);
    assertEquals(discovery.state, "partial");
    assertEquals(
      findUnavailable(discovery, "README.md").reasonCode,
      "unexpected-non-project",
    );
    assertEquals(
      discovery.entries.some((entry) =>
        entry.kind === "available" && entry.id === "healthy"
      ),
      true,
    );
    assertNoLeak(discovery);
  });
});

Deno.test("discovery HTML escapes observed storage identifiers and available names", () => {
  const discovery: NativeWorkbenchProjectDiscovery = {
    schemaVersion: "native-workbench-project-discovery/2.0",
    state: "partial",
    counts: { available: 1, unavailable: 1, candidates: 2 },
    enumeration: { complete: true, truncated: false },
    entries: [
      {
        kind: "available",
        id: "project-<one>",
        name: "Pump & <script>alert(1)</script>",
        revision: 7,
        subjectId: "subject-one",
      },
      {
        kind: "unavailable",
        observedStorageIdentifier: "bad-<script>alert(1)</script>",
        identityAuthority: "observed-storage",
        reasonCode: "malformed-head",
        message: "Observed project head is not well-formed published JSON.",
      },
    ],
  };
  const html = renderNativeWorkbenchProjectDiscoveryHtml(discovery);
  assertEquals(html.includes("<script>alert(1)</script>"), false);
  assertEquals(
    html.includes("Pump &amp; &lt;script&gt;alert(1)&lt;/script&gt;"),
    true,
  );
  assertEquals(html.includes("project-&lt;one&gt;"), true);
  assertEquals(
    html.includes("bad-&lt;script&gt;alert(1)&lt;/script&gt;"),
    true,
  );
  assertEquals(html.includes("<a href="), false);
  assertEquals(html.includes("/projects/"), false);
  assertEquals(html.includes("<form"), false);
  assertEquals(html.includes("<button"), false);
  const availableItem = html.slice(
    html.indexOf('data-discovery-kind="available"'),
    html.indexOf('data-discovery-kind="unavailable"'),
  );
  assertEquals(availableItem.includes("<a "), false);
  assertEquals(availableItem.includes("Pump &amp;"), true);
});

Deno.test("injected exception text with credentials never appears in discovery output", async () => {
  await withTempDirectory(async (directory) => {
    const store = new FileEngineeringProjectRevisionStore(directory);
    await Deno.mkdir(`${directory}/broken`);
    const io: ProjectDiscoveryFileIo = {
      ...nativeWorkbenchProjectDiscoveryFileIo,
      readDir: async function* (path) {
        if (path.endsWith("/broken")) {
          throw new Error(
            `EACCES ${LEAK_PATH} token=${LEAK_TOKEN} ${LEAK_STACK}`,
          );
        }
        yield* nativeWorkbenchProjectDiscoveryFileIo.readDir(path);
      },
    };
    const discovery = await readNativeWorkbenchProjectDiscovery(store, directory, {
      io,
    });
    const broken = findUnavailable(discovery, "broken");
    assertEquals(broken.reasonCode, "unreadable-head");
    assertNoLeak(discovery, broken.message);
    assertEquals(serialized(discovery).includes("EACCES"), false);
  });
});

function availableEntry(id: string, name: string) {
  return {
    kind: "available" as const,
    id,
    name,
    revision: 1,
    subjectId: `${id}-subject`,
  };
}

function findUnavailable(
  discovery: NativeWorkbenchProjectDiscovery,
  observedStorageIdentifier: string,
): NativeWorkbenchProjectDiscoveryUnavailableEntry {
  const entry = discovery.entries.find((item) =>
    item.kind === "unavailable" &&
    item.observedStorageIdentifier === observedStorageIdentifier
  );
  if (!entry || entry.kind !== "unavailable") {
    throw new Error(`Missing unavailable entry ${observedStorageIdentifier}.`);
  }
  return entry;
}

function assertNoLeak(
  discovery: NativeWorkbenchProjectDiscovery,
  extra = "",
): void {
  const text = `${serialized(discovery)}\n${extra}\n${
    renderNativeWorkbenchProjectDiscoveryHtml(discovery)
  }`;
  for (
    const leak of [
      LEAK_PASSWORD,
      LEAK_PATH,
      LEAK_STACK,
      LEAK_TOKEN,
      "Should-Not-Surface",
    ]
  ) {
    assertEquals(text.includes(leak), false);
  }
}

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

function trackWrites(directory: string) {
  let snapshot = "";
  return {
    async mark() {
      snapshot = await treeSnapshot(directory);
    },
    async assertUnchanged() {
      assertEquals(await treeSnapshot(directory), snapshot);
    },
  };
}

async function treeSnapshot(directory: string): Promise<string> {
  const lines: string[] = [];
  async function walk(path: string, relative: string): Promise<void> {
    const entries = [];
    for await (const entry of Deno.readDir(path)) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = `${path}/${entry.name}`;
      const rel = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const stat = await Deno.lstat(child);
      lines.push(
        `${rel}|${stat.isDirectory}|${stat.isSymlink}|${stat.size}|${
          stat.mtime?.getTime() ?? ""
        }`,
      );
      if (stat.isDirectory && !stat.isSymlink) await walk(child, rel);
    }
  }
  await walk(directory, "");
  return lines.join("\n");
}

function projectFixture(
  id: string,
  name = id,
): EngineeringProjectSnapshot {
  return validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: `${id}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id,
      name,
      subjectId: `${id}-subject`,
      objective: { title: OBJECTIVE, statement: OBJECTIVE },
    },
    framing: {
      intent: {
        statement: OBJECTIVE,
        source: { kind: "human", reference: "paired-conversation" },
        capturedAt: AT,
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
      commandId: `start-${id}`,
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: { snapshotId: `${id}:r1`, revision: 1 },
    }],
  });
}

async function withTempDirectory(
  operation: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({
    prefix: "native-workbench-project-discovery-",
  });
  try {
    await operation(directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
