import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/thread-snapshot.ts";
import type { CompiledCoffeeMachineCm01SemanticCadPlan } from "../../domain/coffee-machine-cm01-semantic-cad-plan.ts";
import { renderBuild123dPartScript } from "../../domain/coffee-machine-cm01-semantic-cad-plan.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import { CM01_SEMANTIC_CAD_R2_EXPORT_NAME } from "./cm01-semantic-cad-capture-r2.ts";

/**
 * Closed evidence schema for the CM-01 V3 @3 CAD export.
 *
 * Extends the R2 assembly export with server-generated per-part presentation
 * STLs.  A single fingerprint covers the assembly export, all part exports,
 * and the compiled plan — so the attempt store tracks the entire multi-call
 * sequence atomically.  If any provider call fails, the attempt remains in
 * "dispatched" state and the operator must inspect before any retry.
 */
export const CM01_SEMANTIC_CAD_CAPTURE_R3_SCHEMA =
  "cm01-semantic-cad-capture/3.0" as const;

/**
 * Stable asset basenames used for the assembly and per-part exports.
 *
 * Naming convention for the UI selector (component-workspace):
 *   Assembly STL  → "coffee-machine-cm01-v3-r3-assembly.stl"
 *   Part STL      → "coffee-machine-cm01-v3-r3-{semanticKey}.stl"
 *              e.g. "coffee-machine-cm01-v3-r3-drip-tray.stl"
 *
 * Thread artifact IDs within the snapshot:
 *   {prefix}-step                  (kind: "step")
 *   {prefix}-mesh-assembly         (kind: "mesh")
 *   {prefix}-mesh-{semanticKey}    (kind: "mesh", one per recipe component)
 *
 * where prefix = "coffee-machine-cm01-v3-cad-r3-{captureFingerprint.digest}"
 */
export const CM01_SEMANTIC_CAD_R3_ASSEMBLY_EXPORT_NAME =
  "coffee-machine-cm01-v3-r3-assembly" as const;

export const CM01_SEMANTIC_CAD_R3_PART_EXPORT_PREFIX =
  "coffee-machine-cm01-v3-r3-" as const;

/** One assembly-level export file (step, gltf, or stl). */
export interface Cm01SemanticCadR3AssemblyFile {
  readonly format: "step" | "gltf" | "stl";
  readonly name: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
}

/** One server-rendered per-part presentation STL. */
export interface Cm01SemanticCadR3PartMesh {
  readonly semanticKey: string;
  /** Stable asset basename: "coffee-machine-cm01-v3-r3-{semanticKey}.stl" */
  readonly name: string;
  readonly bytes: number;
  readonly fingerprint: ContentFingerprint;
}

export interface Cm01SemanticCadR3Capture {
  readonly schemaVersion: typeof CM01_SEMANTIC_CAD_CAPTURE_R3_SCHEMA;
  readonly kind: "cm01-semantic-cad-export";
  readonly capturedAt: string;
  readonly producer: {
    readonly serverId: "build123d";
    readonly tool: "build123d_export";
  };
  /** Immutable compiler outputs — same compiled R2 plan as the @2 operation. */
  readonly plan: CompiledCoffeeMachineCm01SemanticCadPlan["plan"];
  readonly script: string;
  readonly request: {
    readonly assemblyFormats: readonly ["step", "gltf", "stl"];
    readonly assemblyName: typeof CM01_SEMANTIC_CAD_R3_ASSEMBLY_EXPORT_NAME;
    readonly partFormats: readonly ["stl"];
    readonly partExportPrefix: typeof CM01_SEMANTIC_CAD_R3_PART_EXPORT_PREFIX;
    readonly timeoutMs: 120000;
  };
  /** Assembly export files: STEP, glTF, STL in that order. */
  readonly files: readonly Cm01SemanticCadR3AssemblyFile[];
  /**
   * Per-part presentation STLs in component-declaration order from the
   * compiled recipe.  Each entry uses the fixed server-side export name
   * "coffee-machine-cm01-v3-r3-{semanticKey}" and STL format only.
   *
   * Tessellation is build123d-default (linear_tolerance ≈ 0.001 × bounding
   * box, angular_tolerance = 0.1 rad) — a presentation-quality constant
   * chosen server-side, never an agent input.
   */
  readonly partMeshes: readonly Cm01SemanticCadR3PartMesh[];
  readonly fingerprint: ContentFingerprint;
}

/**
 * Execute all N+1 build123d_export calls and return one attested capture.
 *
 * Call 1: assembly (STEP + glTF + STL) under the fixed assembly name.
 * Calls 2…N+1: per-component STL only, one per recipe component in order.
 *
 * The entire sequence runs under one attempt-store entry: if any call fails,
 * the "dispatched" marker prevents blind replay and the operator must inspect.
 */
export async function captureCm01SemanticCadExportR3(
  client: McpToolClient,
  compiled: CompiledCoffeeMachineCm01SemanticCadPlan,
  now: () => string = () => new Date().toISOString(),
): Promise<Cm01SemanticCadR3Capture> {
  assertR3Plan(compiled.plan);

  // Assembly call: STEP + glTF + STL.
  const assemblyResult = await client.callTool({
    name: "build123d_export",
    arguments: {
      script: compiled.script,
      formats: ["step", "gltf", "stl"],
      name: CM01_SEMANTIC_CAD_R3_ASSEMBLY_EXPORT_NAME,
      timeout_ms: 120000,
    },
  });
  const assemblyFiles = normalizeAssemblyExport(assemblyResult.structuredContent);

  // Per-part calls: STL only, one per component from the compiled plan.
  const partMeshes: Cm01SemanticCadR3PartMesh[] = [];
  for (const component of compiled.plan.geometry.components) {
    const partName =
      `${CM01_SEMANTIC_CAD_R3_PART_EXPORT_PREFIX}${component.semanticKey}` as const;
    const partScript = renderBuild123dPartScript(component);
    const partResult = await client.callTool({
      name: "build123d_export",
      arguments: {
        script: partScript,
        formats: ["stl"],
        name: partName,
        timeout_ms: 120000,
      },
    });
    partMeshes.push(
      normalizePartMesh(partResult.structuredContent, component.semanticKey),
    );
  }

  const capturedAt = timestamp(now());
  const unsigned = {
    schemaVersion: CM01_SEMANTIC_CAD_CAPTURE_R3_SCHEMA,
    kind: "cm01-semantic-cad-export" as const,
    capturedAt,
    producer: { serverId: "build123d" as const, tool: "build123d_export" as const },
    plan: structuredClone(compiled.plan),
    script: compiled.script,
    request: {
      assemblyFormats: ["step", "gltf", "stl"] as const,
      assemblyName: CM01_SEMANTIC_CAD_R3_ASSEMBLY_EXPORT_NAME,
      partFormats: ["stl"] as const,
      partExportPrefix: CM01_SEMANTIC_CAD_R3_PART_EXPORT_PREFIX,
      timeoutMs: 120000 as const,
    },
    files: assemblyFiles,
    partMeshes: Object.freeze(partMeshes),
  };
  return Object.freeze({ ...unsigned, fingerprint: await sha256Fingerprint(unsigned) });
}

export async function parseCm01SemanticCadR3Capture(
  value: unknown,
): Promise<Cm01SemanticCadR3Capture> {
  const root = record(value, "CM-01 R3 CAD capture");
  exactKeys(root, [
    "capturedAt",
    "files",
    "fingerprint",
    "kind",
    "partMeshes",
    "plan",
    "producer",
    "request",
    "schemaVersion",
    "script",
  ], "CM-01 R3 CAD capture");
  if (
    root.schemaVersion !== CM01_SEMANTIC_CAD_CAPTURE_R3_SCHEMA ||
    root.kind !== "cm01-semantic-cad-export" || typeof root.script !== "string"
  ) throw new Error("The persisted CM-01 R3 CAD capture has an unsupported contract.");
  const producer = record(root.producer, "CM-01 R3 CAD capture producer");
  exactKeys(producer, ["serverId", "tool"], "CM-01 R3 CAD capture producer");
  if (producer.serverId !== "build123d" || producer.tool !== "build123d_export") {
    throw new Error("The persisted CM-01 R3 CAD capture has an unexpected producer.");
  }
  const req = record(root.request, "CM-01 R3 CAD capture request");
  exactKeys(
    req,
    ["assemblyFormats", "assemblyName", "partExportPrefix", "partFormats", "timeoutMs"],
    "CM-01 R3 CAD capture request",
  );
  if (
    !Array.isArray(req.assemblyFormats) ||
    deterministicJson(req.assemblyFormats) !==
      deterministicJson(["step", "gltf", "stl"]) ||
    req.assemblyName !== CM01_SEMANTIC_CAD_R3_ASSEMBLY_EXPORT_NAME ||
    !Array.isArray(req.partFormats) ||
    deterministicJson(req.partFormats) !== deterministicJson(["stl"]) ||
    req.partExportPrefix !== CM01_SEMANTIC_CAD_R3_PART_EXPORT_PREFIX ||
    req.timeoutMs !== 120000
  ) throw new Error("The persisted CM-01 R3 CAD capture has an unexpected request.");
  const plan = root.plan as CompiledCoffeeMachineCm01SemanticCadPlan["plan"];
  assertR3Plan(plan);
  const files = parseStoredAssemblyFiles(root.files);
  const partMeshes = parseStoredPartMeshes(root.partMeshes, plan.geometry.components);
  const fingerprint = contentFingerprint(
    root.fingerprint,
    "CM-01 R3 CAD capture fingerprint",
  );
  const unsigned = {
    schemaVersion: CM01_SEMANTIC_CAD_CAPTURE_R3_SCHEMA,
    kind: "cm01-semantic-cad-export" as const,
    capturedAt: timestamp(root.capturedAt),
    producer: { serverId: "build123d" as const, tool: "build123d_export" as const },
    plan: structuredClone(plan),
    script: root.script as string,
    request: {
      assemblyFormats: ["step", "gltf", "stl"] as const,
      assemblyName: CM01_SEMANTIC_CAD_R3_ASSEMBLY_EXPORT_NAME,
      partFormats: ["stl"] as const,
      partExportPrefix: CM01_SEMANTIC_CAD_R3_PART_EXPORT_PREFIX,
      timeoutMs: 120000 as const,
    },
    files,
    partMeshes,
  };
  const actual = await sha256Fingerprint(unsigned);
  if (actual.digest !== fingerprint.digest) {
    throw new Error(
      "The persisted CM-01 R3 CAD capture fingerprint does not match its content.",
    );
  }
  return Object.freeze({ ...unsigned, fingerprint });
}

function normalizeAssemblyExport(
  value: unknown,
): readonly Cm01SemanticCadR3AssemblyFile[] {
  const root = record(value, "build123d_export assembly structuredContent");
  exactKeys(
    root,
    ["files", "kind", "metrics", "schemaVersion"],
    "build123d_export assembly structuredContent",
  );
  if (root.schemaVersion !== "1.0" || root.kind !== "export") {
    throw new Error(
      "build123d_export assembly returned an unsupported structuredContent contract.",
    );
  }
  record(root.metrics, "build123d_export assembly metrics");
  if (!Array.isArray(root.files) || root.files.length !== 3) {
    throw new Error(
      "build123d_export assembly must return exactly STEP, glTF and STL files.",
    );
  }
  return Object.freeze(root.files.map((candidate, index) => {
    const item = record(candidate, `build123d_export assembly file ${index}`);
    const format = (["step", "gltf", "stl"] as const)[index]!;
    const expectedKeys = format === "gltf"
      ? ["bytes", "format", "path", "sha256", "viewer"]
      : ["bytes", "format", "path", "sha256"];
    exactKeys(item, expectedKeys, `build123d_export assembly file ${index}`);
    if (item.format !== format) {
      throw new Error(
        "build123d_export assembly files are not in the reviewed format order.",
      );
    }
    return {
      format,
      name: assemblyBasename(item.path, format),
      bytes: positiveInt(item.bytes, "build123d_export assembly file bytes"),
      fingerprint: contentFingerprint(item.sha256, "build123d_export assembly sha256"),
    };
  }));
}

function normalizePartMesh(
  value: unknown,
  semanticKey: string,
): Cm01SemanticCadR3PartMesh {
  const root = record(value, `build123d_export part ${semanticKey} structuredContent`);
  exactKeys(
    root,
    ["files", "kind", "metrics", "schemaVersion"],
    `build123d_export part ${semanticKey} structuredContent`,
  );
  if (root.schemaVersion !== "1.0" || root.kind !== "export") {
    throw new Error(
      `build123d_export part ${semanticKey} returned an unsupported structuredContent.`,
    );
  }
  record(root.metrics, `build123d_export part ${semanticKey} metrics`);
  if (!Array.isArray(root.files) || root.files.length !== 1) {
    throw new Error(
      `build123d_export part ${semanticKey} must return exactly one STL file.`,
    );
  }
  const item = record(root.files[0], `build123d_export part ${semanticKey} file`);
  exactKeys(
    item,
    ["bytes", "format", "path", "sha256"],
    `build123d_export part ${semanticKey} file`,
  );
  if (item.format !== "stl") {
    throw new Error(`build123d_export part ${semanticKey} must return STL format.`);
  }
  const expectedName = `${CM01_SEMANTIC_CAD_R3_PART_EXPORT_PREFIX}${semanticKey}.stl`;
  const actualName = (typeof item.path === "string" ? item.path : "").split(/[\\/]/).at(
    -1,
  ) ?? "";
  if (actualName !== expectedName) {
    throw new Error(
      `build123d_export part ${semanticKey} did not preserve the fixed STL basename.`,
    );
  }
  return {
    semanticKey,
    name: expectedName,
    bytes: positiveInt(item.bytes, `build123d_export part ${semanticKey} bytes`),
    fingerprint: contentFingerprint(
      item.sha256,
      `build123d_export part ${semanticKey} sha256`,
    ),
  };
}

function parseStoredAssemblyFiles(
  value: unknown,
): readonly Cm01SemanticCadR3AssemblyFile[] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(
      "The persisted CM-01 R3 CAD capture must contain exactly three assembly files.",
    );
  }
  return Object.freeze(value.map((candidate, index) => {
    const item = record(candidate, `CM-01 R3 CAD capture assembly file ${index}`);
    exactKeys(
      item,
      ["bytes", "fingerprint", "format", "name"],
      `CM-01 R3 CAD capture assembly file ${index}`,
    );
    const format = (["step", "gltf", "stl"] as const)[index]!;
    const extension = format === "gltf" ? "glb" : format;
    const expectedName = `${CM01_SEMANTIC_CAD_R3_ASSEMBLY_EXPORT_NAME}.${extension}`;
    if (item.format !== format || item.name !== expectedName) {
      throw new Error(
        `CM-01 R3 CAD capture has unexpected assembly file identity at index ${index}.`,
      );
    }
    return {
      format,
      name: item.name as string,
      bytes: positiveInt(
        item.bytes,
        `CM-01 R3 CAD capture assembly file ${index} bytes`,
      ),
      fingerprint: contentFingerprint(
        item.fingerprint,
        `CM-01 R3 CAD capture assembly file ${index} fingerprint`,
      ),
    };
  }));
}

function parseStoredPartMeshes(
  value: unknown,
  components: readonly { readonly semanticKey: string }[],
): readonly Cm01SemanticCadR3PartMesh[] {
  if (!Array.isArray(value) || value.length !== components.length) {
    throw new Error(
      "The persisted CM-01 R3 CAD capture partMeshes length does not match the plan components.",
    );
  }
  return Object.freeze(value.map((candidate, index) => {
    const item = record(candidate, `CM-01 R3 CAD capture partMesh ${index}`);
    exactKeys(
      item,
      ["bytes", "fingerprint", "name", "semanticKey"],
      `CM-01 R3 CAD capture partMesh ${index}`,
    );
    const expectedSemanticKey = components[index]!.semanticKey;
    const expectedName =
      `${CM01_SEMANTIC_CAD_R3_PART_EXPORT_PREFIX}${expectedSemanticKey}.stl`;
    if (item.semanticKey !== expectedSemanticKey || item.name !== expectedName) {
      throw new Error(
        `CM-01 R3 CAD capture partMesh ${index} has unexpected identity.`,
      );
    }
    return {
      semanticKey: expectedSemanticKey,
      name: expectedName,
      bytes: positiveInt(item.bytes, `CM-01 R3 CAD capture partMesh ${index} bytes`),
      fingerprint: contentFingerprint(
        item.fingerprint,
        `CM-01 R3 CAD capture partMesh ${index} fingerprint`,
      ),
    };
  }));
}

function assertR3Plan(
  value: unknown,
): asserts value is CompiledCoffeeMachineCm01SemanticCadPlan["plan"] {
  const plan = record(value, "CM-01 R3 CAD plan");
  const planRecipe = record(plan.recipe, "CM-01 R3 CAD plan recipe");
  const planBuild123d = record(plan.build123d, "CM-01 R3 CAD plan build123d");
  const planGeometry = record(plan.geometry, "CM-01 R3 CAD plan geometry");
  if (
    plan.schemaVersion !== "coffee-machine-cm01-semantic-cad-plan/1.0" ||
    planRecipe.schemaVersion !== "coffee-machine-semantic-recipe/2.0" ||
    planRecipe.key !== "cm01-drip-tray-height-30" ||
    planBuild123d.exportName !== CM01_SEMANTIC_CAD_R2_EXPORT_NAME ||
    !Array.isArray(plan.artifacts) ||
    !Array.isArray(planGeometry.components)
  ) {
    throw new Error(
      "The CM-01 R3 CAD capture requires the closed 30 mm compiled plan.",
    );
  }
}

function assemblyBasename(value: unknown, format: "step" | "gltf" | "stl"): string {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error("build123d_export returned an invalid assembly export path.");
  }
  const name = value.split(/[\\/]/).at(-1) ?? "";
  const extension = format === "gltf" ? "glb" : format;
  const expected = `${CM01_SEMANTIC_CAD_R3_ASSEMBLY_EXPORT_NAME}.${extension}`;
  if (name !== expected) {
    throw new Error(
      `build123d_export assembly did not preserve the fixed CM-01 R3 assembly basename.`,
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
  r: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (
    deterministicJson(Object.keys(r).sort()) !== deterministicJson([...expected].sort())
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
    throw new Error("CM-01 R3 CAD capture time must be ISO-8601.");
  }
  return value;
}
