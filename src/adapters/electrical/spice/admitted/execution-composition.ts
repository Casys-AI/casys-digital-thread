/** Explicit deployment composition for admitted SPICE closed-subset runs. */

import type {
  IsolatedCodeExecutionLimits,
  IsolatedCodePolicyRef,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  validateIsolatedCodeExecutionLimits,
  validateIsolatedCodePolicyRef,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { pinnedOciImageReference } from "../../../../domain/compile/isolation/local-isolation-runtime.ts";
import { validateAdmittedSpiceIsolatedOutput } from "../../../../domain/electrical/spice/admitted/isolated-output.ts";
import { nonEmptyText } from "../../../../domain/kernel/case-validation.ts";
import type {
  IsolatedCodeRunner,
  IsolatedCodeRunRecovery,
  IsolatedOutputPublicationReader,
} from "../../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import { FixedAdmittedSpiceExecutionProfileCatalog } from "./execution-profile-catalog.ts";
import { NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

/** Server-owned worker invocation: ENTRYPOINT args only, no extra guest args. */
export function admittedSpiceIsolatedWorkerInvocation() {
  const worker = NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT;
  return Object.freeze({
    expectedImageEntrypoint: Object.freeze([
      worker.executable,
      ...worker.args,
    ]),
    executable: worker.executable,
    args: worker.args,
    extraWorkerArguments: Object.freeze([] as const),
    sourcePath: worker.sourcePath,
    outputDirectory: worker.outputDirectory,
    workDirectory: worker.workDirectory,
    requestedLimits: worker.requestedLimits,
  });
}

export interface AdmittedSpiceExecutionProfileServerOptions {
  readonly imageReference: string;
  readonly policy: IsolatedCodePolicyRef;
  readonly limits: IsolatedCodeExecutionLimits;
}

export interface AdmittedSpiceExecutionRuntimeServerOptions {
  readonly [key: string]: never;
}

export interface AdmittedSpiceExecutionServerOptions {
  readonly profile: AdmittedSpiceExecutionProfileServerOptions;
  readonly runtime?: AdmittedSpiceExecutionRuntimeServerOptions;
}

export interface AdmittedSpiceIsolatedExecutionComposition {
  readonly runner: IsolatedCodeRunner;
  readonly recovery: IsolatedCodeRunRecovery;
  readonly publications: IsolatedOutputPublicationReader;
}

export interface AdmittedSpiceExecutionComposition {
  readonly profiles: FixedAdmittedSpiceExecutionProfileCatalog;
  readonly execution?: AdmittedSpiceIsolatedExecutionComposition;
}

export interface AdmittedSpiceExecutionCompositionPaths {
  readonly outputCasDirectory: string;
}

export async function createAdmittedSpiceExecutionComposition(
  value: unknown,
  pathsValue: unknown,
): Promise<AdmittedSpiceExecutionComposition> {
  const options = parseServerOptions(value);
  const paths = parseCompositionPaths(pathsValue);
  const profiles = new FixedAdmittedSpiceExecutionProfileCatalog(
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
      "../../../../application/use-cases/compile/isolation/brokered-isolated-code-runner.ts"
    ),
    import("../../../shared/cas/file-isolated-output-cas.ts"),
    import("../../../shared/execution/microsandbox-ephemeral-execution-backend.ts"),
  ]);
  const worker = NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT;
  const invocation = admittedSpiceIsolatedWorkerInvocation();
  const backend = new MicrosandboxEphemeralExecutionBackend({
    sdk: await createLocalMicrosandboxSdk(),
    imageReference: profile.runtimeBackend.imageReference,
    expectedImageUser: worker.expectedImageUser,
    expectedImageEntrypoint: invocation.expectedImageEntrypoint,
    executable: invocation.executable,
    args: [...invocation.args, ...invocation.extraWorkerArguments],
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
    maximumSourceBytes: profile.maximumSourceBytes,
    outputManifest: profile.outputManifest,
    policy: profile.isolationPolicy,
    runtime: backend.runtime,
    minimumDestructionAssurance: profile.minimumDestructionAssurance,
    validateOutput: validateAdmittedSpiceIsolatedOutput,
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

function parseServerOptions(value: unknown): AdmittedSpiceExecutionServerOptions {
  const root = closedRecord(
    value,
    ["profile"],
    ["runtime"],
    "$admittedSpiceExecution",
  );
  const profileRoot = closedRecord(
    root.profile,
    ["imageReference", "policy", "limits"],
    [],
    "$admittedSpiceExecution.profile",
  );
  const profile = Object.freeze({
    imageReference: pinnedOciImageReference(
      profileRoot.imageReference,
      "$admittedSpiceExecution.profile.imageReference",
    ),
    policy: validateIsolatedCodePolicyRef(
      profileRoot.policy,
      "$admittedSpiceExecution.profile.policy",
    ),
    limits: validateIsolatedCodeExecutionLimits(
      profileRoot.limits,
      "$admittedSpiceExecution.profile.limits",
    ),
  });
  if (root.runtime === undefined) return Object.freeze({ profile });
  closedRecord(root.runtime, [], [], "$admittedSpiceExecution.runtime");
  return Object.freeze({ profile, runtime: Object.freeze({}) });
}

function parseCompositionPaths(
  value: unknown,
): AdmittedSpiceExecutionCompositionPaths {
  const root = closedRecord(
    value,
    ["outputCasDirectory"],
    [],
    "$admittedSpiceExecution.paths",
  );
  return Object.freeze({
    outputCasDirectory: nonEmptyText(
      root.outputCasDirectory,
      "$admittedSpiceExecution.paths.outputCasDirectory",
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
      throw new TypeError(`${path} is missing ${key}.`);
    }
  }
  return record;
}
