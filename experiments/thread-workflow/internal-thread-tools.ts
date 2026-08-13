import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../src/application/ports/out/mcp-tool-client.ts";

export class ThreadNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreadNormalizationError";
  }
}

/**
 * In-process tools owned by the digital-thread backend.
 *
 * They adapt provider-native results into the linked model; they do not hide or
 * replace provider tools. Keeping the same McpToolClient interface lets the DAG
 * executor resolve local and remote nodes without putting MCP in the browser.
 */
export class InternalThreadToolClient implements McpToolClient {
  /**
   * No internal tool uses the text-result channel.
   *
   * Text-result tools (e.g. syson_constraint_solve) live on remote MCP servers
   * and must never be routed through the in-process backend. Raising an error
   * here enforces that boundary: if a DAG node accidentally routes a text-result
   * call to the internal client, the failure is immediate and labelled.
   */
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new ThreadNormalizationError(
        `Internal tools do not support callToolTextResult: ${call.name}`,
      ),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name !== "thread_observations_normalize") {
      return Promise.reject(
        new ThreadNormalizationError(`Unknown internal tool: ${call.name}`),
      );
    }
    try {
      return Promise.resolve(normalizeObservations(call.arguments ?? {}));
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

function normalizeObservations(
  args: Readonly<Record<string, unknown>>,
): McpToolResult {
  const observations = record(args.observations, "observations");
  const values: Record<string, { value: number; unit: string }> = {};
  const sources: Record<string, { producedBy: string }> = {};
  for (const [metric, raw] of Object.entries(observations)) {
    const observation = record(raw, `observations.${metric}`);
    const producedBy = nonEmptyString(
      observation.produced_by,
      `observations.${metric}.produced_by`,
    );
    const quantity = observation.quantity === undefined
      ? quantityValue(observation, `observations.${metric}`)
      : quantityValue(observation.quantity, `observations.${metric}.quantity`);
    values[metric] = quantity;
    sources[metric] = { producedBy };
  }

  const attestations = array(
    args.artifact_attestations,
    "artifact_attestations",
  ).map((raw, index) => {
    const path = `artifact_attestations[${index}]`;
    const attestation = record(raw, path);
    const producerSha256 = sha256(
      attestation.producer_sha256,
      `${path}.producer_sha256`,
    );
    const consumerSha256 = sha256(
      attestation.consumer_sha256,
      `${path}.consumer_sha256`,
    );
    const relation = nonEmptyString(attestation.relation, `${path}.relation`);
    if (producerSha256 !== consumerSha256) {
      throw new ThreadNormalizationError(
        `${path}: producer ${producerSha256} does not match consumed ${consumerSha256}`,
      );
    }
    return {
      relation,
      producerSha256,
      consumerSha256,
      status: "verified" as const,
    };
  });

  return {
    text: `${
      Object.keys(values).length
    } observation(s) normalized; ${attestations.length} artifact attestation(s) verified.`,
    structuredContent: {
      values,
      provenance: {
        observations: sources,
        artifactAttestations: attestations,
      },
    },
  };
}

function quantityValue(
  value: unknown,
  path: string,
): { value: number; unit: string } {
  const input = record(value, path);
  if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
    throw new ThreadNormalizationError(`${path}.value must be a finite number`);
  }
  return {
    value: input.value,
    unit: nonEmptyString(input.unit, `${path}.unit`),
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ThreadNormalizationError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ThreadNormalizationError(`${path} must be an array`);
  }
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ThreadNormalizationError(`${path} must be a non-empty string`);
  }
  return value;
}

function sha256(value: unknown, path: string): string {
  const digest = nonEmptyString(value, path);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new ThreadNormalizationError(`${path} must be a lowercase SHA-256`);
  }
  return digest;
}
