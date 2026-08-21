import { assertEquals, assertRejects } from "@std/assert";
import { validLedDriverHumanSourceText } from "../../../testing/led-driver-source-fixtures.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import {
  LedDriverSourceCaptureError,
  LedDriverSourceCaptureService,
} from "./led-driver-source-capture.ts";

function captureService(root: string): LedDriverSourceCaptureService {
  return new LedDriverSourceCaptureService({
    sourceCaptures: new FileByteStore({
      kind: "led-driver-source",
      directory: `${root}/sources`,
      uriNamespace: "led-driver-source",
      label: "LED-driver human source",
    }),
  });
}

Deno.test("LED-driver capture hashes bytes before parse and reopens identically", async () => {
  const root = await Deno.makeTempDir({ prefix: "led-driver-source-capture-" });
  try {
    const service = captureService(root);
    const sourceText = validLedDriverHumanSourceText();
    const reference = await service.capture(sourceText);
    assertEquals(reference.schemaVersion, "led-driver-source-capture/1.0");
    assertEquals(reference.kind, "led-driver-source");
    assertEquals(reference.identity.id, "fiche.led-driver.desk-lamp");
    assertEquals(reference.identity.revision, 1);
    assertEquals(
      reference.source.byteCount,
      new TextEncoder().encode(sourceText).byteLength,
    );
    assertEquals(reference.unknowns[0]?.status, "unresolved");
    const reopened = await service.reopen(reference);
    assertEquals(reopened.sourceText, sourceText);
    assertEquals(reopened.source.id, reference.identity.id);
    assertEquals(reopened.reference.source.sha256, reference.source.sha256);
    assertEquals(
      reopened.source.unknowns.map((item) => item.status),
      reference.unknowns.map((item) => item.status),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("LED-driver capture refuses a fiche that omits the named circuit after hash", async () => {
  const root = await Deno.makeTempDir({ prefix: "led-driver-source-missing-" });
  try {
    const service = captureService(root);
    const input = JSON.parse(validLedDriverHumanSourceText()) as Record<
      string,
      unknown
    >;
    delete input.circuit;
    const error = await assertRejects(
      () => service.capture(JSON.stringify(input)),
      LedDriverSourceCaptureError,
    );
    assertEquals(error.code, "source_parse_failed");
    assertEquals(error.message.includes("circuit"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("LED-driver reopen blocks a divergent sha256", async () => {
  const root = await Deno.makeTempDir({ prefix: "led-driver-source-hash-" });
  try {
    const service = captureService(root);
    const reference = await service.capture(validLedDriverHumanSourceText());
    const forged = {
      ...reference,
      source: {
        ...reference.source,
        sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        casUri:
          "casys://led-driver-source/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    };
    const error = await assertRejects(
      () => service.reopen(forged),
      LedDriverSourceCaptureError,
    );
    assertEquals(error.code, "source_capture_invalid");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("LED-driver reopen blocks a divergent byte count", async () => {
  const root = await Deno.makeTempDir({ prefix: "led-driver-source-bytes-" });
  try {
    const service = captureService(root);
    const reference = await service.capture(validLedDriverHumanSourceText());
    const forged = {
      ...reference,
      source: { ...reference.source, byteCount: reference.source.byteCount + 1 },
    };
    const error = await assertRejects(
      () => service.reopen(forged),
      LedDriverSourceCaptureError,
    );
    assertEquals(error.code, "source_capture_invalid");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("LED-driver reopen blocks divergent provenance", async () => {
  const root = await Deno.makeTempDir({
    prefix: "led-driver-source-provenance-",
  });
  try {
    const service = captureService(root);
    const reference = await service.capture(validLedDriverHumanSourceText());
    const forged = {
      ...reference,
      provenance: { ...reference.provenance, authorId: "human.other-author" },
    };
    const error = await assertRejects(
      () => service.reopen(forged),
      LedDriverSourceCaptureError,
    );
    assertEquals(error.code, "capture_identity_mismatch");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
