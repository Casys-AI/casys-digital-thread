/**
 * Maintainer-only qualification of an imported CalculiX worker candidate.
 * Policy, limits, wrapper digest, worker command, fixture, validators and
 * batch inspector stay code-owned. The CLI/gate never accepts a provider,
 * image, digest, platform, command, endpoint, tool, worker, binding, unit,
 * proof path, STEP path, or args.
 *
 * Import already owns acquisition. This path never builds Docker, never loads
 * or removes images, and never assumes Docker and Microsandbox digest identity.
 * It is physical/runtime qualification only: not a product FEA verdict and not
 * L3/L4/L5 engineering evidence.
 */

import type { CalculixIsolatedExecutionAttemptIdentity } from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-attempt-store.ts";
import type { CalculixIsolatedExecutionProfile } from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import { pinnedOciImageReference } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  CALCULIX_ISOLATED_OUTPUT_MANIFEST,
  type CalculixIsolatedInputBundle,
  createCalculixIsolatedInputBundle,
} from "../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import { validateMechanicalProofCase } from "../../../domain/fea/seal-case/mechanical-proof-case.ts";
import type { CapabilityRuntimeHostObservation } from "../../../domain/capability/runtime/capability-runtime-catalog.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  fingerprintFirstPartyMicrosandboxImageCandidateImportRecord,
  type FirstPartyMicrosandboxImageCandidateImportRecord,
} from "../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  assertBoundCandidateImportPhysicalImageId,
  buildFirstPartyMicrosandboxImageCandidateQualificationRecord,
  CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
  firstPartyMicrosandboxImageCandidateQualificationIdentity,
  type FirstPartyMicrosandboxImageCandidateQualificationRecord,
  firstPartyMicrosandboxImageCandidateQualificationRoot,
  persistFirstPartyMicrosandboxImageCandidateQualificationRecord,
  readObservedLinuxArm64Host,
} from "../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import { FileCalculixIsolatedExecutionAttemptStore } from "./file-calculix-isolated-execution-attempt-store.ts";
import { CALCULIX_ISOLATED_OUTPUT_VALIDATOR } from "./fixed-calculix-isolated-execution-profile.ts";
import {
  type CalculixIsolatedExecutionComposition,
  type CalculixIsolatedExecutionCompositionPaths,
  type CalculixIsolatedExecutionServerOptions,
  createCalculixIsolatedExecutionComposition,
} from "./calculix-isolated-execution-composition.ts";
import { createCalculixIsolatedExecutionServerOptionsForBoundCandidateImport } from "./local-calculix-isolated-execution-options.ts";

export const CALCULIX_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA =
  "calculix-worker-candidate-qualification-plan/1.0" as const;
export const CALCULIX_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA =
  "calculix-worker-candidate-qualification/1.0" as const;
export const CALCULIX_WORKER_CANDIDATE_QUALIFICATION_FIXTURE_ID =
  "calculix-worker-candidate-qualification-bracket-v1" as const;
export const CALCULIX_WORKER_CANDIDATE_QUALIFICATION_PROJECT_ID =
  "calculix-worker-candidate-qualification" as const;
export const CALCULIX_WORKER_CANDIDATE_QUALIFICATION_REQUEST_ID =
  "qualification:calculix-worker-candidate" as const;

const BRACKET_STEP_FIXTURE = new URL(
  "../../../../examples/bracket/bracket.step",
  import.meta.url,
);
const BRACKET_CAD_SOURCE = new TextEncoder().encode(
  "calculix-worker-candidate-qualification code-owned bracket STEP fixture; not product CAD.\n",
);

export interface CalculixWorkerCandidateQualificationPlan {
  readonly schemaVersion: typeof CALCULIX_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly mode: "plan";
  readonly mutation: false;
  readonly physicalImageId: typeof CALCULIX_WORKER_PHYSICAL_IMAGE_ID;
  readonly candidateReference: string;
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly fixtureId: typeof CALCULIX_WORKER_CANDIDATE_QUALIFICATION_FIXTURE_ID;
  readonly runtimeQualification: "not-run";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
}

export interface CalculixWorkerCandidateQualificationResult {
  readonly schemaVersion: typeof CALCULIX_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly status: "passed";
  readonly physicalImageId: typeof CALCULIX_WORKER_PHYSICAL_IMAGE_ID;
  readonly candidateReference: string;
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly isolationClass: string;
  readonly executionProfile: { readonly id: string; readonly version: string };
  readonly bundleSha256: string;
  readonly receiptFingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
  readonly outputs: readonly {
    readonly role: string;
    readonly byteCount: number;
    readonly sha256: string;
  }[];
  readonly outputValidation: string;
  readonly reread: "publication-gated";
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

export interface CalculixWorkerCandidateQualificationPorts {
  readonly compose?: (
    options: CalculixIsolatedExecutionServerOptions,
    paths: CalculixIsolatedExecutionCompositionPaths,
  ) => Promise<CalculixIsolatedExecutionComposition>;
  readonly observedHost: { read(): Promise<CapabilityRuntimeHostObservation> };
  readonly now?: () => string;
  readonly stateRoot?: string;
}

export async function createCalculixWorkerCandidateQualificationBundle(): Promise<
  CalculixIsolatedInputBundle
> {
  const stepBytes = await Deno.readFile(BRACKET_STEP_FIXTURE);
  const stepSha256 = await fingerprintResourceBytes(stepBytes);
  const cadSourceSha256 = await fingerprintResourceBytes(BRACKET_CAD_SOURCE);
  const proof = validateMechanicalProofCase({
    schemaVersion: "mechanical-proof-case/1.0",
    id: "calculix-worker-candidate-qualification-bracket",
    revision: 1,
    scope:
      "Code-owned bracket STEP fixture used only to exercise the imported CalculiX worker image. Not a product geometry, not a project proof, and not Thread evidence.",
    evidenceBoundary:
      "Candidate-qualification physical/runtime validation only. Not a certification, material release, product FEA verdict, or L3/L4/L5 engineering evidence. Material, load and support are declared fixture assumptions for worker contract validation.",
    project: {
      id: CALCULIX_WORKER_CANDIDATE_QUALIFICATION_PROJECT_ID,
      subjectId: CALCULIX_WORKER_CANDIDATE_QUALIFICATION_PROJECT_ID,
      baseThreadSnapshot: {
        id: "calculix-worker-candidate-qualification:bracket-1",
        revision: 1,
        subjectId: CALCULIX_WORKER_CANDIDATE_QUALIFICATION_PROJECT_ID,
      },
    },
    target: {
      id: "calculix-worker-candidate-qualification-bracket",
      modelElementId: "calculix-worker-candidate-qualification-target",
    },
    authorization: {
      workItemId: "calculix-worker-candidate-qualification-work-item",
      decisionId: "calculix-worker-candidate-qualification-decision",
    },
    requirementsSource: {
      provider: "syson",
      editingContextId: "calculix-worker-candidate-qualification-context",
      elementId: "calculix-worker-candidate-qualification-requirement",
    },
    solver: {
      provider: "calculix",
      tool: "calculix_solve_static",
      resultSchemaVersion: "2.0",
    },
    cadSource: {
      kind: "parametric",
      generator: {
        provider: "casys",
        tool: "calculix-worker-candidate-qualification-fixture",
        definition: {
          mediaType: "text/plain",
          sha256: cadSourceSha256,
          bytes: BRACKET_CAD_SOURCE.byteLength,
        },
      },
      engineeringBoundary: {
        designIntent: "partial",
        editableCad: "absent",
        manufacturability: "not-established",
        limitations: [
          "Code-owned bracket candidate-qualification fixture; not a product CAD source.",
          "The FIXED selection is treated as fully fixed for worker-contract validation only.",
        ],
      },
    },
    expectedCadArtifact: {
      format: "step",
      sha256: stepSha256,
      bytes: stepBytes.byteLength,
    },
    analysis: {
      kind: "linear-static",
      material: {
        model: "isotropic-linear-elastic",
        basis:
          "Declared bracket-fixture material values for CalculiX worker candidate qualification only.",
        youngModulus: { value: 70000, unit: "MPa" },
        poissonRatio: { value: 0.33, unit: "1" },
      },
      mesh: {
        kind: "tetrahedral-volume",
        targetSize: { value: 3, unit: "mm" },
      },
      supports: [{
        id: "root-fixed",
        kind: "fixed",
        selection: {
          name: "FIXED",
          box: { min: [-31, -21, -3.1], max: [31, 21, -2.4], unit: "mm" },
        },
      }],
      loads: [{
        id: "tip-load",
        kind: "force",
        selection: {
          name: "LOADED",
          box: { min: [-31, -21, 49.4], max: [-24, 21, 50.1], unit: "mm" },
        },
        force: { value: [0, 0, -500], unit: "N" },
      }],
    },
    requirements: [{
      id: "candidate-qualification-deflection",
      name: "maxDisplacement",
      metric: "maximum-displacement",
      feature: "maxDisplacement",
      operator: "<=",
      limit: { value: 2, unit: "mm" },
    }],
  });
  return await createCalculixIsolatedInputBundle({
    requestId: CALCULIX_WORKER_CANDIDATE_QUALIFICATION_REQUEST_ID,
    proof,
    stepBytes,
    elementOrder: 2,
    timeoutMs: 120_000,
  });
}

export async function createCalculixWorkerCandidateQualificationAttemptIdentity(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  profile: CalculixIsolatedExecutionProfile,
  observedHostFingerprint: ContentFingerprint,
  bundle: CalculixIsolatedInputBundle,
  startedAt: string,
): Promise<CalculixIsolatedExecutionAttemptIdentity> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
  );
  const importRecordFingerprint =
    await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record);
  const importIdentity = firstPartyMicrosandboxImageCandidateQualificationIdentity(
    importRecordFingerprint,
  );
  const executionRunId = `calculix-worker-candidate-qualification-${
    (await sha256Fingerprint({
      schemaVersion: "calculix-worker-candidate-qualification-run/1.0",
      importRecordFingerprint,
      candidateReference: record.candidate.microsandbox.candidateReference,
      microsandboxManifestDigest: record.identities.microsandboxManifestDigest,
      observedHost: observedHostFingerprint,
      bundleFingerprint: bundle.fingerprint,
    })).digest
  }`;
  return Object.freeze({
    projectId: CALCULIX_WORKER_CANDIDATE_QUALIFICATION_PROJECT_ID,
    agentRunId: `calculix-worker-candidate-qualification-${importIdentity}`,
    executionRunId,
    requestId: bundle.manifest.requestId,
    startedAt,
    resolvedOperationPlanFingerprint: await sha256Fingerprint({
      schemaVersion: "calculix-worker-candidate-qualification-authority/1.0",
      kind: "candidate-qualification",
      physicalImageId: CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
      importRecordFingerprint,
      candidateReference: record.candidate.microsandbox.candidateReference,
      evidence: "host-runtime-only",
      eligibleForPromotion: false,
    }),
    proofFingerprint: bundle.manifest.proofFingerprint,
    step: {
      byteCount: bundle.manifest.step.byteCount,
      sha256: bundle.manifest.step.sha256,
    },
    bundleFingerprint: bundle.fingerprint,
    profile,
  });
}

export async function planCalculixWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<CalculixWorkerCandidateQualificationPlan> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
  );
  const importRecordFingerprint =
    await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record);
  const plan: CalculixWorkerCandidateQualificationPlan = {
    schemaVersion: CALCULIX_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA,
    kind: "candidate-qualification",
    mode: "plan",
    mutation: false,
    physicalImageId: CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
    candidateReference: record.candidate.microsandbox.candidateReference,
    identities: record.identities,
    importRecordFingerprint,
    stateRoot: firstPartyMicrosandboxImageCandidateQualificationRoot(
      CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
      importRecordFingerprint,
    ),
    fixtureId: CALCULIX_WORKER_CANDIDATE_QUALIFICATION_FIXTURE_ID,
    runtimeQualification: "not-run",
    eligibleForPromotion: false,
    evidence: "host-runtime-only",
  };
  return Object.freeze(plan);
}

export function renderCalculixWorkerCandidateQualificationPlanText(
  plan: CalculixWorkerCandidateQualificationPlan,
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

export async function qualifyCalculixWorkerCandidate(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: CalculixWorkerCandidateQualificationPorts,
): Promise<CalculixWorkerCandidateQualificationResult> {
  const composed = await composeCalculixWorkerCandidateQualification(
    record,
    ports,
    "run",
  );
  return await settleCalculixWorkerCandidateQualification(
    composed,
    await composed.execution.execute.execute({
      identity: composed.identity,
      bundle: composed.bundle,
    }),
  );
}

export async function recoverCalculixWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: CalculixWorkerCandidateQualificationPorts,
): Promise<CalculixWorkerCandidateQualificationResult> {
  const composed = await composeCalculixWorkerCandidateQualification(
    record,
    ports,
    "recover",
  );
  const attempt = await composed.attempts.read(
    composed.identity.projectId,
    composed.identity.agentRunId,
  );
  if (!attempt) {
    throw new Error(
      "CalculiX candidate qualification recovery requires an existing WAL attempt.",
    );
  }
  if (attempt.phase === "prepared") {
    throw new Error(
      "CalculiX candidate qualification recovery does not dispatch a prepared attempt.",
    );
  }
  if (attempt.phase === "dispatching") {
    let resolution;
    try {
      resolution = await composed.execution.publications.resolvePublicationByRunId(
        composed.identity.executionRunId,
        attempt.dispatch.producerGeneration,
      );
    } catch {
      throw new Error(
        "The CalculiX candidate qualification publication could not be resolved safely; no redispatch occurs.",
      );
    }
    if (resolution.status === "outcome-unknown") {
      throw new Error(
        "The CalculiX candidate qualification publication outcome is unknown; no redispatch occurs.",
      );
    }
    if (resolution.status !== "published") {
      throw new Error(
        "The CalculiX candidate qualification publication is unpublished; recovery does not redispatch.",
      );
    }
  }
  return await settleCalculixWorkerCandidateQualification(
    composed,
    await composed.execution.execute.execute({
      identity: composed.identity,
      bundle: composed.bundle,
    }),
  );
}

export function renderCalculixWorkerCandidateQualificationResultText(
  result: CalculixWorkerCandidateQualificationResult,
): string {
  return [
    `schemaVersion=${result.schemaVersion}`,
    `kind=${result.kind}`,
    `status=${result.status}`,
    `physicalImageId=${result.physicalImageId}`,
    `candidateReference=${result.candidateReference}`,
    `microsandbox.manifestDigest=${result.identities.microsandboxManifestDigest}`,
    `importRecord.fingerprint=${result.importRecordFingerprint}`,
    `outputs=${result.outputs.length}`,
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

export function calculixWorkerCandidateQualificationPaths(
  stateRoot: string,
): CalculixIsolatedExecutionCompositionPaths {
  return Object.freeze({
    outputCasDirectory: `${stateRoot}/outputs`,
    attemptDirectory: `${stateRoot}/attempts`,
    evidenceDirectory: `${stateRoot}/evidence`,
    leaseDirectory: `${stateRoot}/leases`,
    durabilitySyncBoundary: stateRoot,
  });
}

async function composeCalculixWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: CalculixWorkerCandidateQualificationPorts,
  mode: "run" | "recover",
): Promise<ComposedCalculixWorkerCandidateQualification> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
  );
  const host = await readObservedLinuxArm64Host(ports.observedHost);
  const options =
    await createCalculixIsolatedExecutionServerOptionsForBoundCandidateImport(
      record,
    );
  const importRecordFingerprint =
    await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record);
  const stateRoot = ports.stateRoot ??
    firstPartyMicrosandboxImageCandidateQualificationRoot(
      CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
      importRecordFingerprint,
    );
  const paths = calculixWorkerCandidateQualificationPaths(stateRoot);
  const compose = ports.compose ?? createCalculixIsolatedExecutionComposition;
  const composition = await compose(options, paths);
  const execution = composition.execution;
  if (execution === undefined) {
    throw new Error("The imported CalculiX candidate runtime was not composed.");
  }
  const profile = await composition.profiles.initial();
  const expectedImageReference = pinnedOciImageReference(
    record.candidate.microsandbox.candidateReference,
    "$calculixWorkerCandidate.imageReference",
  );
  const expectedDigest = record.identities.microsandboxManifestDigest.slice(
    "sha256:".length,
  );
  if (
    profile.imageReference !== expectedImageReference ||
    profile.runtimeBackend.imageReference !== expectedImageReference ||
    profile.runtime.imageDigest.digest !== expectedDigest
  ) {
    throw new Error(
      "The composed CalculiX candidate profile did not retain the bound Microsandbox candidate reference and digest.",
    );
  }
  const bundle = await createCalculixWorkerCandidateQualificationBundle();
  const attempts = new FileCalculixIsolatedExecutionAttemptStore(
    paths.attemptDirectory,
    paths.durabilitySyncBoundary,
  );
  const agentRunId = `calculix-worker-candidate-qualification-${
    firstPartyMicrosandboxImageCandidateQualificationIdentity(
      importRecordFingerprint,
    )
  }`;
  const existingAttempt = await attempts.read(
    CALCULIX_WORKER_CANDIDATE_QUALIFICATION_PROJECT_ID,
    agentRunId,
  );
  if (mode === "recover" && existingAttempt === undefined) {
    throw new Error(
      "CalculiX candidate qualification recovery requires an existing WAL attempt.",
    );
  }
  const startedAt = existingAttempt?.identity.startedAt ??
    (ports.now ?? (() => new Date().toISOString()))();
  const identity = await createCalculixWorkerCandidateQualificationAttemptIdentity(
    record,
    profile,
    host.identity.fingerprint,
    bundle,
    startedAt,
  );
  return {
    record,
    importRecordFingerprint,
    stateRoot,
    observedHost: host.observation,
    bundle,
    identity,
    execution,
    attempts,
  };
}

async function settleCalculixWorkerCandidateQualification(
  composed: ComposedCalculixWorkerCandidateQualification,
  executed: {
    readonly evidence: {
      readonly receipt: {
        readonly runId: string;
        readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
        readonly runtime: { readonly isolationClass: string };
        readonly destruction: { readonly status: string };
        readonly outputs: readonly {
          readonly role: string;
          readonly byteCount: number;
          readonly sha256: string;
        }[];
      };
      readonly executionRunId: string;
    };
  },
): Promise<CalculixWorkerCandidateQualificationResult> {
  if (executed.evidence.receipt.destruction.status !== "proven") {
    throw new Error(
      "CalculiX candidate qualification requires proven microVM destruction.",
    );
  }
  if (
    executed.evidence.receipt.outputs.length !==
      CALCULIX_ISOLATED_OUTPUT_MANIFEST.length
  ) {
    throw new Error(
      "The published CalculiX candidate qualification receipt does not contain the complete output batch.",
    );
  }
  const qualification =
    await persistFirstPartyMicrosandboxImageCandidateQualificationRecord(
      composed.stateRoot,
      await buildFirstPartyMicrosandboxImageCandidateQualificationRecord(
        composed.record,
        {
          observedHost: composed.observedHost,
          runId: executed.evidence.executionRunId,
          receiptFingerprint: executed.evidence.receipt.fingerprint,
        },
      ),
    );
  const result: CalculixWorkerCandidateQualificationResult = {
    schemaVersion: CALCULIX_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA,
    kind: "candidate-qualification",
    status: "passed",
    physicalImageId: CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
    candidateReference: composed.record.candidate.microsandbox.candidateReference,
    identities: composed.record.identities,
    importRecordFingerprint: composed.importRecordFingerprint,
    stateRoot: composed.stateRoot,
    isolationClass: executed.evidence.receipt.runtime.isolationClass,
    executionProfile: composed.identity.profile.executionProfile,
    bundleSha256: composed.bundle.fingerprint.digest,
    receiptFingerprint: executed.evidence.receipt.fingerprint,
    outputs: executed.evidence.receipt.outputs.map((output) => ({
      role: output.role,
      byteCount: output.byteCount,
      sha256: output.sha256,
    })),
    outputValidation:
      `${CALCULIX_ISOLATED_OUTPUT_VALIDATOR.id}@${CALCULIX_ISOLATED_OUTPUT_VALIDATOR.version}`,
    reread: "publication-gated",
    destruction: "proven",
    runtimeQualification: "passed",
    eligibleForPromotion: false,
    evidence: "host-runtime-only",
    engineeringLevels: { l3: false, l4: false, l5: false },
    qualification,
  };
  return Object.freeze(result);
}

interface ComposedCalculixWorkerCandidateQualification {
  readonly record: FirstPartyMicrosandboxImageCandidateImportRecord;
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly observedHost: CapabilityRuntimeHostObservation;
  readonly bundle: CalculixIsolatedInputBundle;
  readonly identity: CalculixIsolatedExecutionAttemptIdentity;
  readonly execution: NonNullable<CalculixIsolatedExecutionComposition["execution"]>;
  readonly attempts: FileCalculixIsolatedExecutionAttemptStore;
}
