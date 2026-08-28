import { loadWorkspaceBehaveFoundationCensus } from "../../src/adapters/control-plane/behave-foundation-census.ts";
import {
  localBehaveFoundationHostObservationPorts,
  observeBehaveFoundationHost,
} from "../../src/adapters/control-plane/behave-foundation-host-observer.ts";
import { createLocalCalculixIsolatedExecutionServerOptions } from "../../src/adapters/fea/isolated-v3/local-calculix-isolated-execution-options.ts";
import { diagnoseBehaveFoundation } from "../../src/application/control-plane/diagnose-behave-foundation.ts";

if (Deno.args.length > 0) {
  throw new TypeError("capability:behave:doctor accepts no arguments.");
}

const calculix = await createLocalCalculixIsolatedExecutionServerOptions();
const census = await loadWorkspaceBehaveFoundationCensus({
  calculix: {
    imageReference: calculix.profile.imageReference,
    policyFingerprint: calculix.profile.policy.fingerprint,
  },
});
const host = await observeBehaveFoundationHost(
  census,
  localBehaveFoundationHostObservationPorts(),
);
const report = diagnoseBehaveFoundation(census, host);
console.log(JSON.stringify(
  {
    schemaVersion: report.schemaVersion,
    mutatesRuntime: report.mutatesRuntime,
    status: report.status,
    pack: census.pack,
    productionEligible: census.productionEligible,
    platform: host.platform,
    prerequisites: host.prerequisites,
    repositoryBlockers: census.blockers,
    hostBlockers: host.blockers,
    installationPlan: report.installationPlan,
  },
  null,
  2,
));
