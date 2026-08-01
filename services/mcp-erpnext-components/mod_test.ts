import { assertEquals } from "@std/assert";
import {
  createBomSurfaceHandler,
  type ErpNextExecutor,
  loadBomSurface,
} from "./mod.ts";

function executor(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): ErpNextExecutor {
  return {
    execute(name, args) {
      calls.push({ name, args });
      if (name === "erpnext_bom_list") {
        return Promise.resolve({
          data: [{
            name: "BOM-CM01-001",
            item: "CM01",
            item_name: "Coffee machine",
            quantity: 1,
            uom: "Nos",
            is_active: 1,
            is_default: 1,
            total_cost: 412.5,
          }],
        });
      }
      return Promise.resolve({
        data: {
          name: "BOM-CM01-001",
          item: "CM01",
          item_name: "Coffee machine",
          quantity: 1,
          uom: "Nos",
          is_active: 1,
          is_default: 1,
          total_cost: 412.5,
          raw_material_cost: 380,
          operating_cost: 32.5,
          currency: "EUR",
          items: [{
            item_code: "BOILER-01",
            item_name: "Boiler",
            qty: 1,
            uom: "Nos",
            rate: 80,
            amount: 80,
          }],
          operations: [{
            operation: "Assembly",
            workstation: "LINE-1",
            time_in_mins: 30,
            hourly_rate: 65,
            operating_cost: 32.5,
          }],
        },
      });
    },
  };
}

Deno.test("BOM surface composes one list and one selected detail", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await loadBomSurface(executor(calls), {
    item: "CM01",
    is_active: true,
    is_default: true,
    limit: 5,
  });

  assertEquals(calls, [
    {
      name: "erpnext_bom_list",
      args: { limit: 5, item: "CM01", is_active: true, is_default: true },
    },
    { name: "erpnext_bom_get", args: { name: "BOM-CM01-001" } },
  ]);
  assertEquals(result.selected?.materials[0]?.itemCode, "BOILER-01");
  assertEquals(result.selected?.operations[0]?.operation, "Assembly");
  assertEquals(result.selected?.totalCost, 412.5);
});

Deno.test("BOM surface tool keeps full data out of the text summary", async () => {
  const result = await createBomSurfaceHandler(executor([]))({ limit: 1 });
  const value = result as {
    content: string;
    structuredContent: { selected?: { materials: unknown[] } };
  };
  assertEquals(value.content.includes("1 materials"), true);
  assertEquals(value.structuredContent.selected?.materials.length, 1);
});
