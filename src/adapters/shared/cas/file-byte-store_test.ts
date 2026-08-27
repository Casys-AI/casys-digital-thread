import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  fingerprintResourceBytes,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import { ByteStoreIntegrityError, FileByteStore } from "./file-byte-store.ts";

async function fixture(bytes: Uint8Array, seams = {}) {
  const directory = await Deno.makeTempDir();
  const digest = await fingerprintResourceBytes(bytes);
  const store = new FileByteStore(
    {
      kind: "provider-artifact",
      directory,
      uriNamespace: "provider-artifact-capture",
      label: "Provider artifact",
    } as const,
    seams,
  );
  return {
    directory,
    digest,
    fingerprint: { algorithm: "sha256", digest } as const,
    store,
  };
}

Deno.test("FileByteStore writes all partial chunks, fsyncs, and rereads exact bytes", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
  let chunks = 0;
  let syncedDirectory = "";
  const context = await fixture(bytes, {
    writeChunk: async (file: Deno.FsFile, remaining: Uint8Array) => {
      chunks += 1;
      return await file.write(remaining.subarray(0, Math.min(2, remaining.length)));
    },
    syncDirectory: (directory: string) => {
      syncedDirectory = directory;
      return Promise.resolve();
    },
  });
  try {
    const saved = await context.store.save(context.fingerprint, bytes);
    assertEquals(chunks, 4);
    assertEquals(syncedDirectory, context.directory);
    assertEquals({
      kind: saved.kind,
      uri: saved.uri,
      fingerprint: saved.fingerprint,
      byteCount: saved.byteCount,
      verification: saved.verification,
    }, {
      kind: "provider-artifact",
      uri: `casys://provider-artifact-capture/sha256/${context.digest}`,
      fingerprint: context.fingerprint,
      byteCount: bytes.byteLength,
      verification: "reread-after-atomic-publication",
    });
    assertEquals((await context.store.read(context.fingerprint))?.copy(), bytes);
    assertEquals(saved.copyBytes(), bytes);
  } finally {
    await Deno.remove(context.directory, { recursive: true });
  }
});

Deno.test("FileByteStore stores and verifies a zero-byte object", async () => {
  const bytes = new Uint8Array();
  const context = await fixture(bytes);
  try {
    const saved = await context.store.save(context.fingerprint, bytes);
    assertEquals(saved.byteCount, 0);
    assertEquals((await context.store.read(context.fingerprint))?.copy(), bytes);
  } finally {
    await Deno.remove(context.directory, { recursive: true });
  }
});

Deno.test("FileByteStore concurrently saves the same digest idempotently without overwrite", async () => {
  const bytes = new TextEncoder().encode("same immutable provider output");
  const context = await fixture(bytes);
  try {
    const [first, second] = await Promise.all([
      context.store.save(context.fingerprint, bytes),
      context.store.save(context.fingerprint, Uint8Array.from(bytes)),
    ]);
    assertEquals(first, second);
    const entries = [];
    for await (const entry of Deno.readDir(context.directory)) {
      entries.push(entry.name);
    }
    assertEquals(entries, [context.digest]);
  } finally {
    await Deno.remove(context.directory, { recursive: true });
  }
});

Deno.test("FileByteStore synchronizes every concurrent receipt before returning it", async () => {
  const bytes = new TextEncoder().encode("same immutable provider output");
  let syncCalls = 0;
  let releaseSync!: () => void;
  const syncReleased = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  let bothSyncing!: () => void;
  const bothEnteredSync = new Promise<void>((resolve) => {
    bothSyncing = resolve;
  });
  const context = await fixture(bytes, {
    syncDirectory: async () => {
      syncCalls += 1;
      if (syncCalls === 2) bothSyncing();
      await syncReleased;
    },
  });
  try {
    let firstReturned = false;
    let secondReturned = false;
    const first = context.store.save(context.fingerprint, bytes).then((receipt) => {
      firstReturned = true;
      return receipt;
    });
    const second = context.store.save(context.fingerprint, Uint8Array.from(bytes)).then(
      (receipt) => {
        secondReturned = true;
        return receipt;
      },
    );

    await bothEnteredSync;
    assertEquals(firstReturned, false);
    assertEquals(secondReturned, false);
    releaseSync();
    const [firstReceipt, secondReceipt] = await Promise.all([first, second]);
    assertEquals(syncCalls, 2);
    assertEquals(firstReceipt, secondReceipt);
  } finally {
    await Deno.remove(context.directory, { recursive: true });
  }
});

Deno.test("FileByteStore returns independent copies and reports missing objects", async () => {
  const bytes = new Uint8Array([10, 20, 30]);
  const context = await fixture(bytes);
  try {
    assertEquals(await context.store.read(context.fingerprint), undefined);
    await context.store.save(context.fingerprint, bytes);
    const first = (await context.store.read(context.fingerprint))?.copy();
    const second = (await context.store.read(context.fingerprint))?.copy();
    if (!first || !second) throw new Error("expected stored bytes");
    first[0] = 99;
    assertEquals(second, bytes);
    assertNotEquals(first, second);
  } finally {
    await Deno.remove(context.directory, { recursive: true });
  }
});

Deno.test("FileByteStore fails closed on fingerprint mismatch and on tampered collision", async () => {
  const bytes = new Uint8Array([5, 6, 7]);
  const context = await fixture(bytes);
  try {
    await assertRejects(
      () =>
        context.store.save(
          { algorithm: "sha256", digest: "a".repeat(64) },
          bytes,
        ),
      ByteStoreIntegrityError,
      "do not match",
    );

    await context.store.save(context.fingerprint, bytes);
    await Deno.writeFile(
      `${context.directory}/${context.digest}`,
      new Uint8Array([9, 9, 9]),
    );
    await assertRejects(
      () => context.store.read(context.fingerprint),
      ByteStoreIntegrityError,
      "failed sha256 verification",
    );
    await assertRejects(
      () => context.store.save(context.fingerprint, bytes),
      ByteStoreIntegrityError,
      "failed sha256 verification",
    );
  } finally {
    await Deno.remove(context.directory, { recursive: true });
  }
});

Deno.test("FileByteStore removes a partial temporary object when write progress stops", async () => {
  const bytes = new Uint8Array([1, 2]);
  const context = await fixture(bytes, {
    writeChunk: () => Promise.resolve(0),
  });
  try {
    await assertRejects(
      () => context.store.save(context.fingerprint, bytes),
      ByteStoreIntegrityError,
      "no write progress",
    );
    const entries = [];
    for await (const entry of Deno.readDir(context.directory)) {
      entries.push(entry.name);
    }
    assertEquals(entries, []);
  } finally {
    await Deno.remove(context.directory, { recursive: true });
  }
});
