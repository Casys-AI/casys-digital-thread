import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  admittedOutputVariableFilter,
  admittedScenarioFor,
  authorizeAdmittedModelicaSource,
  normalizeAdmittedResult,
} from "./run.ts";

const SOURCE = `model GenericMotion
  parameter Real initialPosition(unit = "m") = 1;
  parameter Real drive(unit = "m/s2") = 2;
  output Real position(unit = "m", start = initialPosition, fixed = true);
  output Real velocity(unit = "m/s", start = 0, fixed = true);
equation
  der(position) = velocity;
  der(velocity) = drive-position;
annotation(experiment(StartTime = 0, StopTime = 2, Interval = 0.1, Tolerance = 0.000001));
end GenericMotion;
`;

Deno.test("generic v2 worker preserves the signed scenario and source identity", async () => {
  const authorized = await authorizeAdmittedModelicaSource(
    new TextEncoder().encode(SOURCE),
  );
  assertEquals(authorized.source.modelName, "GenericMotion");
  assertEquals(authorized.byteCount, new TextEncoder().encode(SOURCE).byteLength);
  assertEquals(admittedScenarioFor(authorized.source), {
    startTimeS: 0,
    stopTimeS: 2,
    intervalS: 0.1,
    tolerance: 0.000001,
    numberOfIntervals: 20,
    solver: "dassl",
  });
  assertEquals(
    admittedOutputVariableFilter(authorized.source),
    "^(?:position|velocity)$",
  );
});

Deno.test("generic v2 worker validates output columns, grid, finite starts and metrics", async () => {
  const authorized = await authorizeAdmittedModelicaSource(
    new TextEncoder().encode(SOURCE),
  );
  const rows = ['"der(position)","velocity","time","position","der(velocity)"'];
  for (let index = 0; index <= 20; index += 1) {
    const time = index / 10;
    rows.push(`${time},${time},${time},${1 + time},${2 - time}`);
  }
  const csv = `${rows.join("\n")}\n`;
  assertEquals(normalizeAdmittedResult(csv, authorized.source), [
    { outputName: "position", statistic: "final", value: 3, unit: "m" },
    { outputName: "position", statistic: "max_abs", value: 3, unit: "m" },
    { outputName: "velocity", statistic: "final", value: 2, unit: "m/s" },
    { outputName: "velocity", statistic: "max_abs", value: 2, unit: "m/s" },
  ]);
  assertThrows(
    () =>
      normalizeAdmittedResult(
        csv.replace('"der(velocity)"', '"arbitrary"'),
        authorized.source,
      ),
    TypeError,
  );
  assertThrows(
    () =>
      normalizeAdmittedResult(csv.replace("0,0,0,1,2", "0,0,0,2,2"), authorized.source),
    TypeError,
  );
});

Deno.test("generic v2 worker rejects non UTF-8 bytes", async () => {
  await assertRejects(
    () => authorizeAdmittedModelicaSource(Uint8Array.of(0xff)),
    TypeError,
  );
});
