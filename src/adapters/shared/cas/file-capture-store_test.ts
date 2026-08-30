import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR,
  PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
  syncCaptureDirectoryChain,
  SYSML_SOURCE_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "./file-capture-store.ts";

Deno.test("capture directory syncing stops at an explicit temporary boundary", async () => {
  const synced: string[] = [];
  const fileSystem = {
    open(path: string) {
      return Promise.resolve({
        sync: () => {
          synced.push(path);
          return Promise.resolve();
        },
        close: () => undefined,
      });
    },
  };

  await syncCaptureDirectoryChain(
    "/private/tmp/casys-run/evidence",
    "/private/tmp/casys-run",
    fileSystem,
  );
  assertEquals(synced, [
    "/private/tmp/casys-run/evidence",
    "/private/tmp/casys-run",
  ]);
});

Deno.test("capture directory syncing rejects a non-ancestor boundary", async () => {
  const synced: string[] = [];
  const fileSystem = {
    open(path: string) {
      synced.push(path);
      return Promise.reject(new Error("must not open"));
    },
  };

  await assertRejects(
    () =>
      syncCaptureDirectoryChain(
        "/private/tmp/casys-run/evidence",
        "/private/tmp/foreign-run",
        fileSystem,
      ),
    TypeError,
    "must contain",
  );
  assertEquals(synced, []);
});

// ── Compile-time nominal typing ──────────────────────────────────────────────
//
// The @ts-expect-error directive below is itself a test: `deno task check`
// fails if TypeScript stops treating the assignment as an error. If the phantom
// field `_kind` ever disappears or loses its type, the two `FileCaptureStore`
// instantiations become structurally identical and this directive would turn
// into a spurious suppression, causing the type-checker to reject the file.
function _assertKindIncompatible(
  geometryStore: FileCaptureStore<"geometry-capture">,
): void {
  // @ts-expect-error FileCaptureStore<"geometry-capture"> must not be
  // assignable to FileCaptureStore<"architecture-capture">.
  const _architecture: FileCaptureStore<"architecture-capture"> = geometryStore;
  void _architecture;
}

// ── URI namespace identity (the expected strings are hardcoded) ──────────────
//
// Any automated derivation of the namespace from the directory or kind could
// silently invalidate URIs already persisted under state/.
Deno.test(
  "A capture store preserves its reviewed URI namespace",
  async () => {
    const fp = await sha256Fingerprint({ probe: "uri-namespace-test" });
    const d = fp.digest;

    assertEquals(
      new FileCaptureStore(APPROVED_BRIEF_CAPTURE_DESCRIPTOR).uriFor(fp),
      `casys://approved-brief-capture/sha256/${d}`,
    );
    assertEquals(
      new FileCaptureStore(ARCHITECTURE_CAPTURE_DESCRIPTOR).uriFor(fp),
      `casys://architecture-capture/sha256/${d}`,
    );
    assertEquals(
      new FileCaptureStore(GEOMETRY_CAPTURE_DESCRIPTOR).uriFor(fp),
      `casys://geometry-capture/sha256/${d}`,
    );
    assertEquals(
      new FileCaptureStore(SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR).uriFor(fp),
      `casys://syson-model-seed-capture/sha256/${d}`,
    );
    assertEquals(
      new FileCaptureStore(GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR).uriFor(fp),
      `casys://geometry-source-capture/sha256/${d}`,
    );
    assertEquals(
      new FileCaptureStore(SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR).uriFor(fp),
      `casys://source-analysis-capture/sha256/${d}`,
    );
    assertEquals(
      new FileCaptureStore(SYSML_SOURCE_CAPTURE_DESCRIPTOR).uriFor(fp),
      `casys://sysml-source-capture/sha256/${d}`,
    );
    assertEquals(
      new FileCaptureStore(PART_DEFINITIONS_CAPTURE_DESCRIPTOR).uriFor(fp),
      `casys://part-definitions-capture/sha256/${d}`,
    );
  },
);

// ── Fingerprint validation ───────────────────────────────────────────────────

Deno.test(
  "A capture store rejects a fingerprint whose digest is not lowercase 64-character hex",
  () => {
    const store = new FileCaptureStore(APPROVED_BRIEF_CAPTURE_DESCRIPTOR);

    // digest too short
    assertThrows(
      () => store.uriFor({ algorithm: "sha256", digest: "abc123" }),
      TypeError,
      "A lowercase 64-character sha256 fingerprint is required.",
    );
    // digest contains uppercase
    assertThrows(
      () =>
        store.uriFor({
          algorithm: "sha256",
          digest: "A".repeat(64),
        }),
      TypeError,
      "A lowercase 64-character sha256 fingerprint is required.",
    );
  },
);

// ── Round-trip save / read ───────────────────────────────────────────────────

Deno.test(
  "A capture store persists content-addressed bytes and returns them on read",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-file-capture-store-",
    });
    try {
      const store = new FileCaptureStore({
        ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
        directory,
      });
      const text = '{"kind":"round-trip"}';
      const fp = await sha256Fingerprint({ kind: "round-trip" });

      await store.save(fp, text);
      assertEquals(await store.read(fp), text);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test("A capture store persists a custom relative root", async () => {
  const directory = `casys-relative-captures-${crypto.randomUUID()}`;
  try {
    const store = new FileCaptureStore({
      ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
      directory,
    });
    const text = '{"kind":"relative-root"}';
    const fingerprint = await sha256Fingerprint({ kind: "relative-root" });
    await store.save(fingerprint, text);
    assertEquals(await store.read(fingerprint), text);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

// ── Idempotence ──────────────────────────────────────────────────────────────

Deno.test(
  "A capture store save is idempotent on identical content and returns a deeply-equal value",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-file-capture-store-",
    });
    try {
      const store = new FileCaptureStore({
        ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
        directory,
      });
      const text = '{"idempotent":true}';
      const fp = await sha256Fingerprint({ idempotent: true });

      const first = await store.save(fp, text);
      const replay = await store.save(fp, text);

      assertEquals(first, replay);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Content mismatch on save ─────────────────────────────────────────────────

Deno.test(
  "A capture store rejects content whose hash does not match the declared fingerprint",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-file-capture-store-",
    });
    try {
      const store = new FileCaptureStore({
        ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
        directory,
      });
      const fp = await sha256Fingerprint({ expected: "value" });

      await assertRejects(
        () => store.save(fp, '{"expected":"other"}'),
        Error,
        "does not match declared sha256",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Digest collision (same digest, different on-disk bytes) ──────────────────

Deno.test(
  "A capture store rejects a digest already claimed for different bytes",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-file-capture-store-",
    });
    try {
      const store = new FileCaptureStore({
        ...GEOMETRY_CAPTURE_DESCRIPTOR,
        directory,
      });
      const text = '{"collision":"first"}';
      const fp = await sha256Fingerprint({ collision: "first" });
      await store.save(fp, text);

      // Overwrite the stored file with different bytes to simulate a collision.
      await Deno.writeTextFile(store.pathFor(fp), '{"tampered":true}');

      await assertRejects(
        () => store.save(fp, text),
        Error,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Corruption detection on read ─────────────────────────────────────────────

Deno.test(
  "A capture store detects later corruption on read by re-hashing the stored bytes",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-file-capture-store-",
    });
    try {
      const store = new FileCaptureStore({
        ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
        directory,
      });
      const text = '{"integrity":"verified"}';
      const fp = await sha256Fingerprint({ integrity: "verified" });
      await store.save(fp, text);

      // Tamper with the file directly to simulate on-disk corruption.
      await Deno.writeTextFile(store.pathFor(fp), '{"tampered":true}');

      await assertRejects(
        () => store.read(fp),
        Error,
        "does not match its filename digest",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "A torn pre-existing final capture is never overwritten and a clean retry can publish it",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-file-capture-store-",
    });
    try {
      const store = new FileCaptureStore({
        ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
        directory,
      });
      const text = '{"crash":"recovery"}';
      const fp = await sha256Fingerprint({ crash: "recovery" });
      // This represents an old direct-final write interrupted before all bytes
      // reached disk. A new save must surface it, not silently overwrite it.
      await Deno.writeTextFile(store.pathFor(fp), '{"crash":');
      await assertRejects(() => store.save(fp, text), Error, "already exists");
      await assertRejects(
        () => store.read(fp),
        Error,
        "does not match its filename digest",
      );

      await Deno.remove(store.pathFor(fp));
      await store.save(fp, text);
      assertEquals(await store.read(fp), text);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "Concurrent identical capture writers publish one complete idempotent final file",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-file-capture-store-",
    });
    try {
      const descriptor = {
        ...PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
        directory,
      };
      const left = new FileCaptureStore(descriptor);
      const right = new FileCaptureStore(descriptor);
      const text = '{"concurrent":true}';
      const fp = await sha256Fingerprint({ concurrent: true });
      await Promise.all([left.save(fp, text), right.save(fp, text)]);
      assertEquals(await left.read(fp), text);
      assertEquals(
        [...(await Array.fromAsync(Deno.readDir(directory)))].filter((entry) =>
          entry.name.endsWith(".tmp")
        ).length,
        0,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── save() return value includes uri and path ────────────────────────────────
//
// Migrated from file-approved-brief-baseline-capture-store_test.ts and
// file-syson-model-seed-capture-store_test.ts, which relied on both fields.

Deno.test(
  "A capture store save returns the exact uri and path for the persisted fingerprint",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-file-capture-store-",
    });
    try {
      const store = new FileCaptureStore({
        ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
        directory,
      });
      const text = '{"documentary":true}';
      const fp = await sha256Fingerprint({ documentary: true });

      const result = await store.save(fp, text);

      assertEquals(result.uri, `casys://approved-brief-capture/sha256/${fp.digest}`);
      assertEquals(result.path, store.pathFor(fp));
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Restart persistence ──────────────────────────────────────────────────────
//
// Two separate store instances over the same directory must agree on the
// persisted content; the filesystem is the truth, not any in-memory state.
// Migrated from file-syson-model-seed-capture-store_test.ts.

Deno.test(
  "A capture store written by one instance is readable by a second instance over the same directory",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-file-capture-store-",
    });
    try {
      const text = '{"rootPackage":"package-1"}';
      const fp = await sha256Fingerprint({ rootPackage: "package-1" });

      const first = new FileCaptureStore({
        ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
        directory,
      });
      await first.save(fp, text);

      const restarted = new FileCaptureStore({
        ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
        directory,
      });
      assertEquals(await restarted.read(fp), text);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Missing entry ────────────────────────────────────────────────────────────

Deno.test(
  "A capture store returns undefined for a fingerprint that was never saved",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-file-capture-store-",
    });
    try {
      const store = new FileCaptureStore({
        ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
        directory,
      });
      const fp = await sha256Fingerprint({ missing: true });
      assertEquals(await store.read(fp), undefined);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

// ── Anchored-path integrity ─────────────────────────────────────────────────

Deno.test({
  name: "A capture store refuses symlinked roots and ancestors before writing",
  ignore: Deno.build.os === "windows",
  async fn() {
    const base = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "casys-file-capture-symlink-root-" }),
    );
    try {
      const text = '{"symlink":"root"}';
      const fingerprint = await sha256Fingerprint({ symlink: "root" });
      const target = `${base}/target`;
      const linkedRoot = `${base}/linked-root`;
      await Deno.mkdir(target, { mode: 0o700 });
      await Deno.symlink(target, linkedRoot);
      const linkedStore = new FileCaptureStore({
        ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
        directory: linkedRoot,
      });

      await assertRejects(
        () => linkedStore.save(fingerprint, text),
        Error,
        "root and ancestors",
      );
      assertEquals([...(await Array.fromAsync(Deno.readDir(target)))], []);

      const trusted = `${base}/trusted`;
      const ancestorTarget = `${base}/ancestor-target`;
      const linkedAncestor = `${trusted}/linked-ancestor`;
      await Deno.mkdir(trusted, { mode: 0o700 });
      await Deno.mkdir(ancestorTarget, { mode: 0o700 });
      await Deno.symlink(ancestorTarget, linkedAncestor);
      const ancestorStore = new FileCaptureStore({
        ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
        directory: `${linkedAncestor}/captures`,
      });

      await assertRejects(
        () => ancestorStore.save(fingerprint, text),
        Error,
        "root and ancestors",
      );
      assertEquals(
        [...(await Array.fromAsync(Deno.readDir(ancestorTarget)))],
        [],
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "A capture store refuses an identical final-file symlink on read and idempotent save",
  ignore: Deno.build.os === "windows",
  async fn() {
    const directory = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "casys-file-capture-symlink-final-" }),
    );
    try {
      const store = new FileCaptureStore({
        ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
        directory,
      });
      const text = '{"symlink":"final"}';
      const fingerprint = await sha256Fingerprint({ symlink: "final" });
      const outside = `${directory}/outside.json`;
      await Deno.writeTextFile(outside, text);
      await Deno.symlink(outside, store.pathFor(fingerprint));

      await assertRejects(
        () => store.read(fingerprint),
        Error,
        "regular file",
      );
      await assertRejects(
        () => store.save(fingerprint, text),
        Error,
        "regular file",
      );
      assertEquals(await Deno.readTextFile(outside), text);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name: "A capture store rejects a root substituted by a symlink after a durable write",
  ignore: Deno.build.os === "windows",
  async fn() {
    const base = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "casys-file-capture-root-substitution-" }),
    );
    try {
      const root = `${base}/captures`;
      const outside = `${base}/outside`;
      const store = new FileCaptureStore({
        ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
        directory: root,
      });
      const text = '{"substitution":"root"}';
      const fingerprint = await sha256Fingerprint({ substitution: "root" });
      await store.save(fingerprint, text);

      await Deno.mkdir(outside, { mode: 0o700 });
      await Deno.writeTextFile(
        `${outside}/${fingerprint.digest}.json`,
        text,
      );
      await Deno.rename(root, `${base}/captures-retained`);
      await Deno.symlink(outside, root);

      await assertRejects(
        () => store.read(fingerprint),
        Error,
        "root and ancestors",
      );
      assertEquals(
        await Deno.readTextFile(`${outside}/${fingerprint.digest}.json`),
        text,
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
});
