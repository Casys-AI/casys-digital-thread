import { assertEquals, assertRejects } from "@std/assert";
import { sha256Fingerprint } from "../domain/deterministic-json.ts";
import { FileCm01NominalModelicaCaptureStore } from "./file-cm01-nominal-modelica-capture-store.ts";

Deno.test("CM-01 Modelica capture store writes and re-hashes immutable content-addressed bytes", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cm01-modelica-capture-" });
  try {
    const text = '{"kind":"cm01-nominal-modelica-capture"}';
    const fingerprint = await sha256Fingerprint({
      kind: "cm01-nominal-modelica-capture",
    });
    const store = new FileCm01NominalModelicaCaptureStore(directory);
    await store.save(fingerprint, text);
    await store.save(fingerprint, text);
    assertEquals(await store.read(fingerprint), text);
    assertEquals(
      store.uriFor(fingerprint),
      `casys://cm01-nominal-modelica-capture/sha256/${fingerprint.digest}`,
    );

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
