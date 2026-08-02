import { assertEquals, assertRejects } from "@std/assert";
import { sha256Fingerprint } from "../domain/deterministic-json.ts";
import { FileSysonModelSeedCaptureStore } from "./file-syson-model-seed-capture-store.ts";

Deno.test("SysON model-seed capture store persists immutable content-addressed bytes", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-syson-model-seed-capture-",
  });
  try {
    const text = '{"rootPackage":"package-1"}';
    const fingerprint = await sha256Fingerprint({ rootPackage: "package-1" });
    const store = new FileSysonModelSeedCaptureStore(directory);

    const first = await store.save(fingerprint, text);
    const replay = await store.save(fingerprint, text);
    const restarted = new FileSysonModelSeedCaptureStore(directory);

    assertEquals(first, replay);
    assertEquals(await restarted.read(fingerprint), text);
    assertEquals(
      first.uri,
      `casys://syson-model-seed-capture/sha256/${fingerprint.digest}`,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("SysON model-seed capture store rejects bytes that do not match their declared digest", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-syson-model-seed-capture-",
  });
  try {
    const store = new FileSysonModelSeedCaptureStore(directory);
    const fingerprint = await sha256Fingerprint({ rootPackage: "package-1" });

    await assertRejects(
      () => store.save(fingerprint, '{"rootPackage":"package-2"}'),
      Error,
      "does not match declared sha256",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("SysON model-seed capture store detects later corruption on read", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-syson-model-seed-capture-",
  });
  try {
    const text = '{"rootPackage":"package-1"}';
    const fingerprint = await sha256Fingerprint({ rootPackage: "package-1" });
    const store = new FileSysonModelSeedCaptureStore(directory);
    await store.save(fingerprint, text);
    await Deno.writeTextFile(store.pathFor(fingerprint), '{"tampered":true}');

    await assertRejects(
      () => store.read(fingerprint),
      Error,
      "does not match its filename digest",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
