/** Explicit deployment composition for admitted Modelica closed-subset runs. */

import type {
  IsolatedCodeExecutionLimits,
  IsolatedCodePolicyRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  validateIsolatedCodeExecutionLimits,
  validateIsolatedCodePolicyRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { pinnedOciImageReference } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { validateAdmittedModelicaIsolatedOutput } from "../../../domain/modelica/admitted/isolated-output.ts";
import { nonEmptyText } from "../../../domain/kernel/case-validation.ts";
import type {
  IsolatedCodeRunner,
  IsolatedCodeRunRecovery,
  IsolatedOutputPublicationReader,
} from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import { FixedAdmittedModelicaExecutionProfileCatalog } from "./execution-profile-catalog.ts";
import { MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "./closed-subset-v2/worker-contract.ts";
import { MODELICA_MICROSANDBOX_WORKER_CONTRACT } from "../qualified-kit/kit-v1/worker-contract.ts";

export interface AdmittedModelicaExecutionProfileServerOptions {
  readonly imageReference: string;
  readonly policy: IsolatedCodePolicyRef;
  readonly limits: IsolatedCodeExecutionLimits;
}

export interface AdmittedModelicaExecutionRuntimeServerOptions {
  readonly [key: string]: never;
}

export interface AdmittedModelicaExecutionServerOptions {
  readonly profile: AdmittedModelicaExecutionProfileServerOptions;
  readonly runtime?: AdmittedModelicaExecutionRuntimeServerOptions;
}

export interface AdmittedModelicaIsolatedExecutionComposition {
  readonly runner: IsolatedCodeRunner;
  readonly recovery: IsolatedCodeRunRecovery;
  readonly publications: IsolatedOutputPublicationReader;
}

export interface AdmittedModelicaExecutionComposition {
  readonly profiles: FixedAdmittedModelicaExecutionProfileCatalog;
  readonly execution?: AdmittedModelicaIsolatedExecutionComposition;
}

export interface AdmittedModelicaExecutionCompositionPaths {
  readonly outputCasDirectory: string;
}

export async function createAdmittedModelicaExecutionComposition(
  value: unknown,
  pathsValue: unknown,
): Promise<AdmittedModelicaExecutionComposition> {
  const options = parseServerOptions(value);
  const paths = parseCompositionPaths(pathsValue);
  const profiles = new FixedAdmittedModelicaExecutionProfileCatalog(
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
  const worker = MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT;
  const backend = new MicrosandboxEphemeralExecutionBackend({
    sdk: await createLocalMicrosandboxSdk(),
    imageReference: profile.runtimeBackend.imageReference,
    expectedImageUser: worker.expectedImageUser,
    expectedImageEntrypoint: Object.freeze([
      MODELICA_MICROSANDBOX_WORKER_CONTRACT.executable,
      ...MODELICA_MICROSANDBOX_WORKER_CONTRACT.args,
    ]),
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
    maximumSourceBytes: profile.maximumSourceBytes,
    outputManifest: profile.outputManifest,
    policy: profile.isolationPolicy,
    runtime: backend.runtime,
    minimumDestructionAssurance: profile.minimumDestructionAssurance,
    validateOutput: validateAdmittedModelicaIsolatedOutput,
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

function parseServerOptions(value: unknown): AdmittedModelicaExecutionServerOptions {
  const root = closedRecord(
    value,
    ["profile"],
    ["runtime"],
    "$admittedModelicaExecution",
  );
  const profileRoot = closedRecord(
    root.profile,
    ["imageReference", "policy", "limits"],
    [],
    "$admittedModelicaExecution.profile",
  );
  const profile = Object.freeze({
    imageReference: pinnedOciImageReference(
      profileRoot.imageReference,
      "$admittedModelicaExecution.profile.imageReference",
    ),
    policy: validateIsolatedCodePolicyRef(
      profileRoot.policy,
      "$admittedModelicaExecution.profile.policy",
    ),
    limits: validateIsolatedCodeExecutionLimits(
      profileRoot.limits,
      "$admittedModelicaExecution.profile.limits",
    ),
  });
  if (root.runtime === undefined) return Object.freeze({ profile });
  closedRecord(root.runtime, [], [], "$admittedModelicaExecution.runtime");
  return Object.freeze({ profile, runtime: Object.freeze({}) });
}

function parseCompositionPaths(
  value: unknown,
): AdmittedModelicaExecutionCompositionPaths {
  const root = closedRecord(
    value,
    ["outputCasDirectory"],
    [],
    "$admittedModelicaExecution.paths",
  );
  return Object.freeze({
    outputCasDirectory: nonEmptyText(
      root.outputCasDirectory,
      "$admittedModelicaExecution.paths.outputCasDirectory",
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
