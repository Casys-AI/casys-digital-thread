/**
 * Write the first-party Microsandbox candidate-image distribution matrix as
 * compact JSON on stdout. Planning only: no network, Docker, or file writes.
 * Callers cannot select a worker, image, tag, or registry.
 */

import { createFirstPartyCapabilityRuntimeCatalog } from "../../src/adapters/control-plane/first-party-capability-binding-catalog.ts";
import { createFirstPartyMicrosandboxImageDistributionMatrix } from "../../src/adapters/control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";

if (Deno.args.length !== 0) {
  throw new TypeError(
    "First-party Microsandbox image matrix export accepts no arguments.",
  );
}

const catalog = await createFirstPartyCapabilityRuntimeCatalog();
const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
console.log(deterministicJson(matrix));
