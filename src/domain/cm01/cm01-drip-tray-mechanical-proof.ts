import { deterministicJson, sha256Fingerprint } from "../kernel/deterministic-json.ts";

export const CM01_DRIP_TRAY_MECHANICAL_PROOF_SCHEMA =
  "cm01-v3-drip-tray-static-proof/1.0" as const;
/**
 * The one reviewed follow-up proof. Like the recipe R2, this remains a closed
 * 28 mm -> 30 mm correction contract rather than an open geometry input.
 */
export const CM01_DRIP_TRAY_MECHANICAL_PROOF_R2_SCHEMA =
  "cm01-v3-drip-tray-static-proof/2.0" as const;
/**
 * A recovery is a new reviewed proof contract, never an edit/replay of R2.
 * It widens the two face-selection boxes by one millimetre along Z so Gmsh
 * can contain the full 30 mm faces after STEP import.
 */
export const CM01_DRIP_TRAY_MECHANICAL_PROOF_R3_SCHEMA =
  "cm01-v3-drip-tray-static-proof/3.0" as const;
export const CM01_DRIP_TRAY_MECHANICAL_PROJECT_ID = "coffee-machine-cm01-v3" as const;
export const CM01_DRIP_TRAY_MECHANICAL_SUBJECT_ID =
  "project:coffee-machine-cm01-v3" as const;

export interface Cm01DripTrayMechanicalProof {
  readonly schemaVersion: typeof CM01_DRIP_TRAY_MECHANICAL_PROOF_SCHEMA;
  readonly id: "coffee-machine-cm01-v3-drip-tray-static-proof";
  readonly project: {
    readonly id: typeof CM01_DRIP_TRAY_MECHANICAL_PROJECT_ID;
    readonly subjectId: typeof CM01_DRIP_TRAY_MECHANICAL_SUBJECT_ID;
  };
  readonly evidenceBoundary: string;
  readonly geometry: {
    readonly widthMm: 190;
    readonly depthMm: 135;
    readonly heightMm: 28;
  };
  readonly material: { readonly eMpa: 2200; readonly nu: 0.35 };
  readonly meshSizeMm: 5;
  readonly fixed: { readonly name: "FIXED"; readonly box: Bounds };
  readonly loaded: {
    readonly name: "LOADED";
    readonly box: Bounds;
    readonly forceN: readonly [0, 0, -100];
  };
  readonly limits: {
    readonly maximumDisplacementMm: 1;
    readonly maximumVonMisesMpa: 20;
  };
}

export interface Cm01DripTrayMechanicalProofR2 extends
  Omit<
    Cm01DripTrayMechanicalProof,
    "schemaVersion" | "id" | "geometry"
  > {
  readonly schemaVersion: typeof CM01_DRIP_TRAY_MECHANICAL_PROOF_R2_SCHEMA;
  readonly id: "coffee-machine-cm01-v3-drip-tray-height-30-static-proof";
  readonly geometry: {
    readonly widthMm: 190;
    readonly depthMm: 135;
    readonly heightMm: 30;
  };
}

export interface Cm01DripTrayMechanicalProofR3
  extends Omit<Cm01DripTrayMechanicalProofR2, "schemaVersion" | "id"> {
  readonly schemaVersion: typeof CM01_DRIP_TRAY_MECHANICAL_PROOF_R3_SCHEMA;
  readonly id: "coffee-machine-cm01-v3-drip-tray-height-30-static-proof-r3";
}

export interface Bounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "project",
  "evidenceBoundary",
  "geometry",
  "material",
  "meshSizeMm",
  "fixed",
  "loaded",
  "limits",
] as const;

/** Parse the reviewed V3 proof only; historical declarations are not accepted. */
export function parseCm01DripTrayMechanicalProof(
  value: unknown,
): Cm01DripTrayMechanicalProof {
  const root = exactRecord(value, ROOT_KEYS, "$proof");
  exact(
    root.schemaVersion,
    CM01_DRIP_TRAY_MECHANICAL_PROOF_SCHEMA,
    "$proof.schemaVersion",
  );
  exact(root.id, "coffee-machine-cm01-v3-drip-tray-static-proof", "$proof.id");
  const project = exactRecord(root.project, ["id", "subjectId"], "$proof.project");
  exact(project.id, CM01_DRIP_TRAY_MECHANICAL_PROJECT_ID, "$proof.project.id");
  exact(
    project.subjectId,
    CM01_DRIP_TRAY_MECHANICAL_SUBJECT_ID,
    "$proof.project.subjectId",
  );
  const geometry = exactRecord(
    root.geometry,
    ["widthMm", "depthMm", "heightMm"],
    "$proof.geometry",
  );
  exact(geometry.widthMm, 190, "$proof.geometry.widthMm");
  exact(geometry.depthMm, 135, "$proof.geometry.depthMm");
  exact(geometry.heightMm, 28, "$proof.geometry.heightMm");
  const material = exactRecord(root.material, ["eMpa", "nu"], "$proof.material");
  exact(material.eMpa, 2200, "$proof.material.eMpa");
  exact(material.nu, 0.35, "$proof.material.nu");
  exact(root.meshSizeMm, 5, "$proof.meshSizeMm");
  const fixed = selection(root.fixed, "FIXED", "$proof.fixed");
  const loadedRaw = exactRecord(
    root.loaded,
    ["name", "box", "forceN"],
    "$proof.loaded",
  );
  exact(loadedRaw.name, "LOADED", "$proof.loaded.name");
  const force = vector(
    loadedRaw.forceN,
    [0, 0, -100],
    "$proof.loaded.forceN",
  ) as readonly [0, 0, -100];
  const limits = exactRecord(root.limits, [
    "maximumDisplacementMm",
    "maximumVonMisesMpa",
  ], "$proof.limits");
  exact(limits.maximumDisplacementMm, 1, "$proof.limits.maximumDisplacementMm");
  exact(limits.maximumVonMisesMpa, 20, "$proof.limits.maximumVonMisesMpa");
  if (
    typeof root.evidenceBoundary !== "string" || root.evidenceBoundary.trim() === ""
  ) {
    throw new TypeError("$proof.evidenceBoundary must be non-empty.");
  }
  return Object.freeze({
    schemaVersion: CM01_DRIP_TRAY_MECHANICAL_PROOF_SCHEMA,
    id: "coffee-machine-cm01-v3-drip-tray-static-proof",
    project: {
      id: CM01_DRIP_TRAY_MECHANICAL_PROJECT_ID,
      subjectId: CM01_DRIP_TRAY_MECHANICAL_SUBJECT_ID,
    },
    evidenceBoundary: root.evidenceBoundary,
    geometry: { widthMm: 190 as const, depthMm: 135 as const, heightMm: 28 as const },
    material: { eMpa: 2200 as const, nu: 0.35 as const },
    meshSizeMm: 5 as const,
    fixed,
    loaded: {
      name: "LOADED" as const,
      box: bounds(loadedRaw.box, "$proof.loaded.box"),
      forceN: force,
    },
    limits: { maximumDisplacementMm: 1 as const, maximumVonMisesMpa: 20 as const },
  });
}

/** Parse only the reviewed 30 mm DripTray static-proof follow-up. */
export function parseCm01DripTrayMechanicalProofR2(
  value: unknown,
): Cm01DripTrayMechanicalProofR2 {
  const root = exactRecord(value, ROOT_KEYS, "$proof");
  exact(
    root.schemaVersion,
    CM01_DRIP_TRAY_MECHANICAL_PROOF_R2_SCHEMA,
    "$proof.schemaVersion",
  );
  exact(
    root.id,
    "coffee-machine-cm01-v3-drip-tray-height-30-static-proof",
    "$proof.id",
  );
  const geometry = exactRecord(
    root.geometry,
    ["widthMm", "depthMm", "heightMm"],
    "$proof.geometry",
  );
  exact(geometry.widthMm, 190, "$proof.geometry.widthMm");
  exact(geometry.depthMm, 135, "$proof.geometry.depthMm");
  exact(geometry.heightMm, 30, "$proof.geometry.heightMm");

  const normalized = structuredClone(root);
  normalized.schemaVersion = CM01_DRIP_TRAY_MECHANICAL_PROOF_SCHEMA;
  normalized.id = "coffee-machine-cm01-v3-drip-tray-static-proof";
  const normalizedGeometry = normalized.geometry as Record<string, unknown>;
  normalizedGeometry.heightMm = 28;
  const parsedV1 = parseCm01DripTrayMechanicalProof(normalized);
  return Object.freeze({
    ...parsedV1,
    schemaVersion: CM01_DRIP_TRAY_MECHANICAL_PROOF_R2_SCHEMA,
    id: "coffee-machine-cm01-v3-drip-tray-height-30-static-proof" as const,
    geometry: {
      widthMm: 190 as const,
      depthMm: 135 as const,
      heightMm: 30 as const,
    },
  });
}

/** Parse the one bounded R3 recovery proof, including its exact padded boxes. */
export function parseCm01DripTrayMechanicalProofR3(
  value: unknown,
): Cm01DripTrayMechanicalProofR3 {
  const root = exactRecord(value, ROOT_KEYS, "$proof");
  exact(
    root.schemaVersion,
    CM01_DRIP_TRAY_MECHANICAL_PROOF_R3_SCHEMA,
    "$proof.schemaVersion",
  );
  exact(
    root.id,
    "coffee-machine-cm01-v3-drip-tray-height-30-static-proof-r3",
    "$proof.id",
  );
  const geometry = exactRecord(
    root.geometry,
    ["widthMm", "depthMm", "heightMm"],
    "$proof.geometry",
  );
  exact(geometry.widthMm, 190, "$proof.geometry.widthMm");
  exact(geometry.depthMm, 135, "$proof.geometry.depthMm");
  exact(geometry.heightMm, 30, "$proof.geometry.heightMm");
  const fixed = selection(root.fixed, "FIXED", "$proof.fixed");
  const loadedRaw = exactRecord(
    root.loaded,
    ["name", "box", "forceN"],
    "$proof.loaded",
  );
  exact(loadedRaw.name, "LOADED", "$proof.loaded.name");
  const loaded = {
    name: "LOADED" as const,
    box: bounds(loadedRaw.box, "$proof.loaded.box"),
    forceN: vector(loadedRaw.forceN, [0, 0, -100], "$proof.loaded.forceN") as readonly [
      0,
      0,
      -100,
    ],
  };
  exactBounds(fixed.box, [-96, 66.5, -16], [96, 68.5, 16], "$proof.fixed.box");
  exactBounds(loaded.box, [-96, -68.5, -16], [96, -66.5, 16], "$proof.loaded.box");
  const normalized = structuredClone(root);
  normalized.schemaVersion = CM01_DRIP_TRAY_MECHANICAL_PROOF_SCHEMA;
  normalized.id = "coffee-machine-cm01-v3-drip-tray-static-proof";
  const normalizedGeometry = normalized.geometry as Record<string, unknown>;
  normalizedGeometry.heightMm = 28;
  const base = parseCm01DripTrayMechanicalProof(normalized);
  return Object.freeze({
    ...base,
    schemaVersion: CM01_DRIP_TRAY_MECHANICAL_PROOF_R3_SCHEMA,
    id: "coffee-machine-cm01-v3-drip-tray-height-30-static-proof-r3" as const,
    geometry: { widthMm: 190 as const, depthMm: 135 as const, heightMm: 30 as const },
    fixed,
    loaded,
  });
}

/** The only CAD program permitted by this proof. */
export function renderCm01DripTrayMechanicalScript(
  proof: Cm01DripTrayMechanicalProof,
): string {
  const checked = parseCm01DripTrayMechanicalProof(proof);
  return renderCm01DripTrayMechanicalScriptForHeight(checked.geometry.heightMm);
}

/** Render the fixed build123d input for the reviewed 30 mm correction. */
export function renderCm01DripTrayMechanicalScriptR2(
  proof: Cm01DripTrayMechanicalProofR2,
): string {
  const checked = parseCm01DripTrayMechanicalProofR2(proof);
  return renderCm01DripTrayMechanicalScriptForHeight(checked.geometry.heightMm);
}

export function renderCm01DripTrayMechanicalScriptR3(
  proof: Cm01DripTrayMechanicalProofR3,
): string {
  const checked = parseCm01DripTrayMechanicalProofR3(proof);
  return renderCm01DripTrayMechanicalScriptForHeight(checked.geometry.heightMm);
}

function renderCm01DripTrayMechanicalScriptForHeight(heightMm: 28 | 30): string {
  return [
    "from build123d import Align, Box",
    "",
    `result = Box(190, 135, ${heightMm}, align=(Align.CENTER, Align.CENTER, Align.CENTER))`,
  ].join("\n");
}

export async function fingerprintCm01DripTrayMechanicalScript(
  proof: Cm01DripTrayMechanicalProof,
) {
  return await sha256Fingerprint(renderCm01DripTrayMechanicalScript(proof));
}

/** Fingerprint the R2 bytes independently; V1 proof bytes are not reused. */
export async function fingerprintCm01DripTrayMechanicalScriptR2(
  proof: Cm01DripTrayMechanicalProofR2,
) {
  return await sha256Fingerprint(renderCm01DripTrayMechanicalScriptR2(proof));
}

export function cm01DripTrayMechanicalRequest(
  proof: Cm01DripTrayMechanicalProof,
  step: { path: string; sha256: string },
) {
  const checked = parseCm01DripTrayMechanicalProof(proof);
  return cm01DripTrayMechanicalRequestForProof(checked, step);
}

/** Build the exact CalculiX request for the reviewed 30 mm proof only. */
export function cm01DripTrayMechanicalRequestR2(
  proof: Cm01DripTrayMechanicalProofR2,
  step: { path: string; sha256: string },
) {
  const checked = parseCm01DripTrayMechanicalProofR2(proof);
  return cm01DripTrayMechanicalRequestForProof(checked, step);
}

export function cm01DripTrayMechanicalRequestR3(
  proof: Cm01DripTrayMechanicalProofR3,
  step: { path: string; sha256: string },
) {
  const checked = parseCm01DripTrayMechanicalProofR3(proof);
  return cm01DripTrayMechanicalRequestForProof(checked, step);
}

function cm01DripTrayMechanicalRequestForProof(
  checked:
    | Cm01DripTrayMechanicalProof
    | Cm01DripTrayMechanicalProofR2
    | Cm01DripTrayMechanicalProofR3,
  step: { path: string; sha256: string },
) {
  if (!/^[a-f0-9]{64}$/.test(step.sha256) || !step.path.trim()) {
    throw new TypeError("CM-01 mechanical STEP handoff is invalid.");
  }
  return Object.freeze({
    step_path: step.path,
    expected_step_sha256: step.sha256,
    mesh_size_mm: checked.meshSizeMm,
    material: { e_mpa: checked.material.eMpa, nu: checked.material.nu },
    selections: [
      { name: checked.fixed.name, box: checked.fixed.box },
      { name: checked.loaded.name, box: checked.loaded.box },
    ],
    fixed: [checked.fixed.name],
    loads: [{ selection: checked.loaded.name, force_n: checked.loaded.forceN }],
  });
}

function selection(value: unknown, expectedName: "FIXED", path: string) {
  const record = exactRecord(value, ["name", "box"], path);
  exact(record.name, expectedName, `${path}.name`);
  return { name: expectedName, box: bounds(record.box, `${path}.box`) } as const;
}
function bounds(value: unknown, path: string): Bounds {
  const record = exactRecord(value, ["min", "max"], path);
  return {
    min: vector(record.min, undefined, `${path}.min`),
    max: vector(record.max, undefined, `${path}.max`),
  };
}
function exactBounds(
  value: Bounds,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  path: string,
): void {
  if (
    deterministicJson(value.min) !== deterministicJson(min) ||
    deterministicJson(value.max) !== deterministicJson(max)
  ) {
    throw new TypeError(`${path} must equal the reviewed R3 padded face box.`);
  }
}
function vector(
  value: unknown,
  expected: readonly number[] | undefined,
  path: string,
): readonly [number, number, number] {
  if (
    !Array.isArray(value) || value.length !== 3 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) throw new TypeError(`${path} must be a finite 3-vector.`);
  if (expected && deterministicJson(value) !== deterministicJson(expected)) {
    throw new TypeError(`${path} does not match the reviewed proof.`);
  }
  return [value[0]!, value[1]!, value[2]!];
}
function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (
    deterministicJson(Object.keys(record).sort()) !==
      deterministicJson([...keys].sort())
  ) throw new TypeError(`${path} has unsupported or missing fields.`);
  return record;
}
function exact(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) {
    throw new TypeError(`${path} must equal ${JSON.stringify(expected)}.`);
  }
}
