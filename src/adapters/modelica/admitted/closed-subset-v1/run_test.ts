import { assertEquals, assertRejects } from "@std/assert";
import { MODELICA_QUALIFIED_MODEL_SOURCE } from "../../qualified-kit/kit-v1/run.ts";
import {
  authorizeAdmittedModelicaSource,
  closedSubsetModelName,
  createAdmittedKit,
} from "./run.ts";

const VARIANT = `model MyRamp
  parameter Real initialTemperature(unit = "degC") = 10;
  parameter Real heatingRate(unit = "K/s") = 2;
  output Real temperatureC(
    unit = "degC",
    start = initialTemperature,
    fixed = true);
equation
  der(temperatureC) = heatingRate;
end MyRamp;
`;

Deno.test("admitted worker authorizes the kit form and a different LinearThermalRamp-form source", async () => {
  const kit = await authorizeAdmittedModelicaSource(
    new TextEncoder().encode(MODELICA_QUALIFIED_MODEL_SOURCE),
  );
  assertEquals(kit.modelName, "LinearThermalRamp");
  const variant = await authorizeAdmittedModelicaSource(
    new TextEncoder().encode(VARIANT),
  );
  assertEquals(variant.modelName, "MyRamp");
  assertEquals(variant.source, VARIANT);
  assertEquals(kit.sha256 === variant.sha256, false);
  assertEquals(createAdmittedKit(variant).modelSource, VARIANT);
  assertEquals(createAdmittedKit(variant).modelName, "MyRamp");
});

Deno.test("admitted worker refuses a source outside the LinearThermalRamp form", async () => {
  await assertRejects(
    () =>
      authorizeAdmittedModelicaSource(
        new TextEncoder().encode("model X\nend X;\n"),
      ),
    TypeError,
    "LinearThermalRamp form",
  );
  await assertRejects(
    () =>
      authorizeAdmittedModelicaSource(
        new TextEncoder().encode(VARIANT.replace("der(temperatureC)", "der(x)")),
      ),
    TypeError,
    "LinearThermalRamp form",
  );
});

Deno.test("closed-subset model name is the exact root model", () => {
  assertEquals(closedSubsetModelName(VARIANT), "MyRamp");
});
