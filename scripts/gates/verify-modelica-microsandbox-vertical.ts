/** Real local MicroVM -> broker -> CAS -> external validation qualification gate. */

import {
  FileModelicaMicrosandboxQualificationStore,
  PublicationBackedModelicaMicrosandboxQualificationAuthority,
} from "../../src/adapters/modelica/qualified-kit/microsandbox-qualification.ts";
import {
  MODELICA_MICROSANDBOX_WORKER_IMAGE,
} from "../../src/adapters/modelica/qualified-kit/execution-profile.ts";
import { createModelicaIsolatedExecutionComposition } from "../../src/adapters/modelica/qualified-kit/execution-composition.ts";
import {
  createModelicaMicrosandboxQualificationKit,
  MODELICA_QUALIFIED_KIT_DENO_LOCK_SHA256,
  MODELICA_QUALIFIED_KIT_WORKER_CONTRACT_SHA256,
  MODELICA_QUALIFIED_KIT_WRAPPER_SHA256,
} from "../../src/adapters/modelica/qualified-kit/kit-v1/qualification-kit.ts";
import { FileIsolatedOutputCas } from "../../src/adapters/shared/cas/file-isolated-output-cas.ts";
import {
  createModelicaMicrosandboxQualificationCapture,
} from "../../src/domain/modelica/qualified-kit/microsandbox-qualification.ts";
import { validateModelicaIsolatedRun } from "../../src/domain/modelica/qualified-kit/isolated-execution.ts";
import {
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  isolatedCodeExecutionReceiptRecord,
} from "../../src/domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../src/domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../src/domain/kernel/deterministic-json.ts";

if (Deno.args.length !== 1 || Deno.args[0] !== "--run") {
  console.log(JSON.stringify({
    schemaVersion: "modelica-microsandbox-vertical-gate/1.0",
    status: "skipped",
    reason: "Pass --run to execute the exact local qualification vertical.",
  }));
  Deno.exit(0);
}

const IMAGE_REFERENCE = MODELICA_MICROSANDBOX_WORKER_IMAGE;
const IMAGE_DIGEST = IMAGE_REFERENCE.slice(IMAGE_REFERENCE.indexOf("@sha256:") + 8);
const LIMITS = Object.freeze({
  maxWallTimeMs: 120_000,
  maxCpuTimeMs: 120_000,
  maxMemoryBytes: 3 * 1_073_741_824,
  maxProcesses: 64,
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 1_048_576,
  maxOutputFileBytes: 16 * 1_048_576,
  maxOutputTotalBytes: 17 * 1_048_576,
});
const POLICY = Object.freeze({
  id: "modelica-microsandbox-deny-all-v1",
  version: "1.0.0",
  fingerprint: await sha256Fingerprint({
    schemaVersion: "modelica-microsandbox-policy/1.0",
    backend: "microsandbox-local@0.6.8",
    imageReference: IMAGE_REFERENCE,
    network: "deny-all",
    pullPolicy: "never",
    securityProfile: "restricted",
    workerUser: "65532:65532",
    fixedExecutables: ["omc", "perl"],
    limits: LIMITS,
  }),
});
const ENGINE = Object.freeze({
  name: "OpenModelica" as const,
  version: "1.27.0",
  mslVersion: "4.1.0",
});
const runId = `modelica.qualification.${crypto.randomUUID()}`;
const stateRoot = "state/local/modelica-microsandbox-qualification";
const casDirectory = `${stateRoot}/outputs`;
const captureDirectory = `${stateRoot}/captures`;
let execution:
  | NonNullable<
    Awaited<ReturnType<typeof createModelicaIsolatedExecutionComposition>>[
      "execution"
    ]
  >
  | undefined;
let publicationKnown = false;
let gateFailure: unknown;
let cleanupFailure: unknown;
let gateResult: unknown;

try {
  await Deno.mkdir(stateRoot, { recursive: true, mode: 0o700 });
  await Deno.chmod(stateRoot, 0o700);
  const composition = await createModelicaIsolatedExecutionComposition(
    {
      profile: {
        imageReference: IMAGE_REFERENCE,
        policy: POLICY,
        limits: LIMITS,
        engine: ENGINE,
      },
      runtime: {},
    },
    { outputCasDirectory: casDirectory },
  );
  execution = composition.execution;
  if (!execution) throw new Error("The explicit Modelica runtime was not composed.");
  const profile = await composition.profiles.initial();
  requireEqual(
    profile.runtime.imageDigest.digest,
    IMAGE_DIGEST,
    "The composed profile did not retain the exact image digest.",
  );
  const kit = await createModelicaMicrosandboxQualificationKit(ENGINE);
  const receipt = await execution.runner.run({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId,
    producerGeneration: 0,
    profile: profile.executionProfile,
    source: {
      bytes: Uint8Array.from(kit.bundle.bytes),
      sha256: kit.bundle.fingerprint.digest,
    },
    policy: profile.isolationPolicy,
    outputs: profile.outputManifest,
  });
  if (
    receipt.termination.kind !== "exited" || receipt.termination.exitCode !== 0 ||
    receipt.destruction.status !== "proven" || receipt.producerGeneration !== 0
  ) throw new Error("The real local Modelica run did not close successfully.");
  requireEqual(
    receipt.runtime.isolationClass,
    "microsandbox-local-microvm-v1",
    "The receipt advertised another isolation class.",
  );
  const resolution = await execution.publications.resolvePublicationByRunId(runId, 0);
  if (resolution.status !== "published") {
    throw new Error("The qualification publication is not durably resolvable.");
  }
  publicationKnown = true;
  requireEqual(
    deterministicJson(resolution.receipt),
    deterministicJson(isolatedCodeExecutionReceiptRecord(receipt)),
    "The CAS receipt differs from the broker receipt.",
  );
  const receiptReread = await execution.publications.readReceipt(resolution.ref);
  if (!receiptReread) throw new Error("The complete receipt cannot be reopened.");
  const byRole = new Map(resolution.receipt.outputs.map((output) => [
    output.role,
    output,
  ]));
  const evidenceRecord = byRole.get("evidence");
  const resultRecord = byRole.get("result");
  if (!evidenceRecord || !resultRecord || byRole.size !== 2) {
    throw new Error("The qualification output role set is incomplete.");
  }
  const [evidenceBytes, resultBytes] = await Promise.all([
    execution.publications.readPublishedObject(resolution.ref, evidenceRecord),
    execution.publications.readPublishedObject(resolution.ref, resultRecord),
  ]);
  if (!evidenceBytes || !resultBytes) {
    throw new Error("The publication-gated qualification bytes cannot be reopened.");
  }
  requireEqual(
    await fingerprintResourceBytes(evidenceBytes),
    evidenceRecord.sha256,
    "The reopened evidence digest drifted.",
  );
  requireEqual(
    await fingerprintResourceBytes(resultBytes),
    resultRecord.sha256,
    "The reopened CSV digest drifted.",
  );
  const evidence = await validateModelicaIsolatedRun({
    bundle: kit.bundle.document,
    evidenceBytes,
    resultBytes,
  });
  const metric = evidence.metrics.find((entry) => entry.id === "temperature_final");
  if (!metric || metric.unit !== "degC" || Math.abs(metric.value - 22) > 1e-8) {
    throw new Error("The externally parsed OMC result did not reach 22 degC.");
  }
  const capture = await createModelicaMicrosandboxQualificationCapture({
    schemaVersion: "modelica-microsandbox-qualification-capture/1.0",
    status: "qualified-live-smoke",
    qualifiedAt: new Date().toISOString(),
    executionProfileFingerprint: profile.profileFingerprint,
    image: {
      // Persist the profile's canonical OCI identity, not the short local
      // input spelling, so durable readback proves the profile it reopens.
      reference: profile.runtimeBackend.imageReference,
      digest: profile.runtime.imageDigest,
    },
    worker: {
      wrapperSha256: MODELICA_QUALIFIED_KIT_WRAPPER_SHA256,
      workerContractSha256: MODELICA_QUALIFIED_KIT_WORKER_CONTRACT_SHA256,
      denoLockSha256: MODELICA_QUALIFIED_KIT_DENO_LOCK_SHA256,
    },
    basis: kit.basis,
    bundle: {
      document: kit.bundle.document,
      fingerprint: kit.bundle.fingerprint,
      byteCount: kit.bundle.bytes.byteLength,
    },
    executionRunId: runId,
    receipt: isolatedCodeExecutionReceiptRecord(receipt),
    evidence,
  });
  const store = new FileModelicaMicrosandboxQualificationStore(captureDirectory);
  const reference = await store.save(capture);

  // Recreate the CAS adapter and qualification authority to exercise durable
  // readback rather than sharing in-memory broker state.
  const restartedPublications = new FileIsolatedOutputCas(casDirectory);
  const authority = new PublicationBackedModelicaMicrosandboxQualificationAuthority({
    store: new FileModelicaMicrosandboxQualificationStore(captureDirectory),
    publications: restartedPublications,
    pinnedCaptureFingerprint: reference.fingerprint,
  });
  const reopened = await authority.reopenQualified(profile);
  if (!reopened || deterministicJson(reopened) !== deterministicJson(reference)) {
    throw new Error("The durable qualification authority rejected the candidate.");
  }
  const publicationAfterRestart = await restartedPublications
    .resolvePublicationByRunId(runId, 0);
  if (publicationAfterRestart.status !== "published") {
    throw new Error("The restarted CAS lost the qualification publication.");
  }
  gateResult = {
    schemaVersion: "modelica-microsandbox-vertical-gate/1.0",
    status: "passed-qualified-live-smoke",
    scope: {
      executionProfile: profile.executionProfile,
      model: "linear-thermal-ramp-v1@0.1.0",
      scenario: "linear-ramp-nominal",
      arbitraryModelica: false,
      projectOperationActivation: false,
    },
    imageReference: IMAGE_REFERENCE,
    isolationClass: receipt.runtime.isolationClass,
    profileFingerprint: profile.profileFingerprint,
    bundleFingerprint: kit.bundle.fingerprint,
    receiptFingerprint: receipt.fingerprint,
    publication: resolution.ref,
    outputs: resolution.receipt.outputs.map((output) => ({
      role: output.role,
      byteCount: output.byteCount,
      sha256: output.sha256,
    })),
    metric,
    destruction: receipt.destruction,
    durableQualification: reopened,
    casPublicationAfterRestart: publicationAfterRestart.status,
  };
} catch (error) {
  gateFailure = error;
} finally {
  if (execution && !publicationKnown) {
    try {
      const resolution = await execution.publications.resolvePublicationByRunId(
        runId,
        0,
      );
      if (resolution.status === "published") {
        if (resolution.receipt.destruction.status !== "proven") {
          cleanupFailure = new Error("Published receipt lacks proven VM cleanup.");
        }
      } else if (resolution.status === "not-published") {
        const destruction = await execution.recovery.destroyByRunId(runId, 0);
        if (destruction.status !== "proven") {
          cleanupFailure = new Error("Emergency unpublished-run cleanup failed.");
        }
      } else {
        cleanupFailure = new Error(
          "Emergency cleanup is quarantined because publication is ambiguous.",
        );
      }
    } catch (error) {
      cleanupFailure = error;
    }
  }
}

if (gateFailure !== undefined && cleanupFailure !== undefined) {
  throw new AggregateError(
    [gateFailure, cleanupFailure],
    "The Modelica vertical and emergency cleanup both failed.",
  );
}
if (cleanupFailure !== undefined) throw cleanupFailure;
if (gateFailure !== undefined) throw gateFailure;
console.log(JSON.stringify(gateResult, null, 2));

function requireEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(message);
}
