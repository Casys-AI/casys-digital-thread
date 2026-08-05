import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../http-mcp-tool-client.ts";
import {
  ErpNextCoffeeMachineObserver,
  parseObservedErpNextCoffeeMachineBom,
} from "./erpnext-coffee-machine-observer.ts";

Deno.test("ErpNextCoffeeMachineObserver captures only the reviewed read results", async () => {
  const client = new RecordedClient({
    erpnext_bom_list: bomResult(),
    erpnext_stock_balance: stockResult(),
    erpnext_bom_get: bomDetailResult(),
  });
  const observed = await new ErpNextCoffeeMachineObserver({
    client,
    now: () => new Date("2026-08-01T05:00:00.000Z"),
  }).observe();

  assertEquals(observed.itemCode, "CASYS-CM01");
  assertEquals(observed.itemName, "Coffee Machine CM-01");
  assertEquals(observed.capturedAt, "2026-08-01T05:00:00.000Z");
  assertEquals(client.calls, [
    {
      name: "erpnext_bom_list",
      arguments: {
        item: "CASYS-CM01",
        is_active: true,
        is_default: true,
        limit: 2,
      },
    },
    {
      name: "erpnext_stock_balance",
      arguments: { item_code: "CASYS-CM01", limit: 50 },
    },
    {
      name: "erpnext_bom_get",
      arguments: { name: "BOM-CASYS-CM01-001" },
    },
  ]);
  assertEquals(observed.stock.structuredContent.count, 0);
  assertEquals(
    (observed.bomDetail.structuredContent.data as { items: unknown[] }).items.length,
    2,
  );
});

Deno.test("ERPNext CoffeeMachine capture rejects an ambiguous default BOM", () => {
  const value = capture();
  (value.bom.structuredContent.data as unknown[]).push({
    ...((value.bom.structuredContent.data as Record<string, unknown>[])[0]),
    name: "BOM-CASYS-CM01-002",
  });
  (value.bom.structuredContent as Record<string, unknown>).count = 2;
  assertThrows(
    () => parseObservedErpNextCoffeeMachineBom(value),
    Error,
    "exactly one active default BOM",
  );
});

Deno.test("ERPNext CoffeeMachine capture refuses a Bin row for another item", () => {
  const value = capture();
  value.stock.structuredContent = {
    doctype: "Bin",
    count: 1,
    data: [{ item_code: "OTHER-ITEM", actual_qty: 8 }],
  };
  assertThrows(
    () => parseObservedErpNextCoffeeMachineBom(value),
    Error,
    "item_code must equal CASYS-CM01",
  );
});

Deno.test("ERPNext CoffeeMachine observer rejects a text-only BOM detail result", async () => {
  const client = new RecordedClient({
    erpnext_bom_list: bomResult(),
    erpnext_stock_balance: stockResult(),
    erpnext_bom_get: {
      text: '{"data":{"name":"BOM-CASYS-CM01-001"}}',
      structuredContent: {},
    },
  });
  await assertRejects(
    () => new ErpNextCoffeeMachineObserver({ client }).observe(),
    Error,
    "erpnext_bom_get.data must be an object",
  );
  assertEquals(client.calls.map((call) => call.name), [
    "erpnext_bom_list",
    "erpnext_stock_balance",
    "erpnext_bom_get",
  ]);
});

class RecordedClient implements McpToolClient {
  readonly calls: McpToolCall[] = [];

  constructor(private readonly results: Record<string, McpToolResult>) {}

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    const result = this.results[call.name];
    if (!result) return Promise.reject(new Error(`Unexpected tool ${call.name}`));
    return Promise.resolve(structuredClone(result));
  }
}

function capture() {
  return {
    schemaVersion: "erpnext-coffee-machine-bom/2.0",
    capturedAt: "2026-08-01T05:00:00.000Z",
    itemCode: "CASYS-CM01",
    itemName: "Coffee Machine CM-01",
    providerSubject: { provider: "erpnext", kind: "item", id: "CASYS-CM01" },
    bom: {
      tool: "erpnext_bom_list",
      arguments: { item: "CASYS-CM01", is_active: true, is_default: true, limit: 2 },
      structuredContent: bomResult().structuredContent,
    },
    bomDetail: {
      tool: "erpnext_bom_get",
      arguments: { name: "BOM-CASYS-CM01-001" },
      structuredContent: bomDetailResult().structuredContent,
    },
    stock: {
      tool: "erpnext_stock_balance",
      arguments: { item_code: "CASYS-CM01", limit: 50 },
      structuredContent: stockResult().structuredContent,
    },
  };
}

function bomResult(): McpToolResult {
  return {
    text: "one active default BOM",
    structuredContent: {
      doctype: "BOM",
      count: 1,
      data: [{
        name: "BOM-CASYS-CM01-001",
        item: "CASYS-CM01",
        item_name: "Coffee Machine CM-01",
        quantity: 1,
        uom: "Nos",
        is_active: 1,
        is_default: 1,
        total_cost: 0,
      }],
    },
  };
}

function stockResult(): McpToolResult {
  return {
    text: "no Bin rows",
    structuredContent: { doctype: "Bin", count: 0, data: [] },
  };
}

function bomDetailResult(): McpToolResult {
  return {
    text: "full BOM detail",
    structuredContent: {
      data: {
        name: "BOM-CASYS-CM01-001",
        item: "CASYS-CM01",
        items: [
          {
            idx: 1,
            item_code: "CASYS-CM01-ENC",
            item_name: "CM-01 Enclosure",
            qty: 1,
            uom: "Nos",
          },
          {
            idx: 2,
            item_code: "CASYS-CM01-TANK",
            item_name: "CM-01 Water Tank",
            qty: 1,
            uom: "Nos",
          },
        ],
      },
    },
  };
}
