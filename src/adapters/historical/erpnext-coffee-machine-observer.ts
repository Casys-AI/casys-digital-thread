import type { McpToolClient, McpToolResult } from "../http-mcp-tool-client.ts";

export const COFFEE_MACHINE_ERPNEXT_ITEM = "CASYS-CM01";
export const COFFEE_MACHINE_ERPNEXT_SUBJECT_ID = "erpnext-item-CASYS-CM01";

export interface ProviderSubjectBinding {
  provider: "erpnext";
  kind: "item";
  id: string;
}

export interface ObservedErpNextCoffeeMachineBom {
  schemaVersion: "erpnext-coffee-machine-bom/2.0";
  capturedAt: string;
  itemCode: string;
  itemName: string;
  providerSubject: ProviderSubjectBinding;
  bom: {
    tool: "erpnext_bom_list";
    arguments: {
      item: string;
      is_active: true;
      is_default: true;
      limit: 2;
    };
    structuredContent: Readonly<Record<string, unknown>>;
  };
  bomDetail: {
    tool: "erpnext_bom_get";
    arguments: { name: string };
    structuredContent: Readonly<Record<string, unknown>>;
  };
  stock: {
    tool: "erpnext_stock_balance";
    arguments: {
      item_code: string;
      limit: 50;
    };
    structuredContent: Readonly<Record<string, unknown>>;
  };
}

export interface ErpNextCoffeeMachineObserverOptions {
  client: McpToolClient;
  now?: () => Date;
  itemCode?: string;
}

/**
 * Reads the reviewed ERPNext projections required to establish the
 * provider-native CoffeeMachine BOM identity, its exact component rows, and
 * the shape of its Bin query. It never interprets zero Bin rows as zero
 * available stock; it records precisely what ERPNext returned.
 */
export class ErpNextCoffeeMachineObserver {
  readonly #client: McpToolClient;
  readonly #now: () => Date;
  readonly #itemCode: string;

  constructor(options: ErpNextCoffeeMachineObserverOptions) {
    this.#client = options.client;
    this.#now = options.now ?? (() => new Date());
    this.#itemCode = nonEmptyString(
      options.itemCode ?? COFFEE_MACHINE_ERPNEXT_ITEM,
      "itemCode",
    );
  }

  async observe(): Promise<ObservedErpNextCoffeeMachineBom> {
    const bomArguments = {
      item: this.#itemCode,
      is_active: true as const,
      is_default: true as const,
      limit: 2 as const,
    };
    const stockArguments = { item_code: this.#itemCode, limit: 50 as const };
    const [bomResult, stockResult] = await Promise.all([
      this.#client.callTool({
        name: "erpnext_bom_list",
        arguments: bomArguments,
      }),
      this.#client.callTool({
        name: "erpnext_stock_balance",
        arguments: stockArguments,
      }),
    ]);
    const bom = parseBomResult(bomResult, this.#itemCode);
    parseStockResult(stockResult, this.#itemCode);
    const bomDetailArguments = { name: bom.name };
    const bomDetailResult = await this.#client.callTool({
      name: "erpnext_bom_get",
      arguments: bomDetailArguments,
    });
    parseBomDetailContent(
      bomDetailResult.structuredContent,
      bom.name,
      this.#itemCode,
    );

    return parseObservedErpNextCoffeeMachineBom({
      schemaVersion: "erpnext-coffee-machine-bom/2.0",
      capturedAt: this.#now().toISOString(),
      itemCode: this.#itemCode,
      itemName: bom.itemName,
      providerSubject: {
        provider: "erpnext",
        kind: "item",
        id: this.#itemCode,
      },
      bom: {
        tool: "erpnext_bom_list",
        arguments: bomArguments,
        structuredContent: structuredClone(bomResult.structuredContent),
      },
      bomDetail: {
        tool: "erpnext_bom_get",
        arguments: bomDetailArguments,
        structuredContent: structuredClone(bomDetailResult.structuredContent),
      },
      stock: {
        tool: "erpnext_stock_balance",
        arguments: stockArguments,
        structuredContent: structuredClone(stockResult.structuredContent),
      },
    });
  }
}

/**
 * Strict read boundary for a persisted ERPNext observation. It retains only
 * evidence that the two provider-native read tools actually returned.
 */
export function parseObservedErpNextCoffeeMachineBom(
  value: unknown,
): ObservedErpNextCoffeeMachineBom {
  const capture = record(value, "$");
  exact(
    capture.schemaVersion,
    "erpnext-coffee-machine-bom/2.0",
    "$.schemaVersion",
  );
  const capturedAt = isoDate(capture.capturedAt, "$.capturedAt");
  const itemCode = nonEmptyString(capture.itemCode, "$.itemCode");
  const itemName = nonEmptyString(capture.itemName, "$.itemName");
  const providerSubject = record(capture.providerSubject, "$.providerSubject");
  exact(providerSubject.provider, "erpnext", "$.providerSubject.provider");
  exact(providerSubject.kind, "item", "$.providerSubject.kind");
  exact(providerSubject.id, itemCode, "$.providerSubject.id");
  const bom = record(capture.bom, "$.bom");
  const bomDetail = record(capture.bomDetail, "$.bomDetail");
  const stock = record(capture.stock, "$.stock");

  exact(bom.tool, "erpnext_bom_list", "$.bom.tool");
  const bomArguments = record(bom.arguments, "$.bom.arguments");
  exact(bomArguments.item, itemCode, "$.bom.arguments.item");
  exact(bomArguments.is_active, true, "$.bom.arguments.is_active");
  exact(bomArguments.is_default, true, "$.bom.arguments.is_default");
  exact(bomArguments.limit, 2, "$.bom.arguments.limit");
  const bomContent = record(bom.structuredContent, "$.bom.structuredContent");
  const selectedBom = parseBomContent(bomContent, itemCode);
  if (selectedBom.itemName !== itemName) {
    throw new Error(
      `$.itemName must equal the provider BOM item_name ${selectedBom.itemName}.`,
    );
  }

  exact(bomDetail.tool, "erpnext_bom_get", "$.bomDetail.tool");
  const detailArguments = record(
    bomDetail.arguments,
    "$.bomDetail.arguments",
  );
  exact(detailArguments.name, selectedBom.name, "$.bomDetail.arguments.name");
  const detailContent = record(
    bomDetail.structuredContent,
    "$.bomDetail.structuredContent",
  );
  parseBomDetailContent(detailContent, selectedBom.name, itemCode);

  exact(stock.tool, "erpnext_stock_balance", "$.stock.tool");
  const stockArguments = record(stock.arguments, "$.stock.arguments");
  exact(stockArguments.item_code, itemCode, "$.stock.arguments.item_code");
  exact(stockArguments.limit, 50, "$.stock.arguments.limit");
  const stockContent = record(
    stock.structuredContent,
    "$.stock.structuredContent",
  );
  parseStockContent(stockContent, itemCode);

  return {
    schemaVersion: "erpnext-coffee-machine-bom/2.0",
    capturedAt,
    itemCode,
    itemName,
    providerSubject: { provider: "erpnext", kind: "item", id: itemCode },
    bom: {
      tool: "erpnext_bom_list",
      arguments: {
        item: itemCode,
        is_active: true,
        is_default: true,
        limit: 2,
      },
      structuredContent: structuredClone(bomContent),
    },
    bomDetail: {
      tool: "erpnext_bom_get",
      arguments: { name: selectedBom.name },
      structuredContent: structuredClone(detailContent),
    },
    stock: {
      tool: "erpnext_stock_balance",
      arguments: { item_code: itemCode, limit: 50 },
      structuredContent: structuredClone(stockContent),
    },
  };
}

export interface SelectedErpNextBom {
  name: string;
  itemName: string;
  quantity: number;
  uom: string;
  totalCost: number;
}

export interface SelectedErpNextBomItem {
  index: number;
  itemCode: string;
  itemName: string;
  quantity: number;
  uom: string;
}

function parseBomResult(
  result: McpToolResult,
  itemCode: string,
): SelectedErpNextBom {
  return parseBomContent(result.structuredContent, itemCode);
}

export function selectErpNextCoffeeMachineBom(
  capture: ObservedErpNextCoffeeMachineBom,
): SelectedErpNextBom {
  return parseBomContent(capture.bom.structuredContent, capture.itemCode);
}

export function countErpNextCoffeeMachineBinRows(
  capture: ObservedErpNextCoffeeMachineBom,
): number {
  return parseStockContent(capture.stock.structuredContent, capture.itemCode);
}

export function selectErpNextCoffeeMachineBomItems(
  capture: ObservedErpNextCoffeeMachineBom,
): SelectedErpNextBomItem[] {
  const bom = selectErpNextCoffeeMachineBom(capture);
  return parseBomDetailContent(
    capture.bomDetail.structuredContent,
    bom.name,
    capture.itemCode,
  );
}

function parseBomContent(
  structuredContent: Readonly<Record<string, unknown>>,
  itemCode: string,
): SelectedErpNextBom {
  exact(structuredContent.doctype, "BOM", "erpnext_bom_list.doctype");
  const data = records(structuredContent.data, "erpnext_bom_list.data");
  const count = nonNegativeInteger(
    structuredContent.count,
    "erpnext_bom_list.count",
  );
  if (count !== data.length) {
    throw new Error("erpnext_bom_list.count must equal data.length.");
  }
  if (data.length !== 1) {
    throw new Error(
      `erpnext_bom_list must return exactly one active default BOM for ${itemCode}; received ${data.length}.`,
    );
  }
  const bom = data[0];
  const name = nonEmptyString(bom.name, "erpnext_bom_list.data[0].name");
  exact(bom.item, itemCode, "erpnext_bom_list.data[0].item");
  const itemName = nonEmptyString(
    bom.item_name,
    "erpnext_bom_list.data[0].item_name",
  );
  exactEnabled(bom.is_active, "erpnext_bom_list.data[0].is_active");
  exactEnabled(bom.is_default, "erpnext_bom_list.data[0].is_default");
  const quantity = finite(bom.quantity, "erpnext_bom_list.data[0].quantity");
  const uom = nonEmptyString(bom.uom, "erpnext_bom_list.data[0].uom");
  const totalCost = finite(bom.total_cost, "erpnext_bom_list.data[0].total_cost");
  return { name, itemName, quantity, uom, totalCost };
}

function parseStockResult(result: McpToolResult, itemCode: string): void {
  parseStockContent(result.structuredContent, itemCode);
}

function parseBomDetailContent(
  structuredContent: Readonly<Record<string, unknown>>,
  bomName: string,
  itemCode: string,
): SelectedErpNextBomItem[] {
  const data = record(structuredContent.data, "erpnext_bom_get.data");
  exact(data.name, bomName, "erpnext_bom_get.data.name");
  exact(data.item, itemCode, "erpnext_bom_get.data.item");
  const items = records(data.items, "erpnext_bom_get.data.items").map(
    (item, index) => {
      const quantity = finite(item.qty, `erpnext_bom_get.data.items[${index}].qty`);
      if (quantity <= 0) {
        throw new Error(
          `erpnext_bom_get.data.items[${index}].qty must be greater than zero.`,
        );
      }
      return {
        index: nonNegativeInteger(
          item.idx,
          `erpnext_bom_get.data.items[${index}].idx`,
        ),
        itemCode: nonEmptyString(
          item.item_code,
          `erpnext_bom_get.data.items[${index}].item_code`,
        ),
        itemName: nonEmptyString(
          item.item_name,
          `erpnext_bom_get.data.items[${index}].item_name`,
        ),
        quantity,
        uom: nonEmptyString(
          item.uom,
          `erpnext_bom_get.data.items[${index}].uom`,
        ),
      };
    },
  );
  const itemCodes = items.map((item) => item.itemCode);
  if (new Set(itemCodes).size !== itemCodes.length) {
    throw new Error("erpnext_bom_get.data.items contains duplicate item_code values.");
  }
  return items;
}

function parseStockContent(
  structuredContent: Readonly<Record<string, unknown>>,
  itemCode: string,
): number {
  exact(structuredContent.doctype, "Bin", "erpnext_stock_balance.doctype");
  const data = records(structuredContent.data, "erpnext_stock_balance.data");
  const count = nonNegativeInteger(
    structuredContent.count,
    "erpnext_stock_balance.count",
  );
  if (count !== data.length) {
    throw new Error("erpnext_stock_balance.count must equal data.length.");
  }
  data.forEach((row, index) => {
    exact(
      row.item_code,
      itemCode,
      `erpnext_stock_balance.data[${index}].item_code`,
    );
  });
  return count;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function records(value: unknown, path: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value.map((item, index) => record(item, `${path}[${index}]`));
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function isoDate(value: unknown, path: string): string {
  const result = nonEmptyString(value, path);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${path} must be ISO-8601.`);
  return result;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const result = finite(value, path);
  if (!Number.isInteger(result) || result < 0) {
    throw new Error(`${path} must be a non-negative integer.`);
  }
  return result;
}

function exactEnabled(value: unknown, path: string): void {
  if (value !== true && value !== 1) {
    throw new Error(`${path} must be true or 1.`);
  }
}

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) throw new Error(`${path} must equal ${String(expected)}.`);
}
