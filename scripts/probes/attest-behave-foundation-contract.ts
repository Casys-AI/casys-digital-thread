import {
  attestBehaveFoundationContracts,
} from "../../src/adapters/control-plane/behave-foundation-contract-attestation.ts";
import { loadWorkspaceBehaveFoundationCensus } from "../../src/adapters/control-plane/behave-foundation-census.ts";
import {
  localBehaveFoundationHostObservationPorts,
  observeBehaveFoundationHost,
} from "../../src/adapters/control-plane/behave-foundation-host-observer.ts";
import { loadFleetManifest } from "../../src/adapters/control-plane/manifest.ts";
import { createLocalCalculixIsolatedExecutionServerOptions } from "../../src/adapters/fea/isolated-v3/local-calculix-isolated-execution-options.ts";

if (Deno.args.length > 0) {
  throw new TypeError("capability:behave:attest accepts no arguments.");
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
const attestation = await attestBehaveFoundationContracts({
  census,
  host,
  fleet: await loadFleetManifest("config/mcp-fleet.json"),
});

console.log(JSON.stringify(
  {
    schemaVersion: attestation.schemaVersion,
    mutatesRuntime: attestation.mutatesRuntime,
    evidenceLevel: attestation.evidenceLevel,
    verticalQualification: attestation.verticalQualification,
    pack: attestation.pack,
    cachedExactMaterialIds: host.cachedExactMaterialIds,
    materialObservations: host.materialObservations,
    requiredMcpContracts: attestation.requiredMcpContracts,
    detail: attestation.detail,
  },
  null,
  2,
));
