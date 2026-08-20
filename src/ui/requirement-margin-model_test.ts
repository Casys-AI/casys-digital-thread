import { assertEquals } from "@std/assert";
import {
  marginLabel,
  requirementMargin,
} from "./src/project/requirement-margin-model.ts";

Deno.test("a margin says how much of the allowance a measurement consumes", () => {
  const margin = requirementMargin("maxDisplacement <= 2 mm", "0.5 mm");
  assertEquals(margin?.direction, "at-most");
  assertEquals(margin?.used, 0.25);
  assertEquals(marginLabel(margin!), "+75% margin");
});

Deno.test("a lower bound reads the other way round", () => {
  const margin = requirementMargin("firstMode >= 120 Hz", "150 Hz");
  assertEquals(margin?.direction, "at-least");
  assertEquals(marginLabel(margin!), "+25% margin");
});

Deno.test("an exceeded limit reports the overshoot instead of clamping to pass", () => {
  const margin = requirementMargin("maxVonMises <= 60 MPa", "72 MPa");
  assertEquals(margin?.used, 1);
  assertEquals(marginLabel(margin!), "-20% over");
});

Deno.test("mismatched units refuse a gauge rather than compare across scales", () => {
  // mm contre m se comparerait à 1000 près. Convertir serait interpréter une
  // physique que le cockpit n'a pas autorité pour interpréter.
  assertEquals(
    requirementMargin("maxDisplacement <= 2 mm", "0.5 m"),
    undefined,
  );
});

Deno.test("an unreadable constraint or measurement yields no gauge at all", () => {
  assertEquals(requirementMargin("holds under load", "0.5 mm"), undefined);
  assertEquals(requirementMargin("maxDisplacement <= 2 mm", "—"), undefined);
  assertEquals(requirementMargin("maxDisplacement <= 0 mm", "0 mm"), undefined);
});
