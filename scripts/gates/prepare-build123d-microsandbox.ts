/**
 * Idempotent private operator: observe the exact qualified Build123d target
 * and, on a cache miss, import its immutable public OCI digest under the
 * fixed active Microsandbox reference. Not an MCP tool. Does not execute a
 * qualification or product run.
 */

import { createFirstPartyCapabilityRuntimeCatalog } from "../../src/adapters/control-plane/first-party-capability-binding-catalog.ts";
import {
  acquireFirstPartyMicrosandboxImage,
  assertNoCallerSelectedFirstPartyBootstrapArguments,
  createLocalFirstPartyMicrosandboxImageAcquisitionPorts,
} from "../../src/adapters/control-plane/first-party-microsandbox-image-acquisition.ts";
import {
  createFirstPartyMicrosandboxImageBootstrapDescriptors,
  FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
} from "../../src/adapters/control-plane/first-party-microsandbox-image-bootstrap.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";

assertNoCallerSelectedFirstPartyBootstrapArguments(Deno.args);

const catalog = await createFirstPartyCapabilityRuntimeCatalog();
const descriptor = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog)
  .find((candidate) =>
    candidate.recipeId === FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID
  );
if (!descriptor) {
  throw new Error(
    "First-party Build123d isolated Microsandbox bootstrap descriptor is absent.",
  );
}

const result = await acquireFirstPartyMicrosandboxImage({
  descriptor,
  ports: await createLocalFirstPartyMicrosandboxImageAcquisitionPorts(),
});
console.log(deterministicJson(result));
