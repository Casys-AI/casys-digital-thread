import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import {
  type Cm01DripTrayMechanicalProofR2,
  cm01DripTrayMechanicalRequestR2,
  parseCm01DripTrayMechanicalProofR2,
  renderCm01DripTrayMechanicalScriptR2,
} from "../../domain/cm01-drip-tray-mechanical-proof.ts";
import type { ContentFingerprint } from "../../domain/thread-snapshot.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";

/** Closed provider evidence for the isolated 30 mm DripTray proof. */
export const CM01_DRIP_TRAY_MECHANICAL_CAPTURE_R2_SCHEMA =
  "cm01-v3-drip-tray-mechanical-capture/2.0" as const;
export const CM01_DRIP_TRAY_MECHANICAL_R2_EXPORT_NAME =
  "coffee-machine-cm01-v3-drip-tray-height-30" as const;
export const CM01_DRIP_TRAY_MECHANICAL_R2_PROOF_ID =
  "coffee-machine-cm01-v3-drip-tray-height-30-static-proof" as const;

export interface Cm01DripTrayMechanicalR2Capture {
  readonly schemaVersion: typeof CM01_DRIP_TRAY_MECHANICAL_CAPTURE_R2_SCHEMA;
  readonly kind: "cm01-drip-tray-static-solve";
  readonly capturedAt: string;
  readonly proofId: typeof CM01_DRIP_TRAY_MECHANICAL_R2_PROOF_ID;
  readonly producer: {
    readonly cad: { readonly serverId: "build123d"; readonly tool: "build123d_export" };
    readonly solver: {
      readonly serverId: "calculix";
      readonly tool: "calculix_solve_static";
    };
  };
  /** This is an isolated DripTray STEP, never the assembly successor STEP. */
  readonly step: {
    readonly name: "coffee-machine-cm01-v3-drip-tray-height-30.step";
    readonly bytes: number;
    readonly fingerprint: ContentFingerprint;
  };
  /** CalculiX independently reports the exact isolated STEP it consumed. */
  readonly handoff: {
    readonly fingerprint: ContentFingerprint;
    readonly bytes: number;
  };
  readonly mesh: {
    readonly nodes: number;
    readonly elements: number;
    readonly nodesPerSelection: Readonly<Record<"FIXED" | "LOADED", number>>;
  };
  readonly metrics: {
    readonly maximumDisplacement: {
      readonly value: number;
      readonly unit: "mm";
      readonly nodeId: number;
      readonly vectorMm: readonly [number, number, number];
    };
    readonly maximumVonMises: {
      readonly value: number;
      readonly unit: "MPa";
      readonly elementId: number;
    };
  };
  readonly fingerprint: ContentFingerprint;
}

export async function captureCm01DripTrayMechanicalR2(
  build123d: McpToolClient,
  calculix: McpToolClient,
  proofInput: Cm01DripTrayMechanicalProofR2,
  now: () => string = () => new Date().toISOString(),
): Promise<Cm01DripTrayMechanicalR2Capture> {
  const proof = parseCm01DripTrayMechanicalProofR2(proofInput);
  const exportedResult = await build123d.callTool({
    name: "build123d_export",
    arguments: {
      script: renderCm01DripTrayMechanicalScriptR2(proof),
      formats: ["step"],
      name: CM01_DRIP_TRAY_MECHANICAL_R2_EXPORT_NAME,
      timeout_ms: 120000,
    },
  });
  const exported = parseExport(exportedResult.structuredContent);
  const solvedResult = await calculix.callTool({
    name: "calculix_solve_static",
    arguments: cm01DripTrayMechanicalRequestR2(proof, {
      path: exported.path,
      sha256: exported.fingerprint.digest,
    }),
  });
  const solve = parseSolve(solvedResult.structuredContent, proof, exported);
  const unsigned = {
    schemaVersion: CM01_DRIP_TRAY_MECHANICAL_CAPTURE_R2_SCHEMA,
    kind: "cm01-drip-tray-static-solve" as const,
    capturedAt: timestamp(now(), "capture timestamp"),
    proofId: CM01_DRIP_TRAY_MECHANICAL_R2_PROOF_ID,
    producer: {
      cad: { serverId: "build123d" as const, tool: "build123d_export" as const },
      solver: { serverId: "calculix" as const, tool: "calculix_solve_static" as const },
    },
    step: {
      name: "coffee-machine-cm01-v3-drip-tray-height-30.step" as const,
      bytes: exported.bytes,
      fingerprint: exported.fingerprint,
    },
    handoff: solve.handoff,
    mesh: solve.mesh,
    metrics: solve.metrics,
  };
  return Object.freeze({ ...unsigned, fingerprint: await sha256Fingerprint(unsigned) });
}

export async function parseCm01DripTrayMechanicalR2Capture(
  value: unknown,
): Promise<Cm01DripTrayMechanicalR2Capture> {
  const root = exactRecord(value, [
    "capturedAt",
    "fingerprint",
    "handoff",
    "kind",
    "mesh",
    "metrics",
    "producer",
    "proofId",
    "schemaVersion",
    "step",
  ], "CM-01 R2 mechanical capture");
  if (
    root.schemaVersion !== CM01_DRIP_TRAY_MECHANICAL_CAPTURE_R2_SCHEMA ||
    root.kind !== "cm01-drip-tray-static-solve" ||
    root.proofId !== CM01_DRIP_TRAY_MECHANICAL_R2_PROOF_ID
  ) throw new Error("CM-01 R2 mechanical capture has an unsupported contract.");
  const producer = exactRecord(
    root.producer,
    ["cad", "solver"],
    "CM-01 R2 mechanical producer",
  );
  assertProducer(
    producer.cad,
    "build123d",
    "build123d_export",
    "CM-01 R2 CAD producer",
  );
  assertProducer(
    producer.solver,
    "calculix",
    "calculix_solve_static",
    "CM-01 R2 solver producer",
  );
  const step = parseStoredStep(root.step);
  const handoff = parseHandoff(root.handoff, step);
  const mesh = parseStoredMesh(root.mesh);
  const metrics = parseStoredMetrics(root.metrics);
  const unsigned = {
    schemaVersion: CM01_DRIP_TRAY_MECHANICAL_CAPTURE_R2_SCHEMA,
    kind: "cm01-drip-tray-static-solve" as const,
    capturedAt: timestamp(root.capturedAt, "CM-01 R2 mechanical capture timestamp"),
    proofId: CM01_DRIP_TRAY_MECHANICAL_R2_PROOF_ID,
    producer: {
      cad: { serverId: "build123d" as const, tool: "build123d_export" as const },
      solver: { serverId: "calculix" as const, tool: "calculix_solve_static" as const },
    },
    step,
    handoff,
    mesh,
    metrics,
  };
  const fingerprint = sha256(
    root.fingerprint,
    "CM-01 R2 mechanical capture fingerprint",
  );
  const actual = await sha256Fingerprint(unsigned);
  if (actual.digest !== fingerprint.digest) {
    throw new Error(
      "CM-01 R2 mechanical capture fingerprint does not match its content.",
    );
  }
  return Object.freeze({ ...unsigned, fingerprint });
}

function parseExport(value: unknown) {
  const root = exactRecord(
    value,
    ["files", "kind", "metrics", "schemaVersion"],
    "build123d_export structuredContent",
  );
  if (
    root.schemaVersion !== "1.0" || root.kind !== "export" ||
    !Array.isArray(root.files) || root.files.length !== 1
  ) {
    throw new Error(
      "build123d_export did not return the one reviewed R2 mechanical STEP export.",
    );
  }
  const file = exactRecord(
    root.files[0],
    ["bytes", "format", "path", "sha256"],
    "build123d R2 mechanical STEP",
  );
  if (
    file.format !== "step" || typeof file.path !== "string" ||
    basename(file.path) !== "coffee-machine-cm01-v3-drip-tray-height-30.step"
  ) {
    throw new Error(
      "build123d_export did not preserve the fixed CM-01 R2 isolated STEP identity.",
    );
  }
  return {
    path: file.path,
    bytes: positiveInt(file.bytes, "build123d R2 mechanical STEP bytes"),
    fingerprint: sha256(file.sha256, "build123d R2 mechanical STEP sha256"),
  };
}

function parseSolve(
  value: unknown,
  proof: Cm01DripTrayMechanicalProofR2,
  step: { path: string; bytes: number; fingerprint: ContentFingerprint },
) {
  const root = exactRecord(value, [
    "constraints",
    "inputArtifact",
    "kind",
    "mesh",
    "metrics",
    "schemaVersion",
  ], "calculix_solve_static structuredContent");
  if (root.schemaVersion !== "2.0" || root.kind !== "static-solve") {
    throw new Error("calculix_solve_static returned an unsupported contract.");
  }
  const input = exactRecord(root.inputArtifact, [
    "bytes",
    "path",
    "sha256",
    "sourcePath",
  ], "CalculiX inputArtifact");
  if (input.sourcePath !== step.path || input.bytes !== step.bytes) {
    throw new Error("CalculiX did not attest the exact isolated DripTray STEP source.");
  }
  const handoff = {
    bytes: positiveInt(input.bytes, "CalculiX input STEP bytes"),
    fingerprint: sha256(input.sha256, "CalculiX input STEP sha256"),
  };
  if (handoff.fingerprint.digest !== step.fingerprint.digest) {
    throw new Error(
      "CalculiX input STEP sha256 differs from the isolated build123d export.",
    );
  }
  const constraints = exactRecord(
    root.constraints,
    ["fixedSelections", "loads"],
    "CalculiX constraints",
  );
  if (
    deterministicJson(constraints.fixedSelections) !==
      deterministicJson([proof.fixed.name])
  ) {
    throw new Error("CalculiX fixed selection differs from the reviewed R2 proof.");
  }
  if (!Array.isArray(constraints.loads) || constraints.loads.length !== 1) {
    throw new Error("CalculiX did not return exactly one reviewed R2 load.");
  }
  const load = exactRecord(
    constraints.loads[0],
    ["forceN", "selection"],
    "CalculiX load",
  );
  if (
    load.selection !== proof.loaded.name ||
    deterministicJson(load.forceN) !== deterministicJson(proof.loaded.forceN)
  ) {
    throw new Error("CalculiX load differs from the reviewed R2 proof.");
  }
  return { handoff, mesh: parseMesh(root.mesh), metrics: parseMetrics(root.metrics) };
}

function parseMesh(value: unknown) {
  const root = exactRecord(
    value,
    ["elements", "nodes", "nodesPerSelection"],
    "CalculiX mesh",
  );
  const selections = exactRecord(
    root.nodesPerSelection,
    ["FIXED", "LOADED", "PART"],
    "CalculiX mesh selections",
  );
  const nodes = positiveInt(root.nodes, "CalculiX mesh nodes");
  const fixed = positiveInt(selections.FIXED, "CalculiX FIXED nodes");
  const loaded = positiveInt(selections.LOADED, "CalculiX LOADED nodes");
  if (
    positiveInt(selections.PART, "CalculiX PART nodes") < fixed ||
    positiveInt(selections.PART, "CalculiX PART nodes") < loaded
  ) {
    throw new Error("CalculiX mesh selections exceed the returned PART node count.");
  }
  return {
    nodes,
    elements: positiveInt(root.elements, "CalculiX mesh elements"),
    nodesPerSelection: { FIXED: fixed, LOADED: loaded },
  };
}
function parseStoredMesh(value: unknown) {
  const root = exactRecord(
    value,
    ["elements", "nodes", "nodesPerSelection"],
    "CM-01 R2 stored mesh",
  );
  const selections = exactRecord(
    root.nodesPerSelection,
    ["FIXED", "LOADED"],
    "CM-01 R2 stored mesh selections",
  );
  return {
    nodes: positiveInt(root.nodes, "CM-01 R2 stored mesh nodes"),
    elements: positiveInt(root.elements, "CM-01 R2 stored mesh elements"),
    nodesPerSelection: {
      FIXED: positiveInt(selections.FIXED, "CM-01 R2 stored FIXED nodes"),
      LOADED: positiveInt(selections.LOADED, "CM-01 R2 stored LOADED nodes"),
    },
  };
}
function parseMetrics(value: unknown) {
  const root = exactRecord(
    value,
    ["maxDisplacement", "maxVonMises"],
    "CalculiX metrics",
  );
  const displacement = exactRecord(root.maxDisplacement, [
    "nodeId",
    "unit",
    "value",
    "vectorMm",
  ], "CalculiX displacement");
  const stress = exactRecord(
    root.maxVonMises,
    ["elementId", "unit", "value"],
    "CalculiX von Mises",
  );
  if (displacement.unit !== "mm" || stress.unit !== "MPa") {
    throw new Error("CalculiX metrics have unsupported units.");
  }
  return {
    maximumDisplacement: {
      value: nonNegative(displacement.value, "CalculiX displacement value"),
      unit: "mm" as const,
      nodeId: positiveInt(displacement.nodeId, "CalculiX displacement node"),
      vectorMm: vector(displacement.vectorMm, "CalculiX displacement vector"),
    },
    maximumVonMises: {
      value: nonNegative(stress.value, "CalculiX von Mises value"),
      unit: "MPa" as const,
      elementId: positiveInt(stress.elementId, "CalculiX von Mises element"),
    },
  };
}
function parseStoredMetrics(value: unknown) {
  const root = exactRecord(
    value,
    ["maximumDisplacement", "maximumVonMises"],
    "CM-01 R2 stored metrics",
  );
  const displacement = exactRecord(root.maximumDisplacement, [
    "nodeId",
    "unit",
    "value",
    "vectorMm",
  ], "CM-01 R2 stored displacement");
  const stress = exactRecord(
    root.maximumVonMises,
    ["elementId", "unit", "value"],
    "CM-01 R2 stored von Mises",
  );
  if (displacement.unit !== "mm" || stress.unit !== "MPa") {
    throw new Error("CM-01 R2 mechanical metrics have unsupported units.");
  }
  return {
    maximumDisplacement: {
      value: nonNegative(displacement.value, "CM-01 R2 displacement value"),
      unit: "mm" as const,
      nodeId: positiveInt(displacement.nodeId, "CM-01 R2 displacement node"),
      vectorMm: vector(displacement.vectorMm, "CM-01 R2 displacement vector"),
    },
    maximumVonMises: {
      value: nonNegative(stress.value, "CM-01 R2 von Mises value"),
      unit: "MPa" as const,
      elementId: positiveInt(stress.elementId, "CM-01 R2 von Mises element"),
    },
  };
}
function parseStoredStep(value: unknown) {
  const root = exactRecord(
    value,
    ["bytes", "fingerprint", "name"],
    "CM-01 R2 mechanical STEP",
  );
  if (root.name !== "coffee-machine-cm01-v3-drip-tray-height-30.step") {
    throw new Error("CM-01 R2 mechanical STEP name is invalid.");
  }
  return {
    name: "coffee-machine-cm01-v3-drip-tray-height-30.step" as const,
    bytes: positiveInt(root.bytes, "CM-01 R2 mechanical STEP bytes"),
    fingerprint: sha256(root.fingerprint, "CM-01 R2 mechanical STEP fingerprint"),
  };
}
function parseHandoff(
  value: unknown,
  step: { bytes: number; fingerprint: ContentFingerprint },
) {
  const root = exactRecord(
    value,
    ["bytes", "fingerprint"],
    "CM-01 R2 mechanical handoff",
  );
  const handoff = {
    bytes: positiveInt(root.bytes, "CM-01 R2 mechanical handoff bytes"),
    fingerprint: sha256(root.fingerprint, "CM-01 R2 mechanical handoff fingerprint"),
  };
  if (
    handoff.bytes !== step.bytes ||
    handoff.fingerprint.digest !== step.fingerprint.digest
  ) {
    throw new Error(
      "CM-01 R2 mechanical handoff does not attest the isolated exported STEP.",
    );
  }
  return handoff;
}
function assertProducer(
  value: unknown,
  serverId: string,
  tool: string,
  path: string,
): void {
  const root = exactRecord(value, ["serverId", "tool"], path);
  if (root.serverId !== serverId || root.tool !== tool) {
    throw new Error(`${path} is invalid.`);
  }
}
function sha256(value: unknown, path: string): ContentFingerprint {
  const root = typeof value === "string"
    ? { algorithm: "sha256", digest: value }
    : value;
  if (
    typeof root !== "object" || root === null || Array.isArray(root) ||
    (root as Record<string, unknown>).algorithm !== "sha256" ||
    typeof (root as Record<string, unknown>).digest !== "string" ||
    !/^[a-f0-9]{64}$/.test((root as Record<string, unknown>).digest as string)
  ) throw new Error(`${path} must be a lowercase SHA-256.`);
  return {
    algorithm: "sha256",
    digest: (root as Record<string, unknown>).digest as string,
  };
}
function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const root = value as Record<string, unknown>;
  if (
    deterministicJson(Object.keys(root).sort()) !== deterministicJson([...keys].sort())
  ) throw new TypeError(`${path} has unsupported or missing fields.`);
  return root;
}
function positiveInt(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${path} must be a positive integer.`);
  }
  return value as number;
}
function nonNegative(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${path} must be non-negative.`);
  }
  return value;
}
function vector(value: unknown, path: string): readonly [number, number, number] {
  if (
    !Array.isArray(value) || value.length !== 3 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) throw new TypeError(`${path} must be a finite 3-vector.`);
  return [value[0]!, value[1]!, value[2]!];
}
function basename(value: string): string {
  return value.split(/[\\/]/).at(-1) ?? "";
}
function timestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${path} must be ISO-8601.`);
  }
  return value;
}
