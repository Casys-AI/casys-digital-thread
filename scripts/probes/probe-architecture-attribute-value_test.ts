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
  "architecture attribute probe records insert, readback and cleanup without inventing type or unit",
  async () => {
    const client = new FakeSyson();
    const result = await probeArchitectureAttributeValue({ client });
    assertEquals(result.status, "ok");
    assertEquals(result.sandboxProjectDeleted, true);
    assertEquals(
      result.insertedSysml,
      renderProbeArchitectureAttributeSysml(),
    );
    assertEquals(result.readback, {
      kind: "sysml::AttributeUsage",
      label: "probeHandle",
      typeLabel: "LengthValue",
      valueText: "1",
      unit: "mm",
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
  "architecture attribute probe stays unresolved when value and unit are absent from readback",
  async () => {
    const client = new FakeSyson({ omitValue: true });
    const result = await probeArchitectureAttributeValue({ client });
    assertEquals(result.status, "unresolved");
    assertEquals(result.readback?.typeLabel, "LengthValue");
    assertEquals(result.readback?.unit, undefined);
    assertEquals(result.sandboxProjectDeleted, true);
  },
);

class FakeSyson implements McpToolClient {
  readonly names: string[] = [];
  readonly expressions: string[] = [];
  readonly #omitValue: boolean;

  constructor(options: { readonly omitValue?: boolean } = {}) {
    this.#omitValue = options.omitValue === true;
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
        if (this.#omitValue) {
          return {
            objectId: "attr-1",
            expression,
            type: "objects",
            count: 0,
            results: [],
          };
        }
        return {
          objectId: "attr-1",
          expression,
          type: "objects",
          count: 1,
          results: [{ value: "1", unit: "mm" }],
        };
      }
      case "syson_project_delete":
        return { deleted: true };
      default:
        throw new Error(`unexpected tool ${call.name}`);
    }
  }
}
