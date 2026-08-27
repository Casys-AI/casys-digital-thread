import { assertEquals, assertRejects } from "@std/assert";
import { PythonCadSourceAnalyzer } from "../../src/adapters/cad/source/python-cad-source-analyzer.ts";
import {
  NATIVE_MECHANICAL_BUILD123D_SOURCE_ID,
  qualifyExactNativeBuild123dFixture,
} from "./exact-fixture-qualification.ts";
import { NATIVE_MECHANICAL_BUILD123D_SCRIPT } from "./native-smoke.ts";

async function exactAnalysis() {
  return await new PythonCadSourceAnalyzer().analyze({
    sourceId: NATIVE_MECHANICAL_BUILD123D_SOURCE_ID,
    role: "cad-script",
    language: "python",
    sourceText: NATIVE_MECHANICAL_BUILD123D_SCRIPT,
  });
}

Deno.test("exact build123d fixture qualification preserves unresolved and grants no admission", async () => {
  const receipt = await qualifyExactNativeBuild123dFixture(
    NATIVE_MECHANICAL_BUILD123D_SCRIPT,
    await exactAnalysis(),
  );
  assertEquals(receipt.admitted, false);
  assertEquals(receipt.fixtureOnly, true);
  assertEquals(receipt.compilationStatusEffect, "none");
  assertEquals(
    receipt.sourceFingerprint.digest,
    "615c55d56e0331f699c837d2763d8d5629ffb0cd48881437845b3359e81b5c87",
  );
  assertEquals(receipt.unresolvedDiagnosticIds.length, 5);
});

Deno.test("exact build123d fixture qualification rejects byte and diagnostic drift", async () => {
  const analysis = await exactAnalysis();
  await assertRejects(
    () =>
      qualifyExactNativeBuild123dFixture(
        `${NATIVE_MECHANICAL_BUILD123D_SCRIPT}\n`,
        analysis,
      ),
    TypeError,
    "exact code-owned fixture bytes",
  );

  const drifted = structuredClone(analysis) as unknown as {
    unresolvedConstructs: Array<{ message: string }>;
  };
  drifted.unresolvedConstructs[0]!.message = "weakened diagnostic";
  await assertRejects(
    () =>
      qualifyExactNativeBuild123dFixture(
        NATIVE_MECHANICAL_BUILD123D_SCRIPT,
        drifted,
      ),
    TypeError,
    "diagnostics drifted",
  );
});
