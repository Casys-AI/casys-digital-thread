/**
 * Opt-in real vertical gate for the qualified local Build123d execution path.
 *
 * The worker image must already be present in the local Microsandbox cache
 * under the exact digest-pinned reference below. This gate neither builds nor
 * pulls an image: it exercises composition, the broker, one local microVM,
 * parser-backed STEP validation, atomic file CAS publication, gated reread,
 * and run-scoped destruction.
 *
 * Run from the repository root on macOS:
 * deno run --allow-read --allow-write=/tmp,/private/tmp --allow-env --allow-ffi \
 *   scripts/gates/verify-build123d-microsandbox-vertical.ts --run
 */

import { createBuild123dExecutionComposition } from "../../src/adapters/cad/isolated/build123d-execution-composition.ts";
import { OcctStepOutputValidator } from "../../src/adapters/cad/isolated/occt-step-output-validator.ts";
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
    schemaVersion: "build123d-microsandbox-vertical-gate/1.0",
    status: "skipped",
    reason: "Pass --run to exercise the qualified local vertical.",
  }));
  Deno.exit(0);
}

const IMAGE_DIGEST = "0e19aee61aaab326ec29e50753a0ef56432d255fb44fd21c40988e90ff7601f8";
const IMAGE_REFERENCE = `casys/build123d-microsandbox-worker@sha256:${IMAGE_DIGEST}`;
const LIMITS = Object.freeze({
  maxWallTimeMs: 30_000,
  maxCpuTimeMs: 25_000,
  maxMemoryBytes: 1_024 * 1_048_576,
  maxProcesses: 32,
  maxStdoutBytes: 65_536,
  maxStderrBytes: 65_536,
  maxOutputFileBytes: 128 * 1_048_576,
  maxOutputTotalBytes: 128 * 1_048_576,
});
const POLICY = Object.freeze({
  id: "build123d-microsandbox-deny-all-v1",
  version: "1.0.0",
  fingerprint: await sha256Fingerprint({
    schemaVersion: "build123d-microsandbox-policy/1.0",
    backend: "microsandbox-local@0.6.8",
    imageReference: IMAGE_REFERENCE,
    network: "deny-all",
    pullPolicy: "never",
    securityProfile: "restricted",
    supervisorUser: "0:0",
    untrustedChildUser: "65532:65532",
    limits: LIMITS,
  }),
});
const SOURCE = new TextEncoder().encode(
  "from build123d import Box\nresult = Box(10, 20, 30)\n",
);
const RUN_ID = `build123d.vertical.${crypto.randomUUID()}`;
const PRODUCER_GENERATION = 0 as const;
const temporaryDirectory = await Deno.realPath(
  await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "casys-build123d-microsandbox-vertical-",
  }),
);

let execution:
  | NonNullable<
    Awaited<ReturnType<typeof createBuild123dExecutionComposition>>["execution"]
  >
  | undefined;
let publicationKnown = false;
let gateFailure: unknown;
let cleanupFailure: unknown;
let result: unknown;

try {
  const composition = await createBuild123dExecutionComposition(
    {
      profile: {
        imageReference: IMAGE_REFERENCE,
        policy: POLICY,
        limits: LIMITS,
      },
      runtime: {},
    },
    { outputCasDirectory: `${temporaryDirectory}/cas` },
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

  const sourceSha256 = await fingerprintResourceBytes(SOURCE);
  const receipt = await execution.runner.run({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: RUN_ID,
    producerGeneration: PRODUCER_GENERATION,
    profile: profile.executionProfile,
    source: { bytes: SOURCE, sha256: sourceSha256 },
    policy: profile.isolationPolicy,
    outputs: profile.outputManifest,
  });
  if (receipt.termination.kind !== "exited" || receipt.termination.exitCode !== 0) {
    throw new Error("The real Build123d worker did not exit successfully.");
  }
  if (receipt.destruction.status !== "proven") {
    throw new Error("The broker did not obtain proven microVM destruction.");
  }
  requireEqual(
    receipt.runtime.isolationClass,
    "microsandbox-local-microvm-v1",
    "The receipt advertised a different isolation class.",
  );

  const resolution = await execution.publications.resolvePublicationByRunId(
    RUN_ID,
    PRODUCER_GENERATION,
  );
  if (resolution.status !== "published") {
    throw new Error("The run-keyed CAS publication was not durably resolvable.");
  }
  publicationKnown = true;
  requireEqual(
    deterministicJson(resolution.receipt),
    deterministicJson(isolatedCodeExecutionReceiptRecord(receipt)),
    "The CAS receipt record differs from the broker receipt.",
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
  if (resolution.receipt.outputs.length !== 1) {
    throw new Error("The published receipt does not contain exactly one output.");
  }
  const member = resolution.receipt.outputs[0]!;
  const stepBytes = await execution.publications.readPublishedObject(
    resolution.ref,
    member,
  );
  if (stepBytes === undefined) {
    throw new Error("The publication-gated STEP object could not be reopened.");
  }
  requireEqual(
    stepBytes.byteLength,
    member.byteCount,
    "The reopened STEP byte count drifted.",
  );
  requireEqual(
    await fingerprintResourceBytes(stepBytes),
    member.sha256,
    "The reopened STEP digest drifted.",
  );
  await new OcctStepOutputValidator().validateOutput(
    profile.outputManifest[0]!,
    stepBytes,
  );

  // Recovery is reserved for an unpublished generation: invoking it after a
  // published marker would attempt to fence immutable output. The broker has
  // already destroyed the microVM before issuing the proven receipt.
  const publicationAfterReread = await execution.publications
    .resolvePublicationByRunId(RUN_ID, PRODUCER_GENERATION);
  if (publicationAfterReread.status !== "published") {
    throw new Error("The durable CAS publication changed after complete reread.");
  }

  result = {
    schemaVersion: "build123d-microsandbox-vertical-gate/1.0",
    status: "passed",
    imageReference: IMAGE_REFERENCE,
    isolationClass: receipt.runtime.isolationClass,
    executionProfile: profile.executionProfile,
    profileFingerprint: profile.profileFingerprint,
    sourceSha256,
    receiptFingerprint: receipt.fingerprint,
    producerGeneration: receipt.producerGeneration,
    publication: resolution.ref,
    output: {
      role: member.role,
      basename: member.basename,
      format: member.format,
      byteCount: member.byteCount,
      sha256: member.sha256,
      validation: "occt-step-ap214@1.0.0",
      reread: "publication-gated",
    },
    destruction: {
      broker: receipt.destruction.status,
      authority: "receipt-issued-after-backend-destroy-and-run-label-list",
    },
    casPublicationAfterReread: publicationAfterReread.status,
  };
} catch (error) {
  gateFailure = error;
} finally {
  if (execution !== undefined && !publicationKnown) {
    try {
      const resolution = await execution.publications.resolvePublicationByRunId(
        RUN_ID,
        PRODUCER_GENERATION,
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
        const destruction = await execution.recovery.destroyByRunId(
          RUN_ID,
          PRODUCER_GENERATION,
        );
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
console.log(JSON.stringify(result, null, 2));

function requireEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (actual !== expected) throw new Error(message);
}
