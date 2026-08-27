import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  authorizeAdmittedSpiceSource,
  buildSpiceOperatingPointNetlist,
  parseSpiceOperatingPointVectors,
  spiceOperatingPointPlanFor,
} from "./run.ts";
import { NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

const DIVIDER = await Deno.readTextFile(
  new URL(
    "../../../../testing/fixtures/electrical/spice/operating-point/resistor-divider.cir",
    import.meta.url,
  ),
);
const DIVIDER_VECTORS = await Deno.readTextFile(
  new URL(
    "../../../../testing/fixtures/electrical/spice/operating-point/resistor-divider-vectors.txt",
    import.meta.url,
  ),
);
const DIODE = await Deno.readTextFile(
  new URL(
    "../../../../testing/fixtures/electrical/spice/operating-point/diode-clamp.cir",
    import.meta.url,
  ),
);
const DIODE_VECTORS = await Deno.readTextFile(
  new URL(
    "../../../../testing/fixtures/electrical/spice/operating-point/diode-clamp-vectors.txt",
    import.meta.url,
  ),
);

Deno.test("generic divider plan asks only node voltages and ngspice branch currents", async () => {
  const authorized = await authorizeAdmittedSpiceSource(
    new TextEncoder().encode(DIVIDER),
  );
  assertEquals(
    spiceOperatingPointPlanFor(authorized.source).map((item) => item.nativeName),
    ["v(in)", "v(out)", "i(vin)", "@r1[i]", "@r2[i]"],
  );
});

Deno.test("generic divider vectors keep the proven ngspice voltage-source sign", async () => {
  const authorized = await authorizeAdmittedSpiceSource(
    new TextEncoder().encode(DIVIDER),
  );
  const parsed = parseSpiceOperatingPointVectors(
    DIVIDER_VECTORS,
    spiceOperatingPointPlanFor(authorized.source),
  );
  assertEquals(parsed.map((item) => item.nativeName), [
    "@r1[i]",
    "@r2[i]",
    "i(vin)",
    "v(in)",
    "v(out)",
  ]);
  assertEquals(parsed.find((item) => item.nativeName === "v(out)")?.value, 2.5);
  assertEquals(parsed.find((item) => item.nativeName === "i(vin)")?.value, -0.0025);
  assertEquals(parsed.find((item) => item.nativeName === "@r1[i]")?.value, 0.0025);
  assertEquals(
    parsed.find((item) => item.nativeName === "i(vin)")?.sourceSymbol,
    "Vin",
  );
});

Deno.test("generic diode vectors expose @d1[id] without derived power", async () => {
  const authorized = await authorizeAdmittedSpiceSource(
    new TextEncoder().encode(DIODE),
  );
  const parsed = parseSpiceOperatingPointVectors(
    DIODE_VECTORS,
    spiceOperatingPointPlanFor(authorized.source),
  );
  assertEquals(parsed.map((item) => item.nativeName), [
    "@d1[id]",
    "@r1[i]",
    "i(vin)",
    "v(in)",
    "v(n1)",
  ]);
  assertEquals(parsed[0]?.kind, "branch-current");
  assertEquals(parsed[0]?.unit, "A");
  assertEquals(parsed.some((item) => item.nativeName.includes("power")), false);
});

Deno.test("run netlist preserves exact source and appends server-owned op/control/end", async () => {
  const authorized = await authorizeAdmittedSpiceSource(
    new TextEncoder().encode(DIVIDER),
  );
  const netlist = buildSpiceOperatingPointNetlist(
    authorized.source.sourceText,
    spiceOperatingPointPlanFor(authorized.source),
  );
  assertEquals(
    netlist.startsWith("casys spice-circuit-closed-subset-v1 operating-point\n"),
    true,
  );
  assertEquals(netlist.includes(DIVIDER.trimEnd()), true);
  assertEquals(netlist.includes(".options savecurrents"), true);
  assertEquals(netlist.includes("\n.control\n"), true);
  assertEquals(netlist.includes("\nop\n"), true);
  assertEquals(netlist.includes("print v(in) > /work/op-vectors.txt"), true);
  assertEquals(netlist.includes(".include"), false);
  assertEquals(netlist.endsWith("\n.endc\n.end\n"), true);
  assertEquals(
    netlist.includes(NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.vectorPath),
    true,
  );
});

Deno.test("admitted SPICE worker re-rejects analysis, include, and control directives", async () => {
  for (
    const source of [
      "Vin in 0 DC 5\nR1 in 0 1k\n.op\n.end\n",
      "Vin in 0 DC 5\n.include /etc/passwd\nR1 in 0 1k\n",
      "Vin in 0 DC 5\n.control\nshell cat /etc/passwd\n.endc\nR1 in 0 1k\n",
      "Vin in 0 DC 5\nR1 in 0 1k\n.lib models.lib\n",
    ]
  ) {
    await assertRejects(
      () => authorizeAdmittedSpiceSource(new TextEncoder().encode(source)),
      TypeError,
    );
  }
});

Deno.test("admitted SPICE worker rejects non UTF-8 bytes", async () => {
  await assertRejects(
    () => authorizeAdmittedSpiceSource(Uint8Array.of(0xff)),
    TypeError,
  );
});

Deno.test("vector parser rejects missing, extra, and non-finite ngspice lines", async () => {
  const authorized = await authorizeAdmittedSpiceSource(
    new TextEncoder().encode(DIVIDER),
  );
  const plan = spiceOperatingPointPlanFor(authorized.source);
  assertThrows(
    () =>
      parseSpiceOperatingPointVectors(
        DIVIDER_VECTORS.replace("@r2[i] = 2.500000e-03\n", ""),
        plan,
      ),
    TypeError,
  );
  assertThrows(
    () =>
      parseSpiceOperatingPointVectors(
        `${DIVIDER_VECTORS}@r3[i] = 1.000000e-03\n`,
        plan,
      ),
    TypeError,
  );
  assertThrows(
    () =>
      parseSpiceOperatingPointVectors(
        DIVIDER_VECTORS.replace("2.500000e+00", "nan"),
        plan,
      ),
    TypeError,
  );
});
