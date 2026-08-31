/**
 * Idempotent private operator: import the exact fixed geometry-module
 * assembler into the local Microsandbox cache. Not an MCP tool.
 */

import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import {
  assertNoCallerSelectedGeometryModuleAssemblyCacheArguments,
  createLocalGeometryModuleAssemblyMicrosandboxCachePorts,
  prepareGeometryModuleAssemblyMicrosandboxCache,
} from "../../src/adapters/cad/module-assembly/geometry-module-assembly-microsandbox-cache-preparation.ts";

assertNoCallerSelectedGeometryModuleAssemblyCacheArguments(Deno.args);

const result = await prepareGeometryModuleAssemblyMicrosandboxCache(
  await createLocalGeometryModuleAssemblyMicrosandboxCachePorts(),
);
console.log(deterministicJson(result));
