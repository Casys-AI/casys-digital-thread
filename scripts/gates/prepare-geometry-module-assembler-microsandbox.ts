/**
 * Idempotent private operator: inspect or reconstruct the exact fixed
 * geometry-module assembler, then import it into the local Microsandbox cache.
 * The in-repo Dockerfile is a local candidate recipe, not bit-reproducible
 * proof; the imported image must still match the target digest. Not an MCP
 * tool.
 */

import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../src/adapters/control-plane/first-party-capability-binding-catalog.ts";
import {
  acquireFirstPartyMicrosandboxImage,
  assertNoCallerSelectedFirstPartyBootstrapArguments,
  createLocalFirstPartyMicrosandboxImageAcquisitionPorts,
} from "../../src/adapters/control-plane/first-party-microsandbox-image-acquisition.ts";
import {
  createFirstPartyMicrosandboxImageBootstrapDescriptors,
  FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
} from "../../src/adapters/control-plane/first-party-microsandbox-image-bootstrap.ts";

assertNoCallerSelectedFirstPartyBootstrapArguments(Deno.args);

const catalog = await createFirstPartyCapabilityRuntimeCatalog();
const descriptor = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog)
  .find((candidate) =>
    candidate.recipeId === FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID
  );
if (!descriptor) {
  throw new Error(
    "First-party geometry-module Microsandbox bootstrap descriptor is absent.",
  );
}

const result = await acquireFirstPartyMicrosandboxImage({
  descriptor,
  ports: await createLocalFirstPartyMicrosandboxImageAcquisitionPorts(),
});
console.log(deterministicJson(result));
