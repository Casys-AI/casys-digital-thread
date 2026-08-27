/**
 * Opt-in real vertical gate for the qualified local CalculiX execution path.
 *
 * The image must already be present in the local Microsandbox cache under the
 * exact digest-pinned reference below. This gate crosses one existing ROP2,
 * its reviewed MechanicalProofCase and exact STEP, composition, broker, one
 * local microVM, all nine publication-gated outputs, external CalculiX format
 * validation, physical requirement evaluation, durable evidence replay and
 * broker-proven microVM cleanup. It neither builds nor pulls an image.
 *
 * Run from the repository root on macOS after the runtime bootstrap is ready:
 * deno run --no-prompt --frozen --node-modules-dir=auto \
 *   --allow-read=config,state,src,node_modules,/tmp,/private/tmp \
 *   --allow-write=/tmp,/private/tmp \
 *   --allow-env=NAPI_RS_ENFORCE_VERSION_CHECK,NAPI_RS_NATIVE_LIBRARY_PATH,NAPI_RS_FORCE_WASI,NAPI_RS_WASI_FLAVOR,MSB_PATH,MSB_LIBKRUNFW_PATH,MSB_CONFIG_PATH,MSB_HOME,MSB_BACKEND,MSB_API_URL,MSB_API_KEY,MSB_PROFILE \
 *   --allow-ffi=node_modules \
 *   scripts/gates/verify-calculix-microsandbox-vertical.ts --run
 */

import { createCalculixIsolatedExecutionComposition } from "../../src/adapters/fea/isolated-v3/calculix-isolated-execution-composition.ts";
import { CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR } from "../../src/adapters/fea/isolated-v3/calculix-isolated-output-batch-inspector.ts";
import {
  CALCULIX_ISOLATED_OUTPUT_MANIFEST,
  type CalculixIsolatedStaticResult,
  createCalculixIsolatedInputBundle,
  validateCalculixIsolatedOutput,
  validateCalculixIsolatedOutputBatch,
} from "../../src/domain/fea/isolated-v3/calculix-isolated-execution.ts";
import {
  isolatedCodeOutputManifestsEqual,
} from "../../src/domain/compile/isolation/isolated-code-execution.ts";
import { validateMechanicalProofCase } from "../../src/domain/fea/seal-case/mechanical-proof-case.ts";
import { fingerprintResourceBytes } from "../../src/domain/compile/source/provider-resource-reader.ts";
import { validateResolvedOperationPlanV2 } from "../../src/domain/compile/rop/resolved-operation-plan-v2.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../src/domain/kernel/deterministic-json.ts";

if (Deno.args.length !== 1 || Deno.args[0] !== "--run") {
  console.log(JSON.stringify({
    schemaVersion: "calculix-microsandbox-vertical-gate/1.0",
    status: "skipped",
    reason: "Pass --run to exercise the qualified local vertical.",
  }));
  Deno.exit(0);
}

const IMAGE_DIGEST = "9b3a7468bfbc3f0fe27f7a9ac17c0eb72f1925968173e5a01d985cfa19cbc0a2";
const IMAGE_REFERENCE = `casys/calculix-microsandbox-worker@sha256:${IMAGE_DIGEST}`;
const WRAPPER_PATH = "src/adapters/fea/isolated-v3/calculix-static-proof-v1/run.ts";
const WRAPPER_SHA256 =
  "507c29da72e346aa87465ce96572b19b42e96105c64b2854be73d6894592e4e2";
const PROOF_CAPTURE_SHA256 =
  "3496d77f8cb3db27e8612dc51174eecb2ca9db77779133c81f207d0db0fcad28";
const PROOF_CAPTURE_PATH =
  `state/local/fea-proof-case-captures/${PROOF_CAPTURE_SHA256}.json`;
const STEP_SHA256 = "c2f04aa6660caad85bc1a179d64ab2f68cd966781a2646a5c8e8be308fbe187f";
const STEP_PATH = `state/local/thread-assets/${STEP_SHA256}.step`;
const PLAN_SHA256 = "1e33865aca05f2811363969843e28bb6eb3ee785f4fb9407e070e0c95e70fbc6";
const PLAN_PATH =
  `state/local/recorded-analysis/resolved-operation-plans/${PLAN_SHA256}`;
const LIMITS = Object.freeze({
  maxWallTimeMs: 180_000,
  maxCpuTimeMs: 160_000,
  maxMemoryBytes: 3 * 1_073_741_824,
  maxProcesses: 64,
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 1_048_576,
  maxOutputFileBytes: 128 * 1_048_576,
  maxOutputTotalBytes: 256 * 1_048_576,
});
const POLICY = Object.freeze({
  id: "calculix-microsandbox-deny-all-v1",
  version: "1.0.0",
  fingerprint: await sha256Fingerprint({
    schemaVersion: "calculix-microsandbox-policy/1.0",
    backend: "microsandbox-local@0.6.8",
    imageReference: IMAGE_REFERENCE,
    network: "deny-all",
    pullPolicy: "never",
    securityProfile: "restricted",
    workerUser: "65532:65532",
    fixedExecutables: ["gmsh", "ccx"],
    limits: LIMITS,
  }),
});

const planBytes = await Deno.readFile(PLAN_PATH);
requireEqual(
  await fingerprintResourceBytes(planBytes),
  PLAN_SHA256,
  "The recorded ROP2 bytes differ from their content-addressed path.",
);
const planText = new TextDecoder("utf-8", { fatal: true }).decode(planBytes);
const plan = validateResolvedOperationPlanV2(JSON.parse(planText));
requireEqual(
  planText,
  deterministicJson(plan),
  "The recorded ROP2 bytes are not canonical JSON.",
);
if (plan.action.kind !== "static-structural-analysis") {
  throw new Error("The recorded ROP2 does not authorize a CalculiX static run.");
}
const action = plan.action;
if (
  plan.authorization.kind !== "human-mrtr-and-qualified-method" ||
  plan.expectedProviderResources.resourceProfile.id !==
    "mcp-calculix.recorded-static-artifacts" ||
  plan.recovery.mode !== "same-request-readback-no-blind-redispatch"
) {
  throw new Error("The recorded ROP2 lacks the reviewed CalculiX authority.");
}

const proofCaptureBytes = await Deno.readFile(PROOF_CAPTURE_PATH);
requireEqual(
  await fingerprintResourceBytes(proofCaptureBytes),
  PROOF_CAPTURE_SHA256,
  "The FEA proof capture differs from its content-addressed path.",
);
const proofCapture = record(
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(proofCaptureBytes)),
  "FEA proof capture",
);
requireEqual(
  proofCapture.schemaVersion,
  "fea-proof-case-capture/1.0",
  "The ROP2 source is not a registered FEA proof capture.",
);
const canonicalProofText = text(
  proofCapture.canonicalProofText,
  "FEA proof capture canonicalProofText",
);
const proof = validateMechanicalProofCase(JSON.parse(canonicalProofText));
requireEqual(
  deterministicJson(proof),
  canonicalProofText,
  "The proof capture does not contain canonical proof-case bytes.",
);
const proofFingerprint = await sha256Fingerprint(proof);
requireEqual(
  proof.id,
  action.input.proofCase.id,
  "The proof-case identity differs from the recorded ROP2.",
);
requireEqual(
  PROOF_CAPTURE_SHA256,
  action.input.proofCase.fingerprint.digest,
  "The proof-capture fingerprint differs from the recorded ROP2.",
);
requireEqual(
  plan.authorization.methodQualification.fingerprint.digest,
  PROOF_CAPTURE_SHA256,
  "The qualified method does not name the exact proof authority capture.",
);
requireEqual(
  text(proofCapture.proofDigest, "FEA proof capture proofDigest"),
  proofFingerprint.digest,
  "The proof capture semantic digest differs from its canonical proof text.",
);
assertSourceBinding(
  action.input.proofCase.sourceBinding,
  PROOF_CAPTURE_SHA256,
  "application/json",
  proofCaptureBytes.byteLength,
);

const stepBytes = await Deno.readFile(STEP_PATH);
requireEqual(
  await fingerprintResourceBytes(stepBytes),
  STEP_SHA256,
  "The STEP bytes differ from their content-addressed path.",
);
assertSourceBinding(
  action.input.geometrySourceBinding,
  STEP_SHA256,
  "model/step",
  stepBytes.byteLength,
);
const bundle = await createCalculixIsolatedInputBundle({
  requestId: action.requestId,
  proof,
  stepBytes,
  elementOrder: action.input.effectiveElementOrder,
  timeoutMs: action.input.effectiveTimeoutMs,
});
requireEqual(
  await fingerprintResourceBytes(await Deno.readFile(WRAPPER_PATH)),
  WRAPPER_SHA256,
  "The local wrapper bytes differ from the digest bound into the image.",
);

const unique = crypto.randomUUID();
const agentRunId = `calculix.vertical.${unique}`;
const executionRunId = `calculix.vertical.execution.${unique}`;
const temporaryDirectory = await Deno.realPath(
  await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "casys-calculix-microsandbox-vertical-",
  }),
);

let execution:
  | NonNullable<
    Awaited<ReturnType<typeof createCalculixIsolatedExecutionComposition>>[
      "execution"
    ]
  >
  | undefined;
let publicationKnown = false;
let gateFailure: unknown;
let cleanupFailure: unknown;
let gateResult: Record<string, unknown> | undefined;

try {
  const composition = await createCalculixIsolatedExecutionComposition(
    {
      profile: {
        imageReference: IMAGE_REFERENCE,
        wrapperSha256: WRAPPER_SHA256,
        policy: POLICY,
        limits: LIMITS,
      },
      runtime: {},
    },
    {
      outputCasDirectory: `${temporaryDirectory}/cas`,
      attemptDirectory: `${temporaryDirectory}/attempts`,
      evidenceDirectory: `${temporaryDirectory}/evidence`,
      leaseDirectory: `${temporaryDirectory}/leases`,
      durabilitySyncBoundary: temporaryDirectory,
    },
  );
  execution = composition.execution;
  if (execution === undefined) {
    throw new Error("The explicit Microsandbox runtime was not composed.");
  }
  const profile = await composition.profiles.initial();
  requireEqual(
    profile.runtime.imageDigest.digest,
    IMAGE_DIGEST,
    "The composed runtime did not retain the qualified image digest.",
  );

  const identity = Object.freeze({
    projectId: plan.run.projectId,
    agentRunId,
    executionRunId,
    requestId: action.requestId,
    startedAt: new Date().toISOString(),
    resolvedOperationPlanFingerprint: {
      algorithm: "sha256" as const,
      digest: PLAN_SHA256,
    },
    proofFingerprint: bundle.manifest.proofFingerprint,
    step: Object.freeze({
      byteCount: bundle.manifest.step.byteCount,
      sha256: bundle.manifest.step.sha256,
    }),
    bundleFingerprint: bundle.fingerprint,
    profile,
  });
  const first = await execution.execute.execute({ identity, bundle });
  if (first.attempt.phase !== "evidence-captured") {
    throw new Error("The CalculiX attempt did not reach durable evidence capture.");
  }
  const evidence = first.evidence;
  const receipt = evidence.receipt;
  if (
    receipt.termination.kind !== "exited" ||
    receipt.termination.exitCode !== 0 ||
    receipt.destruction.status !== "proven"
  ) {
    throw new Error("The real CalculiX worker did not close successfully.");
  }
  requireEqual(
    receipt.runtime.isolationClass,
    "microsandbox-local-microvm-v1",
    "The receipt advertised a different isolation class.",
  );
  if (
    receipt.outputs.length !== CALCULIX_ISOLATED_OUTPUT_MANIFEST.length ||
    !isolatedCodeOutputManifestsEqual(
      receipt.outputs,
      CALCULIX_ISOLATED_OUTPUT_MANIFEST,
    )
  ) {
    throw new Error("The receipt does not contain the exact nine-output profile.");
  }

  const resolution = await execution.publications.resolvePublicationByRunId(
    executionRunId,
    receipt.producerGeneration,
  );
  if (resolution.status !== "published") {
    throw new Error("The run-keyed CAS publication was not durably resolvable.");
  }
  publicationKnown = true;
  requireEqual(
    deterministicJson(resolution.receipt),
    deterministicJson(receipt),
    "The CAS receipt record differs from the evidence receipt.",
  );
  const rereadReceipt = await execution.publications.readReceipt(resolution.ref);
  if (rereadReceipt === undefined) {
    throw new Error("The publication-gated complete receipt could not be reopened.");
  }
  requireEqual(
    rereadReceipt.fingerprint.digest,
    receipt.fingerprint.digest,
    "The reopened receipt fingerprint drifted.",
  );

  const outputBytes = new Map<string, Uint8Array>();
  const outputs: Record<string, unknown>[] = [];
  let totalOutputBytes = 0;
  for (const member of resolution.receipt.outputs) {
    const bytes = await execution.publications.readPublishedObject(
      resolution.ref,
      member,
    );
    if (bytes === undefined) {
      throw new Error(`The publication-gated ${member.role} object is unavailable.`);
    }
    requireEqual(
      bytes.byteLength,
      member.byteCount,
      `The reopened ${member.role} byte count drifted.`,
    );
    requireEqual(
      await fingerprintResourceBytes(bytes),
      member.sha256,
      `The reopened ${member.role} digest drifted.`,
    );
    const declaration = CALCULIX_ISOLATED_OUTPUT_MANIFEST.find((item) =>
      item.role === member.role
    );
    if (declaration === undefined) {
      throw new Error(`The output role ${member.role} is not registered.`);
    }
    validateCalculixIsolatedOutput(declaration, bytes);
    outputBytes.set(member.role, bytes);
    totalOutputBytes += bytes.byteLength;
    outputs.push({
      role: member.role,
      basename: member.basename,
      byteCount: member.byteCount,
      sha256: member.sha256,
      validation: "registered-format-and-publication-gated-reread",
    });
  }
  if (totalOutputBytes > LIMITS.maxOutputTotalBytes) {
    throw new Error("The reopened CalculiX batch exceeds the profile ceiling.");
  }
  const observedStep = requiredOutput(outputBytes, "input.step");
  if (!sameBytes(observedStep, stepBytes)) {
    throw new Error("The CAS-published STEP differs from the reviewed ROP2 input.");
  }
  validateCalculixIsolatedOutputBatch(
    bundle.manifest,
    outputBytes,
    evidence.result,
    CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR,
  );
  const requirementChecks = evaluatePhysicalRequirements(
    proof.requirements,
    evidence.result.metrics,
  );

  // A published run must not be passed to recovery: the CAS recovery port is
  // reserved for absent publications and fences that generation against later
  // writes. The broker already destroyed and listed the microVM before it
  // issued this receipt. Reopen the publication and evidence instead.
  const publicationAfterReread = await execution.publications
    .resolvePublicationByRunId(executionRunId, receipt.producerGeneration);
  if (publicationAfterReread.status !== "published") {
    throw new Error("The durable CAS publication changed after complete reread.");
  }

  const replay = await execution.execute.execute({ identity, bundle });
  if (
    replay.attempt.phase !== "evidence-captured" ||
    replay.evidence.fingerprint.digest !== evidence.fingerprint.digest
  ) {
    throw new Error("Durable evidence replay diverged after publication reread.");
  }

  gateResult = {
    schemaVersion: "calculix-microsandbox-vertical-gate/1.0",
    status: "passed",
    imageReference: IMAGE_REFERENCE,
    isolationClass: receipt.runtime.isolationClass,
    recordedAuthority: {
      planSha256: PLAN_SHA256,
      planId: plan.id,
      proofCaptureSha256: PROOF_CAPTURE_SHA256,
      proofSemanticSha256: proofFingerprint.digest,
      mrtrDecisionId: plan.authorization.mrtr.decisionId,
      mrtrApprovalId: plan.authorization.mrtr.approvalId,
    },
    executionProfile: profile.executionProfile,
    profileFingerprint: profile.profileFingerprint,
    wrapperSha256: WRAPPER_SHA256,
    bundleSha256: bundle.fingerprint.digest,
    proofSha256: bundle.manifest.proofFingerprint.digest,
    step: bundle.manifest.step,
    receiptFingerprint: receipt.fingerprint,
    producerGeneration: receipt.producerGeneration,
    evidenceFingerprint: evidence.fingerprint,
    publication: resolution.ref,
    outputs,
    outputCount: outputs.length,
    totalOutputBytes,
    mesh: evidence.result.mesh,
    metrics: evidence.result.metrics,
    physicalRequirements: requirementChecks,
    executionIdentity: evidence.executionIdentity,
    destruction: {
      broker: receipt.destruction.status,
      authority: "receipt-issued-after-backend-destroy-and-run-label-list",
    },
    casPublicationAfterReread: publicationAfterReread.status,
    durableReplayAfterPublication: "exact-evidence-fingerprint",
  };
} catch (error) {
  gateFailure = error;
} finally {
  if (execution !== undefined && !publicationKnown) {
    try {
      const resolution = await execution.publications.resolvePublicationByRunId(
        executionRunId,
        0,
      );
      if (resolution.status === "published") {
        if (resolution.receipt.destruction.status !== "proven") {
          cleanupFailure = new Error(
            "Published emergency receipt lacks proven broker cleanup.",
          );
        } else {
          publicationKnown = true;
        }
      } else if (resolution.status === "not-published") {
        const recovery = await execution.recovery.destroyByRunId(executionRunId, 0);
        if (recovery.status !== "proven") {
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
  try {
    await Deno.remove(temporaryDirectory, { recursive: true });
  } catch (error) {
    cleanupFailure ??= error;
  }
}

if (gateFailure !== undefined && cleanupFailure !== undefined) {
  throw new AggregateError(
    [gateFailure, cleanupFailure],
    "The vertical gate and its run-scoped cleanup both failed.",
  );
}
if (cleanupFailure !== undefined) throw cleanupFailure;
if (gateFailure !== undefined) throw gateFailure;
if (gateResult === undefined) throw new Error("The gate produced no result.");
console.log(JSON.stringify(
  {
    ...gateResult,
    residue: {
      temporaryDirectory: "removed",
      sandbox: "broker-destruction-proven-before-receipt",
    },
  },
  null,
  2,
));

function assertSourceBinding(
  bindingName: string,
  sha256: string,
  mediaType: string,
  byteCount: number | undefined,
): void {
  const matches = plan.sources.filter((source) => source.bindingName === bindingName);
  if (matches.length !== 1) {
    throw new Error(`ROP2 source binding ${bindingName} is not unique.`);
  }
  const artifact = matches[0]!.artifact;
  if (
    artifact.fingerprint.algorithm !== "sha256" ||
    artifact.fingerprint.digest !== sha256 ||
    artifact.mediaType !== mediaType ||
    (byteCount !== undefined && artifact.byteCount !== byteCount)
  ) {
    throw new Error(`ROP2 source binding ${bindingName} differs from local bytes.`);
  }
}

function evaluatePhysicalRequirements(
  requirements: typeof proof.requirements,
  metrics: CalculixIsolatedStaticResult["metrics"],
): readonly Record<string, unknown>[] {
  return Object.freeze(requirements.map((requirement) => {
    const observed = requirement.metric === "maximum-displacement"
      ? {
        value: metrics.maximumDisplacement.value,
        unit: "mm" as const,
        comparableLimit: requirement.limit.value,
      }
      : {
        value: metrics.maximumVonMises.value,
        unit: "MPa" as const,
        comparableLimit: requirement.limit.value / 1_000_000,
      };
    if (requirement.operator !== "<=" || observed.value > observed.comparableLimit) {
      throw new Error(`Physical requirement ${requirement.id} did not pass.`);
    }
    return Object.freeze({
      id: requirement.id,
      metric: requirement.metric,
      operator: requirement.operator,
      observed: { value: observed.value, unit: observed.unit },
      limit: requirement.limit,
      status: "passed",
    });
  }));
}

function requiredOutput(
  outputs: ReadonlyMap<string, Uint8Array>,
  role: string,
): Uint8Array {
  const bytes = outputs.get(role);
  if (bytes === undefined) throw new Error(`Missing output ${role}.`);
  return bytes;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be non-empty text.`);
  }
  return value;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function requireEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (actual !== expected) throw new Error(message);
}
