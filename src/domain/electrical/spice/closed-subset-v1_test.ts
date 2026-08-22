import { assertEquals, assertThrows } from "@std/assert";
import {
  authorizeSpiceCircuitClosedSubsetV1Source,
  SPICE_CIRCUIT_CLOSED_SUBSET_V1_PROFILE_ID,
} from "./closed-subset-v1.ts";

export const GENERIC_CLAMP = [
  "* generic series clamp",
  "Vsupply vin 0 DC 5",
  "Rseries vin nmid {rseries}",
  "Cshunt nmid 0 100n",
  "Dclamp nmid 0 clamp",
  ".param rseries=330",
  ".model clamp D(Is=1e-14 N=1.8)",
  "",
].join("\n");

Deno.test("generic closed-subset v1 authorizes circuit IR and named .param levers only", () => {
  const authorized = authorizeSpiceCircuitClosedSubsetV1Source(GENERIC_CLAMP);
  assertEquals(
    SPICE_CIRCUIT_CLOSED_SUBSET_V1_PROFILE_ID,
    "spice-circuit-closed-subset-v1",
  );
  assertEquals(authorized.circuitName, "circuit");
  assertEquals(authorized.parameters.map((parameter) => parameter.name), [
    "rseries",
  ]);
  assertEquals(authorized.elements.map((element) => element.name), [
    "Vsupply",
    "Rseries",
    "Cshunt",
    "Dclamp",
  ]);
  assertEquals(authorized.nodes, ["vin", "0", "nmid"]);
  assertEquals(authorized.sourceText, GENERIC_CLAMP);
});

Deno.test("ordinary numeric netlist without .param is admissible", () => {
  const authorized = authorizeSpiceCircuitClosedSubsetV1Source(
    "Vin in 0 5\nRload in 0 1k\n",
  );
  assertEquals(authorized.parameters, []);
  assertEquals(authorized.elements.map((element) => element.name), ["Vin", "Rload"]);
});

Deno.test("device literals and model-card numbers are not named levers", () => {
  const authorized = authorizeSpiceCircuitClosedSubsetV1Source(GENERIC_CLAMP);
  assertEquals(authorized.parameters.length, 1);
  assertEquals(authorized.parameters[0]?.value.value, 330);
  assertEquals(
    authorized.elements.some((element) =>
      element.value?.kind === "number" && element.name === "Cshunt"
    ),
    true,
  );
});

Deno.test("closed-subset v1 authorizes declared inductor coupling", () => {
  const authorized = authorizeSpiceCircuitClosedSubsetV1Source(
    "Lpri a 0 1m\nLsec b 0 1m\nK1 Lpri Lsec 0.9\n",
  );
  assertEquals(authorized.elements.map((element) => element.type), ["L", "L", "K"]);
});

Deno.test("closed-subset v1 rejects unbound {param}, unknown models, and duplicate names", () => {
  for (
    const source of [
      "Vin in 0 5\nRload in 0 {missing}\n",
      "Vin in 0 5\nD1 in 0 unknown\n",
      "Vin in 0 5\nvin in 0 3\nRload in 0 1k\n",
      "K1 Lpri Lsec 0.9\n",
      "M1 2 1 0 0 nch L=1u\n.model nch D\nVin 1 0 5\n",
    ]
  ) {
    assertThrows(() => authorizeSpiceCircuitClosedSubsetV1Source(source), TypeError);
  }
});

Deno.test("closed-subset v1 rejects empty, NUL, and analysis-owned commands", () => {
  assertThrows(() => authorizeSpiceCircuitClosedSubsetV1Source(""), TypeError);
  assertThrows(
    () => authorizeSpiceCircuitClosedSubsetV1Source("R1 1 0 1k\0"),
    TypeError,
  );
  assertThrows(
    () => authorizeSpiceCircuitClosedSubsetV1Source("R1 1 0 1k\n.op\n.end\n"),
    TypeError,
  );
});
