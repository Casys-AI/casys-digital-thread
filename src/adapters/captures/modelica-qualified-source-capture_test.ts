import { assertEquals, assertRejects } from "@std/assert";
import {
  createProviderResourceRead,
  fingerprintResourceBytes,
} from "../../domain/analysis/provider-resource-reader.ts";
import { FileByteStore } from "./file-byte-store.ts";
import { ModelicaQualifiedSourceCaptureService } from "./modelica-qualified-source-capture.ts";

Deno.test("qualified Modelica source capture rejects invalid UTF-8 even when its content hash is exact", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-source-capture-utf8-",
  });
  try {
    const captures = new FileByteStore({
      kind: "modelica-qualified-source-capture",
      directory: `${directory}/captures`,
      uriNamespace: "modelica-qualified-source-capture",
      label: "Modelica source capture",
    });
    const bytes = new Uint8Array([0xff]);
    const digest = await fingerprintResourceBytes(bytes);
    const receipt = await captures.save({ algorithm: "sha256", digest }, bytes);
    const service = new ModelicaQualifiedSourceCaptureService({
      reader: { read: () => Promise.reject(new Error("unused")) },
      artifacts: new FileByteStore({
        kind: "modelica-qualified-source",
        directory: `${directory}/sources`,
        uriNamespace: "modelica-qualified-source",
        label: "Modelica source",
      }),
      captures,
    });
    await assertRejects(
      () =>
        service.reopenCapture({
          uri: receipt.uri,
          byteCount: receipt.byteCount,
          sha256: receipt.fingerprint.digest,
        }),
      Error,
      "not valid UTF-8",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("qualified Modelica source capture orders persisted roles by protocol code units", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-source-capture-order-",
  });
  try {
    const model = new TextEncoder().encode("model M end M;");
    const scenario = new TextEncoder().encode("{}");
    const modelDigest = await fingerprintResourceBytes(model);
    const scenarioDigest = await fingerprintResourceBytes(scenario);
    const calls: string[] = [];
    const service = new ModelicaQualifiedSourceCaptureService({
      reader: {
        async read(expected) {
          calls.push(expected.uri);
          const bytes = expected.uri.endsWith("model.mo") ? model : scenario;
          return await createProviderResourceRead(expected, bytes);
        },
      },
      artifacts: new FileByteStore({
        kind: "modelica-qualified-source",
        directory: `${directory}/sources`,
        uriNamespace: "modelica-qualified-source",
        label: "Modelica source",
      }),
      captures: new FileByteStore({
        kind: "modelica-qualified-source-capture",
        directory: `${directory}/captures`,
        uriNamespace: "modelica-qualified-source-capture",
        label: "Modelica source capture",
      }),
    });
    const captured = await service.capture({
      selection: { modelId: "kit", modelVersion: "1", scenarioId: "case" },
      manifestFingerprint: "a".repeat(64),
      resources: [{
        role: "scenario",
        uri: "casys://modelica/scenarios/case.json",
        mediaType: "application/json",
        byteCount: scenario.byteLength,
        sha256: scenarioDigest,
      }, {
        role: "model",
        uri: "casys://modelica/kits/kit/model.mo",
        mediaType: "text/x-modelica",
        byteCount: model.byteLength,
        sha256: modelDigest,
      }],
    });
    assertEquals(calls, [
      "casys://modelica/kits/kit/model.mo",
      "casys://modelica/scenarios/case.json",
    ]);
    assertEquals(captured.document.artifacts.map((entry) => entry.role), [
      "model",
      "scenario",
    ]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
