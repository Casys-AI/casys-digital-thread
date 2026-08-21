import { assertEquals } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../src/application/ports/out/mcp-tool-client.ts";
import {
  ARCHITECTURE_ATTRIBUTE_TYPE_AQL,
  ARCHITECTURE_ATTRIBUTE_VALUE_AQL,
  probeArchitectureAttributeValue,
  renderProbeArchitectureAttributeSysml,
} from "./probe-architecture-attribute-value.ts";

Deno.test(
  "architecture attribute probe stays unresolved on the live OperatorExpression readback",
  async () => {
    const client = new FakeSyson();
    const result = await probeArchitectureAttributeValue({ client });
    assertEquals(result.status, "unresolved");
    assertEquals(result.sandboxProjectDeleted, true);
    assertEquals(
      result.insertedSysml,
      renderProbeArchitectureAttributeSysml(),
    );
    assertEquals(result.readback, {
      kind: "sysml::AttributeUsage",
      label: "probeHandle",
      typeLabel: "LengthValue",
      valueText: "OperatorExpression",
      unit: undefined,
    });
    assertEquals(
      client.names,
      [
        "syson_project_create",
        "syson_model_create",
        "syson_element_insert_sysml",
        "syson_element_children",
        "syson_element_children",
        "syson_element_get",
        "syson_query_aql",
        "syson_query_aql",
        "syson_project_delete",
      ],
    );
    assertEquals(client.expressions, [
      ARCHITECTURE_ATTRIBUTE_TYPE_AQL,
      ARCHITECTURE_ATTRIBUTE_VALUE_AQL,
    ]);
  },
);

Deno.test(
  "architecture attribute probe stays unresolved when FeatureValue rereads OperatorExpression even with a unit",
  async () => {
    const client = new FakeSyson({ valueShape: "operator-with-unit" });
    const result = await probeArchitectureAttributeValue({ client });
    assertEquals(result.status, "unresolved");
    assertEquals(result.readback?.valueText, "OperatorExpression");
    assertEquals(result.readback?.unit, "mm");
  },
);

Deno.test(
  "architecture attribute probe is ok only when type, inserted literal and unit all reread",
  async () => {
    const client = new FakeSyson({ valueShape: "exact-scalar" });
    const result = await probeArchitectureAttributeValue({ client });
    assertEquals(result.status, "ok");
    assertEquals(result.readback, {
      kind: "sysml::AttributeUsage",
      label: "probeHandle",
      typeLabel: "LengthValue",
      valueText: "1",
      unit: "mm",
    });
  },
);

type FakeValueShape = "live" | "exact-scalar" | "operator-with-unit";

class FakeSyson implements McpToolClient {
  readonly names: string[] = [];
  readonly expressions: string[] = [];
  readonly #valueShape: FakeValueShape;

  constructor(options: { readonly valueShape?: FakeValueShape } = {}) {
    this.#valueShape = options.valueShape ?? "live";
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.names.push(call.name);
    if (call.name === "syson_query_aql") {
      const expression = String(call.arguments?.expression ?? "");
      this.expressions.push(expression);
    }
    return Promise.resolve({ text: "", structuredContent: this.#content(call) });
  }

  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("unused"));
  }

  #content(call: McpToolCall): Record<string, unknown> {
    switch (call.name) {
      case "syson_project_create":
        return { id: "project-1", name: "probe", editingContextId: "ctx-1" };
      case "syson_model_create":
        return { rootPackageId: "pkg-1" };
      case "syson_element_insert_sysml":
        return { ok: true };
      case "syson_element_children":
        if (call.arguments?.element_id === "pkg-1") {
          return {
            parentId: "pkg-1",
            count: 1,
            children: [{
              id: "part-1",
              kind: "sysml::PartDefinition",
              label: "ProbePart",
            }],
          };
        }
        return {
          parentId: "part-1",
          count: 1,
          children: [{
            id: "attr-1",
            kind: "sysml::AttributeUsage",
            label: "probeHandle",
          }],
        };
      case "syson_element_get":
        return {
          id: "attr-1",
          kind: "sysml::AttributeUsage",
          label: "probeHandle",
        };
      case "syson_query_aql": {
        const expression = String(call.arguments?.expression ?? "");
        if (expression === ARCHITECTURE_ATTRIBUTE_TYPE_AQL) {
          return {
            objectId: "attr-1",
            expression,
            type: "objects",
            count: 1,
            results: [{
              id: "type-1",
              kind: "sysml::DataType",
              label: "LengthValue",
            }],
          };
        }
        if (this.#valueShape === "exact-scalar") {
          return {
            objectId: "attr-1",
            expression,
            type: "objects",
            count: 1,
            results: [{ value: "1", unit: "mm" }],
          };
        }
        if (this.#valueShape === "operator-with-unit") {
          return {
            objectId: "attr-1",
            expression,
            type: "objects",
            count: 1,
            results: [{
              kind: "sysml::OperatorExpression",
              label: "OperatorExpression",
              unit: "mm",
            }],
          };
        }
        return {
          objectId: "attr-1",
          expression,
          type: "objects",
          count: 1,
          results: [{
            kind: "sysml::OperatorExpression",
            label: "OperatorExpression",
          }],
        };
      }
      case "syson_project_delete":
        return { deleted: true };
      default:
        throw new Error(`unexpected tool ${call.name}`);
    }
  }
}
