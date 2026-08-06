import { assertEquals, assertRejects } from "@std/assert";
import { compileCoffeeMachineCm01SemanticCadPlan } from "../../domain/cm01/coffee-machine-cm01-semantic-cad-plan.ts";
import { parseCoffeeMachineCm01SemanticRecipe } from "../../domain/cm01/coffee-machine-cm01-semantic-recipe.ts";
import {
  captureCm01SemanticCadExport,
  parseCm01SemanticCadCapture,
} from "./cm01-semantic-cad-capture.ts";
import type { McpToolCall, McpToolResult } from "../mcp/http-mcp-tool-client.ts";

Deno.test("CM-01 semantic CAD capture accepts the real build123d path contract but persists only safe basenames and hashes", async () => {
  const client = new FakeBuild123d();
  const capture = await captureCm01SemanticCadExport(
    client,
    await compiled(),
    () => "2026-08-03T15:00:00.000Z",
  );
  assertEquals(client.calls[0], {
    name: "build123d_export",
    arguments: {
      script: (await compiled()).script,
      formats: ["step", "gltf", "stl"],
      name: "coffee-machine-cm01-v3",
      timeout_ms: 120000,
    },
  });
  assertEquals(capture.files.map((file) => [file.format, file.name]), [
    ["step", "coffee-machine-cm01-v3.step"],
    ["gltf", "coffee-machine-cm01-v3.glb"],
    ["stl", "coffee-machine-cm01-v3.stl"],
  ]);
  assertEquals(JSON.stringify(capture).includes("/srv/exports"), false);
  assertEquals(
    (await parseCm01SemanticCadCapture(capture)).fingerprint,
    capture.fingerprint,
  );
});

Deno.test("CM-01 semantic CAD capture fails closed when build123d omits a file hash", async () => {
  const client = new FakeBuild123d();
  client.result.files[0] = { ...client.result.files[0], sha256: undefined };
  const plan = await compiled();
  await assertRejects(
    () => captureCm01SemanticCadExport(client, plan),
    Error,
    "must be an object",
  );
});

Deno.test("CM-01 semantic CAD capture rejects a provider-controlled basename", async () => {
  const client = new FakeBuild123d();
  client.result.files[0] = {
    ...client.result.files[0],
    path: "/srv/exports/other.step",
  };
  const plan = await compiled();
  await assertRejects(
    () => captureCm01SemanticCadExport(client, plan),
    Error,
    "fixed CM-01 export basename",
  );
});

async function compiled() {
  const recipe = parseCoffeeMachineCm01SemanticRecipe(
    JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../../../config/product-recipes/coffee-machine-cm01-v1.json",
          import.meta.url,
        ),
      ),
    ),
  );
  return await compileCoffeeMachineCm01SemanticCadPlan(recipe);
}

class FakeBuild123d {
  calls: McpToolCall[] = [];
  result: {
    schemaVersion: string;
    kind: string;
    metrics: Record<string, unknown>;
    files: Array<Record<string, unknown>>;
  } = {
    schemaVersion: "1.0",
    kind: "export",
    metrics: {},
    files: [
      {
        format: "step",
        path: "/srv/exports/coffee-machine-cm01-v3.step",
        bytes: 101,
        sha256: "a".repeat(64),
      },
      {
        format: "gltf",
        path: "/srv/exports/coffee-machine-cm01-v3.glb",
        bytes: 102,
        sha256: "b".repeat(64),
        viewer: {
          toolName: "build123d_export_read",
          name: "coffee-machine-cm01-v3.glb",
        },
      },
      {
        format: "stl",
        path: "/srv/exports/coffee-machine-cm01-v3.stl",
        bytes: 103,
        sha256: "c".repeat(64),
      },
    ],
  };

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    return Promise.resolve({
      structuredContent: structuredClone(this.result),
      text: "ok",
    });
  }
}
