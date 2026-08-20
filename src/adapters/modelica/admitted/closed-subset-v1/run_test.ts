import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { MODELICA_QUALIFIED_MODEL_SOURCE } from "../../qualified-kit/kit-v1/run.ts";
import {
  authorizeAdmittedModelicaSource,
  closedSubsetModelName,
  createAdmittedKit,
  createAdmittedSimulationRequest,
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

function rampSource(
  modelName: string,
  initialTemperature: number,
  heatingRate: number,
): string {
  return `model ${modelName}
  parameter Real initialTemperature(unit = "degC") = ${initialTemperature};
  parameter Real heatingRate(unit = "K/s") = ${heatingRate};
  output Real temperatureC(
    unit = "degC",
    start = initialTemperature,
    fixed = true);
equation
  der(temperatureC) = heatingRate;
end ${modelName};
`;
}

function rampCsv(
  initialTemperature: number,
  heatingRate: number,
): string {
  const rows = ['"time","temperatureC"'];
  for (let interval = 0; interval <= 20; interval += 1) {
    const time = interval / 10;
    rows.push(`${time},${initialTemperature + heatingRate * time}`);
  }
  return `${rows.join("\n")}\n`;
}

async function assertSourceDefaultsReachSimulation(
  source: string,
  expected: {
    readonly modelName: string;
    readonly initialTemperature: number;
    readonly heatingRate: number;
    readonly finalTemperature: number;
  },
): Promise<void> {
  const authorized = await authorizeAdmittedModelicaSource(
    new TextEncoder().encode(source),
  );
  const kit = createAdmittedKit(authorized);
  assertEquals(authorized.modelName, expected.modelName);
  assertEquals(authorized.parameterDefaults, {
    heatingRate: expected.heatingRate,
    initialTemperature: expected.initialTemperature,
  });
  assertEquals(
    kit.parameters.map((parameter) => [parameter.id, parameter.defaultValue]),
    [
      ["heating_rate", expected.heatingRate],
      ["initial_temperature", expected.initialTemperature],
    ],
  );
  assertEquals(createAdmittedSimulationRequest(kit), {
    model_id: kit.id,
    scenario_id: "linear-ramp-nominal",
    timeout_ms: 30_000,
  });
  assertEquals(
    kit.scenarios[0]?.targetTemperature,
    { value: expected.finalTemperature, unit: "degC" },
  );
  assertEquals(
    JSON.parse(kit.scenarios[0]!.source!).target_temperature,
    { unit: "degC", value: expected.finalTemperature },
  );
  assertEquals(
    kit.resultNormalizer.normalize(
      rampCsv(expected.initialTemperature, expected.heatingRate),
      kit.scenarios[0]!,
    ),
    {
      metrics: {
        temperature_final: { value: expected.finalTemperature, unit: "degC" },
      },
      warnings: [],
    },
  );
}

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
  assertEquals(variant.parameterDefaults, {
    heatingRate: 2,
    initialTemperature: 10,
  });
  assertEquals(kit.sha256 === variant.sha256, false);
  assertEquals(createAdmittedKit(variant).modelSource, VARIANT);
  assertEquals(createAdmittedKit(variant).modelName, "MyRamp");
});

Deno.test("admitted worker derives 10 and 2 from source and simulates temperature 14", async () => {
  await assertSourceDefaultsReachSimulation(VARIANT, {
    modelName: "MyRamp",
    initialTemperature: 10,
    heatingRate: 2,
    finalTemperature: 14,
  });
});

Deno.test("admitted worker derives a second source pair without reusing qualified-kit literals", async () => {
  await assertSourceDefaultsReachSimulation(rampSource("AnotherRamp", -5, 3), {
    modelName: "AnotherRamp",
    initialTemperature: -5,
    heatingRate: 3,
    finalTemperature: 1,
  });
});

Deno.test("admitted worker refuses a finite solver result that contradicts the source defaults", async () => {
  const authorized = await authorizeAdmittedModelicaSource(
    new TextEncoder().encode(VARIANT),
  );
  const kit = createAdmittedKit(authorized);
  assertThrows(
    () =>
      kit.resultNormalizer.normalize(
        rampCsv(10, 2).replace("2,14\n", "2,999\n"),
        kit.scenarios[0]!,
      ),
    TypeError,
    "does not match the exact admitted parameter defaults",
  );
});

Deno.test("admitted worker refuses malformed or incomplete solver CSV", async () => {
  const authorized = await authorizeAdmittedModelicaSource(
    new TextEncoder().encode(VARIANT),
  );
  const kit = createAdmittedKit(authorized);
  const scenario = kit.scenarios[0]!;
  for (
    const csv of [
      rampCsv(10, 2).replace('"time","temperatureC"', '"time","time","temperatureC"'),
      rampCsv(10, 2).replace("1,12\n", "1\n"),
      rampCsv(10, 2).replace("1.9,13.8\n", ""),
      rampCsv(10, 2).replace("2,14\n", "1.9,14\n"),
      rampCsv(10, 2).replace("0.1,10.2\n", "0,10.2\n"),
      rampCsv(10, 2).replace("1,12\n", "1,999\n"),
      (() => {
        const rows = ['"time","temperatureC"'];
        for (let interval = 0; interval <= 20; interval += 1) {
          const time = 2 * (interval / 20) ** 2;
          rows.push(`${time},${10 + 2 * time}`);
        }
        return `${rows.join("\n")}\n`;
      })(),
      rampCsv(10, 2).replace(/\n$/, ""),
    ]
  ) {
    assertThrows(
      () => kit.resultNormalizer.normalize(csv, scenario),
      TypeError,
    );
  }
});

Deno.test("admitted worker accepts one exact event duplicate on the admitted grid", async () => {
  const authorized = await authorizeAdmittedModelicaSource(
    new TextEncoder().encode(VARIANT),
  );
  const kit = createAdmittedKit(authorized);
  const csv = rampCsv(10, 2).replace("1,12\n", "1,12\n1,12\n");
  assertEquals(
    kit.resultNormalizer.normalize(csv, kit.scenarios[0]!),
    {
      metrics: { temperature_final: { value: 14, unit: "degC" } },
      warnings: [],
    },
  );
});

Deno.test("admitted worker bounds source size in UTF-8 bytes", async () => {
  const oversized = VARIANT.replace(
    "model MyRamp",
    `model MyRamp\n  // ${"é".repeat(131_000)}`,
  );
  assertEquals(oversized.length < 262_144, true);
  assertEquals(new TextEncoder().encode(oversized).byteLength > 262_144, true);
  await assertRejects(
    () => authorizeAdmittedModelicaSource(new TextEncoder().encode(oversized)),
    TypeError,
    "not a closed-subset UTF-8 model",
  );
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
  await assertRejects(
    () =>
      authorizeAdmittedModelicaSource(
        new TextEncoder().encode(
          VARIANT.replace('unit = "K/s"', 'unit = "m/s"'),
        ),
      ),
    TypeError,
    'expected "K/s"',
  );
  await assertRejects(
    () =>
      authorizeAdmittedModelicaSource(
        new TextEncoder().encode(
          VARIANT.replace("start = initialTemperature", "start = heatingRate"),
        ),
      ),
    TypeError,
    "does not match initialTemperature",
  );
});

Deno.test("closed-subset model name is the exact root model", () => {
  assertEquals(closedSubsetModelName(VARIANT), "MyRamp");
});
