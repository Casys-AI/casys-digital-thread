import { assertEquals, assertRejects } from "@std/assert";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import { mechanicalProofCaseSourceText } from "../../../testing/fea-proof-case-source-fixtures.ts";
import {
  FeaProofCaseSourceCaptureError,
  FeaProofCaseSourceCaptureService,
} from "./fea-proof-case-source-capture.ts";

function captureService(root: string): FeaProofCaseSourceCaptureService {
  return new FeaProofCaseSourceCaptureService({
    sourceCaptures: new FileByteStore({
      kind: "fea-proof-case-source",
      directory: `${root}/sources`,
      uriNamespace: "fea-proof-case-source",
      label: "FEA proof-case source",
    }),
  });
}

Deno.test("FEA proof-case source capture stores canonical JSON and reopens identically", async () => {
  const root = await Deno.makeTempDir({ prefix: "fea-proof-source-capture-" });
  try {
    const service = captureService(root);
    const reference = await service.capture(mechanicalProofCaseSourceText());
    assertEquals(/^[a-f0-9]{64}$/.test(reference.fingerprint), true);
    const reopened = await service.reopen(reference);
    assertEquals(reopened.source.id, "bracket-br01-static");
    assertEquals(reopened.reference.fingerprint, reference.fingerprint);
    const again = await service.capture(reopened.sourceText);
    assertEquals(again.fingerprint, reference.fingerprint);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("FEA proof-case source capture refuses forbidden authorization and extra keys", async () => {
  const root = await Deno.makeTempDir({ prefix: "fea-proof-source-forbidden-" });
  try {
    const service = captureService(root);
    const error = await assertRejects(
      () =>
        service.capture(JSON.stringify({
          ...JSON.parse(mechanicalProofCaseSourceText()),
          authorization: { workItemId: "w", decisionId: "d" },
        })),
      FeaProofCaseSourceCaptureError,
    );
    assertEquals(error.code, "source_parse_failed");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("FEA proof-case source reopen reports absent CAS", async () => {
  const root = await Deno.makeTempDir({ prefix: "fea-proof-source-absent-" });
  try {
    const service = captureService(root);
    const error = await assertRejects(
      () => service.reopen({ fingerprint: "a".repeat(64) }),
      FeaProofCaseSourceCaptureError,
    );
    assertEquals(error.code, "source_absent");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
