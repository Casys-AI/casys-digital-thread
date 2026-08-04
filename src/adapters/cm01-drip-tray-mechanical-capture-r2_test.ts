import { assertEquals, assertRejects } from "@std/assert";
import { deriveCm01DripTrayHeight30Proof } from "../domain/cm01-drip-tray-height-correction.ts";
import { parseCm01DripTrayMechanicalProof } from "../domain/cm01-drip-tray-mechanical-proof.ts";
import {
  captureCm01DripTrayMechanicalR2,
  parseCm01DripTrayMechanicalR2Capture,
} from "./cm01-drip-tray-mechanical-capture-r2.ts";
import type { McpToolCall, McpToolResult } from "./http-mcp-tool-client.ts";

const SHA = "ea061880c9efc043fa0ad8475594a12c447481723e4e46dfdd7dc62a8dca3c84";

Deno.test("CM-01 R2 mechanical capture attests the isolated 30 mm STEP consumed by CalculiX", async () => {
  const build123d = new RecordingClient([exportResult()]);
  const calculix = new RecordingClient([solveResult()]);
  const capture = await captureCm01DripTrayMechanicalR2(
    build123d,
    calculix,
    await proof(),
    () => "2026-08-03T18:05:00.000Z",
  );
  assertEquals(
    build123d.calls[0]?.arguments?.name,
    "coffee-machine-cm01-v3-drip-tray-height-30",
  );
  assertEquals(calculix.calls[0]?.arguments?.expected_step_sha256, SHA);
  assertEquals(
    calculix.calls[0]?.arguments?.step_path,
    "/exports/coffee-machine-cm01-v3-drip-tray-height-30.step",
  );
  assertEquals(capture.step.name, "coffee-machine-cm01-v3-drip-tray-height-30.step");
  assertEquals(capture.handoff.fingerprint.digest, SHA);
  assertEquals(capture.metrics.maximumVonMises.value, 0.5309183805726515);
  assertEquals(
    (await parseCm01DripTrayMechanicalR2Capture(capture)).fingerprint.digest,
    capture.fingerprint.digest,
  );
});

Deno.test("CM-01 R2 mechanical capture rejects a solver handoff for any other STEP", async () => {
  const answer = solveResult();
  (answer.structuredContent.inputArtifact as Record<string, unknown>).sourcePath =
    "/exports/coffee-machine-cm01-v3-r2.step";
  const r2Proof = await proof();
  await assertRejects(
    () =>
      captureCm01DripTrayMechanicalR2(
        new RecordingClient([exportResult()]),
        new RecordingClient([answer]),
        r2Proof,
      ),
    Error,
    "isolated DripTray STEP source",
  );
});

async function proof() {
  const v1 = parseCm01DripTrayMechanicalProof(
    JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-static.json",
          import.meta.url,
        ),
      ),
    ),
  );
  return deriveCm01DripTrayHeight30Proof(v1);
}
function exportResult(): McpToolResult {
  return {
    text: "",
    structuredContent: {
      schemaVersion: "1.0",
      kind: "export",
      metrics: {},
      files: [{
        format: "step",
        path: "/exports/coffee-machine-cm01-v3-drip-tray-height-30.step",
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
        sourcePath: "/exports/coffee-machine-cm01-v3-drip-tray-height-30.step",
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
