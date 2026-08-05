import { assertEquals, assertRejects } from "@std/assert";
import { compileCoffeeMachineCm01SemanticCadPlanR2 } from "../../domain/coffee-machine-cm01-semantic-cad-plan.ts";
import { deriveCm01DripTrayHeight30Recipe } from "../../domain/cm01-drip-tray-height-correction.ts";
import { parseCoffeeMachineCm01SemanticRecipe } from "../../domain/coffee-machine-cm01-semantic-recipe.ts";
import {
  captureCm01SemanticCadExportR2,
  parseCm01SemanticCadR2Capture,
} from "./cm01-semantic-cad-capture-r2.ts";
import type { McpToolCall, McpToolResult } from "../http-mcp-tool-client.ts";

Deno.test("CM-01 R2 CAD capture accepts only the named successor assembly export", async () => {
  const client = new FakeBuild123d();
  const plan = await compiled();
  const capture = await captureCm01SemanticCadExportR2(
    client,
    plan,
    () => "2026-08-03T18:00:00.000Z",
  );
  assertEquals(client.calls, [{
    name: "build123d_export",
    arguments: {
      script: plan.script,
      formats: ["step", "gltf", "stl"],
      name: "coffee-machine-cm01-v3-r2",
      timeout_ms: 120000,
    },
  }]);
  assertEquals(capture.plan.recipe.key, "cm01-drip-tray-height-30");
  assertEquals(capture.files.map((file) => file.name), [
    "coffee-machine-cm01-v3-r2.step",
    "coffee-machine-cm01-v3-r2.glb",
    "coffee-machine-cm01-v3-r2.stl",
  ]);
  assertEquals(JSON.stringify(capture).includes("/srv/exports"), false);
  assertEquals(
    (await parseCm01SemanticCadR2Capture(capture)).fingerprint,
    capture.fingerprint,
  );
});

Deno.test("CM-01 R2 CAD capture refuses the V1 compiled plan before a provider call", async () => {
  const client = new FakeBuild123d();
  const recipe = parseCoffeeMachineCm01SemanticRecipe(await v1Recipe());
  const { compileCoffeeMachineCm01SemanticCadPlan } = await import(
    "../../domain/coffee-machine-cm01-semantic-cad-plan.ts"
  );
  const v1Plan = await compileCoffeeMachineCm01SemanticCadPlan(recipe);
  await assertRejects(
    () => captureCm01SemanticCadExportR2(client, v1Plan),
    Error,
    "closed 30 mm compiled plan",
  );
  assertEquals(client.calls, []);
});

Deno.test("CM-01 R2 CAD capture rejects provider output under the V1 basename", async () => {
  const client = new FakeBuild123d();
  client.result.files[0] = {
    ...client.result.files[0],
    path: "/srv/exports/coffee-machine-cm01-v3.step",
  };
  const plan = await compiled();
  await assertRejects(
    () => captureCm01SemanticCadExportR2(client, plan),
    Error,
    "fixed CM-01 R2 export basename",
  );
});

async function v1Recipe(): Promise<unknown> {
  return JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../config/product-recipes/coffee-machine-cm01-v1.json",
        import.meta.url,
      ),
    ),
  );
}
async function compiled() {
  return await compileCoffeeMachineCm01SemanticCadPlanR2(
    deriveCm01DripTrayHeight30Recipe(
      parseCoffeeMachineCm01SemanticRecipe(await v1Recipe()),
    ),
  );
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
        path: "/srv/exports/coffee-machine-cm01-v3-r2.step",
        bytes: 101,
        sha256: "a".repeat(64),
      },
      {
        format: "gltf",
        path: "/srv/exports/coffee-machine-cm01-v3-r2.glb",
        bytes: 102,
        sha256: "b".repeat(64),
        viewer: {
          toolName: "build123d_export_read",
          name: "coffee-machine-cm01-v3-r2.glb",
        },
      },
      {
        format: "stl",
        path: "/srv/exports/coffee-machine-cm01-v3-r2.stl",
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
