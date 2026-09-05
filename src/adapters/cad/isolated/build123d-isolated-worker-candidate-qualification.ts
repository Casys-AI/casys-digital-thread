/**
 * Maintainer-only qualification of an imported Build123d isolated-worker
 * candidate. Policy, limits, worker command, fixture and validator stay
 * code-owned. The CLI/gate never accepts a provider, image, digest, platform,
 * command, endpoint, tool, worker, binding, unit, or args.
 *
 * Import already owns acquisition. This path never builds Docker, never loads
 * or removes images, and never assumes Docker and Microsandbox digest identity.
 */

import {
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeOutputDeclaration,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { pinnedOciImageReference } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import type { CapabilityRuntimeHostObservation } from "../../../domain/capability/runtime/capability-runtime-catalog.ts";
import {
  fingerprintFirstPartyMicrosandboxImageCandidateImportRecord,
  type FirstPartyMicrosandboxImageCandidateImportRecord,
} from "../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  assertBoundCandidateImportPhysicalImageId,
  BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
  buildFirstPartyMicrosandboxImageCandidateQualificationRecord,
  type FirstPartyMicrosandboxImageCandidateQualificationRecord,
  firstPartyMicrosandboxImageCandidateQualificationRoot,
  persistFirstPartyMicrosandboxImageCandidateQualificationRecord,
  readObservedLinuxArm64Host,
} from "../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import {
  type Build123dExecutionComposition,
  type Build123dExecutionCompositionPaths,
  type Build123dExecutionServerOptions,
  createBuild123dExecutionComposition,
} from "./build123d-execution-composition.ts";
import { createBuild123dExecutionServerOptionsForBoundCandidateImport } from "./first-party-build123d-execution.ts";
import { OCCT_STEP_OUTPUT_VALIDATOR_REF } from "./occt-step-output-validator-contract.ts";
import { OcctStepOutputValidator } from "./occt-step-output-validator.ts";

export const BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA =
  "build123d-isolated-worker-candidate-qualification-plan/1.0" as const;
export const BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA =
  "build123d-isolated-worker-candidate-qualification/1.0" as const;
export const BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_FIXTURE_ID =
  "build123d-isolated-worker-adversarial-quiescence-v1" as const;

/**
 * Code-owned adversarial source. It proves worker quiescence and isolation
 * controls; it is not a product verdict.
 */
export const BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_SOURCE =
  "from build123d import Box\n" +
  "import os, signal, subprocess, sys\n" +
  "try:\n" +
  "    os.kill(os.getppid(), signal.SIGKILL)\n" +
  "except PermissionError:\n" +
  "    pass\n" +
  "else:\n" +
  "    raise RuntimeError('untrusted child killed its supervisor')\n" +
  "try:\n" +
  "    open('/run/casys/forged', 'wb').write(b'forged')\n" +
  "except PermissionError:\n" +
  "    pass\n" +
  "else:\n" +
  "    raise RuntimeError('untrusted child wrote supervisor control state')\n" +
  "print('qualified-build123d-source', flush=True)\n" +
  "subprocess.Popen([sys.executable, '-I', '-B', '-c', " +
  "\"import time; time.sleep(0.75); open('/out/geometry.step', 'wb').write(b'corrupt')\"" +
  "], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, " +
  "stderr=subprocess.DEVNULL, close_fds=True, start_new_session=True)\n" +
  "result = Box(10, 20, 30)\n";

export interface Build123dIsolatedWorkerCandidateQualificationPlan {
  readonly schemaVersion:
    typeof BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly mode: "plan";
  readonly mutation: false;
  readonly physicalImageId: typeof BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID;
  readonly candidateReference: string;
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly fixtureId:
    typeof BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_FIXTURE_ID;
  readonly runtimeQualification: "not-run";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
}

export interface Build123dIsolatedWorkerCandidateQualificationResult {
  readonly schemaVersion:
    typeof BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly status: "passed";
  readonly physicalImageId: typeof BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID;
  readonly candidateReference: string;
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly isolationClass: string;
  readonly executionProfile: { readonly id: string; readonly version: string };
  readonly sourceSha256: string;
  readonly receiptFingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
  readonly output: {
    readonly role: string;
    readonly byteCount: number;
    readonly sha256: string;
    readonly validation: string;
    readonly reread: "publication-gated";
  };
  readonly destruction: "proven";
  readonly runtimeQualification: "passed";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
  readonly engineeringLevels: {
    readonly l3: false;
    readonly l4: false;
    readonly l5: false;
  };
  readonly qualification: FirstPartyMicrosandboxImageCandidateQualificationRecord;
}

export interface Build123dIsolatedWorkerCandidateQualificationPorts {
  readonly compose?: (
    options: Build123dExecutionServerOptions,
    paths: Build123dExecutionCompositionPaths,
  ) => Promise<Build123dExecutionComposition>;
  readonly validateOutput?: (
    declaration: IsolatedCodeOutputDeclaration,
    bytes: Uint8Array,
  ) => Promise<void>;
  readonly observedHost: { read(): Promise<CapabilityRuntimeHostObservation> };
  readonly stateRoot?: string;
}

export async function planBuild123dIsolatedWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<Build123dIsolatedWorkerCandidateQualificationPlan> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
  );
  const importRecordFingerprint =
    await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record);
  const plan: Build123dIsolatedWorkerCandidateQualificationPlan = {
    schemaVersion: BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA,
    kind: "candidate-qualification",
    mode: "plan",
    mutation: false,
    physicalImageId: BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
    candidateReference: record.candidate.microsandbox.candidateReference,
    identities: record.identities,
    importRecordFingerprint,
    stateRoot: firstPartyMicrosandboxImageCandidateQualificationRoot(
      BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
      importRecordFingerprint,
    ),
    fixtureId: BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_FIXTURE_ID,
    runtimeQualification: "not-run",
    eligibleForPromotion: false,
    evidence: "host-runtime-only",
  };
  return Object.freeze(plan);
}

export function renderBuild123dIsolatedWorkerCandidateQualificationPlanText(
  plan: Build123dIsolatedWorkerCandidateQualificationPlan,
): string {
  return [
    `schemaVersion=${plan.schemaVersion}`,
    `kind=${plan.kind}`,
    `mode=${plan.mode}`,
    `mutation=${plan.mutation}`,
    `physicalImageId=${plan.physicalImageId}`,
    `candidateReference=${plan.candidateReference}`,
    `microsandbox.manifestDigest=${plan.identities.microsandboxManifestDigest}`,
    `importRecord.fingerprint=${plan.importRecordFingerprint}`,
    `stateRoot=${plan.stateRoot}`,
    `runtimeQualification=${plan.runtimeQualification}`,
    `eligibleForPromotion=${plan.eligibleForPromotion}`,
    "Candidate qualification only. Promotion is false.",
    "This is not L3/L4/L5 engineering evidence.",
    "",
  ].join("\n");
}

export async function qualifyBuild123dIsolatedWorkerCandidate(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: Build123dIsolatedWorkerCandidateQualificationPorts,
): Promise<Build123dIsolatedWorkerCandidateQualificationResult> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
  );
  const host = await readObservedLinuxArm64Host(ports.observedHost);
  const options = await createBuild123dExecutionServerOptionsForBoundCandidateImport(
    record,
  );
  const importRecordFingerprint =
    await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record);
  const stateRoot = ports.stateRoot ??
    firstPartyMicrosandboxImageCandidateQualificationRoot(
      BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
      importRecordFingerprint,
    );
  const outputCasDirectory = `${stateRoot}/outputs`;
  const compose = ports.compose ?? createBuild123dExecutionComposition;
  const composition = await compose(options, { outputCasDirectory });
  const execution = composition.execution;
  if (execution === undefined) {
    throw new Error("The imported Build123d candidate runtime was not composed.");
  }
  const profile = await composition.profiles.initial();
  const expectedImageReference = pinnedOciImageReference(
    record.candidate.microsandbox.candidateReference,
    "$build123dIsolatedWorkerCandidate.imageReference",
  );
  const expectedDigest = record.identities.microsandboxManifestDigest.slice(
    "sha256:".length,
  );
  if (
    profile.runtimeBackend.imageReference !== expectedImageReference ||
    profile.runtime.imageDigest.digest !== expectedDigest
  ) {
    throw new Error(
      "The composed Build123d candidate profile did not retain the bound Microsandbox candidate reference and digest.",
    );
  }

  const source = new TextEncoder().encode(
    BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_SOURCE,
  );
  const sourceSha256 = await fingerprintResourceBytes(source);
  const runId = `build123d-isolated-worker-candidate-qualification-${
    (await sha256Fingerprint({
      schemaVersion: "build123d-isolated-worker-candidate-qualification-run/1.0",
      importRecordFingerprint,
      candidateReference: record.candidate.microsandbox.candidateReference,
      sourceSha256,
      observedHost: host.identity.fingerprint,
    })).digest
  }`;
  const producerGeneration = 0 as const;
  let publicationKnown = false;
  try {
    const receipt = await execution.runner.run({
      schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
      runId,
      producerGeneration,
      profile: profile.executionProfile,
      source: { bytes: source, sha256: sourceSha256 },
      policy: profile.isolationPolicy,
      outputs: profile.outputManifest,
    });
    if (receipt.termination.kind !== "exited" || receipt.termination.exitCode !== 0) {
      throw new Error(
        "The imported Build123d candidate worker did not exit successfully.",
      );
    }
    const resolution = await execution.publications.resolvePublicationByRunId(
      runId,
      producerGeneration,
    );
    if (resolution.status !== "published") {
      throw new Error(
        "The Build123d candidate qualification CAS publication was not durably resolvable.",
      );
    }
    publicationKnown = true;
    if (receipt.destruction.status !== "proven") {
      throw new Error(
        "Build123d candidate qualification requires proven microVM destruction.",
      );
    }
    if (
      deterministicJson(resolution.receipt) !==
        deterministicJson(isolatedCodeExecutionReceiptRecord(receipt))
    ) {
      throw new Error(
        "The Build123d candidate qualification CAS receipt record differs from the run receipt.",
      );
    }
    const rereadReceipt = await execution.publications.readReceipt(resolution.ref);
    if (rereadReceipt === undefined) {
      throw new Error(
        "The Build123d candidate qualification publication-gated receipt could not be reopened.",
      );
    }
    if (rereadReceipt.fingerprint.digest !== receipt.fingerprint.digest) {
      throw new Error(
        "The reopened Build123d candidate qualification receipt fingerprint drifted.",
      );
    }
    if (resolution.receipt.outputs.length !== 1) {
      throw new Error(
        "The published Build123d candidate qualification receipt does not contain exactly one output.",
      );
    }
    const member = resolution.receipt.outputs[0]!;
    const stepBytes = await execution.publications.readPublishedObject(
      resolution.ref,
      member,
    );
    if (stepBytes === undefined) {
      throw new Error(
        "The publication-gated Build123d candidate STEP object could not be reopened.",
      );
    }
    if (
      stepBytes.byteLength !== member.byteCount ||
      await fingerprintResourceBytes(stepBytes) !== member.sha256
    ) {
      throw new Error(
        "The reopened Build123d candidate STEP drifted after CAS reread.",
      );
    }
    const validateOutput = ports.validateOutput ??
      new OcctStepOutputValidator().validateOutput;
    await validateOutput(profile.outputManifest[0]!, stepBytes);
    const qualification =
      await persistFirstPartyMicrosandboxImageCandidateQualificationRecord(
        stateRoot,
        await buildFirstPartyMicrosandboxImageCandidateQualificationRecord(record, {
          observedHost: host.observation,
          runId,
          receiptFingerprint: receipt.fingerprint,
        }),
      );
    const result: Build123dIsolatedWorkerCandidateQualificationResult = {
      schemaVersion: BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA,
      kind: "candidate-qualification",
      status: "passed",
      physicalImageId: BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
      candidateReference: record.candidate.microsandbox.candidateReference,
      identities: record.identities,
      importRecordFingerprint,
      stateRoot,
      isolationClass: receipt.runtime.isolationClass,
      executionProfile: profile.executionProfile,
      sourceSha256,
      receiptFingerprint: receipt.fingerprint,
      output: {
        role: member.role,
        byteCount: member.byteCount,
        sha256: member.sha256,
        validation:
          `${OCCT_STEP_OUTPUT_VALIDATOR_REF.id}@${OCCT_STEP_OUTPUT_VALIDATOR_REF.version}`,
        reread: "publication-gated",
      },
      destruction: "proven",
      runtimeQualification: "passed",
      eligibleForPromotion: false,
      evidence: "host-runtime-only",
      engineeringLevels: { l3: false, l4: false, l5: false },
      qualification,
    };
    return Object.freeze(result);
  } finally {
    if (!publicationKnown) {
      await recoverUnpublishedRun(execution, runId, producerGeneration);
    }
  }
}

export function renderBuild123dIsolatedWorkerCandidateQualificationResultText(
  result: Build123dIsolatedWorkerCandidateQualificationResult,
): string {
  return [
    `schemaVersion=${result.schemaVersion}`,
    `kind=${result.kind}`,
    `status=${result.status}`,
    `physicalImageId=${result.physicalImageId}`,
    `candidateReference=${result.candidateReference}`,
    `microsandbox.manifestDigest=${result.identities.microsandboxManifestDigest}`,
    `importRecord.fingerprint=${result.importRecordFingerprint}`,
    `destruction=${result.destruction}`,
    `observedHost.platform=${result.qualification.observedHost.platform}`,
    `execution.runId=${result.qualification.execution.runId}`,
    `execution.receipt=${result.qualification.execution.receiptFingerprint.algorithm}:${result.qualification.execution.receiptFingerprint.digest}`,
    `runtimeQualification=${result.runtimeQualification}`,
    `eligibleForPromotion=${result.eligibleForPromotion}`,
    "Candidate qualification only. Promotion is false.",
    "This is not L3/L4/L5 engineering evidence.",
    "",
  ].join("\n");
}

async function recoverUnpublishedRun(
  execution: NonNullable<Build123dExecutionComposition["execution"]>,
  runId: string,
  producerGeneration: 0,
): Promise<void> {
  const resolution = await execution.publications.resolvePublicationByRunId(
    runId,
    producerGeneration,
  );
  if (resolution.status === "published") {
    if (resolution.receipt.destruction.status !== "proven") {
      throw new Error(
        "Published Build123d candidate emergency receipt lacks proven broker cleanup.",
      );
    }
    return;
  }
  if (resolution.status === "not-published") {
    const destruction = await execution.recovery.destroyByRunId(
      runId,
      producerGeneration,
    );
    if (destruction.status !== "proven") {
      throw new Error(
        "Build123d candidate unpublished-run cleanup is not proven.",
      );
    }
    return;
  }
  throw new Error(
    "Build123d candidate emergency cleanup is quarantined because publication is ambiguous.",
  );
}
