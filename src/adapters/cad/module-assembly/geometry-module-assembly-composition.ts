/**
 * Explicit provider-free/local-Microsandbox composition for module assembly.
 *
 * Profile-only exposes review facts. The empty runtime marker constructs the
 * existing single-source broker and atomic output CAS. Commands, paths and
 * networking stay code-owned. This does not widen IsolatedCodeExecutionRequest.
 */

import type {
  IsolatedCodeExecutionLimits,
  IsolatedCodePolicyRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  validateIsolatedCodeExecutionLimits,
  validateIsolatedCodePolicyRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { pinnedOciImageReference } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { nonEmptyText } from "../../../domain/kernel/case-validation.ts";
import type {
  IsolatedCodeRunner,
  IsolatedCodeRunRecovery,
  IsolatedOutputPublicationReader,
} from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import { FixedGeometryModuleAssemblyProfileCatalog } from "./fixed-geometry-module-assembly-profile.ts";
import { GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";
import { GeometryModuleAssemblyOutputValidator } from "./geometry-module-assembly-output-validator.ts";
import type { GeometryModuleAssembler } from "../../../application/ports/out/cad/module-assembly/geometry-module-assembler.ts";
import { FixedGeometryModuleAssembler } from "./fixed-geometry-module-assembler.ts";

export interface GeometryModuleAssemblyProfileServerOptions {
  readonly imageReference: string;
  readonly wrapperSha256: string;
  readonly policy: IsolatedCodePolicyRef;
  readonly limits: IsolatedCodeExecutionLimits;
}

export interface GeometryModuleAssemblyRuntimeServerOptions {
  readonly [key: string]: never;
}

export interface GeometryModuleAssemblyServerOptions {
  readonly profile: GeometryModuleAssemblyProfileServerOptions;
  readonly runtime?: GeometryModuleAssemblyRuntimeServerOptions;
}

export interface GeometryModuleAssemblyRuntimeComposition {
  readonly runner: IsolatedCodeRunner;
  readonly recovery: IsolatedCodeRunRecovery;
  readonly publications: IsolatedOutputPublicationReader;
}

export interface GeometryModuleAssemblyComposition {
  readonly profiles: FixedGeometryModuleAssemblyProfileCatalog;
  readonly execution?: GeometryModuleAssemblyRuntimeComposition;
  readonly assembler?: GeometryModuleAssembler;
}

export interface GeometryModuleAssemblyCompositionPaths {
  readonly outputCasDirectory: string;
}

export async function createGeometryModuleAssemblyComposition(
  value: unknown,
  pathsValue: unknown,
): Promise<GeometryModuleAssemblyComposition> {
  const options = parseServerOptions(value);
  const paths = parseCompositionPaths(pathsValue);
  const profiles = new FixedGeometryModuleAssemblyProfileCatalog(options.profile);
  const profile = await profiles.initial();
  if (!options.runtime) return Object.freeze({ profiles });

  const [
    { BrokeredIsolatedCodeRunner },
    { FileIsolatedOutputCas },
    {
      createLocalMicrosandboxSdk,
      MicrosandboxEphemeralExecutionBackend,
    },
  ] = await Promise.all([
    import(
      "../../../application/use-cases/compile/isolation/brokered-isolated-code-runner.ts"
    ),
    import("../../shared/cas/file-isolated-output-cas.ts"),
    import("../../shared/execution/microsandbox-ephemeral-execution-backend.ts"),
  ]);
  const worker = GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT;
  const backend = new MicrosandboxEphemeralExecutionBackend({
    sdk: await createLocalMicrosandboxSdk(),
    imageReference: profile.runtimeBackend.imageReference,
    expectedImageUser: worker.expectedImageUser,
    executable: worker.executable,
    args: [...worker.args],
    workdir: worker.workDirectory,
    sourcePath: worker.sourcePath,
    outputDirectory: worker.outputDirectory,
    controlFiles: {
      quiescencePath: worker.controlFiles.quiescencePath,
      quiescenceBytes: new TextEncoder().encode(
        worker.controlFiles.quiescenceText,
      ),
      stdoutPath: worker.controlFiles.stdoutPath,
      stderrPath: worker.controlFiles.stderrPath,
    },
    profile: profile.executionProfile,
    policy: profile.isolationPolicy,
    runtime: profile.runtime,
    outputManifest: profile.outputManifest,
    cpus: worker.cpus,
    rootDiskMiB: worker.rootDiskMiB,
    maxDurationMs: worker.maxDurationMs,
    maxOpenFiles: worker.maxOpenFiles,
    supervisorUser: worker.expectedImageUser,
  });
  const publications = new FileIsolatedOutputCas(paths.outputCasDirectory);
  const validator = new GeometryModuleAssemblyOutputValidator();
  const runner = new BrokeredIsolatedCodeRunner({
    backend,
    cas: publications,
    profile: profile.executionProfile,
    maximumSourceBytes: profile.maximumBundleBytes,
    outputManifest: profile.outputManifest,
    policy: profile.isolationPolicy,
    runtime: backend.runtime,
    minimumDestructionAssurance: profile.minimumDestructionAssurance,
    validateOutput: validator.validateOutput,
  });
  return Object.freeze({
    profiles,
    assembler: new FixedGeometryModuleAssembler({
      profiles,
      runner,
      publications,
    }),
    execution: Object.freeze({
      runner,
      recovery: runner,
      publications,
    }),
  });
}

function parseServerOptions(value: unknown): GeometryModuleAssemblyServerOptions {
  const root = closedRecord(
    value,
    ["profile"],
    ["runtime"],
    "$geometryModuleAssembly",
  );
  const profileRoot = closedRecord(
    root.profile,
    ["imageReference", "wrapperSha256", "policy", "limits"],
    [],
    "$geometryModuleAssembly.profile",
  );
  const profile = Object.freeze({
    imageReference: pinnedOciImageReference(
      profileRoot.imageReference,
      "$geometryModuleAssembly.profile.imageReference",
    ),
    wrapperSha256: nonEmptyText(
      profileRoot.wrapperSha256,
      "$geometryModuleAssembly.profile.wrapperSha256",
    ),
    policy: validateIsolatedCodePolicyRef(
      profileRoot.policy,
      "$geometryModuleAssembly.profile.policy",
    ),
    limits: validateIsolatedCodeExecutionLimits(
      profileRoot.limits,
      "$geometryModuleAssembly.profile.limits",
    ),
  });
  if (root.runtime === undefined) return Object.freeze({ profile });
  const runtime = closedRecord(
    root.runtime,
    [],
    [],
    "$geometryModuleAssembly.runtime",
  );
  return Object.freeze({
    profile,
    runtime: Object.freeze({
      ...runtime,
    }) as GeometryModuleAssemblyRuntimeServerOptions,
  });
}

function parseCompositionPaths(
  value: unknown,
): GeometryModuleAssemblyCompositionPaths {
  const root = closedRecord(
    value,
    ["outputCasDirectory"],
    [],
    "$geometryModuleAssembly.paths",
  );
  return Object.freeze({
    outputCasDirectory: nonEmptyText(
      root.outputCasDirectory,
      "$geometryModuleAssembly.paths.outputCasDirectory",
    ),
  });
}

function closedRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new TypeError(`${path} has unsupported field ${key}.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
  return record;
}
