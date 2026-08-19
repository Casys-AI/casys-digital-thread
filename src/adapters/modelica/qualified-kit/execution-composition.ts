/** Explicit provider-free/local-Microsandbox composition for Modelica @2. */

import type {
  IsolatedCodeExecutionLimits,
  IsolatedCodePolicyRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  validateIsolatedCodeExecutionLimits,
  validateIsolatedCodePolicyRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { pinnedOciImageReference } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { validateModelicaIsolatedOutput } from "../../../domain/modelica/qualified-kit/isolated-execution.ts";
import { nonEmptyText } from "../../../domain/kernel/case-validation.ts";
import type {
  IsolatedCodeRunner,
  IsolatedCodeRunRecovery,
  IsolatedOutputPublicationReader,
} from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import { FixedModelicaIsolatedExecutionProfileCatalog } from "./execution-profile.ts";
import { MODELICA_MICROSANDBOX_WORKER_CONTRACT } from "./kit-v1/worker-contract.ts";

export interface ModelicaIsolatedExecutionProfileServerOptions {
  readonly imageReference: string;
  readonly policy: IsolatedCodePolicyRef;
  readonly limits: IsolatedCodeExecutionLimits;
  readonly engine: {
    readonly name: "OpenModelica";
    readonly version: string;
    readonly mslVersion: string;
  };
}

export interface ModelicaIsolatedExecutionRuntimeServerOptions {
  /** Presence enables only the fixed code-owned local runtime. */
  readonly [key: string]: never;
}

export interface ModelicaIsolatedExecutionServerOptions {
  readonly profile: ModelicaIsolatedExecutionProfileServerOptions;
  readonly runtime?: ModelicaIsolatedExecutionRuntimeServerOptions;
}

export interface ModelicaIsolatedExecutionRuntimeComposition {
  readonly runner: IsolatedCodeRunner;
  readonly recovery: IsolatedCodeRunRecovery;
  readonly publications: IsolatedOutputPublicationReader;
}

export interface ModelicaIsolatedExecutionComposition {
  readonly profiles: FixedModelicaIsolatedExecutionProfileCatalog;
  /**
   * Runtime presence does not activate project execution. A separately
   * publication-backed qualification authority is still mandatory.
   */
  readonly execution?: ModelicaIsolatedExecutionRuntimeComposition;
}

export interface ModelicaIsolatedExecutionCompositionPaths {
  readonly outputCasDirectory: string;
}

/**
 * Construct capabilities without touching registry/server state. In review
 * mode no native Microsandbox module is loaded. Commands, guest paths,
 * lifecycle, networking and output declarations never cross configuration.
 */
export async function createModelicaIsolatedExecutionComposition(
  value: unknown,
  pathsValue: unknown,
): Promise<ModelicaIsolatedExecutionComposition> {
  const options = parseServerOptions(value);
  const paths = parseCompositionPaths(pathsValue);
  const profiles = new FixedModelicaIsolatedExecutionProfileCatalog(
    options.profile,
  );
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
  const worker = MODELICA_MICROSANDBOX_WORKER_CONTRACT;
  const backend = new MicrosandboxEphemeralExecutionBackend({
    sdk: await createLocalMicrosandboxSdk(),
    imageReference: profile.runtimeBackend.imageReference,
    expectedImageUser: worker.expectedImageUser,
    executable: worker.executable,
    args: worker.args,
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
  const runner = new BrokeredIsolatedCodeRunner({
    backend,
    cas: publications,
    profile: profile.executionProfile,
    maximumSourceBytes: profile.maximumBundleBytes,
    outputManifest: profile.outputManifest,
    policy: profile.isolationPolicy,
    runtime: backend.runtime,
    minimumDestructionAssurance: profile.minimumDestructionAssurance,
    validateOutput: validateModelicaIsolatedOutput,
  });
  return Object.freeze({
    profiles,
    execution: Object.freeze({
      runner,
      recovery: runner,
      publications,
    }),
  });
}

function parseServerOptions(value: unknown): ModelicaIsolatedExecutionServerOptions {
  const root = closedRecord(
    value,
    ["profile"],
    ["runtime"],
    "$modelicaIsolatedExecution",
  );
  const profileRoot = closedRecord(
    root.profile,
    ["imageReference", "policy", "limits", "engine"],
    [],
    "$modelicaIsolatedExecution.profile",
  );
  const engineRoot = closedRecord(
    profileRoot.engine,
    ["name", "version", "mslVersion"],
    [],
    "$modelicaIsolatedExecution.profile.engine",
  );
  if (engineRoot.name !== "OpenModelica") {
    throw new TypeError("$modelicaIsolatedExecution.profile.engine.name is fixed.");
  }
  const profile = Object.freeze({
    imageReference: pinnedOciImageReference(
      profileRoot.imageReference,
      "$modelicaIsolatedExecution.profile.imageReference",
    ),
    policy: validateIsolatedCodePolicyRef(
      profileRoot.policy,
      "$modelicaIsolatedExecution.profile.policy",
    ),
    limits: validateIsolatedCodeExecutionLimits(
      profileRoot.limits,
      "$modelicaIsolatedExecution.profile.limits",
    ),
    engine: Object.freeze({
      name: "OpenModelica" as const,
      version: nonEmptyText(
        engineRoot.version,
        "$modelicaIsolatedExecution.profile.engine.version",
      ),
      mslVersion: nonEmptyText(
        engineRoot.mslVersion,
        "$modelicaIsolatedExecution.profile.engine.mslVersion",
      ),
    }),
  });
  if (root.runtime === undefined) return Object.freeze({ profile });
  const runtime = closedRecord(
    root.runtime,
    [],
    [],
    "$modelicaIsolatedExecution.runtime",
  );
  return Object.freeze({
    profile,
    runtime: Object.freeze({
      ...runtime,
    }) as ModelicaIsolatedExecutionRuntimeServerOptions,
  });
}

function parseCompositionPaths(
  value: unknown,
): ModelicaIsolatedExecutionCompositionPaths {
  const root = closedRecord(
    value,
    ["outputCasDirectory"],
    [],
    "$modelicaIsolatedExecution.paths",
  );
  return Object.freeze({
    outputCasDirectory: nonEmptyText(
      root.outputCasDirectory,
      "$modelicaIsolatedExecution.paths.outputCasDirectory",
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
