import { assertEquals, assertRejects } from "@std/assert";
import { FileByteStore } from "../../../../adapters/shared/cas/file-byte-store.ts";
import { FeaProofCaseSourceCaptureService } from "../../../../adapters/fea/seal-case/fea-proof-case-source-capture.ts";
import { mechanicalProofCaseSourceText } from "../../../../testing/fea-proof-case-source-fixtures.ts";
import { persistAgentResourceText } from "../../../../testing/agent-resource-test-support.ts";
import {
  PrepareProjectFeaProofCaseCapture,
  ProjectFeaProofCaseCaptureError,
} from "./prepare-project-fea-proof-case-capture.ts";

Deno.test("FEA proof-case capture returns a reference-only review", async () => {
  const root = await Deno.makeTempDir({ prefix: "fea-proof-source-app-" });
  try {
    const captures = new FeaProofCaseSourceCaptureService({
      sourceCaptures: new FileByteStore({
        kind: "fea-proof-case-source",
        directory: `${root}/sources`,
        uriNamespace: "fea-proof-case-source",
        label: "FEA proof-case source",
      }),
    });
    const persisted = await persistAgentResourceText(`${root}/agent-resources`, {
      name: "proof.json",
      mimeType: "application/json",
      text: mechanicalProofCaseSourceText(),
    });
    const review = await new PrepareProjectFeaProofCaseCapture({
      captures,
      resources: persisted.reopen,
    })
      .capture({ resourceRef: persisted.reference });
    assertEquals(review.schemaVersion, "fea-proof-case-source-capture-review/1.0");
    assertEquals(review.status, "captured");
    assertEquals(review.grants, "none");
    assertEquals(review.id, "bracket-br01-static");
    assertEquals("source" in review, false);
    assertEquals("decisionParameters" in review, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("FEA proof-case capture refuses extra caller fields", async () => {
  const capture = new PrepareProjectFeaProofCaseCapture({
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
          name: "proof.json",
          mimeType: "application/json",
          representation: "text",
          byteCount: 2,
          fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        },
        provider: "calculix",
      } as never),
    ProjectFeaProofCaseCaptureError,
  );
  assertEquals(error.code, "invalid_request");
});
