import {
  COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_KEY,
  COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_SCHEMA,
  COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_SCHEMA,
  type CoffeeMachineCm01SemanticRecipe,
  type CoffeeMachineCm01SemanticRecipeR2,
} from "./coffee-machine-cm01-semantic-recipe.ts";

/**
 * Provider-neutral CAD handoff for the reviewed CM-01 V3 product recipe.
 *
 * It is a deterministic geometry intent and build123d program, not a CAD
 * authoring surface, a STEP result, or a manufacturing declaration.  A future
 * server-owned executor must call build123d, retain the returned artefacts,
 * and attest their content before it can claim a CAD result.
 */
export const COFFEE_MACHINE_CM01_SEMANTIC_CAD_PLAN_SCHEMA =
  "coffee-machine-cm01-semantic-cad-plan/1.0" as const;

export type CoffeeMachineCm01CadGeometryKind =
  | "enclosure-shell"
  | "hollow-box"
  | "solid-box"
  | "cylinder";

export interface CoffeeMachineCm01CadFingerprint {
  readonly algorithm: "sha256";
  readonly digest: string;
}

export interface CoffeeMachineCm01CadGeometry {
  readonly semanticKey: string;
  readonly kind: CoffeeMachineCm01CadGeometryKind;
  readonly dimensionsMm: Readonly<Record<string, number>>;
  readonly translationMm: readonly [number, number, number];
  readonly rotationDeg: readonly [number, number, number];
}

export interface CoffeeMachineCm01CadArtifact {
  readonly role: "cad-plan" | "cad-script";
  readonly mediaType: "application/json" | "text/x-python";
  readonly fingerprint: CoffeeMachineCm01CadFingerprint;
}

export interface CoffeeMachineCm01SemanticCadPlan {
  readonly schemaVersion: typeof COFFEE_MACHINE_CM01_SEMANTIC_CAD_PLAN_SCHEMA;
  readonly recipe: {
    readonly schemaVersion:
      | typeof COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_SCHEMA
      | typeof COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_SCHEMA;
    readonly key: "cm01-golden" | typeof COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_KEY;
    readonly fingerprint: CoffeeMachineCm01CadFingerprint;
  };
  readonly geometry: {
    readonly unit: "mm";
    readonly envelopeMm: {
      readonly min: readonly [number, number, number];
      readonly max: readonly [number, number, number];
    };
    readonly components: readonly CoffeeMachineCm01CadGeometry[];
  };
  /** The future executor maps this fixed request to its owned MCP client. */
  readonly build123d: {
    readonly tool: "build123d_export";
    readonly exportFormats: readonly ["step", "gltf", "stl"];
    readonly exportName: "coffee-machine-cm01-v3" | "coffee-machine-cm01-v3-r2";
    readonly scriptArtifactRole: "cad-script";
  };
  readonly artifacts: readonly [
    CoffeeMachineCm01CadArtifact,
    CoffeeMachineCm01CadArtifact,
  ];
}

export interface CompiledCoffeeMachineCm01SemanticCadPlan {
  readonly plan: CoffeeMachineCm01SemanticCadPlan;
  /** Exact UTF-8 Python program for the build123d_export request. */
  readonly script: string;
}

/**
 * Render a single-component build123d script for presentation STL export.
 *
 * The component is placed at its reviewed assembly position so the resulting
 * STL is geometrically consistent with the assembly. The function is pure and
 * deterministic — it does not call any provider. The server owns the shape; no
 * geometry value reaches here from an agent.
 *
 * Tessellation is not parameterised: build123d_export applies its default
 * tolerances (linear 0.001 relative to bounding box, angular 0.1 rad), which
 * produce presentation-quality meshes appropriate for component-workspace
 * viewers. This is a deliberate server-side constant, not an agent input.
 */
export function renderBuild123dPartScript(
  component: CoffeeMachineCm01CadGeometry,
): string {
  const lines = [
    "from build123d import Align, Box, Compound, Cylinder, Pos, Rot",
    "",
    `# ${component.semanticKey}`,
    ...renderComponent("shape", component),
  ];
  const [rx, ry, rz] = component.rotationDeg;
  const [x, y, z] = component.translationMm;
  lines.push(
    `shape = Rot(${pythonNumber(rx)}, ${pythonNumber(ry)}, ${
      pythonNumber(rz)
    }) * shape`,
    `shape = Pos(${pythonNumber(x)}, ${pythonNumber(y)}, ${pythonNumber(z)}) * shape`,
    `shape.label = ${pythonString(component.semanticKey)}`,
    `result = shape`,
    "",
  );
  return lines.join("\n");
}

/**
 * Compile the closed CM-01 semantic recipe into the only CAD handoff accepted
 * by this V3 golden path.  The input is parsed before any render work: there
 * are no source UUIDs, snapshots, free-form Python, or provider calls here.
 */
export async function compileCoffeeMachineCm01SemanticCadPlan(
  recipe: CoffeeMachineCm01SemanticRecipe,
): Promise<CompiledCoffeeMachineCm01SemanticCadPlan> {
  assertParsedRecipe(
    recipe,
    COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_SCHEMA,
    "cm01-golden",
  );
  return await compileParsedRecipe(recipe, "coffee-machine-cm01-v3");
}

/**
 * Compile only the reviewed 30 mm DripTray follow-up recipe.
 *
 * This is intentionally a separate entry point: passing a V1 frozen recipe
 * cannot silently produce a V2 CAD handoff, and no free geometry value is
 * accepted by the compiler.
 */
export async function compileCoffeeMachineCm01SemanticCadPlanR2(
  recipe: CoffeeMachineCm01SemanticRecipeR2,
): Promise<CompiledCoffeeMachineCm01SemanticCadPlan> {
  assertParsedRecipe(
    recipe,
    COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_SCHEMA,
    COFFEE_MACHINE_CM01_SEMANTIC_RECIPE_R2_KEY,
  );
  return await compileParsedRecipe(recipe, "coffee-machine-cm01-v3-r2");
}

type ParsedCoffeeMachineCm01SemanticRecipe =
  | CoffeeMachineCm01SemanticRecipe
  | CoffeeMachineCm01SemanticRecipeR2;

async function compileParsedRecipe(
  recipe: ParsedCoffeeMachineCm01SemanticRecipe,
  exportName: CoffeeMachineCm01SemanticCadPlan["build123d"]["exportName"],
): Promise<CompiledCoffeeMachineCm01SemanticCadPlan> {
  const geometry = normalizeGeometry(recipe);
  const script = renderBuild123dScript(geometry.components, exportName);
  const recipeFingerprint = await fingerprint(recipeFingerprintPayload(recipe));
  const planFingerprint = await fingerprint({
    schemaVersion: COFFEE_MACHINE_CM01_SEMANTIC_CAD_PLAN_SCHEMA,
    recipe: {
      schemaVersion: recipe.schemaVersion,
      key: recipe.recipeKey,
      fingerprint: recipeFingerprint,
    },
    geometry,
    build123d: {
      tool: "build123d_export",
      exportFormats: ["step", "gltf", "stl"],
      exportName,
      scriptArtifactRole: "cad-script",
    },
  });
  const scriptFingerprint = await fingerprint(script);

  return deepFreeze({
    plan: {
      schemaVersion: COFFEE_MACHINE_CM01_SEMANTIC_CAD_PLAN_SCHEMA,
      recipe: {
        schemaVersion: recipe.schemaVersion,
        key: recipe.recipeKey,
        fingerprint: recipeFingerprint,
      },
      geometry,
      build123d: {
        tool: "build123d_export",
        exportFormats: ["step", "gltf", "stl"],
        exportName,
        scriptArtifactRole: "cad-script",
      },
      artifacts: [
        {
          role: "cad-plan",
          mediaType: "application/json",
          fingerprint: planFingerprint,
        },
        {
          role: "cad-script",
          mediaType: "text/x-python",
          fingerprint: scriptFingerprint,
        },
      ],
    },
    script,
  });
}

/**
 * The parser is the only authority allowed to turn JSON into this product
 * definition.  Requiring its frozen result prevents an executor from silently
 * making the CAD compiler a second recipe parser with divergent policy.
 */
function assertParsedRecipe(
  recipe: ParsedCoffeeMachineCm01SemanticRecipe,
  schemaVersion: ParsedCoffeeMachineCm01SemanticRecipe["schemaVersion"],
  recipeKey: ParsedCoffeeMachineCm01SemanticRecipe["recipeKey"],
): void {
  if (
    recipe.schemaVersion !== schemaVersion || recipe.recipeKey !== recipeKey ||
    !Object.isFrozen(recipe) ||
    !Object.isFrozen(recipe.components) ||
    !recipe.components.every((component) =>
      Object.isFrozen(component) &&
      Object.isFrozen(component.dimensions) &&
      Object.isFrozen(component.placement) &&
      Object.isFrozen(component.placement.translation) &&
      Object.isFrozen(component.placement.rotation)
    )
  ) {
    throw new Error(
      "CM-01 semantic CAD compilation requires a parsed frozen semantic recipe.",
    );
  }
}

function normalizeGeometry(
  recipe: ParsedCoffeeMachineCm01SemanticRecipe,
): CoffeeMachineCm01SemanticCadPlan["geometry"] {
  return {
    unit: "mm",
    envelopeMm: {
      min: [...recipe.envelope.min] as [number, number, number],
      max: [...recipe.envelope.max] as [number, number, number],
    },
    components: recipe.components.map((component) => ({
      semanticKey: component.semanticKey,
      kind: component.geometryTemplate,
      dimensionsMm: Object.fromEntries(
        component.dimensions.map((dimension) => [
          dimension.semanticKey,
          dimension.value,
        ]),
      ),
      translationMm: component.placement.translation.map((axis) => axis.value) as [
        number,
        number,
        number,
      ],
      rotationDeg: component.placement.rotation.map((axis) => axis.value) as [
        number,
        number,
        number,
      ],
    })),
  };
}

function recipeFingerprintPayload(
  recipe: ParsedCoffeeMachineCm01SemanticRecipe,
): unknown {
  return {
    schemaVersion: recipe.schemaVersion,
    recipeKey: recipe.recipeKey,
    system: recipe.system,
    envelope: recipe.envelope,
    components: recipe.components,
  };
}

function renderBuild123dScript(
  components: readonly CoffeeMachineCm01CadGeometry[],
  assemblyLabel: CoffeeMachineCm01SemanticCadPlan["build123d"]["exportName"],
): string {
  const lines = [
    "from build123d import Align, Box, Compound, Cylinder, Pos, Rot",
    "",
    "components = []",
  ];
  for (const [index, component] of components.entries()) {
    const shape = `shape_${index}`;
    lines.push("", `# ${component.semanticKey}`);
    lines.push(...renderComponent(shape, component));
    const [rx, ry, rz] = component.rotationDeg;
    const [x, y, z] = component.translationMm;
    lines.push(
      `${shape} = Rot(${pythonNumber(rx)}, ${pythonNumber(ry)}, ${
        pythonNumber(rz)
      }) * ${shape}`,
      `${shape} = Pos(${pythonNumber(x)}, ${pythonNumber(y)}, ${
        pythonNumber(z)
      }) * ${shape}`,
      `${shape}.label = ${pythonString(component.semanticKey)}`,
      `components.append(${shape})`,
    );
  }
  lines.push(
    "",
    `result = Compound(label=${pythonString(assemblyLabel)}, children=components)`,
    "",
  );
  return lines.join("\n");
}

function renderComponent(
  shape: string,
  component: CoffeeMachineCm01CadGeometry,
): string[] {
  const dimensions = component.dimensionsMm;
  const centered = "align=(Align.CENTER, Align.CENTER, Align.CENTER)";
  switch (component.kind) {
    case "solid-box":
      return [
        `${shape} = Box(${pythonNumber(requiredDimension(dimensions, "size-x"))}, ${
          pythonNumber(requiredDimension(dimensions, "size-y"))
        }, ${pythonNumber(requiredDimension(dimensions, "size-z"))}, ${centered})`,
      ];
    case "cylinder":
      return [
        `${shape} = Cylinder(${
          pythonNumber(requiredDimension(dimensions, "diameter") / 2)
        }, ${pythonNumber(requiredDimension(dimensions, "height"))}, ${centered})`,
      ];
    case "enclosure-shell":
    case "hollow-box": {
      const x = requiredDimension(dimensions, "size-x");
      const y = requiredDimension(dimensions, "size-y");
      const z = requiredDimension(dimensions, "size-z");
      const wall = requiredDimension(dimensions, "wall-thickness");
      return [
        `${shape}_outer = Box(${pythonNumber(x)}, ${pythonNumber(y)}, ${
          pythonNumber(z)
        }, ${centered})`,
        `${shape}_inner = Box(${pythonNumber(x - 2 * wall)}, ${
          pythonNumber(y - 2 * wall)
        }, ${pythonNumber(z - 2 * wall)}, ${centered})`,
        `${shape} = ${shape}_outer - ${shape}_inner`,
      ];
    }
  }
}

function requiredDimension(
  dimensions: Readonly<Record<string, number>>,
  semanticKey: string,
): number {
  const value = dimensions[semanticKey];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Missing finite ${semanticKey} dimension in normalized CM-01 geometry.`,
    );
  }
  return value;
}

function pythonNumber(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

function pythonString(value: string): string {
  return JSON.stringify(value);
}

async function fingerprint(value: unknown): Promise<CoffeeMachineCm01CadFingerprint> {
  const bytes = new TextEncoder().encode(
    typeof value === "string" ? value : canonicalJson(value),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot fingerprint a non-finite number.");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") {
    throw new Error("Cannot fingerprint a non-JSON value.");
  }
  const record = value as Record<string, unknown>;
  return `{${
    Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")
  }}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}
