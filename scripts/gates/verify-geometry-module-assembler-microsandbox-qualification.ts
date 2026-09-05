/**
 * Explicit private qualification of the fixed geometry-module assembler.
 *
 * It is neither a product operation nor catalogue promotion. `--run` is the
 * only dispatching action. `--recover` only reconciles the exact durable WAL
 * attempt and will never call the worker.
 */

import {
  createGeometryModuleAssemblerMicrosandboxQualificationCandidate,
  FileGeometryModuleAssemblerMicrosandboxQualificationStore,
  GeometryModuleAssemblerQualificationService,
} from "../../src/adapters/cad/module-assembly/geometry-module-assembly-microsandbox-qualification.ts";
import { createGeometryModuleAssemblyComposition } from "../../src/adapters/cad/module-assembly/geometry-module-assembly-composition.ts";
import { createLocalGeometryModuleAssemblyServerOptions } from "../../src/adapters/cad/module-assembly/first-party-geometry-module-assembly.ts";
import { createLocalCapabilityRuntimeReadComposition } from "../../src/adapters/control-plane/local-capability-runtime-read-composition.ts";
import { FileIsolatedOutputCas } from "../../src/adapters/shared/cas/file-isolated-output-cas.ts";

const mode = Deno.args.length === 1 ? Deno.args[0] : undefined;
if (mode !== "--run" && mode !== "--recover") {
  console.log(JSON.stringify({
    schemaVersion: "geometry-module-assembler-microsandbox-qualification-gate/1.0",
    status: "skipped",
    reason: "Pass --run to dispatch once, or --recover for readback and cleanup only.",
  }));
  Deno.exit(0);
}

const STATE_ROOT = "state/local/geometry-module-assembler-microsandbox-qualification";
const CAS_DIRECTORY = `${STATE_ROOT}/outputs`;
const [options, capabilityRuntime] = await Promise.all([
  createLocalGeometryModuleAssemblyServerOptions(),
  createLocalCapabilityRuntimeReadComposition(),
]);
const composition = await createGeometryModuleAssemblyComposition({
  ...options,
  runtime: {},
}, { outputCasDirectory: CAS_DIRECTORY });
if (!composition.execution) {
  throw new Error("The geometry-module assembler runtime was not composed.");
}

const service = new GeometryModuleAssemblerQualificationService({
  candidate: createGeometryModuleAssemblerMicrosandboxQualificationCandidate,
  observedHost: capabilityRuntime.host,
  profiles: composition.profiles,
  runner: composition.execution.runner,
  publications: composition.execution.publications,
  recovery: composition.execution.recovery,
  restartPublications: () => new FileIsolatedOutputCas(CAS_DIRECTORY),
  attempts: capabilityRuntime.qualificationAttempts,
  attestations: capabilityRuntime.qualifications,
  captures: new FileGeometryModuleAssemblerMicrosandboxQualificationStore(),
});

let result;
if (mode === "--recover") {
  // An explicit recovery must surface its exact readback/cleanup failure; a
  // second recovery here could make that failure disappear from the gate.
  result = await service.recover();
} else {
  try {
    result = await service.apply();
  } catch (failure) {
    // A failed dispatch still leaves its deterministic identity in the WAL.
    // The only permitted follow-up is exact CAS readback and run-scoped cleanup.
    try {
      result = await service.recover();
    } catch (recoveryFailure) {
      throw new AggregateError(
        [failure, recoveryFailure],
        "Geometry-module qualification apply failed and exact recovery/cleanup also failed.",
      );
    }
  }
}

console.log(JSON.stringify(
  {
    schemaVersion: "geometry-module-assembler-microsandbox-qualification-gate/1.0",
    mode: mode === "--run" ? "apply" : "recover",
    ...result,
  },
  null,
  2,
));

if (result.status !== "qualified") Deno.exitCode = 1;
