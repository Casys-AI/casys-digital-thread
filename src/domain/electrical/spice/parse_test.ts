import { assertEquals, assertThrows } from "@std/assert";
import { SpiceLexicalError, spiceNumberValue } from "./lexical.ts";
import { parseSpiceCircuitSubset } from "./parse.ts";

const GENERIC_CIRCUIT = [
  "* series clamp",
  "Vsupply vin 0 DC 5",
  "Rseries vin nmid {rseries}",
  "Cshunt nmid 0 100n",
  "Dclamp nmid 0 clamp",
  ".param rseries=330",
  ".model clamp D(Is=1e-14 N=1.8)",
  "",
].join("\n");

Deno.test("circuit-only SPICE parser accepts generic elements, comments, .param and .model", () => {
  const parsed = parseSpiceCircuitSubset(GENERIC_CIRCUIT);
  assertEquals(parsed.circuit.elements.map((element) => element.name), [
    "Vsupply",
    "Rseries",
    "Cshunt",
    "Dclamp",
  ]);
  assertEquals(parsed.circuit.parameters.map((parameter) => parameter.name), [
    "rseries",
  ]);
  assertEquals(parsed.circuit.models.map((model) => model.name), ["clamp"]);
  assertEquals(parsed.circuit.elements[1]?.value, {
    kind: "param-ref",
    name: "rseries",
    span: parsed.circuit.elements[1]!.value!.span,
  });
});

Deno.test("circuit-only SPICE parser joins plus-continuations into one .model", () => {
  const parsed = parseSpiceCircuitSubset([
    "Rload out 0 1k",
    "Vsrc in 0 5",
    ".model clamp D",
    "+ (Is=1e-14 N=2)",
    "",
  ].join("\n"));
  assertEquals(parsed.circuit.models[0]?.parameters.map((item) => item.name), [
    "Is",
    "N",
  ]);
});

Deno.test("circuit-only SPICE parser accepts integer nodes, MOSFET L/W, and BJT 3-terminal form", () => {
  const parsed = parseSpiceCircuitSubset([
    "Vin 1 0 DC 3.3",
    "Msw 2 1 0 0 nch L=1u W={width}",
    "Qdrv 2 1 0 npnmod",
    ".param width=20u",
    ".model nch NMOS(Vto=0.7)",
    ".model npnmod NPN(Bf=100)",
    "",
  ].join("\n"));
  assertEquals(parsed.circuit.elements[1]?.nodes.map((node) => node.name), [
    "2",
    "1",
    "0",
    "0",
  ]);
  assertEquals(parsed.circuit.elements[1]?.namedValues[1]?.value.kind, "param-ref");
  assertEquals(parsed.circuit.elements[2]?.nodes.map((node) => node.name), [
    "2",
    "1",
    "0",
  ]);
  assertEquals(parsed.circuit.elements[2]?.modelName, "npnmod");
});

Deno.test("SPICE closed-subset numbers accept one scale suffix and reject trailing junk", () => {
  assertEquals(spiceNumberValue("1k"), 1000);
  assertEquals(spiceNumberValue("100n"), 100 * 1e-9);
  assertEquals(spiceNumberValue("1MEG"), 1e6);
  assertEquals(spiceNumberValue("1e-14"), 1e-14);
  assertEquals(spiceNumberValue(".5"), 0.5);
  assertThrows(() => spiceNumberValue("1kOhm"), SpiceLexicalError);
  assertThrows(() => spiceNumberValue("1x"), SpiceLexicalError);
});

Deno.test("circuit-only SPICE parser accepts comments, leading decimals, I sources and coupling", () => {
  const parsed = parseSpiceCircuitSubset([
    "Isrc nmid 0 DC 2m $ bias",
    "Rload nmid 0 .5 ; ohm",
    "Lpri a 0 1m",
    "Lsec b 0 1m",
    "Kcouple Lpri Lsec 0.9",
    "",
  ].join("\n"));
  assertEquals(parsed.circuit.elements.map((element) => element.type), [
    "I",
    "R",
    "L",
    "L",
    "K",
  ]);
  assertEquals(parsed.circuit.elements[1]?.value, {
    kind: "number",
    spelling: ".5",
    value: 0.5,
    span: parsed.circuit.elements[1]!.value!.span,
  });
  assertEquals(parsed.circuit.elements[4]?.inductorNames, ["Lpri", "Lsec"]);
});

Deno.test("circuit-only SPICE parser rejects analysis, include, control, and behavioral forms", () => {
  const accepted = GENERIC_CIRCUIT;
  for (
    const source of [
      `${accepted}.op\n`,
      `${accepted}.end\n`,
      `${accepted}.tran 1n 1u\n`,
      `${accepted}.ac lin 1 1 1\n`,
      `${accepted}.dc Vin 0 5 0.1\n`,
      `${accepted}.inc models.lib\n`,
      `${accepted}.include models.lib\n`,
      `${accepted}.lib /usr/share/ngspice/foo.lib\n`,
      `${accepted}.control\nop\n.endc\n`,
      `${accepted}.shell ls\n`,
      `${accepted}.print v(nmid)\n`,
      `${accepted}.probe v(nmid)\n`,
      `${accepted}.meas dc vmax MAX v(nmid)\n`,
      `${accepted}.save all\n`,
      "B1 vin 0 V=v(vin)*2\nR1 vin 0 1k\n",
      "G1 vin 0 POLY(1) vin 0 0 1\nR1 vin 0 1k\n",
      "E1 vin 0 2 0 2\nR1 vin 0 1k\n",
      "X1 vin 0 subckt\nR1 vin 0 1k\n",
      "Vdrive vin 0 PWL FILE=wave.txt\nR1 vin 0 1k\n",
      ".subckt amp in out\nR1 in out 1k\n.ends\n",
      "D1 in 0 clamp 2\n.model clamp D\nVin in 0 5\n",
      "M1 2 1 0 0 nch L=1u L=2u W=1u\n.model nch NMOS\nVin 1 0 5\n",
    ]
  ) {
    assertThrows(() => parseSpiceCircuitSubset(source), Error);
  }
});
