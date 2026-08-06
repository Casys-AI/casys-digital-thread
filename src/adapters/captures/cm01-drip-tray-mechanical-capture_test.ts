import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  parseCm01DripTrayMechanicalProof,
  renderCm01DripTrayMechanicalScript,
} from "../../domain/cm01/cm01-drip-tray-mechanical-proof.ts";
import {
  captureCm01DripTrayMechanical,
  parseCm01DripTrayMechanicalCapture,
} from "./cm01-drip-tray-mechanical-capture.ts";
import {
  CM01_DRIP_TRAY_MECHANICAL_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "./file-capture-store.ts";
import type { McpToolCall, McpToolResult } from "../mcp/http-mcp-tool-client.ts";

const proof = parseCm01DripTrayMechanicalProof({
  schemaVersion: "cm01-v3-drip-tray-static-proof/1.0",
  id: "coffee-machine-cm01-v3-drip-tray-static-proof",
  project: {
    id: "coffee-machine-cm01-v3",
    subjectId: "project:coffee-machine-cm01-v3",
  },
  evidenceBoundary: "concept only",
  geometry: { widthMm: 190, depthMm: 135, heightMm: 28 },
  material: { eMpa: 2200, nu: 0.35 },
  meshSizeMm: 5,
  fixed: { name: "FIXED", box: { min: [-96, 66.5, -15], max: [96, 68.5, 15] } },
  loaded: {
    name: "LOADED",
    box: { min: [-96, -68.5, -15], max: [96, -66.5, 15] },
    forceN: [0, 0, -100],
  },
  limits: { maximumDisplacementMm: 1, maximumVonMisesMpa: 20 },
});
const SHA = "ea061880c9efc043fa0ad8475594a12c447481723e4e46dfdd7dc62a8dca3c84";

Deno.test("CM-01 V3 DripTray capture exports one fixed STEP then binds the same hash into CalculiX", async () => {
  const build123d = new RecordingClient([exportResult()]);
  const calculix = new RecordingClient([solveResult()]);
  const capture = await captureCm01DripTrayMechanical(
    build123d,
    calculix,
    proof,
    () => "2026-08-03T16:00:00.000Z",
  );
  assertEquals(build123d.calls[0]?.name, "build123d_export");
  assertEquals(build123d.calls[0]?.arguments?.name, "coffee-machine-cm01-v3-drip-tray");
  assertEquals(
    build123d.calls[0]?.arguments?.script,
    renderCm01DripTrayMechanicalScript(proof),
  );
  assertEquals(calculix.calls[0]?.arguments?.expected_step_sha256, SHA);
  assertEquals(
    calculix.calls[0]?.arguments?.step_path,
    "/exports/coffee-machine-cm01-v3-drip-tray.step",
  );
  assertEquals(capture.handoff.fingerprint.digest, SHA);
  assertEquals(capture.metrics.maximumDisplacement.value, 0.10363294359363535);
  assertEquals(capture.metrics.maximumVonMises.value, 0.5309183805726515);
  assertEquals(
    (await parseCm01DripTrayMechanicalCapture(capture)).fingerprint.digest,
    capture.fingerprint.digest,
  );
});

Deno.test("CM-01 V3 DripTray capture rejects a CalculiX result whose attested STEP differs", async () => {
  const build123d = new RecordingClient([exportResult()]);
  const result = solveResult();
  (result.structuredContent.inputArtifact as Record<string, unknown>).sha256 = "a"
    .repeat(64);
  await assertRejects(
    () =>
      captureCm01DripTrayMechanical(build123d, new RecordingClient([result]), proof),
    Error,
    "differs from the build123d export",
  );
});

Deno.test("CM-01 V3 DripTray storage addresses complete capture JSON, not its unsigned evidence hash", async () => {
  const capture = await captureCm01DripTrayMechanical(
    new RecordingClient([exportResult()]),
    new RecordingClient([solveResult()]),
    proof,
    () => "2026-08-03T16:00:00.000Z",
  );
  const text = deterministicJson(capture);
  const storageFingerprint = await sha256Fingerprint(capture);
  assertNotEquals(storageFingerprint.digest, capture.fingerprint.digest);
  const directory = await Deno.makeTempDir({
    prefix: "casys-cm01-mechanical-capture-",
  });
  try {
    const store = new FileCaptureStore({
      ...CM01_DRIP_TRAY_MECHANICAL_CAPTURE_DESCRIPTOR,
      directory,
    });
    await store.save(storageFingerprint, text);
    assertEquals(await store.read(storageFingerprint), text);
    await assertRejects(
      () => store.save(capture.fingerprint, text),
      Error,
      "does not match declared sha256",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function exportResult(): McpToolResult {
  return {
    text: "",
    structuredContent: {
      schemaVersion: "1.0",
      kind: "export",
      metrics: {},
      files: [{
        format: "step",
        path: "/exports/coffee-machine-cm01-v3-drip-tray.step",
        bytes: 15490,
        sha256: SHA,
      }],
    },
  };
}
function solveResult(): McpToolResult {
  return {
    text: "",
    structuredContent: {
      schemaVersion: "2.0",
      kind: "static-solve",
      inputArtifact: {
        path: "/tmp/private/input.step",
        sourcePath: "/exports/coffee-machine-cm01-v3-drip-tray.step",
        sha256: SHA,
        bytes: 15490,
      },
      mesh: {
        nodes: 100,
        elements: 50,
        nodesPerSelection: { FIXED: 10, LOADED: 10, PART: 100 },
      },
      constraints: {
        fixedSelections: ["FIXED"],
        loads: [{ selection: "LOADED", forceN: [0, 0, -100] }],
      },
      metrics: {
        maxDisplacement: {
          value: 0.10363294359363535,
          unit: "mm",
          nodeId: 7,
          vectorMm: [0, 0, -0.10363294359363535],
        },
        maxVonMises: { value: 0.5309183805726515, unit: "MPa", elementId: 12 },
      },
    },
  };
}
class RecordingClient {
  calls: McpToolCall[] = [];
  constructor(private readonly answers: McpToolResult[]) {}
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(
        `callToolTextResult is not implemented by this stub (${call.name})`,
      ),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    const answer = this.answers.shift();
    if (!answer) return Promise.reject(new Error("unexpected provider call"));
    return Promise.resolve(structuredClone(answer));
  }
}
