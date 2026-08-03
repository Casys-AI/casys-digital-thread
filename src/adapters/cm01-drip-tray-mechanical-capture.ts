import { deterministicJson, sha256Fingerprint } from "../domain/deterministic-json.ts";
import {
  type Cm01DripTrayMechanicalProof,
  cm01DripTrayMechanicalRequest,
  parseCm01DripTrayMechanicalProof,
  renderCm01DripTrayMechanicalScript,
} from "../domain/cm01-drip-tray-mechanical-proof.ts";
import type { ContentFingerprint } from "../domain/thread-snapshot.ts";
import type { McpToolClient } from "./http-mcp-tool-client.ts";

export const CM01_DRIP_TRAY_MECHANICAL_CAPTURE_SCHEMA =
  "cm01-v3-drip-tray-mechanical-capture/1.0" as const;

export interface Cm01DripTrayMechanicalCapture {
  readonly schemaVersion: typeof CM01_DRIP_TRAY_MECHANICAL_CAPTURE_SCHEMA;
  readonly kind: "cm01-drip-tray-static-solve";
  readonly capturedAt: string;
  readonly proofId: "coffee-machine-cm01-v3-drip-tray-static-proof";
  readonly producer: {
    readonly cad: { readonly serverId: "build123d"; readonly tool: "build123d_export" };
    readonly solver: {
      readonly serverId: "calculix";
      readonly tool: "calculix_solve_static";
    };
  };
  readonly step: {
    readonly name: "coffee-machine-cm01-v3-drip-tray.step";
    readonly bytes: number;
    readonly fingerprint: ContentFingerprint;
  };
  /** CalculiX's private input snapshot independently attested the exported bytes. */
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

/** Calls the two fixed provider tools and retains only normalized evidence. */
export async function captureCm01DripTrayMechanical(
  build123d: McpToolClient,
  calculix: McpToolClient,
  proofInput: Cm01DripTrayMechanicalProof,
  now: () => string = () => new Date().toISOString(),
): Promise<Cm01DripTrayMechanicalCapture> {
  const proof = parseCm01DripTrayMechanicalProof(proofInput);
  const cad = await build123d.callTool({
    name: "build123d_export",
    arguments: {
      script: renderCm01DripTrayMechanicalScript(proof),
      formats: ["step"],
      name: "coffee-machine-cm01-v3-drip-tray",
      timeout_ms: 120000,
    },
  });
  const exported = parseExport(cad.structuredContent);
  const solved = await calculix.callTool({
    name: "calculix_solve_static",
    arguments: cm01DripTrayMechanicalRequest(proof, {
      path: exported.path,
      sha256: exported.fingerprint.digest,
    }),
  });
  const solve = parseSolve(solved.structuredContent, proof, exported);
  const unsigned = {
    schemaVersion: CM01_DRIP_TRAY_MECHANICAL_CAPTURE_SCHEMA,
    kind: "cm01-drip-tray-static-solve" as const,
    capturedAt: timestamp(now(), "capture timestamp"),
    proofId: proof.id,
    producer: {
      cad: { serverId: "build123d" as const, tool: "build123d_export" as const },
      solver: { serverId: "calculix" as const, tool: "calculix_solve_static" as const },
    },
    step: {
      name: "coffee-machine-cm01-v3-drip-tray.step" as const,
      bytes: exported.bytes,
      fingerprint: exported.fingerprint,
    },
    handoff: { fingerprint: solve.handoff.fingerprint, bytes: solve.handoff.bytes },
    mesh: solve.mesh,
    metrics: solve.metrics,
  };
  return Object.freeze({ ...unsigned, fingerprint: await sha256Fingerprint(unsigned) });
}

export async function parseCm01DripTrayMechanicalCapture(
  value: unknown,
): Promise<Cm01DripTrayMechanicalCapture> {
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
  ], "CM-01 mechanical capture");
  if (
    root.schemaVersion !== CM01_DRIP_TRAY_MECHANICAL_CAPTURE_SCHEMA ||
    root.kind !== "cm01-drip-tray-static-solve" ||
    root.proofId !== "coffee-machine-cm01-v3-drip-tray-static-proof"
  ) throw new Error("CM-01 mechanical capture has an unsupported contract.");
  const producer = exactRecord(
    root.producer,
    ["cad", "solver"],
    "CM-01 mechanical capture producer",
  );
  assertProducer(
    producer.cad,
    "build123d",
    "build123d_export",
    "CM-01 mechanical CAD producer",
  );
  assertProducer(
    producer.solver,
    "calculix",
    "calculix_solve_static",
    "CM-01 mechanical solver producer",
  );
  const step = parseStoredStep(root.step);
  const handoff = parseHandoff(root.handoff, step);
  const mesh = parseStoredMesh(root.mesh);
  const metrics = parseStoredMetrics(root.metrics);
  const unsigned = {
    schemaVersion: CM01_DRIP_TRAY_MECHANICAL_CAPTURE_SCHEMA,
    kind: "cm01-drip-tray-static-solve" as const,
    capturedAt: timestamp(root.capturedAt, "CM-01 mechanical capture timestamp"),
    proofId: "coffee-machine-cm01-v3-drip-tray-static-proof" as const,
    producer: {
      cad: { serverId: "build123d" as const, tool: "build123d_export" as const },
      solver: { serverId: "calculix" as const, tool: "calculix_solve_static" as const },
    },
    step,
    handoff,
    mesh,
    metrics,
  };
  const captureFingerprint = fingerprint(
    root.fingerprint,
    "CM-01 mechanical capture fingerprint",
  );
  const actual = await sha256Fingerprint(unsigned);
  if (actual.digest !== captureFingerprint.digest) {
    throw new Error("CM-01 mechanical capture fingerprint does not match its content.");
  }
  return Object.freeze({ ...unsigned, fingerprint: captureFingerprint });
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
      "build123d_export did not return the one reviewed mechanical STEP export.",
    );
  }
  const file = exactRecord(
    root.files[0],
    ["bytes", "format", "path", "sha256"],
    "build123d mechanical STEP",
  );
  if (
    file.format !== "step" || typeof file.path !== "string" ||
    basename(file.path) !== "coffee-machine-cm01-v3-drip-tray.step"
  ) {
    throw new Error(
      "build123d_export did not preserve the fixed CM-01 mechanical STEP identity.",
    );
  }
  return {
    path: file.path,
    bytes: positiveInt(file.bytes, "build123d mechanical STEP bytes"),
    fingerprint: fingerprint(file.sha256, "build123d mechanical STEP sha256"),
  };
}

function parseSolve(
  value: unknown,
  proof: Cm01DripTrayMechanicalProof,
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
  ], "calculix inputArtifact");
  if (input.sourcePath !== step.path || input.bytes !== step.bytes) {
    throw new Error("CalculiX did not attest the exact exported STEP source.");
  }
  const handoff = {
    fingerprint: fingerprint(input.sha256, "CalculiX input STEP sha256"),
    bytes: positiveInt(input.bytes, "CalculiX input STEP bytes"),
  };
  if (handoff.fingerprint.digest !== step.fingerprint.digest) {
    throw new Error("CalculiX input STEP sha256 differs from the build123d export.");
  }
  const constraints = exactRecord(
    root.constraints,
    ["fixedSelections", "loads"],
    "CalculiX constraints",
  );
  if (
    deterministicJson(constraints.fixedSelections) !==
      deterministicJson([proof.fixed.name])
  ) throw new Error("CalculiX fixed selection differs from the reviewed proof.");
  const loads = Array.isArray(constraints.loads) ? constraints.loads : [];
  if (loads.length !== 1) {
    throw new Error("CalculiX did not return exactly one reviewed load.");
  }
  const load = exactRecord(loads[0], ["forceN", "selection"], "CalculiX load");
  if (
    load.selection !== proof.loaded.name ||
    deterministicJson(load.forceN) !== deterministicJson(proof.loaded.forceN)
  ) throw new Error("CalculiX load differs from the reviewed proof.");
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
  const partNodes = positiveInt(selections.PART, "CalculiX mesh PART nodes");
  const fixedNodes = positiveInt(selections.FIXED, "CalculiX FIXED nodes");
  const loadedNodes = positiveInt(selections.LOADED, "CalculiX LOADED nodes");
  if (partNodes < fixedNodes || partNodes < loadedNodes) {
    throw new Error("CalculiX mesh selections exceed the returned PART node count.");
  }
  return {
    nodes: positiveInt(root.nodes, "CalculiX mesh nodes"),
    elements: positiveInt(root.elements, "CalculiX mesh elements"),
    nodesPerSelection: {
      FIXED: fixedNodes,
      LOADED: loadedNodes,
    },
  };
}
function parseStoredMesh(value: unknown) {
  const root = exactRecord(
    value,
    ["elements", "nodes", "nodesPerSelection"],
    "CM-01 mechanical stored mesh",
  );
  const selections = exactRecord(
    root.nodesPerSelection,
    ["FIXED", "LOADED"],
    "CM-01 mechanical stored mesh selections",
  );
  return {
    nodes: positiveInt(root.nodes, "CM-01 mechanical stored mesh nodes"),
    elements: positiveInt(root.elements, "CM-01 mechanical stored mesh elements"),
    nodesPerSelection: {
      FIXED: positiveInt(selections.FIXED, "CM-01 mechanical stored FIXED nodes"),
      LOADED: positiveInt(selections.LOADED, "CM-01 mechanical stored LOADED nodes"),
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
    "CM-01 mechanical metrics",
  );
  const displacement = exactRecord(
    root.maximumDisplacement,
    ["nodeId", "unit", "value", "vectorMm"],
    "CM-01 mechanical displacement",
  );
  const stress = exactRecord(
    root.maximumVonMises,
    ["elementId", "unit", "value"],
    "CM-01 mechanical von Mises",
  );
  if (displacement.unit !== "mm" || stress.unit !== "MPa") {
    throw new Error("CM-01 mechanical metrics have unsupported units.");
  }
  return {
    maximumDisplacement: {
      value: nonNegative(displacement.value, "CM-01 mechanical displacement value"),
      unit: "mm" as const,
      nodeId: positiveInt(displacement.nodeId, "CM-01 mechanical displacement node"),
      vectorMm: vector(displacement.vectorMm, "CM-01 mechanical displacement vector"),
    },
    maximumVonMises: {
      value: nonNegative(stress.value, "CM-01 mechanical von Mises value"),
      unit: "MPa" as const,
      elementId: positiveInt(stress.elementId, "CM-01 mechanical von Mises element"),
    },
  };
}
function parseStoredStep(value: unknown) {
  const root = exactRecord(
    value,
    ["bytes", "fingerprint", "name"],
    "CM-01 mechanical STEP",
  );
  if (root.name !== "coffee-machine-cm01-v3-drip-tray.step") {
    throw new Error("CM-01 mechanical STEP name is invalid.");
  }
  return {
    name: "coffee-machine-cm01-v3-drip-tray.step" as const,
    bytes: positiveInt(root.bytes, "CM-01 mechanical STEP bytes"),
    fingerprint: fingerprint(root.fingerprint, "CM-01 mechanical STEP fingerprint"),
  };
}
function parseHandoff(
  value: unknown,
  step: { bytes: number; fingerprint: ContentFingerprint },
) {
  const root = exactRecord(value, ["bytes", "fingerprint"], "CM-01 mechanical handoff");
  const handoff = {
    bytes: positiveInt(root.bytes, "CM-01 mechanical handoff bytes"),
    fingerprint: fingerprint(root.fingerprint, "CM-01 mechanical handoff fingerprint"),
  };
  if (
    handoff.bytes !== step.bytes ||
    handoff.fingerprint.digest !== step.fingerprint.digest
  ) throw new Error("CM-01 mechanical handoff does not attest the exported STEP.");
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
function fingerprint(value: unknown, path: string): ContentFingerprint {
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
