/** Explicit provider-free/local-Microsandbox composition for CalculiX static proof. */

import type {
  IsolatedCodeExecutionLimits,
  IsolatedCodePolicyRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  validateIsolatedCodeExecutionLimits,
  validateIsolatedCodePolicyRef,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { pinnedOciImageReference } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { validateCalculixIsolatedOutput } from "../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import { nonEmptyText } from "../../../domain/kernel/case-validation.ts";
import type {
  IsolatedCodeRunner,
  IsolatedCodeRunRecovery,
  IsolatedOutputPublicationReader,
} from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import { FixedCalculixIsolatedExecutionProfileCatalog } from "./fixed-calculix-isolated-execution-profile.ts";
import { CALCULIX_MICROSANDBOX_WORKER_CONTRACT } from "./calculix-static-proof-v1/worker-contract.ts";
import type { ExecuteIsolatedCalculixStaticProof } from "../../../application/use-cases/fea/isolated-v3/execute-isolated-calculix-static-proof.ts";
import type { CalculixIsolatedExecutionEvidenceStore } from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-evidence-store.ts";

export interface CalculixIsolatedExecutionProfileServerOptions {
  readonly imageReference: string;
  readonly wrapperSha256: string;
  readonly policy: IsolatedCodePolicyRef;
  readonly limits: IsolatedCodeExecutionLimits;
}

export interface CalculixIsolatedExecutionRuntimeServerOptions {
  /** Presence enables only the fixed code-owned local runtime. */
  readonly [key: string]: never;
}

export interface CalculixIsolatedExecutionServerOptions {
  readonly profile: CalculixIsolatedExecutionProfileServerOptions;
  readonly runtime?: CalculixIsolatedExecutionRuntimeServerOptions;
}

export interface CalculixIsolatedExecutionRuntimeComposition {
  readonly runner: IsolatedCodeRunner;
  readonly recovery: IsolatedCodeRunRecovery;
  readonly publications: IsolatedOutputPublicationReader;
  /** Same durable store owned by the inner executor, exposed read-only by port. */
  readonly evidence: CalculixIsolatedExecutionEvidenceStore;
  readonly execute: ExecuteIsolatedCalculixStaticProof;
}

export interface CalculixIsolatedExecutionComposition {
  readonly profiles: FixedCalculixIsolatedExecutionProfileCatalog;
  readonly execution?: CalculixIsolatedExecutionRuntimeComposition;
}

export interface CalculixIsolatedExecutionCompositionPaths {
  readonly outputCasDirectory: string;
  readonly attemptDirectory: string;
  readonly evidenceDirectory: string;
  readonly leaseDirectory: string;
  readonly durabilitySyncBoundary?: string;
}

/**
 * Build the exact local capability graph without server or registry wiring.
 * Commands, paths, lifecycle, networking and output declarations stay code-owned.
 */
export async function createCalculixIsolatedExecutionComposition(
  value: unknown,
  pathsValue: unknown,
): Promise<CalculixIsolatedExecutionComposition> {
  const options = parseServerOptions(value);
  const paths = parseCompositionPaths(pathsValue);
  const profiles = new FixedCalculixIsolatedExecutionProfileCatalog(options.profile);
  const profile = await profiles.initial();
  if (!options.runtime) return Object.freeze({ profiles });

  const [
    { BrokeredIsolatedCodeRunner },
    { FileIsolatedOutputCas },
    {
      createLocalMicrosandboxSdk,
      MicrosandboxEphemeralExecutionBackend,
    },
    { FileCalculixIsolatedExecutionAttemptStore },
    { FileCalculixIsolatedExecutionEvidenceStore },
    { FileEngineeringProjectRunLease },
    { CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR },
    { ExecuteIsolatedCalculixStaticProof },
  ] = await Promise.all([
    import(
      "../../../application/use-cases/compile/isolation/brokered-isolated-code-runner.ts"
    ),
    import("../../shared/cas/file-isolated-output-cas.ts"),
    import("../../shared/execution/microsandbox-ephemeral-execution-backend.ts"),
    import("./file-calculix-isolated-execution-attempt-store.ts"),
    import("./calculix-isolated-execution-evidence.ts"),
    import("../../shared/stores/file-engineering-project-run-lease.ts"),
    import("./calculix-isolated-output-batch-inspector.ts"),
    import(
      "../../../application/use-cases/fea/isolated-v3/execute-isolated-calculix-static-proof.ts"
    ),
  ]);
  const worker = CALCULIX_MICROSANDBOX_WORKER_CONTRACT;
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
    validateOutput: validateCalculixIsolatedOutput,
  });
  const evidence = new FileCalculixIsolatedExecutionEvidenceStore(
    paths.evidenceDirectory,
    paths.durabilitySyncBoundary,
  );
  const execute = new ExecuteIsolatedCalculixStaticProof({
    runner,
    recovery: runner,
    publications,
    lease: new FileEngineeringProjectRunLease(paths.leaseDirectory),
    attempts: new FileCalculixIsolatedExecutionAttemptStore(
      paths.attemptDirectory,
      paths.durabilitySyncBoundary,
    ),
    evidence,
    inspector: CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
  });
  return Object.freeze({
    profiles,
    execution: Object.freeze({
      runner,
      recovery: runner,
      publications,
      evidence,
      execute,
    }),
  });
}

function parseServerOptions(value: unknown): CalculixIsolatedExecutionServerOptions {
  const root = closedRecord(
    value,
    ["profile"],
    ["runtime"],
    "$calculixIsolatedExecution",
  );
  const profileRoot = closedRecord(
    root.profile,
    ["imageReference", "wrapperSha256", "policy", "limits"],
    [],
    "$calculixIsolatedExecution.profile",
  );
  const profile = Object.freeze({
    imageReference: pinnedOciImageReference(
      profileRoot.imageReference,
      "$calculixIsolatedExecution.profile.imageReference",
    ),
    wrapperSha256: nonEmptyText(
      profileRoot.wrapperSha256,
      "$calculixIsolatedExecution.profile.wrapperSha256",
    ),
    policy: validateIsolatedCodePolicyRef(
      profileRoot.policy,
      "$calculixIsolatedExecution.profile.policy",
    ),
    limits: validateIsolatedCodeExecutionLimits(
      profileRoot.limits,
      "$calculixIsolatedExecution.profile.limits",
    ),
  });
  if (root.runtime === undefined) return Object.freeze({ profile });
  const runtime = closedRecord(
    root.runtime,
    [],
    [],
    "$calculixIsolatedExecution.runtime",
  );
  return Object.freeze({
    profile,
    runtime: Object.freeze({
      ...runtime,
    }) as CalculixIsolatedExecutionRuntimeServerOptions,
  });
}

function parseCompositionPaths(
  value: unknown,
): CalculixIsolatedExecutionCompositionPaths {
  const root = closedRecord(
    value,
    ["outputCasDirectory", "attemptDirectory", "evidenceDirectory", "leaseDirectory"],
    ["durabilitySyncBoundary"],
    "$calculixIsolatedExecution.paths",
  );
  return Object.freeze({
    outputCasDirectory: nonEmptyText(
      root.outputCasDirectory,
      "$calculixIsolatedExecution.paths.outputCasDirectory",
    ),
    attemptDirectory: nonEmptyText(
      root.attemptDirectory,
      "$calculixIsolatedExecution.paths.attemptDirectory",
    ),
    evidenceDirectory: nonEmptyText(
      root.evidenceDirectory,
      "$calculixIsolatedExecution.paths.evidenceDirectory",
    ),
    leaseDirectory: nonEmptyText(
      root.leaseDirectory,
      "$calculixIsolatedExecution.paths.leaseDirectory",
    ),
    durabilitySyncBoundary: root.durabilitySyncBoundary === undefined
      ? undefined
      : nonEmptyText(
        root.durabilitySyncBoundary,
        "$calculixIsolatedExecution.paths.durabilitySyncBoundary",
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
