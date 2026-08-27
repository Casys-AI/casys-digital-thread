/**
 * Idempotent operator: import the pinned Docker ngspice worker into the local
 * Microsandbox cache under the executable manifest reference. Not an agent
 * tool. Does not pull. Does not execute a product run.
 */

import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import {
  assertNoCallerSelectedNgspiceCacheArguments,
  createLocalNgspiceMicrosandboxCachePorts,
  prepareAdmittedNgspiceMicrosandboxCache,
} from "../../src/adapters/electrical/spice/admitted/microsandbox-cache-preparation.ts";

assertNoCallerSelectedNgspiceCacheArguments(Deno.args);

const result = await prepareAdmittedNgspiceMicrosandboxCache(
  await createLocalNgspiceMicrosandboxCachePorts(),
);
console.log(deterministicJson(result));
