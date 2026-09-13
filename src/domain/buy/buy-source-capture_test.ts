import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sha256Hex } from "../kernel/deterministic-json.ts";
import {
  assertBuySourceCaptureFingerprint,
  BUY_SOURCE_CAPTURE_SCHEMA,
  validateBuySourceCaptureEnvelope,
} from "./buy-source-capture.ts";
import { BUY_FIXTURE_SITE } from "./buy-fixtures.ts";

const FIXTURE_DIR = new URL(
  "../../adapters/buy/fixtures/",
  import.meta.url,
);

async function readFixture(name: string): Promise<string> {
  return await Deno.readTextFile(new URL(name, FIXTURE_DIR));
}

function stripTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

Deno.test("accepts the producer capture wrapper and hashes inner canonicalText", async () => {
  const wrapperText = stripTrailingNewline(
    await readFixture("buy-source-capture.wrapper.json"),
  );
  const canonicalText = stripTrailingNewline(
    await readFixture("buy-source-capture.canonical.json"),
  );
  const envelope = validateBuySourceCaptureEnvelope(JSON.parse(wrapperText));
  await assertBuySourceCaptureFingerprint(envelope, sha256Hex);
  assertEquals(envelope.schemaVersion, BUY_SOURCE_CAPTURE_SCHEMA);
  assertEquals(envelope.canonicalText, canonicalText);
  assertEquals(envelope.byteCount, 2435);
  assertEquals(
    envelope.fingerprint,
    "sha256:aa33230c6af6abc929f1687ce6ffc00ccf920510e58efa3c53ec71f4dbbe9d5a",
  );
  assertEquals(envelope.capture.sourceInstance.kind, "erpnext-site");
  assertEquals(envelope.capture.sourceInstance.siteId, BUY_FIXTURE_SITE);
  assertEquals(envelope.capture.consistency.kind, "repeated-read");
  assertEquals(envelope.capture.documents[0]?.modified.includes("Z"), false);
});

Deno.test("rejects a canonicalText that does not match the capture payload", async () => {
  const wrapper = JSON.parse(
    stripTrailingNewline(await readFixture("buy-source-capture.wrapper.json")),
  );
  assertThrows(
    () =>
      validateBuySourceCaptureEnvelope({
        ...wrapper,
        canonicalText: wrapper.canonicalText.replace("EUR", "USD"),
      }),
    TypeError,
    "canonicalText",
  );
});

Deno.test("rejects a fingerprint that does not match canonicalText bytes", async () => {
  const wrapper = JSON.parse(
    stripTrailingNewline(await readFixture("buy-source-capture.wrapper.json")),
  );
  const envelope = validateBuySourceCaptureEnvelope(wrapper);
  await assertRejects(
    () =>
      assertBuySourceCaptureFingerprint({
        ...envelope,
        fingerprint: `sha256:${"0".repeat(64)}`,
      }, sha256Hex),
    TypeError,
    "fingerprint",
  );
});

Deno.test("refuses to treat a timezone-less modified token as UTC", async () => {
  const wrapper = JSON.parse(
    stripTrailingNewline(await readFixture("buy-source-capture.wrapper.json")),
  );
  const envelope = validateBuySourceCaptureEnvelope(wrapper);
  const modified = envelope.capture.documents.find((item) =>
    item.doctype === "Item Price"
  )?.modified;
  assertEquals(modified, "2026-09-01 08:00:00.000000");
});
