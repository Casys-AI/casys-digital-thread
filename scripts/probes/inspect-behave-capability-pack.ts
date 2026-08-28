import { loadWorkspaceBehaveFoundationCensus } from "../../src/adapters/control-plane/behave-foundation-census.ts";
import { createLocalCalculixIsolatedExecutionServerOptions } from "../../src/adapters/fea/isolated-v3/local-calculix-isolated-execution-options.ts";

if (import.meta.main) {
  if (Deno.args.length > 0) {
    throw new TypeError("inspect:behave-capabilities accepts no arguments.");
  }
  const calculix = await createLocalCalculixIsolatedExecutionServerOptions();
  const census = await loadWorkspaceBehaveFoundationCensus({
    calculix: {
      imageReference: calculix.profile.imageReference,
      policyFingerprint: calculix.profile.policy.fingerprint,
    },
  });
  console.log(JSON.stringify(census, null, 2));
}
