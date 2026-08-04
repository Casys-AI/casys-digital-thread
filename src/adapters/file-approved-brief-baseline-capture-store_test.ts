import { assertEquals, assertRejects } from "@std/assert";
import { sha256Fingerprint } from "../domain/deterministic-json.ts";
import { FileApprovedBriefBaselineCaptureStore } from "./file-approved-brief-baseline-capture-store.ts";

Deno.test("approved-brief capture store persists immutable content-addressed bytes", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-approved-brief-capture-",
  });
  try {
    const store = new FileApprovedBriefBaselineCaptureStore(directory);
    const text = '{"documentary":true}';
    const fingerprint = await sha256Fingerprint({ documentary: true });

    const first = await store.save(fingerprint, text);
    const replay = await store.save(fingerprint, text);

    assertEquals(first, replay);
    assertEquals(await store.read(fingerprint), text);
    assertEquals(
      first.uri,
      `casys://approved-brief-capture/sha256/${fingerprint.digest}`,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("approved-brief capture store rejects bytes that do not match the declared digest", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-approved-brief-capture-",
  });
  try {
    const store = new FileApprovedBriefBaselineCaptureStore(directory);
    const fingerprint = await sha256Fingerprint({ documentary: true });
    await assertRejects(
      () => store.save(fingerprint, '{"documentary":false}'),
      Error,
      "does not match declared sha256",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
