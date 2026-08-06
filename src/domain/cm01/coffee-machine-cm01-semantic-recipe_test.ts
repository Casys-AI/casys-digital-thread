import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  fingerprintCoffeeMachineCm01Sysml,
  fingerprintCoffeeMachineCm01SysmlR2,
  parseCoffeeMachineCm01SemanticRecipe,
  parseCoffeeMachineCm01SemanticRecipeR2,
  renderCoffeeMachineCm01Sysml,
  renderCoffeeMachineCm01SysmlR2,
} from "./coffee-machine-cm01-semantic-recipe.ts";

const RECIPE_URL = new URL(
  "../../../config/product-recipes/coffee-machine-cm01-v1.json",
  import.meta.url,
);
const RECIPE = JSON.parse(await Deno.readTextFile(RECIPE_URL)) as Record<
  string,
  unknown
>;

Deno.test("CM-01 semantic recipe is a frozen provider-identity-free product definition", () => {
  const recipe = parseCoffeeMachineCm01SemanticRecipe(RECIPE);

  assertEquals(recipe.schemaVersion, "coffee-machine-semantic-recipe/1.0");
  assertEquals(recipe.recipeKey, "cm01-golden");
  assertEquals(recipe.system, {
    semanticKey: "coffee-machine",
    sysmlPackageName: "CoffeeMachineCM01",
    sysmlPartDefinitionName: "CoffeeMachine",
  });
  assertEquals(recipe.envelope, {
    semanticKey: "assembly-envelope",
    min: [-130, -160, -190],
    max: [130, 160, 190],
    unit: "mm",
  });
  assertEquals(
    recipe.components.map((component) => [
      component.semanticKey,
      component.geometryTemplate,
      Object.fromEntries(
        component.dimensions.map((parameter) => [
          parameter.semanticKey,
          parameter.value,
        ]),
      ),
      component.placement.translation.map((parameter) => parameter.value),
      component.placement.rotation.map((parameter) => parameter.value),
    ]),
    [
      [
        "enclosure",
        "enclosure-shell",
        { "size-x": 260, "size-y": 320, "size-z": 380, "wall-thickness": 3 },
        [0, 0, 0],
        [0, 0, 0],
      ],
      [
        "water-tank",
        "hollow-box",
        {
          "size-x": 90,
          "size-y": 90,
          "size-z": 230,
          "wall-thickness": 2.5,
        },
        [-75, 95, 45],
        [0, 0, 0],
      ],
      ["boiler", "cylinder", { diameter: 70, height: 150 }, [70, 35, 85], [0, 0, 0]],
      [
        "pump",
        "solid-box",
        { "size-x": 55, "size-y": 65, "size-z": 60 },
        [70, 95, -75],
        [0, 0, 0],
      ],
      [
        "brew-unit",
        "solid-box",
        { "size-x": 105, "size-y": 95, "size-z": 115 },
        [25, -65, -40],
        [0, 0, 0],
      ],
      [
        "control-pcb",
        "solid-box",
        { "size-x": 110, "size-y": 18, "size-z": 75 },
        [35, 145, 85],
        [0, 0, 0],
      ],
      [
        "power-supply",
        "solid-box",
        { "size-x": 95, "size-y": 75, "size-z": 55 },
        [-55, 70, -135],
        [0, 0, 0],
      ],
      [
        "temperature-sensor",
        "cylinder",
        { diameter: 12, height: 35 },
        [82, 25, 150],
        [0, 0, 0],
      ],
      [
        "user-interface",
        "solid-box",
        { "size-x": 145, "size-y": 18, "size-z": 55 },
        [0, -150, 125],
        [0, 0, 0],
      ],
      [
        "drip-tray",
        "solid-box",
        { "size-x": 190, "size-y": 135, "size-z": 28 },
        [0, -65, -170],
        [0, 0, 0],
      ],
    ],
  );
  assertEquals(Object.isFrozen(recipe), true);
  assertEquals(Object.isFrozen(recipe.components), true);
  assertEquals(Object.isFrozen(recipe.components[0]!.placement.translation), true);

  const serialized = JSON.stringify(recipe);
  assertEquals(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/.test(serialized),
    false,
  );
  assertEquals(serialized.includes("partUsageId"), false);
  assertEquals(serialized.includes("editingContextId"), false);
  assertEquals(serialized.includes("rootPartDefinitionId"), false);
  assertEquals(serialized.includes("coffee-machine-cm01"), false);
});

Deno.test("CM-01 semantic recipe rejects drift, provider identities and unreviewed fields", () => {
  const changedDimension = cloneRecipe();
  parameter(changedDimension, 9, "dimensions", 0).value = 191;
  assertThrows(
    () => parseCoffeeMachineCm01SemanticRecipe(changedDimension),
    Error,
    "$recipe.components[9].dimensions[0].value must equal 190.",
  );

  const alteredTemplate = cloneRecipe();
  component(alteredTemplate, 1).geometryTemplate = "solid-box";
  assertThrows(
    () => parseCoffeeMachineCm01SemanticRecipe(alteredTemplate),
    Error,
    '$recipe.components[1].geometryTemplate must equal "hollow-box".',
  );

  const reordered = cloneRecipe();
  const components = array(reordered.components);
  [components[0], components[1]] = [components[1], components[0]];
  assertThrows(
    () => parseCoffeeMachineCm01SemanticRecipe(reordered),
    Error,
    '$recipe.components[0].semanticKey must equal "enclosure".',
  );

  const providerIdentity = cloneRecipe();
  component(providerIdentity, 0).partUsageId = "provider-owned-identity";
  assertThrows(
    () => parseCoffeeMachineCm01SemanticRecipe(providerIdentity),
    Error,
    "$recipe.components[0] has unsupported field partUsageId.",
  );

  const unknownRootField = cloneRecipe();
  unknownRootField.editingContextId = "provider-owned-identity";
  assertThrows(
    () => parseCoffeeMachineCm01SemanticRecipe(unknownRootField),
    Error,
    "$recipe has unsupported field editingContextId.",
  );

  const wrongUnit = cloneRecipe();
  parameter(wrongUnit, 0, "placement.translation", 0).unit = "m";
  assertThrows(
    () => parseCoffeeMachineCm01SemanticRecipe(wrongUnit),
    Error,
    '$recipe.components[0].placement.translation[0].unit must equal "mm" or "deg".',
  );
});

Deno.test("CM-01 R2 recipe permits only the reviewed 30 mm DripTray correction", async () => {
  const corrected = cloneRecipe();
  corrected.schemaVersion = "coffee-machine-semantic-recipe/2.0";
  corrected.recipeKey = "cm01-drip-tray-height-30";
  parameter(corrected, 9, "dimensions", 2).value = 30;

  const recipe = parseCoffeeMachineCm01SemanticRecipeR2(corrected);
  assertEquals(recipe.schemaVersion, "coffee-machine-semantic-recipe/2.0");
  assertEquals(recipe.recipeKey, "cm01-drip-tray-height-30");
  assertEquals(recipe.components[9]?.dimensions[2]?.value, 30);
  assertEquals(Object.isFrozen(recipe), true);
  assertStringIncludes(
    renderCoffeeMachineCm01SysmlR2(recipe),
    "attribute sizeZ : Real = 30 [mm];",
  );
  assertEquals(
    (await fingerprintCoffeeMachineCm01SysmlR2(recipe)).digest ===
      (await fingerprintCoffeeMachineCm01Sysml(RECIPE)).digest,
    false,
  );

  const wrongHeight = structuredClone(corrected);
  parameter(wrongHeight, 9, "dimensions", 2).value = 29;
  assertThrows(
    () => parseCoffeeMachineCm01SemanticRecipeR2(wrongHeight),
    Error,
    "$recipe.components[9].dimensions[2].value must equal 30.",
  );

  const unrelatedDrift = structuredClone(corrected);
  parameter(unrelatedDrift, 0, "dimensions", 0).value = 261;
  assertThrows(
    () => parseCoffeeMachineCm01SemanticRecipeR2(unrelatedDrift),
    Error,
    "$recipe.components[0].dimensions[0].value must equal 260.",
  );
});

Deno.test("CM-01 SysML renderer emits one fixed byte-identical fragment", async () => {
  const first = renderCoffeeMachineCm01Sysml(RECIPE);
  const second = renderCoffeeMachineCm01Sysml(structuredClone(RECIPE));

  assertEquals(second, first);
  assertStringIncludes(first, "private import SI::*;");
  assertStringIncludes(first, "package CoffeeMachineCM01 {");
  assertStringIncludes(first, "part enclosure: Enclosure;");
  assertStringIncludes(first, "part dripTray: DripTray;");
  assertStringIncludes(first, "attribute wallThickness : Real = 2.5 [mm];");
  assertStringIncludes(first, "attribute positionZ : Real = -170 [mm];");
  assertStringIncludes(first, "attribute rotationZ : Real = 0 [deg];");
  assertEquals(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/.test(first),
    false,
  );
  assertEquals(first.includes("editing_context_id"), false);
  assertEquals(
    await fingerprintCoffeeMachineCm01Sysml(RECIPE),
    {
      algorithm: "sha256",
      digest: "c3e53bc85fcfa58434f3c8ddfaa569f6c7133d12d74d0268c90b498943fcc088",
    },
  );
});

function cloneRecipe(): Record<string, unknown> {
  return structuredClone(RECIPE);
}

function component(
  recipe: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  return object(array(recipe.components)[index]);
}

function parameter(
  recipe: Record<string, unknown>,
  componentIndex: number,
  path: "dimensions" | "placement.translation",
  parameterIndex: number,
): Record<string, unknown> {
  const target = component(recipe, componentIndex);
  if (path === "dimensions") {
    return object(array(target.dimensions)[parameterIndex]);
  }
  return object(array(object(target.placement).translation)[parameterIndex]);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("test fixture must be an object");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("test fixture must be an array");
  return value;
}
