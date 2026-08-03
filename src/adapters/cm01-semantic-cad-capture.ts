import { deterministicJson, sha256Fingerprint } from "../domain/deterministic-json.ts";
import type { ContentFingerprint } from "../domain/thread-snapshot.ts";
import type { CompiledCoffeeMachineCm01SemanticCadPlan } from "../domain/coffee-machine-cm01-semantic-cad-plan.ts";
import type { McpToolClient } from "./http-mcp-tool-client.ts";

/** Normalized, closed evidence from the reviewed V3 build123d export. */
export const CM01_SEMANTIC_CAD_CAPTURE_SCHEMA =
  "cm01-semantic-cad-capture/1.0" as const;

export interface Cm01SemanticCadExportFile {
  readonly format: "step" | "gltf" | "stl";
  /** Safe basename only; provider-local absolute paths never enter the thread. */
  readonly name: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
}

export interface Cm01SemanticCadCapture {
  readonly schemaVersion: typeof CM01_SEMANTIC_CAD_CAPTURE_SCHEMA;
  readonly kind: "cm01-semantic-cad-export";
  readonly capturedAt: string;
  readonly producer: {
    readonly serverId: "build123d";
    readonly tool: "build123d_export";
  };
  /** Immutable compiler outputs; no provider payload is retained. */
  readonly plan: CompiledCoffeeMachineCm01SemanticCadPlan["plan"];
  readonly script: string;
  /** The exact fixed provider request, excluding any provider response. */
  readonly request: {
    readonly formats: readonly ["step", "gltf", "stl"];
    readonly name: "coffee-machine-cm01-v3";
    readonly timeoutMs: 120000;
  };
  readonly files: readonly Cm01SemanticCadExportFile[];
  readonly fingerprint: ContentFingerprint;
}

/**
 * Calls only the closed export request.  The provider result is parsed into a
 * small attested file manifest; raw structuredContent never crosses this
 * boundary or reaches persistent project evidence.
 */
export async function captureCm01SemanticCadExport(
  client: McpToolClient,
  compiled: CompiledCoffeeMachineCm01SemanticCadPlan,
  now: () => string = () => new Date().toISOString(),
): Promise<Cm01SemanticCadCapture> {
  const result = await client.callTool({
    name: "build123d_export",
    arguments: {
      script: compiled.script,
      formats: ["step", "gltf", "stl"],
      name: "coffee-machine-cm01-v3",
      timeout_ms: 120000,
    },
  });
  const capturedAt = timestamp(now());
  const files = normalizeExport(result.structuredContent);
  const unsigned = {
    schemaVersion: CM01_SEMANTIC_CAD_CAPTURE_SCHEMA,
    kind: "cm01-semantic-cad-export" as const,
    capturedAt,
    producer: { serverId: "build123d" as const, tool: "build123d_export" as const },
    plan: structuredClone(compiled.plan),
    script: compiled.script,
    request: {
      formats: ["step", "gltf", "stl"] as const,
      name: "coffee-machine-cm01-v3" as const,
      timeoutMs: 120000 as const,
    },
    files,
  };
  return Object.freeze({
    ...unsigned,
    fingerprint: await sha256Fingerprint(unsigned),
  });
}

export async function parseCm01SemanticCadCapture(
  value: unknown,
): Promise<Cm01SemanticCadCapture> {
  const record = object(value, "CM-01 CAD capture");
  exactKeys(record, [
    "capturedAt",
    "files",
    "fingerprint",
    "kind",
    "plan",
    "producer",
    "request",
    "schemaVersion",
    "script",
  ], "CM-01 CAD capture");
  if (
    record.schemaVersion !== CM01_SEMANTIC_CAD_CAPTURE_SCHEMA ||
    record.kind !== "cm01-semantic-cad-export" || typeof record.script !== "string"
  ) throw new Error("The persisted CM-01 CAD capture has an unsupported contract.");
  const capturedAt = timestamp(record.capturedAt);
  const producer = object(record.producer, "CM-01 CAD capture producer");
  exactKeys(producer, ["serverId", "tool"], "CM-01 CAD capture producer");
  if (producer.serverId !== "build123d" || producer.tool !== "build123d_export") {
    throw new Error("The persisted CM-01 CAD capture has an unexpected producer.");
  }
  const request = object(record.request, "CM-01 CAD capture request");
  exactKeys(request, ["formats", "name", "timeoutMs"], "CM-01 CAD capture request");
  if (
    !Array.isArray(request.formats) || deterministicJson(request.formats) !==
      deterministicJson(["step", "gltf", "stl"]) ||
    request.name !== "coffee-machine-cm01-v3" || request.timeoutMs !== 120000
  ) throw new Error("The persisted CM-01 CAD capture has an unexpected request.");
  const plan = record.plan as CompiledCoffeeMachineCm01SemanticCadPlan["plan"];
  validatePlan(plan);
  const files = parseStoredFiles(record.files);
  const fingerprint = contentFingerprint(
    record.fingerprint,
    "CM-01 CAD capture fingerprint",
  );
  const unsigned = {
    schemaVersion: CM01_SEMANTIC_CAD_CAPTURE_SCHEMA,
    kind: "cm01-semantic-cad-export" as const,
    capturedAt,
    producer: { serverId: "build123d" as const, tool: "build123d_export" as const },
    plan: structuredClone(plan),
    script: record.script,
    request: {
      formats: ["step", "gltf", "stl"] as const,
      name: "coffee-machine-cm01-v3" as const,
      timeoutMs: 120000 as const,
    },
    files,
  };
  const actual = await sha256Fingerprint(unsigned);
  if (actual.digest !== fingerprint.digest) {
    throw new Error(
      "The persisted CM-01 CAD capture fingerprint does not match its content.",
    );
  }
  return Object.freeze({ ...unsigned, fingerprint });
}

function normalizeExport(value: unknown): readonly Cm01SemanticCadExportFile[] {
  const root = object(value, "build123d_export structuredContent");
  exactKeys(
    root,
    ["files", "kind", "metrics", "schemaVersion"],
    "build123d_export structuredContent",
  );
  if (root.schemaVersion !== "1.0" || root.kind !== "export") {
    throw new Error(
      "build123d_export returned an unsupported structuredContent contract.",
    );
  }
  object(root.metrics, "build123d_export metrics");
  return normalizeFiles(root.files);
}

function normalizeFiles(value: unknown): readonly Cm01SemanticCadExportFile[] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error("build123d_export must return exactly STEP, glTF and STL files.");
  }
  const expected = ["step", "gltf", "stl"] as const;
  const files = value.map((candidate, index) => {
    const record = object(candidate, `build123d_export file ${index}`);
    const allowed = record.format === "gltf"
      ? ["bytes", "format", "path", "sha256", "viewer"]
      : ["bytes", "format", "path", "sha256"];
    exactKeys(record, allowed, `build123d_export file ${index}`);
    const format = expected[index]!;
    if (record.format !== format) {
      throw new Error("build123d_export files are not in the reviewed format order.");
    }
    if (
      typeof record.bytes !== "number" || !Number.isSafeInteger(record.bytes) ||
      record.bytes < 1
    ) {
      throw new Error("build123d_export returned invalid export bytes.");
    }
    return {
      format,
      name: exportBasename(record.path, format),
      bytes: record.bytes,
      fingerprint: contentFingerprint(
        record.sha256,
        `build123d_export file ${index} sha256`,
      ),
    } as Cm01SemanticCadExportFile;
  });
  return Object.freeze(files);
}

function parseStoredFiles(value: unknown): readonly Cm01SemanticCadExportFile[] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(
      "The persisted CM-01 CAD capture must contain exactly three files.",
    );
  }
  const expected = ["step", "gltf", "stl"] as const;
  return Object.freeze(value.map((candidate, index) => {
    const record = object(candidate, `CM-01 CAD capture file ${index}`);
    exactKeys(
      record,
      ["bytes", "fingerprint", "format", "name"],
      `CM-01 CAD capture file ${index}`,
    );
    const format = expected[index]!;
    if (
      record.format !== format ||
      record.name !== `coffee-machine-cm01-v3.${format === "gltf" ? "glb" : format}`
    ) {
      throw new Error(
        "The persisted CM-01 CAD capture has an unexpected file identity.",
      );
    }
    if (
      typeof record.bytes !== "number" || !Number.isSafeInteger(record.bytes) ||
      record.bytes < 1
    ) {
      throw new Error("The persisted CM-01 CAD capture has invalid file bytes.");
    }
    return {
      format,
      name: record.name,
      bytes: record.bytes,
      fingerprint: contentFingerprint(
        record.fingerprint,
        `CM-01 CAD capture file ${index} fingerprint`,
      ),
    };
  }));
}

function exportBasename(path: unknown, format: "step" | "gltf" | "stl"): string {
  if (typeof path !== "string" || path.includes("\0")) {
    throw new Error("build123d_export returned an invalid export path.");
  }
  const name = path.split(/[\\/]/).at(-1) ?? "";
  const extension = format === "gltf" ? "glb" : format;
  if (name !== `coffee-machine-cm01-v3.${extension}`) {
    throw new Error(
      "build123d_export did not preserve the fixed CM-01 export basename.",
    );
  }
  return name;
}

function validatePlan(
  value: unknown,
): asserts value is CompiledCoffeeMachineCm01SemanticCadPlan["plan"] {
  const plan = object(value, "CM-01 CAD plan");
  if (plan.schemaVersion !== "coffee-machine-cm01-semantic-cad-plan/1.0") {
    throw new Error("The persisted CM-01 CAD capture has an unsupported plan.");
  }
  // The executor independently recompiles the parsed recipe and compares the
  // canonical JSON, so this parser only rejects obviously malformed storage.
  if (
    !object(plan.build123d, "CM-01 CAD plan build123d") ||
    !Array.isArray(plan.artifacts)
  ) {
    throw new Error("The persisted CM-01 CAD capture has an invalid plan.");
  }
}

function contentFingerprint(value: unknown, label: string): ContentFingerprint {
  if (typeof value === "string") {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be sha256.`);
    return { algorithm: "sha256", digest: value };
  }
  const record = object(value, label);
  exactKeys(record, ["algorithm", "digest"], label);
  if (
    record.algorithm !== "sha256" || typeof record.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.digest)
  ) {
    throw new Error(`${label} must be sha256.`);
  }
  return { algorithm: "sha256", digest: record.digest };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (
    deterministicJson(Object.keys(record).sort()) !==
      deterministicJson([...expected].sort())
  ) {
    throw new Error(`${label} has unsupported or missing fields.`);
  }
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("CM-01 CAD capture time must be ISO-8601.");
  }
  return value;
}
