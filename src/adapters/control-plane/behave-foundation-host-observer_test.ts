import { assertEquals } from "@std/assert";
import { createLocalCalculixIsolatedExecutionServerOptions } from "../fea/isolated-v3/local-calculix-isolated-execution-options.ts";
import { loadWorkspaceBehaveFoundationCensus } from "./behave-foundation-census.ts";
import { observeBehaveFoundationHost } from "./behave-foundation-host-observer.ts";

Deno.test("host observer distinguishes Docker images from an absent microVM cache entry", async () => {
  const calculix = await createLocalCalculixIsolatedExecutionServerOptions();
  const census = await loadWorkspaceBehaveFoundationCensus({
    calculix: {
      imageReference: calculix.profile.imageReference,
      policyFingerprint: calculix.profile.policy.fingerprint,
    },
  });
  const observed = await observeBehaveFoundationHost(census, {
    platform: "linux/arm64",
    runDocker: (args) =>
      Promise.resolve({
        success: true,
        stdout: args[0] === "compose" ? "5.3.1\n" : "123\n",
        stderr: "",
      }),
    inspectMicrosandboxImage: () => Promise.resolve(undefined),
  });

  assertEquals(observed.mutatesRuntime, false);
  assertEquals(observed.blockers, []);
  assertEquals(observed.prerequisites.map((item) => item.status), [
    "available",
    "available",
  ]);
  assertEquals(observed.images.length, 4);
  assertEquals(
    observed.images.some((image) =>
      image.reference === calculix.profile.imageReference
    ),
    false,
  );
});
