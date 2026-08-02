import { assertEquals, assertRejects } from "@std/assert";
import { sha256Fingerprint } from "../domain/deterministic-json.ts";
import { FileInspectionDroneArchitectureCaptureStore } from "./file-inspection-drone-architecture-capture-store.ts";

Deno.test("r3 architecture capture store persists immutable content-addressed text", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-inspection-drone-architecture-capture-",
  });
  try {
    const text = '{"architecturePackage":"InspectionDroneArchitecture"}';
    const fingerprint = await sha256Fingerprint({
      architecturePackage: "InspectionDroneArchitecture",
    });
    const store = new FileInspectionDroneArchitectureCaptureStore(directory);

    const first = await store.save(fingerprint, text);
    const replay = await store.save(fingerprint, text);
    const restarted = new FileInspectionDroneArchitectureCaptureStore(directory);

    assertEquals(first, replay);
    assertEquals(await restarted.read(fingerprint), text);
    assertEquals(
      first.uri,
      `casys://inspection-drone-architecture-capture/sha256/${fingerprint.digest}`,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 architecture capture store rejects text that does not match its declared digest", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-inspection-drone-architecture-capture-",
  });
  try {
    const store = new FileInspectionDroneArchitectureCaptureStore(directory);
    const fingerprint = await sha256Fingerprint({
      architecturePackage: "InspectionDroneArchitecture",
    });

    await assertRejects(
      () => store.save(fingerprint, '{"architecturePackage":"Different"}'),
      Error,
      "does not match declared sha256",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("r3 architecture capture store detects later corruption on read", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-inspection-drone-architecture-capture-",
  });
  try {
    const text = '{"architecturePackage":"InspectionDroneArchitecture"}';
    const fingerprint = await sha256Fingerprint({
      architecturePackage: "InspectionDroneArchitecture",
    });
    const store = new FileInspectionDroneArchitectureCaptureStore(directory);
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

Deno.test("r3 architecture capture store repairs a partial final file during safe resume", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-inspection-drone-architecture-capture-",
  });
  try {
    const text = '{"architecturePackage":"InspectionDroneArchitecture"}';
    const fingerprint = await sha256Fingerprint({
      architecturePackage: "InspectionDroneArchitecture",
    });
    const store = new FileInspectionDroneArchitectureCaptureStore(directory);
    await Deno.writeTextFile(store.pathFor(fingerprint), "{", { createNew: true });

    await store.save(fingerprint, text);

    assertEquals(await store.read(fingerprint), text);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
