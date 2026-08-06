import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  type CoffeeMachineBuildComponent,
  type CoffeeMachineBuildPlanInput,
  type CoffeeMachineBuildTemplateId,
  compileCoffeeMachineBuildPlan,
  verifyCoffeeMachineBuildPlan,
} from "./coffee-machine-build-plan.ts";

Deno.test("CoffeeMachine build plan compiles deterministically without label matching", async () => {
  const first = await compileCoffeeMachineBuildPlan(planInput());
  const reordered = planInput();
  reordered.partUsageIds.reverse();
  reordered.sourceAttributes.reverse();
  reordered.components.reverse();
  for (const component of reordered.components) component.bindings.reverse();
  const second = await compileCoffeeMachineBuildPlan(reordered);

  assertEquals(second, first);
  assertEquals(first.plan.components.length, 10);
  assertEquals(first.plan.partUsageIds.length, 10);
  assertEquals(first.plan.fingerprints.source.digest, "a".repeat(64));
  assertEquals(first.plan.fingerprints.plan.digest.length, 64);
  assertEquals(first.plan.fingerprints.script.digest.length, 64);
  assertStringIncludes(
    first.script,
    'result = Compound(label="coffee-machine-cm01-build-v1", children=components)',
  );
  assertStringIncludes(first.script, "# component-0 <- part-usage-0");
  assertStringIncludes(first.script, 'shape_0.label = "component-0"');
  assertEquals(first.script.includes("eval("), false);
  assertEquals(first.script.includes("exec("), false);
});

Deno.test("persisted CoffeeMachine plan verifies both plan and script fingerprints", async () => {
  const compiled = await compileCoffeeMachineBuildPlan(planInput());
  assertEquals(await verifyCoffeeMachineBuildPlan(compiled.plan), compiled);

  const tampered = structuredClone(compiled.plan);
  const translationId = tampered.components[0].placement.translationAttributeIds[0];
  sourceAttribute(tampered, translationId).value += 1;
  await assertRejects(
    () => verifyCoffeeMachineBuildPlan(tampered),
    Error,
    "fingerprints.plan does not match",
  );
});

Deno.test("CoffeeMachine build plan rejects invalid dimensions and unit bindings", async () => {
  const negative = planInput();
  negative.sourceAttributes[0].value = -1;
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(negative),
    Error,
    "must be within 0.1..2000 mm",
  );

  const notFinite = planInput();
  notFinite.sourceAttributes[0].value = Number.NaN;
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(notFinite),
    Error,
    "must be a finite number",
  );

  const falseScale = planInput();
  falseScale.sourceAttributes[0].unitBinding.sourceUnit = "cm";
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(falseScale),
    Error,
    "scaleToTarget must be 10 for cm",
  );

  const wrongPoseUnit = planInput();
  const rotationId = wrongPoseUnit.components[0].placement.rotationAttributeIds[0];
  sourceAttribute(wrongPoseUnit, rotationId).unitBinding = {
    sourceUnit: "mm",
    targetUnit: "mm",
    scaleToTarget: 1,
  };
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(wrongPoseUnit),
    Error,
    "must bind an angle attribute targeting deg",
  );
});

Deno.test("CoffeeMachine build plan rejects missing and duplicate exact identities", async () => {
  const missingAttribute = planInput();
  const referencedId = missingAttribute.components[0].bindings[0].attributeId;
  missingAttribute.sourceAttributes = missingAttribute.sourceAttributes.filter(
    (attribute) => attribute.id !== referencedId,
  );
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(missingAttribute),
    Error,
    "references missing attribute",
  );

  const missingPoseAttribute = planInput();
  const poseAttributeId = missingPoseAttribute.components[0].placement
    .translationAttributeIds[0];
  missingPoseAttribute.sourceAttributes = missingPoseAttribute.sourceAttributes.filter(
    (attribute) => attribute.id !== poseAttributeId,
  );
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(missingPoseAttribute),
    Error,
    "placement translation axis 0 references missing attribute",
  );

  const duplicatePartUsage = planInput();
  duplicatePartUsage.partUsageIds[1] = duplicatePartUsage.partUsageIds[0];
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(duplicatePartUsage),
    Error,
    "contains duplicate ids",
  );

  const duplicateComponent = planInput();
  duplicateComponent.components[1].id = duplicateComponent.components[0].id;
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(duplicateComponent),
    Error,
    "components ids contains duplicate ids",
  );

  const unknownPartUsage = planInput();
  unknownPartUsage.components[0].partUsageId = "not-declared";
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(unknownPartUsage),
    Error,
    "is not declared by the source read",
  );
});

Deno.test("CoffeeMachine build plan rejects incomplete templates and unsafe extra fields", async () => {
  const missingBinding = planInput();
  missingBinding.components[0].bindings.pop();
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(missingBinding),
    Error,
    "bindings must contain exactly",
  );

  const arbitraryPython = planInput() as CoffeeMachineBuildPlanInput & {
    script: string;
  };
  arbitraryPython.script = "import os";
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(arbitraryPython),
    Error,
    "unsupported field script",
  );
});

Deno.test("CoffeeMachine build plan rejects components outside the envelope", async () => {
  const outside = planInput();
  const outsideTranslationId = outside.components[0].placement
    .translationAttributeIds[0];
  sourceAttribute(outside, outsideTranslationId).value = 490;
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(outside),
    Error,
    "lies outside envelope on axis 0",
  );

  const invalidRotation = planInput();
  const invalidRotationId = invalidRotation.components[0].placement
    .rotationAttributeIds[0];
  sourceAttribute(invalidRotation, invalidRotationId).value = 45;
  await assertRejects(
    () => compileCoffeeMachineBuildPlan(invalidRotation),
    Error,
    "must resolve to a multiple of 90 deg",
  );
});

const COMPONENTS: Array<{
  templateId: CoffeeMachineBuildTemplateId;
  values: Record<string, number>;
  translationMm: [number, number, number];
  rotationDeg?: [number, number, number];
}> = [
  {
    templateId: "enclosure-shell-v1",
    values: { size_x: 300, size_y: 250, size_z: 400, wall_thickness: 3 },
    translationMm: [0, 0, 0],
  },
  {
    templateId: "hollow-box-v1",
    values: { size_x: 100, size_y: 80, size_z: 90, wall_thickness: 2 },
    translationMm: [-180, -150, -120],
  },
  {
    templateId: "solid-box-v1",
    values: { size_x: 60, size_y: 50, size_z: 40 },
    translationMm: [180, -150, -120],
  },
  {
    templateId: "cylinder-v1",
    values: { diameter: 80, height: 100 },
    translationMm: [-180, 150, -120],
  },
  {
    templateId: "thin-panel-v1",
    values: { size_x: 100, size_y: 70, thickness: 2 },
    translationMm: [180, 150, -120],
    rotationDeg: [-90, 0, 0],
  },
  {
    templateId: "tray-v1",
    values: { size_x: 120, size_y: 90, size_z: 24, wall_thickness: 2 },
    translationMm: [-180, -150, 140],
  },
  {
    templateId: "solid-box-v1",
    values: { size_x: 80, size_y: 40, size_z: 25 },
    translationMm: [180, -150, 140],
  },
  {
    templateId: "cylinder-v1",
    values: { diameter: 50, height: 70 },
    translationMm: [-180, 150, 140],
    rotationDeg: [0, 90, 0],
  },
  {
    templateId: "thin-panel-v1",
    values: { size_x: 90, size_y: 50, thickness: 3 },
    translationMm: [180, 150, 140],
  },
  {
    templateId: "hollow-box-v1",
    values: { size_x: 70, size_y: 60, size_z: 80, wall_thickness: 2 },
    translationMm: [0, 0, 250],
  },
];

function planInput(): CoffeeMachineBuildPlanInput {
  const sourceAttributes: CoffeeMachineBuildPlanInput["sourceAttributes"] = [];
  const components: CoffeeMachineBuildComponent[] = COMPONENTS.map(
    (definition, index) => {
      const bindings = Object.entries(definition.values).map(
        ([parameter, value], parameterIndex) => {
          const attributeId = `attribute-${index}-${parameterIndex}`;
          sourceAttributes.push({
            id: attributeId,
            value,
            unitBinding: {
              sourceUnit: "mm",
              targetUnit: "mm",
              scaleToTarget: 1,
            },
          });
          return { parameter, attributeId };
        },
      );
      const translationAttributeIds = definition.translationMm.map((value, axis) => {
        const attributeId = `translation-${index}-${axis}`;
        sourceAttributes.push({
          id: attributeId,
          value,
          unitBinding: {
            sourceUnit: "mm",
            targetUnit: "mm",
            scaleToTarget: 1,
          },
        });
        return attributeId;
      }) as [string, string, string];
      const rotationAttributeIds = (definition.rotationDeg ?? [0, 0, 0]).map(
        (value, axis) => {
          const attributeId = `rotation-${index}-${axis}`;
          sourceAttributes.push({
            id: attributeId,
            value,
            unitBinding: {
              sourceUnit: "deg",
              targetUnit: "deg",
              scaleToTarget: 1,
            },
          });
          return attributeId;
        },
      ) as [string, string, string];
      return {
        id: `component-${index}`,
        partUsageId: `part-usage-${index}`,
        templateId: definition.templateId,
        bindings,
        placement: {
          translationAttributeIds,
          rotationAttributeIds,
        },
      };
    },
  );
  return {
    schemaVersion: "coffee-machine-build-plan/1.0",
    id: "coffee-machine-cm01-build-v1",
    editingContextId: "01942665-3ded-4d3a-9902-08691eae190e",
    rootPartDefinitionId: "c83e2a8d-82ca-4882-8451-82cfc6e3a3c1",
    sourceFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    partUsageIds: COMPONENTS.map((_definition, index) => `part-usage-${index}`),
    sourceAttributes,
    envelopeMm: { min: [-500, -500, -500], max: [500, 500, 500] },
    components,
  };
}

function sourceAttribute(
  plan: CoffeeMachineBuildPlanInput,
  id: string,
): CoffeeMachineBuildPlanInput["sourceAttributes"][number] {
  const attribute = plan.sourceAttributes.find((candidate) => candidate.id === id);
  if (!attribute) throw new Error(`Test fixture is missing ${id}.`);
  return attribute;
}
