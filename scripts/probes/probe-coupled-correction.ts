/**
 * Probe: coupled-correction — z3 sur le système linéarisé couplé DripTray.
 *
 * DIAGNOSTIC ONLY — aucune écriture, aucune révision de projet, aucun appel
 * projet (project_change_append / queue / execute).
 *
 * Lit depuis les captures CAS réelles (state/local/) et depuis le modèle SysON
 * vivant les données du système couplé :
 *   - bornes de voisinage (DripTraySensitivityRelations, syson_constraint_extract)
 *   - exigences oracle (DripTrayMechanicalRequirements, syson_constraint_extract)
 *   - u0 et k (sensitivity-study capture, fichier CAS)
 *
 * Compose le système linéarisé u(z) = u0 + k·(z − z0) et pose à z3 deux
 * questions :
 *
 *   SAT  — existe-t-il z dans [z0−step, z0+step] tel que toutes les
 *           exigences soient satisfaites ? → sat avec VALEUR de z exploitable.
 *   UNSAT — même question avec une limite de déplacement resserrée au delà
 *           du voisinage déclaré → unsat avec conflict set.
 *
 * Toutes les valeurs numériques (u0, k, bornes, seuils) viennent de l'extraction
 * du modèle réel. Aucune constante n'est recopiée en dur. Les identifiants SysON
 * (editingContextId, elementId) sont lus depuis les captures CAS, comme le fait
 * la sonde existante probe-constraint-solver.ts.
 *
 * Budget MCP : 4 appels (2 × syson_constraint_extract + 2 × syson_constraint_solve).
 *
 * Pure math — normalizeValue, deriveSizeZBound, composeCoupledSystem — lives in
 * src/domain/analysis/coupled-correction-math.ts so that executors can import it
 * without creating a scripts/ → src/ dependency inversion.
 */

import {
  HttpMcpToolClient,
  type McpToolClient,
} from "../../src/adapters/mcp/http-mcp-tool-client.ts";
import {
  composeCoupledSystem,
  type CoupledSystemComposition,
  type ExtractedBound,
  type ExtractedRequirement,
  type Z3Constraint,
} from "../../src/domain/analysis/coupled-correction-math.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SYSON_ENDPOINT = "http://127.0.0.1:3009/mcp";
const DEFAULT_CAPTURES_DIR = "state/local";

// ---------------------------------------------------------------------------
// Types — captures CAS
// ---------------------------------------------------------------------------

export interface SensitivityRelationsCapture {
  readonly editingContextId: string;
  readonly elementId: string;
  readonly partDefName: string;
}

export interface OracleRequirementsCapture {
  readonly editingContextId: string;
  readonly elementId: string;
}

export interface SensitivityStudyCapture {
  readonly domain: {
    readonly base: number;
    readonly step: number;
    readonly parameterUnit: string;
  };
  readonly base: {
    readonly metrics: Record<string, { readonly value: number; readonly unit: string }>;
  };
  readonly derivatives: ReadonlyArray<{
    readonly metric: string;
    readonly value: number;
    readonly unit: string;
  }>;
}

// ---------------------------------------------------------------------------
// Types — probe result
// ---------------------------------------------------------------------------

export type Z3Result =
  | {
    readonly status: "sat";
    readonly model: Record<string, unknown>;
    readonly objectiveValue?: unknown;
  }
  | { readonly status: "unsat"; readonly conflict: readonly string[] }
  | { readonly status: "error"; readonly message: string };

export interface ProbeCoupledCorrectionResult {
  readonly probe: "coupled-correction";
  readonly endpoint: string;
  readonly captures: {
    readonly sensitivityRelationsElementId: string;
    readonly oracleElementId: string;
    readonly editingContextId: string;
  };
  readonly extractedValidityBounds: readonly ExtractedBound[];
  readonly extractedOracleRequirements: readonly ExtractedRequirement[];
  readonly coupledSystem: {
    readonly z0_mm: number;
    readonly step_mm: number;
    readonly satConstraints: readonly Z3Constraint[];
    readonly unsatConstraints: readonly Z3Constraint[];
    readonly tightLimitDisplacement_mm: number;
    readonly rationale: string;
  };
  readonly satCase: Z3Result;
  readonly unsatCase: Z3Result;
}

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

export interface ProbeCoupledCorrectionOptions {
  readonly sysonEndpoint?: string;
  readonly capturesDir?: string;
  /** Test seam — omit in production; defaults to HttpMcpToolClient. */
  readonly client?: McpToolClient;
}

// ---------------------------------------------------------------------------
// Capture file helpers
// ---------------------------------------------------------------------------

async function readSingleCaptureJson(
  dir: string,
): Promise<Record<string, unknown>> {
  const entries: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      entries.push(entry.name);
    }
  }
  if (entries.length === 0) {
    throw new Error(`readSingleCaptureJson: no JSON file in "${dir}".`);
  }
  if (entries.length > 1) {
    throw new Error(
      `readSingleCaptureJson: expected exactly 1 JSON file in "${dir}", found ${entries.length}.`,
    );
  }
  const text = await Deno.readTextFile(`${dir}/${entries[0]!}`);
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`readSingleCaptureJson: "${dir}/${entries[0]}" is not an object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseSensitivityRelationsCapture(
  raw: Record<string, unknown>,
): SensitivityRelationsCapture {
  const editingContextId = raw.editingContextId;
  const elementId = raw.elementId;
  const partDefName = raw.partDefName;
  if (
    typeof editingContextId !== "string" || !editingContextId.trim() ||
    typeof elementId !== "string" || !elementId.trim() ||
    typeof partDefName !== "string" || !partDefName.trim()
  ) {
    throw new Error(
      "parseSensitivityRelationsCapture: missing editingContextId, elementId, or partDefName.",
    );
  }
  return { editingContextId, elementId, partDefName };
}

function parseOracleRequirementsCapture(
  raw: Record<string, unknown>,
): OracleRequirementsCapture {
  const editingContextId = raw.editingContextId;
  const elementId = raw.elementId;
  if (
    typeof editingContextId !== "string" || !editingContextId.trim() ||
    typeof elementId !== "string" || !elementId.trim()
  ) {
    throw new Error(
      "parseOracleRequirementsCapture: missing editingContextId or elementId.",
    );
  }
  return { editingContextId, elementId };
}

function parseSensitivityStudyCapture(
  raw: Record<string, unknown>,
): SensitivityStudyCapture {
  const domain = raw.domain;
  const base = raw.base;
  const derivatives = raw.derivatives;

  if (
    !domain || typeof domain !== "object" || Array.isArray(domain) ||
    !base || typeof base !== "object" || Array.isArray(base) ||
    !Array.isArray(derivatives)
  ) {
    throw new Error(
      "parseSensitivityStudyCapture: missing domain, base, or derivatives.",
    );
  }
  const d = domain as Record<string, unknown>;
  if (
    typeof d.base !== "number" || typeof d.step !== "number" ||
    typeof d.parameterUnit !== "string"
  ) {
    throw new Error(
      "parseSensitivityStudyCapture: domain missing base, step, or parameterUnit.",
    );
  }
  const b = base as Record<string, unknown>;
  if (!b.metrics || typeof b.metrics !== "object" || Array.isArray(b.metrics)) {
    throw new Error("parseSensitivityStudyCapture: base.metrics missing.");
  }

  return {
    domain: { base: d.base, step: d.step, parameterUnit: String(d.parameterUnit) },
    base: { metrics: b.metrics as Record<string, { value: number; unit: string }> },
    derivatives: derivatives as ReadonlyArray<{
      readonly metric: string;
      readonly value: number;
      readonly unit: string;
    }>,
  };
}

// ---------------------------------------------------------------------------
// SysON constraint extraction helpers
// ---------------------------------------------------------------------------

/**
 * Parse validity bounds from syson_constraint_extract output for the
 * DripTraySensitivityRelations element.
 *
 * Expects constraints in the format produced by the existing extractor
 * (bound.constraintName, bound.op, bound.boundValue, bound.boundUnit,
 * bound.paramAttrName = expression.left.featurePath[0]).
 */
export function parseValidityBounds(
  structuredContent: Record<string, unknown>,
): ExtractedBound[] {
  if (!Array.isArray(structuredContent.constraints)) {
    throw new Error(
      "parseValidityBounds: structuredContent.constraints is not an array.",
    );
  }
  return (structuredContent.constraints as unknown[]).map((raw, i) => {
    const item = asRecord(raw, `constraints[${i}]`);
    const expr = asRecord(item.expression, `constraints[${i}].expression`);
    const left = asRecord(expr.left, `constraints[${i}].expression.left`);
    const right = asRecord(expr.right, `constraints[${i}].expression.right`);
    const featurePath = left.featurePath;
    const paramAttrName = Array.isArray(featurePath) && featurePath.length > 0 &&
        typeof featurePath[0] === "string"
      ? featurePath[0]
      : undefined;
    if (!paramAttrName) {
      throw new Error(`constraints[${i}]: invalid featurePath.`);
    }
    const constraintName = typeof item.name === "string" && item.name.trim()
      ? item.name
      : `constraint_${i}`;
    const op = expr.op;
    if (op !== ">=" && op !== "<=") {
      throw new Error(`constraints[${i}]: unexpected op "${String(op)}".`);
    }
    if (typeof right.value !== "number" || typeof right.unit !== "string") {
      throw new Error(`constraints[${i}]: right.value or right.unit invalid.`);
    }
    return {
      constraintName,
      paramAttrName,
      op: op as ">=" | "<=",
      boundValue: right.value,
      boundUnit: right.unit,
    };
  });
}

/**
 * Parse oracle requirements from syson_constraint_extract output for the
 * DripTrayMechanicalRequirements element.
 */
export function parseOracleConstraints(
  structuredContent: Record<string, unknown>,
): ExtractedRequirement[] {
  if (!Array.isArray(structuredContent.constraints)) {
    throw new Error(
      "parseOracleConstraints: structuredContent.constraints is not an array.",
    );
  }
  return (structuredContent.constraints as unknown[]).map((raw, i) => {
    const item = asRecord(raw, `constraints[${i}]`);
    const expr = asRecord(item.expression, `constraints[${i}].expression`);
    const left = asRecord(expr.left, `constraints[${i}].expression.left`);
    const right = asRecord(expr.right, `constraints[${i}].expression.right`);
    const featurePath = left.featurePath;
    const metric = Array.isArray(featurePath) && featurePath.length > 0 &&
        typeof featurePath[0] === "string"
      ? featurePath[0]
      : undefined;
    if (!metric) {
      throw new Error(`constraints[${i}]: invalid featurePath.`);
    }
    const constraintName = typeof item.name === "string" && item.name.trim()
      ? item.name
      : `constraint_${i}`;
    const op = expr.op;
    if (op !== ">=" && op !== "<=") {
      throw new Error(`constraints[${i}]: unexpected op "${String(op)}".`);
    }
    if (typeof right.value !== "number" || typeof right.unit !== "string") {
      throw new Error(`constraints[${i}]: right.value or right.unit invalid.`);
    }
    return {
      name: constraintName,
      metric,
      op: op as ">=" | "<=",
      limitValue: right.value,
      limitUnit: right.unit,
    };
  });
}

// ---------------------------------------------------------------------------
// Z3 result parser (same pattern as probe-constraint-solver.ts)
// ---------------------------------------------------------------------------

function parseZ3Result(raw: Record<string, unknown>): Z3Result {
  const status = raw.status;
  if (status === "sat") {
    const model = raw.model;
    if (!isRecord(model)) {
      return { status: "error", message: "sat response missing model object" };
    }
    return { status: "sat", model, objectiveValue: raw.objectiveValue };
  }
  if (status === "unsat") {
    const conflict = raw.conflict;
    if (!Array.isArray(conflict)) {
      return { status: "error", message: "unsat response missing conflict array" };
    }
    const ids = conflict.filter((item): item is string => typeof item === "string");
    if (ids.length !== conflict.length) {
      return { status: "error", message: "unsat conflict contains non-string entries" };
    }
    return { status: "unsat", conflict: ids };
  }
  return {
    status: "error",
    message: `unexpected z3 status: ${JSON.stringify(status)}`,
  };
}

// ---------------------------------------------------------------------------
// Main probe function
// ---------------------------------------------------------------------------

/**
 * Run the coupled-correction probe and return a machine-readable result.
 *
 * The function is read-only on both the model and the capture stores.
 * It makes exactly 4 MCP calls (2 extractions + 2 solves).
 */
export async function probeCoupledCorrection(
  options: ProbeCoupledCorrectionOptions = {},
): Promise<ProbeCoupledCorrectionResult> {
  const endpoint = options.sysonEndpoint ?? DEFAULT_SYSON_ENDPOINT;
  const capturesDir = options.capturesDir ?? DEFAULT_CAPTURES_DIR;

  const client = options.client ?? new HttpMcpToolClient({
    mcpUrl: endpoint,
    timeoutMs: 60_000,
  });

  // ── Step 1: read captures from file store ─────────────────────────────────
  const sensRelCaptureRaw = await readSingleCaptureJson(
    `${capturesDir}/sensitivity-relations-seed-captures`,
  );
  const oracleCaptureRaw = await readSingleCaptureJson(
    `${capturesDir}/oracle-requirements-seed-captures`,
  );
  const sensitivityCaptureRaw = await readSingleCaptureJson(
    `${capturesDir}/sensitivity-study-captures`,
  );

  const sensRelCapture = parseSensitivityRelationsCapture(sensRelCaptureRaw);
  const oracleCapture = parseOracleRequirementsCapture(oracleCaptureRaw);
  const sensitivityCapture = parseSensitivityStudyCapture(sensitivityCaptureRaw);

  if (sensRelCapture.editingContextId !== oracleCapture.editingContextId) {
    throw new Error(
      `Editing context mismatch: sensitivity-relations uses "${sensRelCapture.editingContextId}" ` +
        `but oracle-requirements uses "${oracleCapture.editingContextId}". ` +
        "Both elements must belong to the same SysON project.",
    );
  }
  const editingContextId = sensRelCapture.editingContextId;

  // ── Step 2: extract validity bounds from live SysON model (MCP call #1) ───
  const validityExtract = await client.callTool({
    name: "syson_constraint_extract",
    arguments: {
      editing_context_id: editingContextId,
      element_id: sensRelCapture.elementId,
    },
  });
  const extractedValidityBounds = parseValidityBounds(
    validityExtract.structuredContent,
  );

  // ── Step 3: extract oracle requirements from live SysON model (MCP call #2)
  const oracleExtract = await client.callTool({
    name: "syson_constraint_extract",
    arguments: {
      editing_context_id: editingContextId,
      element_id: oracleCapture.elementId,
    },
  });
  const extractedOracleRequirements = parseOracleConstraints(
    oracleExtract.structuredContent,
  );

  // ── Step 4: compose the coupled system ────────────────────────────────────
  const composition: CoupledSystemComposition = composeCoupledSystem(
    extractedValidityBounds,
    extractedOracleRequirements,
    sensitivityCapture.base.metrics,
    sensitivityCapture.derivatives,
    sensitivityCapture.domain.base,
    sensitivityCapture.domain.step,
    sensitivityCapture.domain.parameterUnit,
  );

  // ── Step 5: SAT case (MCP call #3) ────────────────────────────────────────
  let satCase: Z3Result;
  try {
    const satRaw = await client.callToolTextResult({
      name: "syson_constraint_solve",
      arguments: {
        constraints: composition.satConstraints,
        objective: {
          variable: extractedValidityBounds[0]?.paramAttrName ?? "sizeZ_base_mm",
          direction: "minimize",
        },
      },
    });
    satCase = parseZ3Result(satRaw);
  } catch (error) {
    satCase = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // ── Step 6: UNSAT case (MCP call #4) ──────────────────────────────────────
  let unsatCase: Z3Result;
  try {
    const unsatRaw = await client.callToolTextResult({
      name: "syson_constraint_solve",
      arguments: {
        constraints: composition.unsatConstraints,
        objective: {
          variable: extractedValidityBounds[0]?.paramAttrName ?? "sizeZ_base_mm",
          direction: "minimize",
        },
      },
    });
    unsatCase = parseZ3Result(unsatRaw);
  } catch (error) {
    unsatCase = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    probe: "coupled-correction",
    endpoint,
    captures: {
      sensitivityRelationsElementId: sensRelCapture.elementId,
      oracleElementId: oracleCapture.elementId,
      editingContextId,
    },
    extractedValidityBounds,
    extractedOracleRequirements,
    coupledSystem: {
      z0_mm: composition.z0_mm,
      step_mm: composition.step_mm,
      satConstraints: composition.satConstraints,
      unsatConstraints: composition.unsatConstraints,
      tightLimitDisplacement_mm: composition.tightLimitDisplacement_mm,
      rationale: composition.rationale,
    },
    satCase,
    unsatCase,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const result = await probeCoupledCorrection();
  console.log(JSON.stringify(result, null, 2));
  if (
    result.satCase.status !== "sat" ||
    result.unsatCase.status !== "unsat"
  ) {
    Deno.exitCode = 1;
  }
}
