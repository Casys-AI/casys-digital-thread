import { assertEquals } from "@std/assert";
import { LocalChronoRuntimeSecretResolver } from "./local-chrono-runtime-secret-resolver.ts";

Deno.test("qualification composition constructs one secret resolver for review, Compose overlay and Chrono client", async () => {
  const text = await Deno.readTextFile(
    new URL("./local-capability-runtime-qualification-composition.ts", import.meta.url),
  );
  assertEquals(
    [...text.matchAll(/new LocalChronoRuntimeSecretResolver/g)].length,
    1,
  );
  assertEquals(text.includes("secretInjector: secrets"), true);
  assertEquals(text.includes("secretResolver: secrets"), true);
  assertEquals(
    text.includes("createLocalCapabilityRuntimeReadComposition({ secrets })"),
    true,
  );
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
