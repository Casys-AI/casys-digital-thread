import { assertEquals, assertThrows } from "@std/assert";
import {
  authorizeModelicaClosedSubsetV2Source,
  MODELICA_CLOSED_SUBSET_V2_PROFILE_ID,
} from "./closed-subset-v2.ts";

export const GENERIC_MODEL = `model GenericOscillator
  parameter Real initialPosition(unit = "m") = 0;
  parameter Real drive(unit = "m/s2") = 2;
  output Real position(unit = "m", start = initialPosition, fixed = true);
  output Real velocity(unit = "m/s", start = 0, fixed = true);
equation
  der(position) = velocity;
  der(velocity) = drive-position;
annotation(experiment(StartTime = 0, StopTime = 2, Interval = 0.1, Tolerance = 0.000001));
end GenericOscillator;
`;

Deno.test("generic closed-subset v2 authorizes model IR and exact signed experiment", () => {
  const authorized = authorizeModelicaClosedSubsetV2Source(GENERIC_MODEL);
  assertEquals(MODELICA_CLOSED_SUBSET_V2_PROFILE_ID, "modelica-closed-subset-v2");
  assertEquals(authorized.modelName, "GenericOscillator");
  assertEquals(authorized.parameters.map((node) => node.name), [
    "initialPosition",
    "drive",
  ]);
  assertEquals(authorized.outputs.map((node) => node.name), ["position", "velocity"]);
  assertEquals(authorized.equations.map((node) => node.discriminator), ["der", "der"]);
  assertEquals(authorized.scenario, {
    startTimeS: 0,
    stopTimeS: 2,
    intervalS: 0.1,
    tolerance: 0.000001,
    numberOfIntervals: 20,
  });
});

Deno.test("generic closed-subset v2 accepts a mixed derivative and algebraic output set", () => {
  const authorized = authorizeModelicaClosedSubsetV2Source(
    GENERIC_MODEL.replace("der(velocity)", "velocity"),
  );
  assertEquals(authorized.equations.map((node) => node.discriminator), [
    "der",
    "algebraic",
  ]);
});

Deno.test("generic closed-subset v2 rejects unbound RHS and incomplete annotations", () => {
  for (
    const source of [
      GENERIC_MODEL.replace("drive-position", "unknown-position"),
      GENERIC_MODEL.replace(", Tolerance = 0.000001", ""),
      GENERIC_MODEL.replace("der(position)", "position").replace(
        "der(velocity)",
        "velocity",
      ),
      GENERIC_MODEL.replace("Interval = 0.1", "Interval = 0.13"),
    ]
  ) {
    assertThrows(() => authorizeModelicaClosedSubsetV2Source(source), TypeError);
  }
});

Deno.test("generic closed-subset v2 requires exact signed decimal experiment grids", () => {
  const exact = authorizeModelicaClosedSubsetV2Source(
    GENERIC_MODEL.replace(
      "StartTime = 0, StopTime = 2, Interval = 0.1",
      "StartTime = -0.1, StopTime = 0.2, Interval = 0.03",
    ),
  );
  assertEquals(exact.scenario.numberOfIntervals, 10);
  assertThrows(
    () =>
      authorizeModelicaClosedSubsetV2Source(
        GENERIC_MODEL.replace(
          "StartTime = 0, StopTime = 2, Interval = 0.1",
          "StartTime = 0, StopTime = 10, Interval = 0.9999999999999999",
        ),
      ),
    TypeError,
    "exact grid intervals",
  );
});

Deno.test("generic closed-subset v2 rejects cross-kind names and unsafe units", () => {
  assertThrows(
    () =>
      authorizeModelicaClosedSubsetV2Source(
        GENERIC_MODEL.replace("output Real position", "output Real drive"),
      ),
    TypeError,
    "must not collide",
  );
  assertThrows(
    () =>
      authorizeModelicaClosedSubsetV2Source(
        GENERIC_MODEL.replace('unit = "m/s2"', 'unit = "m s2"'),
      ),
    TypeError,
    "invalid unit",
  );
});

Deno.test("generic closed-subset v2 rejects an equation LHS outside indexed outputs", () => {
  assertThrows(
    () =>
      authorizeModelicaClosedSubsetV2Source(
        GENERIC_MODEL.replace("der(position)", "der(drive)"),
      ),
    TypeError,
    "equations may only target declared outputs",
  );
});
