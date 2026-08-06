import type { McpToolClient, McpToolResult } from "../mcp/http-mcp-tool-client.ts";

export const SYSON_COFFEE_MACHINE_BUILD_SOURCE_SCHEMA =
  "syson-coffee-machine-build-source/1.0" as const;

export type SysonNumericLiteralKind =
  | "LiteralInteger"
  | "LiteralRational";

export interface SysonCoffeeMachineValueRead {
  tool: "syson_value_read";
  arguments: {
    editing_context_id: string;
    element_id: string;
  };
  structuredContent: {
    element_id: string;
    value: number;
    literal_id: string;
    literal_kind: SysonNumericLiteralKind;
    negated: boolean;
  };
}

/** The complete, canonical payload covered by sourceFingerprint. */
export interface SysonCoffeeMachineBuildSourcePayload {
  editingContextId: string;
  rootPartDefinitionId: string;
  exactAttributeIds: string[];
  reads: SysonCoffeeMachineValueRead[];
}

export interface SysonCoffeeMachineBuildSourceCapture {
  schemaVersion: typeof SYSON_COFFEE_MACHINE_BUILD_SOURCE_SCHEMA;
  capturedAt: string;
  source: SysonCoffeeMachineBuildSourcePayload;
  sourceFingerprint: {
    algorithm: "sha256";
    digest: string;
  };
}

export interface SysonCoffeeMachineBuildObserverOptions {
  client: McpToolClient;
  editingContextId: string;
  rootPartDefinitionId: string;
  exactAttributeIds: readonly string[];
  /** Bound provider pressure without retrying or changing result order. */
  maxConcurrency?: number;
  now?: () => Date;
}

/**
 * Captures exact numeric AttributeUsage values from SysON for a reviewed build.
 *
 * This is deliberately a read-only, identity-first boundary: it never resolves
 * labels, infers units, retries calls, or invokes a write tool.
 */
export class SysonCoffeeMachineBuildObserver {
  readonly #client: McpToolClient;
  readonly #editingContextId: string;
  readonly #rootPartDefinitionId: string;
  readonly #exactAttributeIds: string[];
  readonly #maxConcurrency: number;
  readonly #now: () => Date;

  constructor(options: SysonCoffeeMachineBuildObserverOptions) {
    this.#client = options.client;
    this.#editingContextId = strictUuid(
      options.editingContextId,
      "editingContextId",
    );
    this.#rootPartDefinitionId = strictUuid(
      options.rootPartDefinitionId,
      "rootPartDefinitionId",
    );
    if (
      !Array.isArray(options.exactAttributeIds) ||
      options.exactAttributeIds.length === 0
    ) {
      throw new TypeError("exactAttributeIds must be a non-empty list of UUIDs.");
    }
    this.#exactAttributeIds = options.exactAttributeIds.map((id, index) =>
      strictUuid(id, `exactAttributeIds[${index}]`)
    );
    rejectDuplicates(this.#exactAttributeIds, "exactAttributeIds");
    this.#maxConcurrency = options.maxConcurrency ?? 8;
    if (
      !Number.isSafeInteger(this.#maxConcurrency) ||
      this.#maxConcurrency < 1 ||
      this.#maxConcurrency > 32
    ) {
      throw new TypeError("maxConcurrency must be an integer between 1 and 32.");
    }
    this.#now = options.now ?? (() => new Date());
  }

  async observe(): Promise<SysonCoffeeMachineBuildSourceCapture> {
    const reads = await mapConcurrent(
      this.#exactAttributeIds,
      this.#maxConcurrency,
      async (attributeId) => {
        const args = {
          editing_context_id: this.#editingContextId,
          element_id: attributeId,
        };
        const result = await this.#client.callTool({
          name: "syson_value_read",
          arguments: args,
        });
        return {
          tool: "syson_value_read" as const,
          arguments: args,
          structuredContent: parseValueRead(result, attributeId),
        };
      },
    );

    const source: SysonCoffeeMachineBuildSourcePayload = {
      editingContextId: this.#editingContextId,
      rootPartDefinitionId: this.#rootPartDefinitionId,
      exactAttributeIds: [...this.#exactAttributeIds],
      reads,
    };
    const capturedAt = this.#now().toISOString();
    return {
      schemaVersion: SYSON_COFFEE_MACHINE_BUILD_SOURCE_SCHEMA,
      capturedAt,
      source,
      sourceFingerprint: {
        algorithm: "sha256",
        digest: await sha256(canonicalJson(source)),
      },
    };
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let failure: unknown;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (failure === undefined) {
        const index = nextIndex++;
        if (index >= values.length) return;
        try {
          results[index] = await operation(values[index]);
        } catch (error) {
          failure = error;
          return;
        }
      }
    },
  );
  await Promise.all(workers);
  if (failure !== undefined) throw failure;
  return results;
}

function parseValueRead(
  result: McpToolResult,
  requestedAttributeId: string,
): SysonCoffeeMachineValueRead["structuredContent"] {
  const content = result.structuredContent;
  if (content.element_id !== requestedAttributeId) {
    throw new Error(
      `syson_value_read element_id must exactly match requested attribute ${requestedAttributeId}.`,
    );
  }
  const value = content.value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `syson_value_read value for ${requestedAttributeId} must be a finite number.`,
    );
  }
  const literalId = strictUuid(
    content.literal_id,
    `syson_value_read literal_id for ${requestedAttributeId}`,
  );
  const literalKind = numericLiteralKind(
    content.literal_kind,
    requestedAttributeId,
  );
  if (literalKind === "LiteralInteger" && !Number.isInteger(value)) {
    throw new Error(
      `syson_value_read LiteralInteger value for ${requestedAttributeId} must be an integer.`,
    );
  }
  if (typeof content.negated !== "boolean") {
    throw new Error(
      `syson_value_read negated for ${requestedAttributeId} must be a boolean.`,
    );
  }
  if (
    (value < 0 && !content.negated) ||
    (value > 0 && content.negated)
  ) {
    throw new Error(
      `syson_value_read negated for ${requestedAttributeId} is inconsistent with value ${value}.`,
    );
  }
  return {
    element_id: requestedAttributeId,
    value,
    literal_id: literalId,
    literal_kind: literalKind,
    negated: content.negated,
  };
}

function numericLiteralKind(
  value: unknown,
  attributeId: string,
): SysonNumericLiteralKind {
  if (value !== "LiteralInteger" && value !== "LiteralRational") {
    throw new Error(
      `syson_value_read literal_kind for ${attributeId} must be LiteralInteger or LiteralRational.`,
    );
  }
  return value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function strictUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError(`${label} must be a canonical lowercase UUID.`);
  }
  return value;
}

function rejectDuplicates(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${label} must not contain duplicate IDs.`);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
