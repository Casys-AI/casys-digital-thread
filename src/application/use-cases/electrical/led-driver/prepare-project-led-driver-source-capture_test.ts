import { assertEquals, assertRejects } from "@std/assert";
import { validLedDriverHumanSourceText } from "../../../../testing/led-driver-source-fixtures.ts";
import { persistAgentResourceText } from "../../../../testing/agent-resource-test-support.ts";
import { FileByteStore } from "../../../../adapters/shared/cas/file-byte-store.ts";
import { LedDriverSourceCaptureService } from "../../../../adapters/electrical/led-driver/led-driver-source-capture.ts";
import {
  PrepareProjectLedDriverSourceCapture,
  ProjectLedDriverSourceCaptureError,
} from "./prepare-project-led-driver-source-capture.ts";
import { PrepareProjectLedDriverSourceReview } from "./prepare-project-led-driver-source-review.ts";

Deno.test("LED-driver source capture hashes, rereads, and returns a reviewable reference", async () => {
  const root = await Deno.makeTempDir({ prefix: "led-driver-source-app-capture-" });
  try {
    const captures = new LedDriverSourceCaptureService({
      sourceCaptures: new FileByteStore({
        kind: "led-driver-source",
        directory: `${root}/sources`,
        uriNamespace: "led-driver-source",
        label: "LED-driver human source",
      }),
    });
    const persisted = await persistAgentResourceText(`${root}/agent-resources`, {
      name: "led-driver.json",
      mimeType: "application/json",
      text: validLedDriverHumanSourceText(),
    });
    const review = await new PrepareProjectLedDriverSourceCapture({
      captures,
      resources: persisted.reopen,
    })
      .capture({ resourceRef: persisted.reference });
    assertEquals(review.schemaVersion, "led-driver-source-capture-review/1.0");
    assertEquals(review.status, "unresolved");
    assertEquals(review.grants, "none");
    assertEquals(review.reference.schemaVersion, "led-driver-source-capture/1.0");
    assertEquals(review.reference.identity.id, "fiche.led-driver.desk-lamp");
    assertEquals(review.unknowns.status, "unresolved");
    assertEquals(
      "decisionParameters" in review || "next" in review,
      false,
    );
    const reread = await new PrepareProjectLedDriverSourceReview({ captures })
      .execute({ sourceRef: review.reference });
    assertEquals(reread.reference, review.reference);
    assertEquals(reread.status, review.status);
    assertEquals(reread.unknowns, review.unknowns);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("LED-driver source capture refuses extra authority fields", async () => {
  const capture = new PrepareProjectLedDriverSourceCapture({
    captures: {
      capture: () => {
        throw new Error("must not capture");
      },
      reopen: () => {
        throw new Error("must not reopen");
      },
    },
    resources: {
      reopenUtf8Text: () => {
        throw new Error("must not reopen resource");
      },
    } as never,
  });
  const error = await assertRejects(
    () =>
      capture.capture({
        resourceRef: {
          schemaVersion: "agent-resource-capture/1.0",
          uri: `casys://agent-resource-capture/sha256/${"a".repeat(64)}`,
          name: "led-driver.json",
          mimeType: "application/json",
          representation: "text",
          byteCount: 2,
          fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        },
        provider: "ngspice",
      } as never),
    ProjectLedDriverSourceCaptureError,
  );
  assertEquals(error.code, "invalid_request");
});

Deno.test("LED-driver source capture wraps a failed hash-before-parse write", async () => {
  const root = await Deno.makeTempDir({ prefix: "led-driver-source-fail-" });
  try {
    const persisted = await persistAgentResourceText(root, {
      name: "led-driver.json",
      mimeType: "application/json",
      text: validLedDriverHumanSourceText(),
    });
    const capture = new PrepareProjectLedDriverSourceCapture({
      captures: {
        capture: () => {
          throw new Error("bytes did not persist");
        },
        reopen: () => {
          throw new Error("must not reopen");
        },
      },
      resources: persisted.reopen,
    });
    const error = await assertRejects(
      () => capture.capture({ resourceRef: persisted.reference }),
      ProjectLedDriverSourceCaptureError,
    );
    assertEquals(error.code, "source_capture_failed");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
