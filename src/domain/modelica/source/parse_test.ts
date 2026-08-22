import { assertEquals, assertThrows } from "@std/assert";
import { authorizeModelicaClosedSubsetV2Source } from "./closed-subset-v2.ts";
import { ModelicaParseError, parseModelicaSubset } from "./parse.ts";

function modelWithRhs(rhs: string): string {
  return `model GenericOscillator
  parameter Real initialPosition(unit = "m") = 0;
  parameter Real drive(unit = "m/s2") = 2;
  output Real position(unit = "m", start = initialPosition, fixed = true);
  output Real velocity(unit = "m/s", start = 0, fixed = true);
equation
  der(position) = velocity;
  der(velocity) = ${rhs};
annotation(experiment(StartTime = 0, StopTime = 2, Interval = 0.1, Tolerance = 0.000001));
end GenericOscillator;
`;
}

function parsedRhsNames(rhs: string): readonly string[] {
  const equation = parseModelicaSubset(modelWithRhs(rhs)).model.equations.find(
    (node) => node.lhsName === "velocity",
  );
  if (equation === undefined) {
    throw new Error("expected velocity equation");
  }
  return equation.rhsNames;
}

Deno.test("closed-subset v2 RHS parse accepts mixed arithmetic and one unary sign", () => {
  assertEquals(parsedRhsNames("a+b*c"), ["a", "b", "c"]);
  assertEquals(parsedRhsNames("(a+b)*c"), ["a", "b", "c"]);
  assertEquals(parsedRhsNames("a+-b"), ["a", "b"]);
  assertEquals(parsedRhsNames("(+x)"), ["x"]);
});

Deno.test("closed-subset v2 RHS parse rejects empty, unmatched, trailing, and unary chains", () => {
  for (const rhs of ["()", "x)", "x+", "--x"]) {
    assertThrows(() => parseModelicaSubset(modelWithRhs(rhs)), ModelicaParseError);
    assertThrows(
      () => authorizeModelicaClosedSubsetV2Source(modelWithRhs(rhs)),
      TypeError,
    );
  }
});

Deno.test("closed-subset v2 authorizes 8192 balanced RHS parentheses", () => {
  const depth = 8192;
  const authorized = authorizeModelicaClosedSubsetV2Source(
    modelWithRhs(`${"(".repeat(depth)}drive-position${")".repeat(depth)}`),
  );
  assertEquals(
    authorized.equations.find((node) => node.lhsName === "velocity")?.rhsNames,
    ["drive", "position"],
  );
});

Deno.test("closed-subset v2 unclosed 8192 RHS parentheses fail TypeError not RangeError", () => {
  const depth = 8192;
  let thrown: unknown;
  try {
    authorizeModelicaClosedSubsetV2Source(
      modelWithRhs(`${"(".repeat(depth)}drive-position`),
    );
  } catch (error) {
    thrown = error;
  }
  assertEquals(thrown instanceof TypeError, true);
  assertEquals(thrown instanceof RangeError, false);
});

Deno.test("closed-subset v2 parses ~200k ASCII source below the adapter byte cap", () => {
  const source = modelWithRhs(`drive-position${"+0".repeat(99_800)}`);
  assertEquals(source.length > 200_000, true);
  assertEquals(source.length < 262_144, true);
  const authorized = authorizeModelicaClosedSubsetV2Source(source);
  assertEquals(
    authorized.equations.find((node) => node.lhsName === "velocity")?.rhsNames,
    ["drive", "position"],
  );
});
