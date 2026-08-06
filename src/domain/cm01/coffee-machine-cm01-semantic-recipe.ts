import type { ContentFingerprint } from "../thread-snapshot.ts";

/**
 * A closed, provider-identity-free product definition for the CM-01 golden
 * path. It is deliberately not a generic SysML authoring language: changing a
 * geometry value, semantic name, or placement requires a new reviewed recipe
 * revision and an explicit parser contract.
 */
export const COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_SCHEMA =
  "coffee-machine-semantic-recipe/1.0" as const;
export const COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_KEY = "cm01-golden" as const;

/**
 * The one reviewed follow-up recipe. It is deliberately a new closed parser,
 * rather than a parameter accepted by the V1 golden recipe: the only allowed
 * geometry difference is the DripTray `size-z` correction from 28 mm to
 * 30 mm. A future revision needs its own schema, key and parser contract.
 */
export const COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_SCHEMA =
  "coffee-machine-semantic-recipe/2.0" as const;
export const COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_KEY =
  "cm01-drip-tray-height-30" as const;

export type CoffeeMachineCm01GeometryTemplate =
  | "enclosure-shell"
  | "hollow-box"
  | "solid-box"
  | "cylinder";

export type CoffeeMachineCm01Unit = "mm" | "deg";

export interface CoffeeMachineCm01SemanticParameter<
  Unit extends CoffeeMachineCm01Unit = CoffeeMachineCm01Unit,
> {
  /** Stable semantic coordinate, never a provider element identity. */
  readonly semanticKey: string;
  /** Fixed SysML identifier emitted by the canonical renderer. */
  readonly sysmlAttributeName: string;
  readonly value: number;
  readonly unit: Unit;
}

export interface CoffeeMachineCm01Component {
  /** Stable product-semantic key, scoped beneath this one recipe. */
  readonly semanticKey: string;
  readonly sysmlPartDefinitionName: string;
  readonly sysmlPartUsageName: string;
  readonly geometryTemplate: CoffeeMachineCm01GeometryTemplate;
  readonly dimensions: readonly CoffeeMachineCm01SemanticParameter<"mm">[];
  readonly placement: {
    readonly translation: readonly [
      CoffeeMachineCm01SemanticParameter<"mm">,
      CoffeeMachineCm01SemanticParameter<"mm">,
      CoffeeMachineCm01SemanticParameter<"mm">,
    ];
    readonly rotation: readonly [
      CoffeeMachineCm01SemanticParameter<"deg">,
      CoffeeMachineCm01SemanticParameter<"deg">,
      CoffeeMachineCm01SemanticParameter<"deg">,
    ];
  };
}

export interface CoffeeMachineCm01SemanticRecipe {
  readonly schemaVersion: typeof COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_SCHEMA;
  readonly recipeKey: typeof COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_KEY;
  readonly system: {
    readonly semanticKey: "coffee-machine";
    readonly sysmlPackageName: "CoffeeMachineCM01";
    readonly sysmlPartDefinitionName: "CoffeeMachine";
  };
  readonly envelope: {
    readonly semanticKey: "assembly-envelope";
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
    readonly unit: "mm";
  };
  readonly components: readonly CoffeeMachineCm01Component[];
}

/** Exact corrected CM-01 recipe; no arbitrary dimension inputs are admitted. */
export interface CoffeeMachineCm01SemanticRecipeR2 extends
  Omit<
    CoffeeMachineCm01SemanticRecipe,
    "schemaVersion" | "recipeKey"
  > {
  readonly schemaVersion: typeof COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_SCHEMA;
  readonly recipeKey: typeof COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_KEY;
}

interface ParameterContract {
  readonly semanticKey: string;
  readonly sysmlAttributeName: string;
  readonly value: number;
  readonly unit: CoffeeMachineCm01Unit;
}

interface ComponentContract {
  readonly semanticKey: string;
  readonly sysmlPartDefinitionName: string;
  readonly sysmlPartUsageName: string;
  readonly geometryTemplate: CoffeeMachineCm01GeometryTemplate;
  readonly dimensions: readonly ParameterContract[];
  readonly translation: readonly ParameterContract[];
  readonly rotation: readonly ParameterContract[];
}

const ROOT_KEYS = [
  "schemaVersion",
  "recipeKey",
  "system",
  "envelope",
  "components",
] as const;
const COMPONENT_KEYS = [
  "semanticKey",
  "sysmlPartDefinitionName",
  "sysmlPartUsageName",
  "geometryTemplate",
  "dimensions",
  "placement",
] as const;
const PARAMETER_KEYS = [
  "semanticKey",
  "sysmlAttributeName",
  "value",
  "unit",
] as const;
const SEMANTIC_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SYSML_IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;

const AXIS_PARAMETERS = {
  translation: [
    { semanticKey: "position-x", sysmlAttributeName: "positionX", unit: "mm" },
    { semanticKey: "position-y", sysmlAttributeName: "positionY", unit: "mm" },
    { semanticKey: "position-z", sysmlAttributeName: "positionZ", unit: "mm" },
  ] as const,
  rotation: [
    { semanticKey: "rotation-x", sysmlAttributeName: "rotationX", unit: "deg" },
    { semanticKey: "rotation-y", sysmlAttributeName: "rotationY", unit: "deg" },
    { semanticKey: "rotation-z", sysmlAttributeName: "rotationZ", unit: "deg" },
  ] as const,
};

/**
 * The static product values were transcribed from the reviewed r5 CM-01 CAD
 * source capture. This table contains no SysON UUID, provider project ID,
 * path, hash, or historical component identifier.
 */
const COMPONENT_CONTRACTS: readonly ComponentContract[] = [
  componentContract(
    "enclosure",
    "Enclosure",
    "enclosure",
    "enclosure-shell",
    [
      dimension("size-x", "sizeX", 260),
      dimension("size-y", "sizeY", 320),
      dimension("size-z", "sizeZ", 380),
      dimension("wall-thickness", "wallThickness", 3),
    ],
    [0, 0, 0],
  ),
  componentContract(
    "water-tank",
    "WaterTank",
    "waterTank",
    "hollow-box",
    [
      dimension("size-x", "sizeX", 90),
      dimension("size-y", "sizeY", 90),
      dimension("size-z", "sizeZ", 230),
      dimension("wall-thickness", "wallThickness", 2.5),
    ],
    [-75, 95, 45],
  ),
  componentContract(
    "boiler",
    "Boiler",
    "boiler",
    "cylinder",
    [
      dimension("diameter", "diameter", 70),
      dimension("height", "height", 150),
    ],
    [70, 35, 85],
  ),
  componentContract(
    "pump",
    "Pump",
    "pump",
    "solid-box",
    [
      dimension("size-x", "sizeX", 55),
      dimension("size-y", "sizeY", 65),
      dimension("size-z", "sizeZ", 60),
    ],
    [70, 95, -75],
  ),
  componentContract(
    "brew-unit",
    "BrewUnit",
    "brewUnit",
    "solid-box",
    [
      dimension("size-x", "sizeX", 105),
      dimension("size-y", "sizeY", 95),
      dimension("size-z", "sizeZ", 115),
    ],
    [25, -65, -40],
  ),
  componentContract(
    "control-pcb",
    "ControlPCB",
    "controlPCB",
    "solid-box",
    [
      dimension("size-x", "sizeX", 110),
      dimension("size-y", "sizeY", 18),
      dimension("size-z", "sizeZ", 75),
    ],
    [35, 145, 85],
  ),
  componentContract(
    "power-supply",
    "PowerSupply",
    "powerSupply",
    "solid-box",
    [
      dimension("size-x", "sizeX", 95),
      dimension("size-y", "sizeY", 75),
      dimension("size-z", "sizeZ", 55),
    ],
    [-55, 70, -135],
  ),
  componentContract(
    "temperature-sensor",
    "TemperatureSensor",
    "temperatureSensor",
    "cylinder",
    [
      dimension("diameter", "diameter", 12),
      dimension("height", "height", 35),
    ],
    [82, 25, 150],
  ),
  componentContract(
    "user-interface",
    "UserInterface",
    "userInterface",
    "solid-box",
    [
      dimension("size-x", "sizeX", 145),
      dimension("size-y", "sizeY", 18),
      dimension("size-z", "sizeZ", 55),
    ],
    [0, -150, 125],
  ),
  componentContract(
    "drip-tray",
    "DripTray",
    "dripTray",
    "solid-box",
    [
      dimension("size-x", "sizeX", 190),
      dimension("size-y", "sizeY", 135),
      dimension("size-z", "sizeZ", 28),
    ],
    [0, -65, -170],
  ),
];

/**
 * Strictly parse the one reviewed CM-01 semantic product recipe.
 *
 * It rejects both unrecognised fields and a value that diverges from the
 * qualified golden geometry. Provider identities are intentionally absent:
 * a future authoring operation must resolve new SysON identities from its own
 * write/readback cycle.
 */
export function parseCoffeeMachineCm01SemanticRecipe(
  value: unknown,
): CoffeeMachineCm01SemanticRecipe {
  const root = record(value, "$recipe");
  exactKeys(root, ROOT_KEYS, "$recipe");
  exact(
    root.schemaVersion,
    COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_SCHEMA,
    "$recipe.schemaVersion",
  );
  exact(
    root.recipeKey,
    COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_KEY,
    "$recipe.recipeKey",
  );

  const system = parseSystem(root.system);
  const envelope = parseEnvelope(root.envelope);
  const rawComponents = array(root.components, "$recipe.components");
  if (rawComponents.length !== COMPONENT_CONTRACTS.length) {
    throw new Error(
      `$recipe.components must contain exactly ${COMPONENT_CONTRACTS.length} components.`,
    );
  }
  const components = COMPONENT_CONTRACTS.map((contract, index) =>
    parseComponent(rawComponents[index], contract, `$recipe.components[${index}]`)
  );

  return deepFreeze({
    schemaVersion: COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_SCHEMA,
    recipeKey: COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_KEY,
    system,
    envelope,
    components,
  });
}

/**
 * Parse only the reviewed 28 mm -> 30 mm DripTray follow-up recipe.
 *
 * The V1 parser remains the authority for every unchanged component,
 * identity, unit and placement. This parser first requires the distinct R2
 * schema/key and the exact corrected dimension, then maps that one closed
 * difference back through the V1 contract to prove no other geometry drift
 * was smuggled into the revision.
 */
export function parseCoffeeMachineCm01SemanticRecipeR2(
  value: unknown,
): CoffeeMachineCm01SemanticRecipeR2 {
  const normalizedV1 = normalizeR2RecipeToV1(value);
  const parsedV1 = parseCoffeeMachineCm01SemanticRecipe(normalizedV1);
  const components = structuredClone(
    parsedV1.components,
  ) as CoffeeMachineCm01Component[];
  const dripTray = components[9]!;
  const dimensions = structuredClone(
    dripTray.dimensions,
  ) as CoffeeMachineCm01SemanticParameter<"mm">[];
  dimensions[2] = {
    ...dimensions[2]!,
    value: 30,
  };
  components[9] = { ...dripTray, dimensions };
  return deepFreeze({
    ...parsedV1,
    schemaVersion: COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_SCHEMA,
    recipeKey: COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_KEY,
    components,
  });
}

/**
 * Render one canonical UTF-8 SysML fragment from the static recipe.
 *
 * Local validation proves the data contract and byte-determinism only. A
 * future server-owned SysON operation must still require provider
 * acknowledgement plus readback before treating this fragment as model
 * evidence.
 */
export function renderCoffeeMachineCm01Sysml(value: unknown): string {
  const recipe = parseCoffeeMachineCm01SemanticRecipe(value);
  return renderCoffeeMachineCm01SysmlRecipe(recipe);
}

/** Render the fixed SysML fragment for the one reviewed 30 mm correction. */
export function renderCoffeeMachineCm01SysmlR2(value: unknown): string {
  const recipe = parseCoffeeMachineCm01SemanticRecipeR2(value);
  return renderCoffeeMachineCm01SysmlRecipe(recipe);
}

function renderCoffeeMachineCm01SysmlRecipe(
  recipe: Pick<
    CoffeeMachineCm01SemanticRecipe,
    "system" | "components"
  >,
): string {
  const lines = [
    "private import SI::*;",
    "",
    `package ${recipe.system.sysmlPackageName} {`,
    `    part def ${recipe.system.sysmlPartDefinitionName} {`,
    ...recipe.components.map(
      (component) =>
        `        part ${component.sysmlPartUsageName}: ${component.sysmlPartDefinitionName};`,
    ),
    "    }",
    "",
  ];

  for (const component of recipe.components) {
    lines.push(`    part def ${component.sysmlPartDefinitionName} {`);
    for (const parameter of component.dimensions) {
      lines.push(sysmlAttributeLine(parameter));
    }
    for (const parameter of component.placement.translation) {
      lines.push(sysmlAttributeLine(parameter));
    }
    for (const parameter of component.placement.rotation) {
      lines.push(sysmlAttributeLine(parameter));
    }
    lines.push("    }", "");
  }
  lines.push("}");
  return lines.join("\n");
}

/** Hash exact rendered UTF-8 bytes, suitable for a future write acknowledgement. */
export async function fingerprintCoffeeMachineCm01Sysml(
  value: unknown,
): Promise<ContentFingerprint> {
  const bytes = new TextEncoder().encode(renderCoffeeMachineCm01Sysml(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}

/** Hash exact R2 SysML bytes; the V1 fingerprint is intentionally not reused. */
export async function fingerprintCoffeeMachineCm01SysmlR2(
  value: unknown,
): Promise<ContentFingerprint> {
  const bytes = new TextEncoder().encode(renderCoffeeMachineCm01SysmlR2(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}

function normalizeR2RecipeToV1(value: unknown): unknown {
  const root = record(value, "$recipe");
  exactKeys(root, ROOT_KEYS, "$recipe");
  exact(
    root.schemaVersion,
    COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_SCHEMA,
    "$recipe.schemaVersion",
  );
  exact(
    root.recipeKey,
    COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_KEY,
    "$recipe.recipeKey",
  );
  const components = array(root.components, "$recipe.components");
  const dripTray = record(components[9], "$recipe.components[9]");
  const dimensions = array(dripTray.dimensions, "$recipe.components[9].dimensions");
  const sizeZ = record(dimensions[2], "$recipe.components[9].dimensions[2]");
  exact(sizeZ.semanticKey, "size-z", "$recipe.components[9].dimensions[2].semanticKey");
  exact(
    sizeZ.sysmlAttributeName,
    "sizeZ",
    "$recipe.components[9].dimensions[2].sysmlAttributeName",
  );
  exact(sizeZ.unit, "mm", "$recipe.components[9].dimensions[2].unit");
  exact(sizeZ.value, 30, "$recipe.components[9].dimensions[2].value");

  const normalized = structuredClone(root);
  normalized.schemaVersion = COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_SCHEMA;
  normalized.recipeKey = COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_KEY;
  const normalizedComponents = normalized.components as unknown[];
  const normalizedDripTray = normalizedComponents[9] as Record<string, unknown>;
  const normalizedDimensions = normalizedDripTray.dimensions as unknown[];
  const normalizedSizeZ = normalizedDimensions[2] as Record<string, unknown>;
  normalizedSizeZ.value = 28;
  return normalized;
}

function componentContract(
  semanticKey: string,
  sysmlPartDefinitionName: string,
  sysmlPartUsageName: string,
  geometryTemplate: CoffeeMachineCm01GeometryTemplate,
  dimensions: readonly ParameterContract[],
  translationValues: readonly [number, number, number],
): ComponentContract {
  return {
    semanticKey,
    sysmlPartDefinitionName,
    sysmlPartUsageName,
    geometryTemplate,
    dimensions,
    translation: AXIS_PARAMETERS.translation.map((axis, index) => ({
      ...axis,
      value: translationValues[index]!,
    })),
    rotation: AXIS_PARAMETERS.rotation.map((axis) => ({ ...axis, value: 0 })),
  };
}

function dimension(
  semanticKey: string,
  sysmlAttributeName: string,
  value: number,
): ParameterContract {
  return { semanticKey, sysmlAttributeName, value, unit: "mm" };
}

function parseSystem(
  value: unknown,
): CoffeeMachineCm01SemanticRecipe["system"] {
  const root = record(value, "$recipe.system");
  exactKeys(
    root,
    ["semanticKey", "sysmlPackageName", "sysmlPartDefinitionName"],
    "$recipe.system",
  );
  exact(root.semanticKey, "coffee-machine", "$recipe.system.semanticKey");
  exact(
    root.sysmlPackageName,
    "CoffeeMachineCM01",
    "$recipe.system.sysmlPackageName",
  );
  exact(
    root.sysmlPartDefinitionName,
    "CoffeeMachine",
    "$recipe.system.sysmlPartDefinitionName",
  );
  return {
    semanticKey: "coffee-machine",
    sysmlPackageName: "CoffeeMachineCM01",
    sysmlPartDefinitionName: "CoffeeMachine",
  };
}

function parseEnvelope(
  value: unknown,
): CoffeeMachineCm01SemanticRecipe["envelope"] {
  const root = record(value, "$recipe.envelope");
  exactKeys(root, ["semanticKey", "min", "max", "unit"], "$recipe.envelope");
  exact(root.semanticKey, "assembly-envelope", "$recipe.envelope.semanticKey");
  exact(root.unit, "mm", "$recipe.envelope.unit");
  const min = vector(root.min, "$recipe.envelope.min");
  const max = vector(root.max, "$recipe.envelope.max");
  const expectedMin: readonly [number, number, number] = [-130, -160, -190];
  const expectedMax: readonly [number, number, number] = [130, 160, 190];
  for (let axis = 0; axis < 3; axis++) {
    exact(min[axis], expectedMin[axis], `$recipe.envelope.min[${axis}]`);
    exact(max[axis], expectedMax[axis], `$recipe.envelope.max[${axis}]`);
    if (min[axis] >= max[axis]) {
      throw new Error(`$recipe.envelope.min[${axis}] must be below max[${axis}].`);
    }
  }
  return {
    semanticKey: "assembly-envelope",
    min,
    max,
    unit: "mm",
  };
}

function parseComponent(
  value: unknown,
  contract: ComponentContract,
  path: string,
): CoffeeMachineCm01Component {
  const root = record(value, path);
  exactKeys(root, COMPONENT_KEYS, path);
  semanticKey(root.semanticKey, `${path}.semanticKey`);
  exact(root.semanticKey, contract.semanticKey, `${path}.semanticKey`);
  sysmlIdentifier(root.sysmlPartDefinitionName, `${path}.sysmlPartDefinitionName`);
  exact(
    root.sysmlPartDefinitionName,
    contract.sysmlPartDefinitionName,
    `${path}.sysmlPartDefinitionName`,
  );
  sysmlIdentifier(root.sysmlPartUsageName, `${path}.sysmlPartUsageName`);
  exact(
    root.sysmlPartUsageName,
    contract.sysmlPartUsageName,
    `${path}.sysmlPartUsageName`,
  );
  exact(root.geometryTemplate, contract.geometryTemplate, `${path}.geometryTemplate`);
  const dimensions = parseParameters(
    root.dimensions,
    contract.dimensions,
    "mm",
    `${path}.dimensions`,
  ) as CoffeeMachineCm01SemanticParameter<"mm">[];

  const placement = record(root.placement, `${path}.placement`);
  exactKeys(placement, ["translation", "rotation"], `${path}.placement`);
  const translation = tuple3(
    parseParameters(
      placement.translation,
      contract.translation,
      "mm",
      `${path}.placement.translation`,
    ) as CoffeeMachineCm01SemanticParameter<"mm">[],
    `${path}.placement.translation`,
  );
  const rotation = tuple3(
    parseParameters(
      placement.rotation,
      contract.rotation,
      "deg",
      `${path}.placement.rotation`,
    ) as CoffeeMachineCm01SemanticParameter<"deg">[],
    `${path}.placement.rotation`,
  );

  return {
    semanticKey: contract.semanticKey,
    sysmlPartDefinitionName: contract.sysmlPartDefinitionName,
    sysmlPartUsageName: contract.sysmlPartUsageName,
    geometryTemplate: contract.geometryTemplate,
    dimensions,
    placement: { translation, rotation },
  };
}

function parseParameters(
  value: unknown,
  expected: readonly ParameterContract[],
  unit: CoffeeMachineCm01Unit,
  path: string,
): CoffeeMachineCm01SemanticParameter[] {
  const entries = array(value, path);
  if (entries.length !== expected.length) {
    throw new Error(`${path} must contain exactly ${expected.length} parameters.`);
  }
  return expected.map((contract, index) => {
    const entryPath = `${path}[${index}]`;
    const root = record(entries[index], entryPath);
    exactKeys(root, PARAMETER_KEYS, entryPath);
    semanticKey(root.semanticKey, `${entryPath}.semanticKey`);
    exact(root.semanticKey, contract.semanticKey, `${entryPath}.semanticKey`);
    sysmlIdentifier(root.sysmlAttributeName, `${entryPath}.sysmlAttributeName`);
    exact(
      root.sysmlAttributeName,
      contract.sysmlAttributeName,
      `${entryPath}.sysmlAttributeName`,
    );
    const parameterUnit = parseUnit(root.unit, `${entryPath}.unit`);
    exact(parameterUnit, unit, `${entryPath}.unit`);
    exact(parameterUnit, contract.unit, `${entryPath}.unit`);
    const parameterValue = finite(root.value, `${entryPath}.value`);
    exact(parameterValue, contract.value, `${entryPath}.value`);
    if (
      unit === "mm" && contract.semanticKey !== "position-x" &&
      contract.semanticKey !== "position-y" && contract.semanticKey !== "position-z" &&
      parameterValue <= 0
    ) {
      throw new Error(`${entryPath}.value must be positive for a dimension.`);
    }
    return {
      semanticKey: contract.semanticKey,
      sysmlAttributeName: contract.sysmlAttributeName,
      value: contract.value,
      unit: contract.unit,
    };
  });
}

function tuple3<Unit extends CoffeeMachineCm01Unit>(
  value: CoffeeMachineCm01SemanticParameter<Unit>[],
  path: string,
): [
  CoffeeMachineCm01SemanticParameter<Unit>,
  CoffeeMachineCm01SemanticParameter<Unit>,
  CoffeeMachineCm01SemanticParameter<Unit>,
] {
  if (value.length !== 3) {
    throw new Error(`${path} must contain exactly three axes.`);
  }
  return [value[0]!, value[1]!, value[2]!];
}

function sysmlAttributeLine(parameter: CoffeeMachineCm01SemanticParameter): string {
  return `        attribute ${parameter.sysmlAttributeName} : Real = ${
    decimal(parameter.value)
  } [${parameter.unit}];`;
}

function decimal(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function vector(value: unknown, path: string): [number, number, number] {
  const values = array(value, path);
  if (values.length !== 3) throw new Error(`${path} must contain exactly three axes.`);
  return [
    finite(values[0], `${path}[0]`),
    finite(values[1], `${path}[1]`),
    finite(values[2], `${path}[2]`),
  ];
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  const unexpected = actual.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !actual.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${path} has unsupported field ${unexpected[0]}.`);
  }
  if (missing.length > 0) {
    throw new Error(`${path} is missing required field ${missing[0]}.`);
  }
}

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    throw new Error(`${path} must equal ${JSON.stringify(expected)}.`);
  }
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function semanticKey(value: unknown, path: string): string {
  if (typeof value !== "string" || !SEMANTIC_KEY.test(value)) {
    throw new Error(`${path} must be a lowercase stable semantic key.`);
  }
  return value;
}

function sysmlIdentifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !SYSML_IDENTIFIER.test(value)) {
    throw new Error(`${path} must be a SysML identifier.`);
  }
  return value;
}

function parseUnit(value: unknown, path: string): CoffeeMachineCm01Unit {
  if (value !== "mm" && value !== "deg") {
    throw new Error(`${path} must equal "mm" or "deg".`);
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
