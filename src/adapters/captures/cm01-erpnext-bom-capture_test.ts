import { assertEquals, assertRejects } from "@std/assert";
import {
  CM01_V3_ERPNEXT_BOM,
  Cm01ErpNextBomCaptureAdapter,
  Cm01ErpNextBomCaptureError,
} from "./cm01-erpnext-bom-capture.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../mcp/http-mcp-tool-client.ts";

Deno.test("CM-01 V3 ERP capture reads exactly the reviewed BOM and returns portable evidence", async () => {
  const client = new ScriptedErpNextClient([bomResult()]);
  const capture = await new Cm01ErpNextBomCaptureAdapter({
    erpnext: client,
    now: () => new Date("2026-08-03T10:00:00.000Z"),
  }).capture();

  assertEquals(client.calls, [{
    name: "erpnext_bom_get",
    arguments: { name: CM01_V3_ERPNEXT_BOM.name },
  }]);
  assertEquals(capture, {
    schemaVersion: "cm01-erpnext-bom-capture/2.0",
    kind: "cm01-erpnext-bom-capture",
    capturedAt: "2026-08-03T10:00:00.000Z",
    artifact: {
      role: "erp-bom",
      kind: "bom",
      producer: { serverId: "erpnext", tool: "erpnext_bom_get" },
      identity: {
        bomName: "BOM-CASYS-CM01-001",
        itemCode: "CASYS-CM01",
        itemName: "Coffee Machine CM-01",
      },
      quantity: { value: 1, unit: "Nos" },
      components: [
        { index: 1, itemCode: "CASYS-CM01-ENC", quantity: 1, unit: "Nos" },
        { index: 2, itemCode: "CASYS-CM01-TANK", quantity: 1, unit: "Nos" },
      ],
    },
  });
  const serialized = JSON.stringify(capture);
  assertEquals(serialized.includes("item_name"), false);
  assertEquals(serialized.includes("stock"), false);
  assertEquals(serialized.includes("secret"), false);
});

Deno.test("CM-01 V3 ERP capture fails closed when the fixed BOM identity is not returned", async () => {
  const result = bomResult();
  (result.structuredContent.data as Record<string, unknown>).name = "BOM-OTHER";
  const client = new ScriptedErpNextClient([result]);

  await assertRejects(
    () => new Cm01ErpNextBomCaptureAdapter({ erpnext: client }).capture(),
    Cm01ErpNextBomCaptureError,
    'erpnext_bom_get.data.name must equal "BOM-CASYS-CM01-001".',
  );
  assertEquals(client.calls.length, 1);
});

Deno.test("CM-01 V3 ERP capture rejects a provider envelope with undeclared raw surface", async () => {
  const result = bomResult();
  (result.structuredContent as Record<string, unknown>).debug = {
    secret: "never retain",
  };
  const client = new ScriptedErpNextClient([result]);

  await assertRejects(
    () => new Cm01ErpNextBomCaptureAdapter({ erpnext: client }).capture(),
    Cm01ErpNextBomCaptureError,
    "erpnext_bom_get contains unsupported keys: debug.",
  );
});

Deno.test("CM-01 V3 ERP capture rejects malformed or duplicate BOM component rows", async () => {
  const result = bomResult();
  const items = (result.structuredContent.data as Record<string, unknown>)
    .items as Array<
      Record<string, unknown>
    >;
  items[0].idx = 1;
  const client = new ScriptedErpNextClient([result]);

  await assertRejects(
    () => new Cm01ErpNextBomCaptureAdapter({ erpnext: client }).capture(),
    Cm01ErpNextBomCaptureError,
    "erpnext_bom_get.data.items contains duplicate idx values.",
  );
});

class ScriptedErpNextClient implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  #results: McpToolResult[];

  constructor(results: readonly McpToolResult[]) {
    this.#results = results.map((result) => structuredClone(result));
  }

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    const result = this.#results.shift();
    if (!result) throw new Error(`Unexpected ${call.name}.`);
    return Promise.resolve(structuredClone(result));
  }
}

function bomResult(): McpToolResult {
  return {
    text: "Full ERPNext BOM document.",
    structuredContent: {
      data: {
        name: "BOM-CASYS-CM01-001",
        item: "CASYS-CM01",
        item_name: "Coffee Machine CM-01",
        quantity: 1,
        uom: "Nos",
        items: [
          {
            idx: 2,
            item_code: "CASYS-CM01-TANK",
            item_name: "CM-01 Water Tank",
            qty: 1,
            uom: "Nos",
          },
          {
            idx: 1,
            item_code: "CASYS-CM01-ENC",
            item_name: "CM-01 Enclosure",
            qty: 1,
            uom: "Nos",
          },
        ],
      },
    },
  };
}
