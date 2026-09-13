/**
 * DT consumption of `io.casys.mcp-erpnext.buy-source-capture/1.0`.
 *
 * Provider owns the capture wire. Inner `canonicalText` is the CAS preimage.
 * Do not hash the MCP wrapper or a reserialized DT projection. `modified` is
 * an ERP concurrency token (Frappe datetime); never append Z.
 */

import {
  arrayOf,
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
} from "../kernel/case-validation.ts";

export const BUY_SOURCE_CAPTURE_SCHEMA =
  "io.casys.mcp-erpnext.buy-source-capture/1.0" as const;
export const BUY_SOURCE_INSTANCE_KIND = "erpnext-site" as const;
export const BUY_CONSISTENCY_KIND = "repeated-read" as const;
export const BUY_CONSISTENCY_READS = 2;
export const BUY_CAPTURE_URI_PREFIX =
  "casys://mcp-erpnext/buy-source-capture/sha256/" as const;

export const BUY_CLOSED_DOCTYPES = [
  "Item",
  "BOM",
  "Item Price",
  "Supplier Quotation",
  "Supplier",
  "Price List",
  "UOM",
  "Currency Exchange",
] as const;
export type BuyClosedDoctype = typeof BUY_CLOSED_DOCTYPES[number];

export const BUY_DOCUMENT_SOURCE_CATEGORIES = [
  "item",
  "bom",
  "catalogue-price",
  "supplier-quotation",
  "supplier",
  "price-list",
  "uom",
  "currency-exchange",
] as const;
export type BuyDocumentSourceCategory = typeof BUY_DOCUMENT_SOURCE_CATEGORIES[number];

export const BUY_DOCTYPE_SOURCE_CATEGORY = {
  Item: "item",
  BOM: "bom",
  "Item Price": "catalogue-price",
  "Supplier Quotation": "supplier-quotation",
  Supplier: "supplier",
  "Price List": "price-list",
  UOM: "uom",
  "Currency Exchange": "currency-exchange",
} as const satisfies Record<BuyClosedDoctype, BuyDocumentSourceCategory>;

const SHA256_FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
const FRAPPE_DATETIME =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[ T][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)?$/;
const ISO_MILLISECONDS =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

export type BuyProjectedValue = string | number | boolean;

export interface BuySourceInstance {
  readonly kind: typeof BUY_SOURCE_INSTANCE_KIND;
  readonly siteId: string;
}

export interface BuyCaptureConsistency {
  readonly kind: typeof BUY_CONSISTENCY_KIND;
  readonly reads: typeof BUY_CONSISTENCY_READS;
  readonly consistent: true;
}

export interface BuyCapturedChildRow {
  readonly name: string;
  readonly idx?: number;
  readonly fields: Readonly<Record<string, BuyProjectedValue>>;
}

export interface BuyCapturedChildTable {
  readonly table: string;
  readonly rows: readonly BuyCapturedChildRow[];
}

export interface BuySourceDocument {
  readonly doctype: BuyClosedDoctype;
  readonly name: string;
  readonly modified: string;
  readonly docstatus?: number;
  readonly status?: string;
  readonly sourceCategory: BuyDocumentSourceCategory;
  readonly fields: Readonly<Record<string, BuyProjectedValue>>;
  readonly children?: readonly BuyCapturedChildTable[];
  readonly fingerprint: string;
}

export interface BuySourceCaptureBody {
  readonly schemaVersion: typeof BUY_SOURCE_CAPTURE_SCHEMA;
  readonly sourceInstance: BuySourceInstance;
  readonly capturedAt: string;
  readonly documents: readonly BuySourceDocument[];
  readonly consistency: BuyCaptureConsistency;
}

export interface BuySourceCaptureEnvelope {
  readonly schemaVersion: typeof BUY_SOURCE_CAPTURE_SCHEMA;
  readonly capture: BuySourceCaptureBody;
  readonly canonicalText: string;
  readonly fingerprint: string;
  readonly byteCount: number;
}

export function validateBuySourceCaptureEnvelope(
  value: unknown,
): BuySourceCaptureEnvelope {
  const root = exactRecord(value, [
    "schemaVersion",
    "capture",
    "canonicalText",
    "fingerprint",
    "byteCount",
  ], "$buySourceCapture");
  literalValue(
    root.schemaVersion,
    BUY_SOURCE_CAPTURE_SCHEMA,
    "$buySourceCapture.schemaVersion",
  );
  const canonicalText = nonEmptyText(
    root.canonicalText,
    "$buySourceCapture.canonicalText",
  );
  let parsedCanonical: unknown;
  try {
    parsedCanonical = JSON.parse(canonicalText);
  } catch {
    throw new TypeError("$buySourceCapture.canonicalText is not JSON.");
  }
  const fromText = parseCaptureBody(
    parsedCanonical,
    "$buySourceCapture.canonicalText",
  );
  const capture = parseCaptureBody(root.capture, "$buySourceCapture.capture");
  if (JSON.stringify(fromText) !== JSON.stringify(capture)) {
    throw new TypeError(
      "$buySourceCapture.canonicalText does not match the capture payload.",
    );
  }
  const fingerprint = prefixedSha256(
    root.fingerprint,
    "$buySourceCapture.fingerprint",
  );
  if (typeof root.byteCount !== "number" || !Number.isSafeInteger(root.byteCount)) {
    throw new TypeError("$buySourceCapture.byteCount must be a safe integer.");
  }
  const observedBytes = new TextEncoder().encode(canonicalText).byteLength;
  if (root.byteCount !== observedBytes) {
    throw new TypeError(
      `$buySourceCapture.byteCount mismatch: declared ${root.byteCount}, observed ${observedBytes}.`,
    );
  }
  return deepFreeze({
    schemaVersion: BUY_SOURCE_CAPTURE_SCHEMA,
    capture,
    canonicalText,
    fingerprint,
    byteCount: root.byteCount,
  });
}

export async function assertBuySourceCaptureFingerprint(
  envelope: BuySourceCaptureEnvelope,
  digest: (bytes: Uint8Array) => Promise<string>,
): Promise<void> {
  const observed = await digest(new TextEncoder().encode(envelope.canonicalText));
  const expected = sha256Digest(envelope.fingerprint);
  if (observed !== expected) {
    throw new TypeError(
      "$buySourceCapture.fingerprint does not match SHA-256 of canonicalText.",
    );
  }
}

export function findBuySourceDocument(
  capture: BuySourceCaptureBody,
  reference: { readonly doctype: BuyClosedDoctype; readonly name: string },
): BuySourceDocument | undefined {
  return capture.documents.find((document) =>
    document.doctype === reference.doctype && document.name === reference.name
  );
}

export function findBuySourceChildRow(
  document: BuySourceDocument,
  rowName: string,
): BuyCapturedChildRow | undefined {
  for (const table of document.children ?? []) {
    const row = table.rows.find((item) => item.name === rowName);
    if (row) return row;
  }
  return undefined;
}

export function prefixedSha256(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!SHA256_FINGERPRINT.test(text)) {
    throw new TypeError(`${path} must be sha256:<64 lowercase hex>.`);
  }
  return text;
}

export function sha256Digest(fingerprint: string): string {
  return fingerprint.slice("sha256:".length);
}

export function frappeDatetime(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!FRAPPE_DATETIME.test(text)) {
    throw new TypeError(`${path} must be a Frappe datetime; do not append Z.`);
  }
  return text;
}

export function parseBuySourceInstance(
  value: unknown,
  path: string,
): BuySourceInstance {
  const input = exactRecord(value, ["kind", "siteId"], path);
  literalValue(input.kind, BUY_SOURCE_INSTANCE_KIND, `${path}.kind`);
  return {
    kind: BUY_SOURCE_INSTANCE_KIND,
    siteId: prefixedSha256(input.siteId, `${path}.siteId`),
  };
}

function parseCaptureBody(value: unknown, path: string): BuySourceCaptureBody {
  const input = exactRecord(value, [
    "schemaVersion",
    "sourceInstance",
    "capturedAt",
    "documents",
    "consistency",
  ], path);
  literalValue(
    input.schemaVersion,
    BUY_SOURCE_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const documents = arrayOf(input.documents, `${path}.documents`).map(
    (document, i) => parseDocument(document, `${path}.documents[${i}]`),
  );
  rejectDuplicates(
    documents.map((document) => `${document.doctype}\0${document.name}`),
    `${path}.documents`,
  );
  return {
    schemaVersion: BUY_SOURCE_CAPTURE_SCHEMA,
    sourceInstance: parseBuySourceInstance(
      input.sourceInstance,
      `${path}.sourceInstance`,
    ),
    capturedAt: isoMilliseconds(input.capturedAt, `${path}.capturedAt`),
    documents,
    consistency: parseConsistency(input.consistency, `${path}.consistency`),
  };
}

function parseConsistency(value: unknown, path: string): BuyCaptureConsistency {
  const input = exactRecord(value, ["kind", "reads", "consistent"], path);
  literalValue(input.kind, BUY_CONSISTENCY_KIND, `${path}.kind`);
  if (input.reads !== BUY_CONSISTENCY_READS) {
    throw new TypeError(`${path}.reads must be ${BUY_CONSISTENCY_READS}.`);
  }
  if (input.consistent !== true) {
    throw new TypeError(
      `${path}.consistent must be true; inconsistent captures are not a usable payload.`,
    );
  }
  return {
    kind: BUY_CONSISTENCY_KIND,
    reads: BUY_CONSISTENCY_READS,
    consistent: true,
  };
}

function parseDocument(value: unknown, path: string): BuySourceDocument {
  const input = closedRecord(
    value,
    [
      "doctype",
      "name",
      "modified",
      "docstatus",
      "status",
      "sourceCategory",
      "fields",
      "children",
      "fingerprint",
    ],
    ["doctype", "name", "modified", "sourceCategory", "fields", "fingerprint"],
    path,
  );
  const doctype = oneOf(input.doctype, BUY_CLOSED_DOCTYPES, `${path}.doctype`);
  const sourceCategory = oneOf(
    input.sourceCategory,
    BUY_DOCUMENT_SOURCE_CATEGORIES,
    `${path}.sourceCategory`,
  );
  if (sourceCategory !== BUY_DOCTYPE_SOURCE_CATEGORY[doctype]) {
    throw new TypeError(
      `${path}.sourceCategory must match the closed DocType; a generic document cannot masquerade as a price.`,
    );
  }
  return {
    doctype,
    name: nonEmptyText(input.name, `${path}.name`),
    modified: frappeDatetime(input.modified, `${path}.modified`),
    ...(input.docstatus === undefined
      ? {}
      : { docstatus: parseDocstatus(input.docstatus, `${path}.docstatus`) }),
    ...(input.status === undefined
      ? {}
      : { status: nonEmptyText(input.status, `${path}.status`) }),
    sourceCategory,
    fields: parseProjectedFields(input.fields, `${path}.fields`),
    ...(input.children === undefined
      ? {}
      : { children: parseChildren(input.children, `${path}.children`) }),
    fingerprint: prefixedSha256(input.fingerprint, `${path}.fingerprint`),
  };
}

function parseProjectedFields(
  value: unknown,
  path: string,
): Readonly<Record<string, BuyProjectedValue>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const rec = value as Record<string, unknown>;
  const fields: Record<string, BuyProjectedValue> = {};
  for (const key of Object.keys(rec).toSorted()) {
    const field = rec[key];
    if (
      typeof field !== "string" && typeof field !== "number" &&
      typeof field !== "boolean"
    ) {
      throw new TypeError(`${path}.${key} must be a scalar projection value.`);
    }
    if (typeof field === "number" && !Number.isFinite(field)) {
      throw new TypeError(`${path}.${key} must be finite.`);
    }
    fields[key] = field;
  }
  return fields;
}

function parseChildren(
  value: unknown,
  path: string,
): readonly BuyCapturedChildTable[] {
  return arrayOf(value, path).map((item, index) => {
    const table = exactRecord(item, ["table", "rows"], `${path}[${index}]`);
    return {
      table: nonEmptyText(table.table, `${path}[${index}].table`),
      rows: arrayOf(table.rows, `${path}[${index}].rows`).map((row, rowIndex) =>
        parseChildRow(row, `${path}[${index}].rows[${rowIndex}]`)
      ),
    };
  });
}

function parseChildRow(value: unknown, path: string): BuyCapturedChildRow {
  const input = closedRecord(
    value,
    ["name", "idx", "fields"],
    ["name", "fields"],
    path,
  );
  return {
    name: nonEmptyText(input.name, `${path}.name`),
    ...(input.idx === undefined ? {} : { idx: parseIdx(input.idx, `${path}.idx`) }),
    fields: parseProjectedFields(input.fields, `${path}.fields`),
  };
}

function parseDocstatus(value: unknown, path: string): number {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw new TypeError(`${path} must be 0, 1, or 2.`);
  }
  return value;
}

function parseIdx(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative integer.`);
  }
  return Number(value);
}

function isoMilliseconds(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!ISO_MILLISECONDS.test(text)) {
    throw new TypeError(`${path} must be canonical UTC with milliseconds.`);
  }
  return text;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`${path} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}
