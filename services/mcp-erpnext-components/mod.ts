import type {
  BomDetail,
  BomMaterial,
  BomOperation,
  BomSummary,
  BomSurfaceArgs,
  ErpNextBomSurfaceData,
} from "./component-contract.ts";

export const BOM_SURFACE_RESOURCE_URI = "ui://mcp-erpnext-components/bom-surface";
export const BOM_SURFACE_TOOL_NAME = "erpnext_bom_surface";

export interface ErpNextExecutor {
  execute(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface BomSurfaceToolResult {
  readonly content: string;
  readonly structuredContent: ErpNextBomSurfaceData;
}

export const BOM_SURFACE_TOOL = {
  name: BOM_SURFACE_TOOL_NAME,
  description:
    "Read an ERPNext Bill of Materials as a catalog of small composable UI components. " +
    "Returns BOM identity, cost, material and operation evidence without mutation tools.",
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  _meta: {
    ui: { resourceUri: BOM_SURFACE_RESOURCE_URI },
  },
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        minLength: 1,
        description: "Exact BOM document name to select.",
      },
      item: {
        type: "string",
        minLength: 1,
        description: "Finished item code or human-readable item name.",
      },
      is_active: { type: "boolean" },
      is_default: { type: "boolean" },
      limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
    },
    additionalProperties: false,
  },
} as const;

export function createBomSurfaceHandler(
  executor: ErpNextExecutor,
): (input: Record<string, unknown>) => Promise<BomSurfaceToolResult> {
  return async (input: Record<string, unknown>) => {
    const data = await loadBomSurface(executor, parseArgs(input));
    const selected = data.selected;
    const summary = selected
      ? `${selected.name}: ${selected.materials.length} materials, ` +
        `${selected.operations.length} operations, total cost ${selected.totalCost}`
      : `No ERPNext BOM matched the requested filters (${data.count} listed).`;
    return {
      content: summary,
      structuredContent: data,
    };
  };
}

export async function loadBomSurface(
  executor: ErpNextExecutor,
  args: BomSurfaceArgs,
): Promise<ErpNextBomSurfaceData> {
  const listArgs: Record<string, unknown> = {
    limit: args.limit ?? 10,
    ...(args.item ? { item: args.item } : {}),
    ...(args.is_active !== undefined ? { is_active: args.is_active } : {}),
    ...(args.is_default !== undefined ? { is_default: args.is_default } : {}),
  };
  const listResult = await executor.execute("erpnext_bom_list", listArgs);
  const list = records(record(listResult)?.data).map(normalizeSummary);
  const selectedName = args.name ?? list[0]?.name;

  let selected: BomDetail | undefined;
  if (selectedName) {
    const detailResult = await executor.execute("erpnext_bom_get", {
      name: selectedName,
    });
    const detail = record(record(detailResult)?.data);
    if (detail) selected = normalizeDetail(detail);
  }

  const boms = selected && !list.some((entry) => entry.name === selected.name)
    ? [selected, ...list]
    : list;
  return {
    generatedAt: new Date().toISOString(),
    count: boms.length,
    ...(selectedName ? { selectedName } : {}),
    boms,
    ...(selected ? { selected } : {}),
  };
}

function parseArgs(input: Record<string, unknown>): BomSurfaceArgs {
  return {
    ...(nonEmptyString(input.name) ? { name: input.name as string } : {}),
    ...(nonEmptyString(input.item) ? { item: input.item as string } : {}),
    ...(typeof input.is_active === "boolean" ? { is_active: input.is_active } : {}),
    ...(typeof input.is_default === "boolean" ? { is_default: input.is_default } : {}),
    ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
  };
}

function normalizeSummary(value: Record<string, unknown>): BomSummary {
  return {
    name: text(value.name),
    item: text(value.item),
    ...(optionalText(value.item_name)
      ? { itemName: optionalText(value.item_name) }
      : {}),
    quantity: number(value.quantity, 1),
    ...(optionalText(value.uom) ? { uom: optionalText(value.uom) } : {}),
    active: boolean(value.is_active),
    default: boolean(value.is_default),
    totalCost: number(value.total_cost),
  };
}

function normalizeDetail(value: Record<string, unknown>): BomDetail {
  return {
    ...normalizeSummary(value),
    ...(optionalText(value.currency) ? { currency: optionalText(value.currency) } : {}),
    rawMaterialCost: number(value.raw_material_cost),
    operatingCost: number(value.operating_cost),
    materials: records(value.items).map(normalizeMaterial),
    operations: records(value.operations).map(normalizeOperation),
  };
}

function normalizeMaterial(value: Record<string, unknown>): BomMaterial {
  return {
    itemCode: text(value.item_code),
    ...(optionalText(value.item_name)
      ? { itemName: optionalText(value.item_name) }
      : {}),
    quantity: number(value.qty),
    ...(value.stock_qty !== undefined
      ? { stockQuantity: number(value.stock_qty) }
      : {}),
    ...(optionalText(value.uom) ? { uom: optionalText(value.uom) } : {}),
    rate: number(value.rate),
    amount: number(value.amount),
    ...(optionalText(value.source_warehouse)
      ? { sourceWarehouse: optionalText(value.source_warehouse) }
      : {}),
  };
}

function normalizeOperation(value: Record<string, unknown>): BomOperation {
  return {
    operation: text(value.operation),
    ...(optionalText(value.workstation)
      ? { workstation: optionalText(value.workstation) }
      : {}),
    timeMinutes: number(value.time_in_mins),
    hourlyRate: number(value.hourly_rate),
    operatingCost: number(value.operating_cost),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(record).filter((entry): entry is Record<string, unknown> =>
      entry !== undefined
    )
    : [];
}

function text(value: unknown): string {
  return optionalText(value) ?? "";
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}
