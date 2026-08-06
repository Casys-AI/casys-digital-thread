import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  compileCoffeeMachineCm01SemanticCadPlan,
  compileCoffeeMachineCm01SemanticCadPlanR2,
} from "./coffee-machine-cm01-semantic-cad-plan.ts";
import {
  parseCoffeeMachineCm01SemanticRecipe,
  parseCoffeeMachineCm01SemanticRecipeR2,
} from "./coffee-machine-cm01-semantic-recipe.ts";

const RECIPE_URL = new URL(
  "../../../config/product-recipes/coffee-machine-cm01-v1.json",
  import.meta.url,
);
const RECIPE = JSON.parse(await Deno.readTextFile(RECIPE_URL)) as Record<
  string,
  unknown
>;

Deno.test("CM-01 semantic CAD plan compiles the reviewed ten-component geometry deterministically", async () => {
  const first = await compileCoffeeMachineCm01SemanticCadPlan(
    parseCoffeeMachineCm01SemanticRecipe(RECIPE),
  );
  const second = await compileCoffeeMachineCm01SemanticCadPlan(
    parseCoffeeMachineCm01SemanticRecipe(structuredClone(RECIPE)),
  );

  assertEquals(second, first);
  assertEquals(first.plan.schemaVersion, "coffee-machine-cm01-semantic-cad-plan/1.0");
  assertEquals(first.plan.recipe.key, "cm01-golden");
  assertEquals(
    first.plan.geometry.components.map((component) => component.semanticKey),
    [
      "enclosure",
      "water-tank",
      "boiler",
      "pump",
      "brew-unit",
      "control-pcb",
      "power-supply",
      "temperature-sensor",
      "user-interface",
      "drip-tray",
    ],
  );
  assertEquals(first.plan.artifacts.map((artifact) => artifact.role), [
    "cad-plan",
    "cad-script",
  ]);
  assertEquals(first.plan.build123d, {
    tool: "build123d_export",
    exportFormats: ["step", "gltf", "stl"],
    exportName: "coffee-machine-cm01-v3",
    scriptArtifactRole: "cad-script",
  });
  assertEquals(first.plan.artifacts[0].fingerprint.digest.length, 64);
  assertEquals(first.plan.artifacts[1].fingerprint.digest.length, 64);
  assertEquals(Object.isFrozen(first.plan), true);
  assertEquals(Object.isFrozen(first.plan.geometry.components), true);
});

Deno.test("CM-01 semantic CAD script is a fixed build123d handoff, not editable provider input", async () => {
  const compiled = await compileCoffeeMachineCm01SemanticCadPlan(
    parseCoffeeMachineCm01SemanticRecipe(RECIPE),
  );

  assertStringIncludes(
    compiled.script,
    "from build123d import Align, Box, Compound, Cylinder, Pos, Rot",
  );
  assertStringIncludes(compiled.script, "# enclosure");
  assertStringIncludes(compiled.script, "# drip-tray");
  assertStringIncludes(compiled.script, 'shape_0.label = "enclosure"');
  assertStringIncludes(
    compiled.script,
    'result = Compound(label="coffee-machine-cm01-v3", children=components)',
  );
  assertEquals(compiled.script.includes("eval("), false);
  assertEquals(compiled.script.includes("exec("), false);
  assertEquals(compiled.script.includes("editingContextId"), false);
  assertEquals(compiled.script.includes("partUsageId"), false);
  assertEquals(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/.test(
      compiled.script,
    ),
    false,
  );
});

Deno.test("CM-01 semantic CAD plan fingerprints change with reviewed recipe content", async () => {
  const baseline = await compileCoffeeMachineCm01SemanticCadPlan(
    parseCoffeeMachineCm01SemanticRecipe(RECIPE),
  );
  const changed = structuredClone(RECIPE);
  const components = changed.components as Array<Record<string, unknown>>;
  const dimensions = components[0].dimensions as Array<Record<string, unknown>>;
  dimensions[0].value = 261;

  let failure: unknown;
  try {
    await compileCoffeeMachineCm01SemanticCadPlan(
      parseCoffeeMachineCm01SemanticRecipe(changed),
    );
  } catch (error) {
    failure = error;
  }
  assertEquals(failure instanceof Error, true);
  assertEquals(
    (failure as Error).message,
    "$recipe.components[0].dimensions[0].value must equal 260.",
  );
  assertEquals(baseline.plan.recipe.fingerprint.algorithm, "sha256");
});

Deno.test("CM-01 R2 CAD plan is the closed 30 mm DripTray successor", async () => {
  const corrected = structuredClone(RECIPE);
  corrected.schemaVersion = "coffee-machine-semantic-recipe/2.0";
  corrected.recipeKey = "cm01-drip-tray-height-30";
  const components = corrected.components as Array<Record<string, unknown>>;
  const dimensions = components[9]!.dimensions as Array<Record<string, unknown>>;
  dimensions[2]!.value = 30;

  const compiled = await compileCoffeeMachineCm01SemanticCadPlanR2(
    parseCoffeeMachineCm01SemanticRecipeR2(corrected),
  );
  assertEquals(compiled.plan.recipe, {
    schemaVersion: "coffee-machine-semantic-recipe/2.0",
    key: "cm01-drip-tray-height-30",
    fingerprint: compiled.plan.recipe.fingerprint,
  });
  assertEquals(compiled.plan.build123d.exportName, "coffee-machine-cm01-v3-r2");
  assertEquals(
    compiled.plan.geometry.components[9]?.dimensionsMm["size-z"],
    30,
  );
  assertStringIncludes(
    compiled.script,
    "shape_9 = Box(190, 135, 30, align=(Align.CENTER, Align.CENTER, Align.CENTER))",
  );
  assertStringIncludes(
    compiled.script,
    'result = Compound(label="coffee-machine-cm01-v3-r2", children=components)',
  );
});

Deno.test("CM-01 semantic CAD plan refuses a raw JSON object", async () => {
  let failure: unknown;
  try {
    await compileCoffeeMachineCm01SemanticCadPlan(
      RECIPE as unknown as ReturnType<typeof parseCoffeeMachineCm01SemanticRecipe>,
    );
  } catch (error) {
    failure = error;
  }
  assertEquals(
    (failure as Error).message,
    "CM-01 semantic CAD compilation requires a parsed frozen semantic recipe.",
  );
});
