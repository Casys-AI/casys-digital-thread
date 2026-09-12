import { assertEquals } from "@std/assert";
import { LocalChronoRuntimeSecretResolver } from "./local-chrono-runtime-secret-resolver.ts";

Deno.test("qualification composition constructs one secret resolver and routes only the fixed Chrono and CalculiX probes", async () => {
  const text = await Deno.readTextFile(
    new URL("./local-capability-runtime-qualification-composition.ts", import.meta.url),
  );
  assertEquals(
    [...text.matchAll(/new LocalChronoRuntimeSecretResolver/g)].length,
    1,
  );
  assertEquals(text.includes("overlaySecretInjector("), true);
  assertEquals(text.includes("secretResolver: secrets"), true);
  assertEquals(
    text.includes("createLocalCapabilityRuntimeReadComposition({ secrets })"),
    true,
  );
  assertEquals(
    text.includes("CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID"),
    true,
  );
  assertEquals(text.includes("ErpnextBuyRuntimeQualificationService"), true);
  assertEquals(
    text.includes("capability.erpnextBuy?.qualificationCandidates"),
    true,
  );
  assertEquals(text.includes("createFixedRecordedCalculixSensitivityProvider()"), true);
  assertEquals(text.includes("createFixedCalculixSensitivityResourceReader()"), true);
  assertEquals(text.includes("CapabilityRuntimeCalculixInputStagerFactory"), true);
  assertEquals(text.includes("state/local/sensitivity-step-cache"), true);
  assertEquals(text.includes("src/tools/"), false);
  assertEquals(text.includes("orchestration/operations"), false);
  assertEquals(text.includes("FileCapabilityRuntimeRolloverSagaStore"), false);
  assertEquals(text.includes("CapabilityRuntimeChronoRolloverGate"), false);
  assertEquals(text.includes("availabilityGate:"), false);
  assertEquals(text.includes("rollovers:"), false);
  assertEquals(
    LocalChronoRuntimeSecretResolver.name,
    "LocalChronoRuntimeSecretResolver",
  );
});
