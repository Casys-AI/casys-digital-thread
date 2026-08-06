import { sha256Fingerprint } from "../../domain/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/thread-snapshot.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";

/**
 * Reviewed external ERP identity for the CM-01 V3 reference project.
 *
 * This is an ERPNext identity, not a Digital Thread subject, snapshot, or
 * historical run identifier. It is intentionally fixed in server-owned code:
 * callers may observe this BOM, but cannot select an arbitrary ERP document.
 */
export const CM01_V3_ERPNEXT_BOM = Object.freeze(
  {
    name: "BOM-CASYS-CM01-001",
    itemCode: "CASYS-CM01",
  } as const,
);

export const CM01_ERPNEXT_BOM_CAPTURE_SCHEMA = "cm01-erpnext-bom-capture/1.0" as const;

export interface Cm01ErpNextBomCapture {
  readonly schemaVersion: typeof CM01_ERPNEXT_BOM_CAPTURE_SCHEMA;
  readonly kind: "cm01-erpnext-bom-capture";
  readonly capturedAt: string;
  /** Minimal, content-addressed external evidence. No ERP document payload leaks. */
  readonly artifact: {
    readonly role: "erp-bom";
    readonly kind: "bom";
    readonly fingerprint: ContentFingerprint;
    readonly producer: {
      readonly serverId: "erpnext";
      readonly tool: "erpnext_bom_get";
    };
    readonly identity: {
      readonly bomName: string;
      readonly itemCode: string;
      readonly itemName: string;
    };
    readonly quantity: {
      readonly value: number;
      readonly unit: string;
    };
    readonly componentCount: number;
  };
}

export interface Cm01ErpNextBomCaptureAdapterOptions {
  /** Server-owned MCP client; ERP credentials and endpoint never cross a tool boundary. */
  readonly erpnext: McpToolClient;
  readonly now?: () => Date;
}

export class Cm01ErpNextBomCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Cm01ErpNextBomCaptureError";
  }
}

/**
 * Read the one reviewed external CM-01 BOM and reduce it to portable evidence.
 *
 * `erpnext_bom_get` is provider-native and read-only. The adapter deliberately
 * does not list BOMs, read stock, infer availability, or invoke any mutation.
 */
export class Cm01ErpNextBomCaptureAdapter {
  readonly #erpnext: McpToolClient;
  readonly #now: () => Date;

  constructor(options: Cm01ErpNextBomCaptureAdapterOptions) {
    this.#erpnext = options.erpnext;
    this.#now = options.now ?? (() => new Date());
  }

  async capture(): Promise<Cm01ErpNextBomCapture> {
    let result;
    try {
      result = await this.#erpnext.callTool({
        name: "erpnext_bom_get",
        arguments: { name: CM01_V3_ERPNEXT_BOM.name },
      });
    } catch (error) {
      throw new Cm01ErpNextBomCaptureError(
        `erpnext_bom_get failed: ${errorMessage(error)}`,
      );
    }

    const bom = parseProviderBom(result.structuredContent);
    const fingerprint = await sha256Fingerprint({
      schemaVersion: "cm01-erpnext-bom-fingerprint/1.0",
      bomName: bom.name,
      itemCode: bom.itemCode,
      quantity: bom.quantity,
      components: bom.components,
    });

    return deepFreeze({
      schemaVersion: CM01_ERPNEXT_BOM_CAPTURE_SCHEMA,
      kind: "cm01-erpnext-bom-capture",
      capturedAt: isoDate(this.#now().toISOString(), "capturedAt"),
      artifact: {
        role: "erp-bom",
        kind: "bom",
        fingerprint,
        producer: { serverId: "erpnext", tool: "erpnext_bom_get" },
        identity: {
          bomName: bom.name,
          itemCode: bom.itemCode,
          itemName: bom.itemName,
        },
        quantity: bom.quantity,
        componentCount: bom.components.length,
      },
    });
  }
}

interface NormalizedBom {
  readonly name: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly quantity: { readonly value: number; readonly unit: string };
  readonly components: readonly {
    readonly index: number;
    readonly itemCode: string;
    readonly quantity: number;
    readonly unit: string;
  }[];
}

/** Strict boundary for the actual mcp-erpnext `erpnext_bom_get` response. */
function parseProviderBom(value: unknown): NormalizedBom {
  const envelope = exactRecord(value, ["data"], "erpnext_bom_get");
  const data = record(envelope.data, "erpnext_bom_get.data");
  const name = text(data.name, "erpnext_bom_get.data.name");
  exact(name, CM01_V3_ERPNEXT_BOM.name, "erpnext_bom_get.data.name");
  const itemCode = text(data.item, "erpnext_bom_get.data.item");
  exact(itemCode, CM01_V3_ERPNEXT_BOM.itemCode, "erpnext_bom_get.data.item");
  const itemName = text(data.item_name, "erpnext_bom_get.data.item_name");
  const quantity = {
    value: positive(data.quantity, "erpnext_bom_get.data.quantity"),
    unit: text(data.uom, "erpnext_bom_get.data.uom"),
  };
  const components = records(data.items, "erpnext_bom_get.data.items").map(
    (component, index) => ({
      index: positiveInteger(
        component.idx,
        `erpnext_bom_get.data.items[${index}].idx`,
      ),
      itemCode: text(
        component.item_code,
        `erpnext_bom_get.data.items[${index}].item_code`,
      ),
      quantity: positive(
        component.qty,
        `erpnext_bom_get.data.items[${index}].qty`,
      ),
      unit: text(component.uom, `erpnext_bom_get.data.items[${index}].uom`),
    }),
  ).sort((left, right) => left.index - right.index);
  if (components.length === 0) {
    fail("erpnext_bom_get.data.items must contain at least one component.");
  }
  if (
    new Set(components.map((component) => component.index)).size !== components.length
  ) {
    fail("erpnext_bom_get.data.items contains duplicate idx values.");
  }

  return { name, itemCode, itemName, quantity, components };
}

function exactRecord(
  value: unknown,
  allowed: readonly string[],
  path: string,
): Record<string, unknown> {
  const output = record(value, path);
  const extras = Object.keys(output).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    fail(`${path} contains unsupported keys: ${extras.sort().join(", ")}.`);
  }
  return output;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function records(value: unknown, path: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  return value.map((entry, index) => record(entry, `${path}[${index}]`));
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${path} must be a non-empty string.`);
  }
  return value;
}

function positive(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${path} must be a positive finite number.`);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = positive(value, path);
  if (!Number.isSafeInteger(parsed)) fail(`${path} must be a positive integer.`);
  return parsed;
}

function isoDate(value: string, path: string): string {
  if (Number.isNaN(Date.parse(value))) fail(`${path} must be an ISO date.`);
  return value;
}

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) fail(`${path} must equal ${JSON.stringify(expected)}.`);
}

function fail(message: string): never {
  throw new Cm01ErpNextBomCaptureError(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
