import { assertEquals } from "@std/assert";
import { validLedDriverHumanSourceText } from "../../../testing/led-driver-source-fixtures.ts";
import { validateLedDriverHumanSource } from "./led-driver-human-source.ts";
import {
  assembleLedDriverSourceCaptureDocument,
  fingerprintLedDriverSourceCapture,
  LED_DRIVER_SOURCE_CAPTURE_SCHEMA,
  sameLedDriverSourceFacts,
  validateLedDriverSourceCaptureDocument,
} from "./led-driver-source-capture.ts";

const SHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

Deno.test("LED-driver source capture assembles identity, bytes and unresolved unknowns", async () => {
  const source = validateLedDriverHumanSource(
    JSON.parse(validLedDriverHumanSourceText()),
  );
  const document = assembleLedDriverSourceCaptureDocument({
    source,
    sha256: SHA256,
    byteCount: 128,
    casUri: `casys://led-driver-source/sha256/${SHA256}`,
  });
  assertEquals(document.schemaVersion, LED_DRIVER_SOURCE_CAPTURE_SCHEMA);
  assertEquals(document.kind, "led-driver-source");
  assertEquals(document.identity.id, source.id);
  assertEquals(document.identity.revision, source.revision);
  assertEquals(document.provenance.authorId, source.provenance.authorId);
  assertEquals(document.source.byteCount, 128);
  assertEquals(document.unknowns[0]?.status, "unresolved");
  assertEquals(sameLedDriverSourceFacts(document, source), true);
  const again = validateLedDriverSourceCaptureDocument(document);
  assertEquals(
    (await fingerprintLedDriverSourceCapture(document)).digest,
    (await fingerprintLedDriverSourceCapture(again)).digest,
  );
});

Deno.test("LED-driver source capture refuses a CAS URI that does not match sha256", () => {
  const source = validateLedDriverHumanSource(
    JSON.parse(validLedDriverHumanSourceText()),
  );
  const other = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const error = assertThrowsOn(() =>
    assembleLedDriverSourceCaptureDocument({
      source,
      sha256: SHA256,
      byteCount: 128,
      casUri: `casys://led-driver-source/sha256/${other}`,
    })
  );
  assertEquals(error.message.includes("casUri"), true);
});

Deno.test("LED-driver source capture refuses a mutable latest alias", () => {
  const source = validateLedDriverHumanSource(
    JSON.parse(validLedDriverHumanSourceText()),
  );
  const document = assembleLedDriverSourceCaptureDocument({
    source,
    sha256: SHA256,
    byteCount: 128,
    casUri: `casys://led-driver-source/sha256/${SHA256}`,
  });
  const forged = {
    ...document,
    source: { ...document.source, casUri: "casys://led-driver-source/latest" },
  };
  const error = assertThrowsOn(() => validateLedDriverSourceCaptureDocument(forged));
  assertEquals(error.message.includes("casUri"), true);
});

function assertThrowsOn(run: () => unknown): TypeError {
  try {
    run();
  } catch (error) {
    if (error instanceof TypeError) return error;
    throw error;
  }
  throw new Error("expected TypeError");
}
