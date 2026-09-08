import { assertEquals } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../src/application/ports/out/mcp-tool-client.ts";
import {
  probeRequirementUnits,
  requirementUnitProbeQualifies,
} from "./probe-requirement-units.ts";

Deno.test("unit probe qualifies only after an explicitly confirmed sandbox delete", async () => {
  const result = await probeRequirementUnits({
    unit: "nm",
    sysmlType: "LengthValue",
    client: new FakeSyson(true),
  });
  assertEquals(result.units[0]?.status, "ok");
  assertEquals(result.sandboxProjectDeleted, true);
  assertEquals(requirementUnitProbeQualifies(result), true);
});

Deno.test("unit probe refuses a non-throwing unconfirmed sandbox delete", async () => {
  const result = await probeRequirementUnits({
    unit: "nm",
    sysmlType: "LengthValue",
    client: new FakeSyson(false),
  });
  assertEquals(result.units[0]?.status, "ok");
  assertEquals(result.sandboxProjectDeleted, false);
  assertEquals(requirementUnitProbeQualifies(result), false);
});

class FakeSyson implements McpToolClient {
  constructor(private readonly deleted: boolean) {}

  callTool(call: McpToolCall): Promise<McpToolResult> {
    return Promise.resolve({ text: "", structuredContent: this.content(call) });
  }

  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("unused"));
  }

  private content(call: McpToolCall): Record<string, unknown> {
    switch (call.name) {
      case "syson_project_create":
        return { id: "project-1", editingContextId: "context-1" };
      case "syson_model_create":
        return { rootPackageId: "package-1" };
      case "syson_element_insert_sysml":
        return { ok: true };
      case "syson_element_children":
        return {
          children: [{ id: "part-1", label: "ProbeRequirementsTest" }],
        };
      case "syson_constraint_extract":
        return {
          constraints: [{
            name: "probe_limit",
            expression: {
              kind: "binary",
              op: "<=",
              left: { kind: "ref", featurePath: ["probeValue"] },
              right: { kind: "literal", value: 1, unit: "nm" },
            },
          }],
        };
      case "syson_project_delete":
        return { deleted: this.deleted };
      default:
        throw new Error(`unexpected tool ${call.name}`);
    }
  }
}
