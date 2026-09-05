/**
 * Explicit deployment composition for the qualified Build123d vertical.
 *
 * Supplying the profile block enables only provider-free review. The isolated
 * runner exists only when the runtime block is also present and exact. This
 * Configuration is never sourced from environment variables and never falls
 * back to the legacy Build123d MCP preview provider. Runtime bootstrap only
 * inspects the native-loader override variables required to fail closed.
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
import { FixedBuild123dExecutionProfileCatalog } from "./fixed-build123d-execution-profile-catalog.ts";
import { BUILD123D_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

export interface Build123dExecutionProfileServerOptions {
  /** Reviewed local runtime image; mutable tags are never accepted. */
  readonly imageReference: string;
  /** Identity of the code-owned deny-all isolation policy revision. */
  readonly policy: IsolatedCodePolicyRef;
  /** Code-owned execution ceilings bound into the profile fingerprint. */
  readonly limits: IsolatedCodeExecutionLimits;
}

export interface Build123dExecutionRuntimeServerOptions {
  /**
   * Presence enables the code-owned attached local runtime. The record is
   * intentionally empty: no caller or deployment input selects commands,
   * networking, lifecycle, credentials, sockets, or backend identity.
   */
  readonly [key: string]: never;
}

/**
 * No default exists. A deployment must explicitly provide at least `profile`;
 * omitting `runtime` deliberately produces a provider-free review-only seam.
 */
export interface Build123dExecutionServerOptions {
  readonly profile: Build123dExecutionProfileServerOptions;
  readonly runtime?: Build123dExecutionRuntimeServerOptions;
}

export interface Build123dIsolatedExecutionComposition {
  readonly runner: IsolatedCodeRunner;
  readonly recovery: IsolatedCodeRunRecovery;
  readonly publications: IsolatedOutputPublicationReader;
}

export interface Build123dExecutionComposition {
  readonly profiles: FixedBuild123dExecutionProfileCatalog;
  readonly execution?: Build123dIsolatedExecutionComposition;
}

export interface Build123dExecutionCompositionPaths {
  readonly outputCasDirectory: string;
}

/**
 * Construct control-plane objects only. No sandbox, network request, or CAS
 * write occurs until a reviewed executor calls the returned port.
 */
export async function createBuild123dExecutionComposition(
  value: unknown,
  pathsValue: unknown,
): Promise<Build123dExecutionComposition> {
  const options = parseServerOptions(value);
  const paths = parseCompositionPaths(pathsValue);
  const profiles = new FixedBuild123dExecutionProfileCatalog(options.profile);
  // Resolve even in review-only mode: an explicit but invalid deployment
  // profile must fail server startup instead of becoming a delayed tool error.
  const profile = await profiles.initial();
  if (!options.runtime) return Object.freeze({ profiles });

  // Reuse that exact resolved profile so a divergent profile cannot be wired
  // to a backend with a different policy, image, output, or cleanup contract.
  // These capability-bearing adapters stay unloaded in absent/review-only mode.
  const [
    { BrokeredIsolatedCodeRunner },
    { FileIsolatedOutputCas },
    { OcctStepOutputValidator },
    {
      createLocalMicrosandboxSdk,
      MicrosandboxEphemeralExecutionBackend,
    },
  ] = await Promise.all([
    import(
      "../../../application/use-cases/compile/isolation/brokered-isolated-code-runner.ts"
    ),
    import("../../shared/cas/file-isolated-output-cas.ts"),
    import("./occt-step-output-validator.ts"),
    import("../../shared/execution/microsandbox-ephemeral-execution-backend.ts"),
  ]);
  const worker = BUILD123D_MICROSANDBOX_WORKER_CONTRACT;
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
  const validator = new OcctStepOutputValidator();
  const runner = new BrokeredIsolatedCodeRunner({
    backend,
    cas: publications,
    profile: profile.executionProfile,
    maximumSourceBytes: profile.maximumSourceBytes,
    outputManifest: profile.outputManifest,
    policy: profile.isolationPolicy,
    runtime: backend.runtime,
    minimumDestructionAssurance: profile.minimumDestructionAssurance,
    validateOutput: validator.validateOutput,
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

function parseServerOptions(value: unknown): Build123dExecutionServerOptions {
  const root = closedRecord(
    value,
    ["profile"],
    ["runtime"],
    "$build123dExecution",
  );
  const profileRoot = closedRecord(
    root.profile,
    ["imageReference", "policy", "limits"],
    [],
    "$build123dExecution.profile",
  );
  const profile = Object.freeze({
    imageReference: pinnedOciImageReference(
      profileRoot.imageReference,
      "$build123dExecution.profile.imageReference",
    ),
    policy: validateIsolatedCodePolicyRef(
      profileRoot.policy,
      "$build123dExecution.profile.policy",
    ),
    limits: validateIsolatedCodeExecutionLimits(
      profileRoot.limits,
      "$build123dExecution.profile.limits",
    ),
  });
  if (root.runtime === undefined) return Object.freeze({ profile });

  const runtimeRoot = closedRecord(
    root.runtime,
    [],
    [],
    "$build123dExecution.runtime",
  );
  return Object.freeze({
    profile,
    runtime: Object.freeze({
      ...runtimeRoot,
    }) as Build123dExecutionRuntimeServerOptions,
  });
}

function parseCompositionPaths(value: unknown): Build123dExecutionCompositionPaths {
  const root = closedRecord(
    value,
    ["outputCasDirectory"],
    [],
    "$build123dExecution.paths",
  );
  return Object.freeze({
    outputCasDirectory: nonEmptyText(
      root.outputCasDirectory,
      "$build123dExecution.paths.outputCasDirectory",
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
    if (!allowed.has(key)) {
      throw new TypeError(`${path} has unsupported field ${key}.`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
  return record;
}
