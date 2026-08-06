import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/thread-snapshot.ts";
import type { CompiledCoffeeMachineCm01SemanticCadPlan } from "../../domain/cm01/coffee-machine-cm01-semantic-cad-plan.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";

/** Closed capture contract for the reviewed 28 mm -> 30 mm CAD successor. */
export const CM01_SEMANTIC_CAD_CAPTURE_R2_SCHEMA =
  "cm01-semantic-cad-capture/2.0" as const;
export const CM01_SEMANTIC_CAD_R2_EXPORT_NAME = "coffee-machine-cm01-v3-r2" as const;

export interface Cm01SemanticCadR2ExportFile {
  readonly format: "step" | "gltf" | "stl";
  /** Provider paths are deliberately reduced to this reviewed basename. */
  readonly name: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
}

export interface Cm01SemanticCadR2Capture {
  readonly schemaVersion: typeof CM01_SEMANTIC_CAD_CAPTURE_R2_SCHEMA;
  readonly kind: "cm01-semantic-cad-export";
  readonly capturedAt: string;
  readonly producer: {
    readonly serverId: "build123d";
    readonly tool: "build123d_export";
  };
  readonly plan: CompiledCoffeeMachineCm01SemanticCadPlan["plan"];
  readonly script: string;
  readonly request: {
    readonly formats: readonly ["step", "gltf", "stl"];
    readonly name: typeof CM01_SEMANTIC_CAD_R2_EXPORT_NAME;
    readonly timeoutMs: 120000;
  };
  readonly files: readonly Cm01SemanticCadR2ExportFile[];
  readonly fingerprint: ContentFingerprint;
}

/**
 * Capture only the explicit R2 assembly export. The compiler is expected to
 * have produced the closed `coffee-machine-cm01-v3-r2` plan already; this
 * adapter repeats that assertion so a V1 plan cannot cross the provider edge.
 */
export async function captureCm01SemanticCadExportR2(
  client: McpToolClient,
  compiled: CompiledCoffeeMachineCm01SemanticCadPlan,
  now: () => string = () => new Date().toISOString(),
): Promise<Cm01SemanticCadR2Capture> {
  assertR2Plan(compiled.plan);
  const result = await client.callTool({
    name: "build123d_export",
    arguments: {
      script: compiled.script,
      formats: ["step", "gltf", "stl"],
      name: CM01_SEMANTIC_CAD_R2_EXPORT_NAME,
      timeout_ms: 120000,
    },
  });
  const unsigned = {
    schemaVersion: CM01_SEMANTIC_CAD_CAPTURE_R2_SCHEMA,
    kind: "cm01-semantic-cad-export" as const,
    capturedAt: timestamp(now()),
    producer: { serverId: "build123d" as const, tool: "build123d_export" as const },
    plan: structuredClone(compiled.plan),
    script: compiled.script,
    request: {
      formats: ["step", "gltf", "stl"] as const,
      name: CM01_SEMANTIC_CAD_R2_EXPORT_NAME,
      timeoutMs: 120000 as const,
    },
    files: normalizeExport(result.structuredContent),
  };
  return Object.freeze({ ...unsigned, fingerprint: await sha256Fingerprint(unsigned) });
}

export async function parseCm01SemanticCadR2Capture(
  value: unknown,
): Promise<Cm01SemanticCadR2Capture> {
  const root = record(value, "CM-01 R2 CAD capture");
  exactKeys(root, [
    "capturedAt",
    "files",
    "fingerprint",
    "kind",
    "plan",
    "producer",
    "request",
    "schemaVersion",
    "script",
  ], "CM-01 R2 CAD capture");
  if (
    root.schemaVersion !== CM01_SEMANTIC_CAD_CAPTURE_R2_SCHEMA ||
    root.kind !== "cm01-semantic-cad-export" || typeof root.script !== "string"
  ) throw new Error("The persisted CM-01 R2 CAD capture has an unsupported contract.");
  const producer = record(root.producer, "CM-01 R2 CAD capture producer");
  exactKeys(producer, ["serverId", "tool"], "CM-01 R2 CAD capture producer");
  if (producer.serverId !== "build123d" || producer.tool !== "build123d_export") {
    throw new Error("The persisted CM-01 R2 CAD capture has an unexpected producer.");
  }
  const request = record(root.request, "CM-01 R2 CAD capture request");
  exactKeys(request, ["formats", "name", "timeoutMs"], "CM-01 R2 CAD capture request");
  if (
    !Array.isArray(request.formats) ||
    deterministicJson(request.formats) !== deterministicJson(["step", "gltf", "stl"]) ||
    request.name !== CM01_SEMANTIC_CAD_R2_EXPORT_NAME || request.timeoutMs !== 120000
  ) throw new Error("The persisted CM-01 R2 CAD capture has an unexpected request.");
  const plan = root.plan as CompiledCoffeeMachineCm01SemanticCadPlan["plan"];
  assertR2Plan(plan);
  const files = parseStoredFiles(root.files);
  const unsigned = {
    schemaVersion: CM01_SEMANTIC_CAD_CAPTURE_R2_SCHEMA,
    kind: "cm01-semantic-cad-export" as const,
    capturedAt: timestamp(root.capturedAt),
    producer: { serverId: "build123d" as const, tool: "build123d_export" as const },
    plan: structuredClone(plan),
    script: root.script,
    request: {
      formats: ["step", "gltf", "stl"] as const,
      name: CM01_SEMANTIC_CAD_R2_EXPORT_NAME,
      timeoutMs: 120000 as const,
    },
    files,
  };
  const fingerprint = contentFingerprint(
    root.fingerprint,
    "CM-01 R2 CAD capture fingerprint",
  );
  const actual = await sha256Fingerprint(unsigned);
  if (actual.digest !== fingerprint.digest) {
    throw new Error(
      "The persisted CM-01 R2 CAD capture fingerprint does not match its content.",
    );
  }
  return Object.freeze({ ...unsigned, fingerprint });
}

function normalizeExport(value: unknown): readonly Cm01SemanticCadR2ExportFile[] {
  const root = record(value, "build123d_export structuredContent");
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
  record(root.metrics, "build123d_export metrics");
  if (!Array.isArray(root.files) || root.files.length !== 3) {
    throw new Error("build123d_export must return exactly STEP, glTF and STL files.");
  }
  return Object.freeze(root.files.map((candidate, index) => {
    const item = record(candidate, `build123d_export file ${index}`);
    const format = (["step", "gltf", "stl"] as const)[index]!;
    const expectedKeys = format === "gltf"
      ? ["bytes", "format", "path", "sha256", "viewer"]
      : ["bytes", "format", "path", "sha256"];
    exactKeys(item, expectedKeys, `build123d_export file ${index}`);
    if (item.format !== format) {
      throw new Error("build123d_export files are not in the reviewed format order.");
    }
    return {
      format,
      name: basename(item.path, format),
      bytes: positiveInt(item.bytes, "build123d_export file bytes"),
      fingerprint: contentFingerprint(item.sha256, "build123d_export file sha256"),
    };
  }));
}

function parseStoredFiles(value: unknown): readonly Cm01SemanticCadR2ExportFile[] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(
      "The persisted CM-01 R2 CAD capture must contain exactly three files.",
    );
  }
  return Object.freeze(value.map((candidate, index) => {
    const item = record(candidate, `CM-01 R2 CAD capture file ${index}`);
    exactKeys(
      item,
      ["bytes", "fingerprint", "format", "name"],
      `CM-01 R2 CAD capture file ${index}`,
    );
    const format = (["step", "gltf", "stl"] as const)[index]!;
    const extension = format === "gltf" ? "glb" : format;
    if (
      item.format !== format ||
      item.name !== `${CM01_SEMANTIC_CAD_R2_EXPORT_NAME}.${extension}`
    ) {
      throw new Error(
        "The persisted CM-01 R2 CAD capture has an unexpected file identity.",
      );
    }
    return {
      format,
      name: item.name,
      bytes: positiveInt(item.bytes, "CM-01 R2 CAD capture file bytes"),
      fingerprint: contentFingerprint(
        item.fingerprint,
        "CM-01 R2 CAD capture file fingerprint",
      ),
    };
  }));
}

function assertR2Plan(
  value: unknown,
): asserts value is CompiledCoffeeMachineCm01SemanticCadPlan["plan"] {
  const plan = record(value, "CM-01 R2 CAD plan");
  if (
    plan.schemaVersion !== "coffee-machine-cm01-semantic-cad-plan/1.0" ||
    !record(plan.recipe, "CM-01 R2 CAD plan recipe") ||
    !record(plan.build123d, "CM-01 R2 CAD plan build123d") ||
    (plan.recipe as Record<string, unknown>).schemaVersion !==
      "coffee-machine-semantic-recipe/2.0" ||
    (plan.recipe as Record<string, unknown>).key !== "cm01-drip-tray-height-30" ||
    (plan.build123d as Record<string, unknown>).exportName !==
      CM01_SEMANTIC_CAD_R2_EXPORT_NAME ||
    !Array.isArray(plan.artifacts)
  ) {
    throw new Error(
      "The CM-01 R2 CAD capture requires the closed 30 mm compiled plan.",
    );
  }
}

function basename(value: unknown, format: "step" | "gltf" | "stl"): string {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error("build123d_export returned an invalid export path.");
  }
  const name = value.split(/[\\/]/).at(-1) ?? "";
  const extension = format === "gltf" ? "glb" : format;
  if (name !== `${CM01_SEMANTIC_CAD_R2_EXPORT_NAME}.${extension}`) {
    throw new Error(
      "build123d_export did not preserve the fixed CM-01 R2 export basename.",
    );
  }
  return name;
}

function contentFingerprint(value: unknown, label: string): ContentFingerprint {
  const candidate = typeof value === "string"
    ? { algorithm: "sha256", digest: value }
    : value;
  const root = record(candidate, label);
  exactKeys(root, ["algorithm", "digest"], label);
  if (
    root.algorithm !== "sha256" || typeof root.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(root.digest)
  ) {
    throw new Error(`${label} must be sha256.`);
  }
  return { algorithm: "sha256", digest: root.digest };
}

function record(value: unknown, label: string): Record<string, unknown> {
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
function positiveInt(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value as number;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("CM-01 R2 CAD capture time must be ISO-8601.");
  }
  return value;
}
