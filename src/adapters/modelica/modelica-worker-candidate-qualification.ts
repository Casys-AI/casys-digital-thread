/**
 * Maintainer-only qualification of one imported Modelica worker candidate.
 * The one physical image must pass two server-owned runtime proofs:
 * `openmodelica-qualified-kit` and `openmodelica-admitted-modelica`.
 *
 * Policy, limits, worker, fixture and validators stay code-owned. The
 * CLI/gate never accepts a provider, image, digest, platform, command,
 * endpoint, tool, worker, profile, source, or args.
 *
 * This is imported physical/runtime evidence only. It does not promote the
 * image, activate a project operation, or turn the admitted method/binding
 * into qualified.
 */

import type { CapabilityRuntimeObservedHost } from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type { CapabilityRuntimeHostObservation } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type {
  IsolatedCodeRunner,
  IsolatedCodeRunRecovery,
  IsolatedOutputPublicationReader,
} from "../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import {
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeOutputDeclaration,
  type IsolatedCodePolicyRef,
  type IsolatedCodeRuntimeAttestation,
  runtimeAttestationsEqual,
} from "../../domain/compile/isolation/isolated-code-execution.ts";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintResourceBytes } from "../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  parseAdmittedModelicaIsolatedEvidence,
  validateAdmittedModelicaIsolatedOutput,
} from "../../domain/modelica/admitted/isolated-output.ts";
import { MODELICA_ADMITTED_OUTPUT_VALIDATOR } from "../../domain/modelica/admitted/run-proposal.ts";
import {
  fingerprintFirstPartyMicrosandboxImageCandidateImportRecord,
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
  type FirstPartyMicrosandboxImageCandidateImportRecord,
  firstPartyMicrosandboxImageCandidateReference,
} from "../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  assertBoundCandidateImportPhysicalImageId,
  firstPartyMicrosandboxImageCandidateQualificationRoot,
  MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
  readObservedLinuxArm64Host,
} from "../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import {
  authorizeAdmittedModelicaSource,
  normalizeAdmittedResult,
} from "./admitted/closed-subset-v2/run.ts";
import {
  type AdmittedModelicaExecutionComposition,
  type AdmittedModelicaExecutionCompositionPaths,
  type AdmittedModelicaExecutionServerOptions,
  createAdmittedModelicaExecutionComposition,
} from "./admitted/execution-composition.ts";
import {
  createAdmittedModelicaExecutionServerOptionsForBoundCandidateImport,
  createModelicaIsolatedExecutionServerOptionsForBoundCandidateImport,
  LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
} from "./first-party-modelica-execution.ts";
import {
  FileModelicaWorkerCandidateProfileAttemptStore,
  type ModelicaWorkerCandidateProfileAttempt,
  type ModelicaWorkerCandidateProfileAttemptIdentity,
  type ModelicaWorkerCandidateProfileProofId,
  parseProfileId,
} from "./modelica-worker-candidate-profile-attempt-store.ts";
import {
  createModelicaIsolatedExecutionComposition,
  type ModelicaIsolatedExecutionComposition,
  type ModelicaIsolatedExecutionCompositionPaths,
  type ModelicaIsolatedExecutionServerOptions,
} from "./qualified-kit/execution-composition.ts";
import { MODELICA_ISOLATED_OUTPUT_VALIDATOR } from "./qualified-kit/execution-profile.ts";
import { createModelicaMicrosandboxQualificationKit } from "./qualified-kit/kit-v1/qualification-kit.ts";
import {
  validateModelicaIsolatedInputBundle,
  validateModelicaIsolatedOutput,
  validateModelicaIsolatedRun,
} from "../../domain/modelica/qualified-kit/isolated-execution.ts";

export const MODELICA_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA =
  "modelica-worker-candidate-qualification-plan/1.0" as const;
export const MODELICA_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA =
  "modelica-worker-candidate-qualification/1.0" as const;
export const MODELICA_WORKER_CANDIDATE_PROFILE_PROOF_SCHEMA =
  "modelica-worker-candidate-profile-proof/1.0" as const;
export const MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID =
  "openmodelica-qualified-kit" as const;
export const MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID =
  "openmodelica-admitted-modelica" as const;
export const MODELICA_WORKER_CANDIDATE_PROOF_IDS = Object.freeze(
  [
    MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
    MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID,
  ] as const,
);

/**
 * Code-owned closed-subset v2 fixture. Runtime conformance only; not
 * admission, MRTR, project or Thread authority.
 */
export const MODELICA_WORKER_CANDIDATE_ADMITTED_SOURCE = `model GenericMotion
  parameter Real initialPosition(unit = "m") = 1;
  parameter Real drive(unit = "m/s2") = 2;
  output Real position(unit = "m", start = initialPosition, fixed = true);
  output Real velocity(unit = "m/s", start = 0, fixed = true);
equation
  der(position) = velocity;
  der(velocity) = drive-position;
annotation(experiment(StartTime = 0, StopTime = 2, Interval = 0.1, Tolerance = 0.000001));
end GenericMotion;
`;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SHA256_DIGEST = /^[0-9a-f]{64}$/u;

export interface ModelicaWorkerCandidateQualificationPlan {
  readonly schemaVersion: typeof MODELICA_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly mode: "plan";
  readonly mutation: false;
  readonly physicalImageId: typeof MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID;
  readonly candidateReference: string;
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly proofs: readonly [
    {
      readonly id: typeof MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID;
      readonly status: "not-run";
    },
    {
      readonly id: typeof MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID;
      readonly status: "not-run";
    },
  ];
  readonly runtimeQualification: "not-run";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
}

export interface ModelicaWorkerCandidateObservedHost {
  readonly identityFingerprint: ContentFingerprint;
  readonly platform: "linux/arm64";
  readonly fingerprint: ContentFingerprint;
}

export interface ModelicaWorkerCandidateProfileProofBase {
  readonly schemaVersion: typeof MODELICA_WORKER_CANDIDATE_PROFILE_PROOF_SCHEMA;
  readonly kind: "candidate-profile-proof";
  readonly physicalImageId: typeof MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID;
  readonly importRecord: {
    readonly fingerprint: string;
    readonly schemaVersion:
      typeof FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA;
  };
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly candidateReference: string;
  readonly observedHost: ModelicaWorkerCandidateObservedHost;
  readonly executionProfile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly execution: {
    readonly runId: string;
    readonly receiptFingerprint: ContentFingerprint;
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
}

export interface ModelicaWorkerCandidateQualifiedKitProof
  extends ModelicaWorkerCandidateProfileProofBase {
  readonly profileId: typeof MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID;
}

export interface ModelicaWorkerCandidateAdmittedProof
  extends ModelicaWorkerCandidateProfileProofBase {
  readonly profileId: typeof MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID;
  readonly methodQualification: "unqualified";
  readonly bindingQualification: "unqualified";
}

export type ModelicaWorkerCandidateProfileProof =
  | ModelicaWorkerCandidateQualifiedKitProof
  | ModelicaWorkerCandidateAdmittedProof;

export interface ModelicaWorkerCandidateQualificationAggregate {
  readonly schemaVersion: typeof MODELICA_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly status: "passed";
  readonly physicalImageId: typeof MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID;
  readonly importRecord: {
    readonly fingerprint: string;
    readonly schemaVersion:
      typeof FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA;
  };
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly candidateReference: string;
  readonly observedHost: ModelicaWorkerCandidateObservedHost;
  readonly proofs: readonly [
    ModelicaWorkerCandidateQualifiedKitProof,
    ModelicaWorkerCandidateAdmittedProof,
  ];
  readonly runtimeQualification: "passed";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
  readonly engineeringLevels: {
    readonly l3: false;
    readonly l4: false;
    readonly l5: false;
  };
  readonly admittedMethodQualification: "unqualified";
}

export interface ModelicaWorkerCandidateQualificationPassedResult {
  readonly schemaVersion: typeof MODELICA_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly status: "passed";
  readonly physicalImageId: typeof MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID;
  readonly candidateReference: string;
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly proofs: readonly [
    ModelicaWorkerCandidateQualifiedKitProof,
    ModelicaWorkerCandidateAdmittedProof,
  ];
  readonly destruction: "proven";
  readonly runtimeQualification: "passed";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
  readonly engineeringLevels: {
    readonly l3: false;
    readonly l4: false;
    readonly l5: false;
  };
  readonly admittedMethodQualification: "unqualified";
  readonly qualification: ModelicaWorkerCandidateQualificationAggregate;
}

export interface ModelicaWorkerCandidateQualificationIncompleteResult {
  readonly schemaVersion: typeof MODELICA_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly status: "incomplete";
  readonly physicalImageId: typeof MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID;
  readonly candidateReference: string;
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly proofs: readonly ModelicaWorkerCandidateProfileProof[];
  readonly runtimeQualification: "incomplete";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
  readonly engineeringLevels: {
    readonly l3: false;
    readonly l4: false;
    readonly l5: false;
  };
  readonly admittedMethodQualification: "unqualified";
}

export type ModelicaWorkerCandidateQualificationResult =
  | ModelicaWorkerCandidateQualificationPassedResult
  | ModelicaWorkerCandidateQualificationIncompleteResult;

export interface ModelicaWorkerCandidateQualificationPorts {
  readonly composeQualifiedKit?: (
    options: ModelicaIsolatedExecutionServerOptions,
    paths: ModelicaIsolatedExecutionCompositionPaths,
  ) => Promise<ModelicaIsolatedExecutionComposition>;
  readonly composeAdmitted?: (
    options: AdmittedModelicaExecutionServerOptions,
    paths: AdmittedModelicaExecutionCompositionPaths,
  ) => Promise<AdmittedModelicaExecutionComposition>;
  readonly observedHost: { read(): Promise<CapabilityRuntimeHostObservation> };
  readonly now?: () => string;
  readonly stateRoot?: string;
}

export async function planModelicaWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<ModelicaWorkerCandidateQualificationPlan> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
  );
  const importRecordFingerprint =
    await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record);
  return Object.freeze({
    schemaVersion: MODELICA_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA,
    kind: "candidate-qualification",
    mode: "plan",
    mutation: false,
    physicalImageId: MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
    candidateReference: record.candidate.microsandbox.candidateReference,
    identities: record.identities,
    importRecordFingerprint,
    stateRoot: firstPartyMicrosandboxImageCandidateQualificationRoot(
      MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
      importRecordFingerprint,
    ),
    proofs: [
      Object.freeze({
        id: MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
        status: "not-run" as const,
      }),
      Object.freeze({
        id: MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID,
        status: "not-run" as const,
      }),
    ] as const,
    runtimeQualification: "not-run",
    eligibleForPromotion: false,
    evidence: "host-runtime-only",
  });
}

export function renderModelicaWorkerCandidateQualificationPlanText(
  plan: ModelicaWorkerCandidateQualificationPlan,
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
    `proofs=${plan.proofs.map((proof) => `${proof.id}:${proof.status}`).join(",")}`,
    `runtimeQualification=${plan.runtimeQualification}`,
    `eligibleForPromotion=${plan.eligibleForPromotion}`,
    "Candidate qualification only. Promotion is false.",
    "This is not L3/L4/L5 engineering evidence.",
    "Admitted method and binding qualification remain unqualified.",
    "",
  ].join("\n");
}

export async function qualifyModelicaWorkerCandidate(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: ModelicaWorkerCandidateQualificationPorts,
): Promise<ModelicaWorkerCandidateQualificationResult> {
  return await orchestrateModelicaWorkerCandidateQualification(record, ports, "run");
}

export async function recoverModelicaWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: ModelicaWorkerCandidateQualificationPorts,
): Promise<ModelicaWorkerCandidateQualificationResult> {
  return await orchestrateModelicaWorkerCandidateQualification(
    record,
    ports,
    "recover",
  );
}

export function renderModelicaWorkerCandidateQualificationResultText(
  result: ModelicaWorkerCandidateQualificationResult,
): string {
  return [
    `schemaVersion=${result.schemaVersion}`,
    `kind=${result.kind}`,
    `status=${result.status}`,
    `physicalImageId=${result.physicalImageId}`,
    `candidateReference=${result.candidateReference}`,
    `microsandbox.manifestDigest=${result.identities.microsandboxManifestDigest}`,
    `importRecord.fingerprint=${result.importRecordFingerprint}`,
    `proofs=${
      result.proofs.map((proof) => `${proof.profileId}:${proof.runtimeQualification}`)
        .join(",")
    }`,
    `runtimeQualification=${result.runtimeQualification}`,
    `eligibleForPromotion=${result.eligibleForPromotion}`,
    `admittedMethodQualification=${result.admittedMethodQualification}`,
    "Candidate qualification only. Promotion is false.",
    "This is not L3/L4/L5 engineering evidence.",
    "Admitted method and binding qualification remain unqualified.",
    "",
  ].join("\n");
}

export function modelicaWorkerCandidateProfileRoot(
  stateRoot: string,
  profileId: ModelicaWorkerCandidateProfileProofId,
): string {
  parseProfileId(profileId);
  return `${stateRoot}/targets/${profileId}`;
}

async function orchestrateModelicaWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: ModelicaWorkerCandidateQualificationPorts,
  mode: "run" | "recover",
): Promise<ModelicaWorkerCandidateQualificationResult> {
  const composed = await composeModelicaWorkerCandidateQualification(
    record,
    ports,
    mode,
  );
  const kit = await settleProfile(composed.kit, mode);
  const admitted = await settleProfile(composed.admitted, mode);
  if (kit.status === "passed" && admitted.status === "passed") {
    const kitProof = requireQualifiedKitProof(kit.proof);
    const admittedProof = requireAdmittedProof(admitted.proof);
    const qualification = await persistAggregate(
      composed.stateRoot,
      buildAggregate(composed, kitProof, admittedProof),
    );
    return Object.freeze({
      schemaVersion: MODELICA_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA,
      kind: "candidate-qualification",
      status: "passed",
      physicalImageId: MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
      candidateReference: composed.record.candidate.microsandbox.candidateReference,
      identities: composed.record.identities,
      importRecordFingerprint: composed.importRecordFingerprint,
      stateRoot: composed.stateRoot,
      proofs: Object.freeze([kitProof, admittedProof] as const),
      destruction: "proven",
      runtimeQualification: "passed",
      eligibleForPromotion: false as const,
      evidence: "host-runtime-only" as const,
      engineeringLevels: Object.freeze({
        l3: false as const,
        l4: false as const,
        l5: false as const,
      }),
      admittedMethodQualification: "unqualified" as const,
      qualification,
    });
  }
  if (mode === "recover") {
    throw new Error(
      "Modelica candidate qualification recovery cannot complete both profile proofs without redispatched worker calls.",
    );
  }
  const proofs = [
    ...(kit.status === "passed" ? [kit.proof] : []),
    ...(admitted.status === "passed" ? [admitted.proof] : []),
  ];
  return Object.freeze({
    schemaVersion: MODELICA_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA,
    kind: "candidate-qualification",
    status: "incomplete",
    physicalImageId: MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
    candidateReference: composed.record.candidate.microsandbox.candidateReference,
    identities: composed.record.identities,
    importRecordFingerprint: composed.importRecordFingerprint,
    stateRoot: composed.stateRoot,
    proofs: Object.freeze(proofs),
    runtimeQualification: "incomplete" as const,
    eligibleForPromotion: false as const,
    evidence: "host-runtime-only" as const,
    engineeringLevels: Object.freeze({
      l3: false as const,
      l4: false as const,
      l5: false as const,
    }),
    admittedMethodQualification: "unqualified" as const,
  });
}

async function composeModelicaWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: ModelicaWorkerCandidateQualificationPorts,
  mode: "run" | "recover",
): Promise<ComposedModelicaWorkerCandidateQualification> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
  );
  const host = await readObservedLinuxArm64Host(ports.observedHost);
  const qualifiedOptions =
    await createModelicaIsolatedExecutionServerOptionsForBoundCandidateImport(
      record,
    );
  const admittedOptions =
    await createAdmittedModelicaExecutionServerOptionsForBoundCandidateImport(
      record,
    );
  const importRecordFingerprint =
    await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record);
  const stateRoot = ports.stateRoot ??
    firstPartyMicrosandboxImageCandidateQualificationRoot(
      MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
      importRecordFingerprint,
    );
  const composeQualifiedKit = ports.composeQualifiedKit ??
    createModelicaIsolatedExecutionComposition;
  const composeAdmitted = ports.composeAdmitted ??
    createAdmittedModelicaExecutionComposition;
  const kitComposition = await composeQualifiedKit(
    qualifiedOptions,
    {
      outputCasDirectory: `${
        profileRoot(stateRoot, "openmodelica-qualified-kit")
      }/outputs`,
    },
  );
  const admittedComposition = await composeAdmitted(
    admittedOptions,
    {
      outputCasDirectory: `${
        profileRoot(stateRoot, "openmodelica-admitted-modelica")
      }/outputs`,
    },
  );
  const kitExecution = requireExecution(kitComposition.execution, "qualified-kit");
  const admittedExecution = requireExecution(
    admittedComposition.execution,
    "admitted",
  );
  const kitProfile = await kitComposition.profiles.initial();
  const admittedProfile = await admittedComposition.profiles.initial();
  const expectedImageReference = pinnedOciImageReference(
    record.candidate.microsandbox.candidateReference,
    "$modelicaWorkerCandidate.imageReference",
  );
  const expectedDigest = record.identities.microsandboxManifestDigest.slice(
    "sha256:".length,
  );
  assertCandidateProfile(
    "qualified-kit",
    kitProfile.runtimeBackend.imageReference,
    kitProfile.runtime.imageDigest.digest,
    expectedImageReference,
    expectedDigest,
  );
  assertCandidateProfile(
    "admitted",
    admittedProfile.runtimeBackend.imageReference,
    admittedProfile.runtime.imageDigest.digest,
    expectedImageReference,
    expectedDigest,
  );
  if (
    kitProfile.runtimeBackend.imageReference !==
      admittedProfile.runtimeBackend.imageReference ||
    kitProfile.runtime.imageDigest.digest !==
      admittedProfile.runtime.imageDigest.digest
  ) {
    throw new Error(
      "The two Modelica candidate proofs diverged on candidate reference or Microsandbox digest.",
    );
  }
  if (expectedImageReference === LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE) {
    throw new Error(
      "Modelica candidate qualification must not substitute the active catalogue pin.",
    );
  }
  let nowValue: string | undefined;
  const startedAtFor = (existing: string | undefined): string => {
    if (existing !== undefined) return existing;
    if (mode === "recover") {
      return "1970-01-01T00:00:00.000Z";
    }
    nowValue ??= (ports.now ?? (() => new Date().toISOString()))();
    return nowValue;
  };
  const kitBundle = await createModelicaMicrosandboxQualificationKit(
    kitProfile.method.engine,
  );
  const kit = await composeProfileContext({
    record,
    importRecordFingerprint,
    stateRoot,
    host,
    profileId: MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
    execution: kitExecution,
    executionProfile: kitProfile.executionProfile,
    isolationPolicy: kitProfile.isolationPolicy,
    outputManifest: kitProfile.outputManifest,
    profileFingerprint: kitProfile.profileFingerprint,
    runtime: kitProfile.runtime,
    sourceBytes: kitBundle.bundle.bytes,
    startedAtFor,
    validateOutputs: async (receipt, bytesByRole) => {
      const evidence = bytesByRole.get("evidence");
      const result = bytesByRole.get("result");
      if (!evidence || !result) {
        throw new Error(
          "The qualified-kit candidate publication has an incomplete role set.",
        );
      }
      for (const output of receipt.outputs) {
        const declaration = kitProfile.outputManifest.find((entry) =>
          entry.role === output.role
        );
        const bytes = bytesByRole.get(output.role);
        if (!declaration || !bytes) {
          throw new Error("The qualified-kit candidate output declaration is missing.");
        }
        validateModelicaIsolatedOutput(declaration, bytes);
      }
      const bundle = await validateModelicaIsolatedInputBundle(
        kitBundle.bundle.document,
      );
      await validateModelicaIsolatedRun({
        bundle,
        evidenceBytes: evidence,
        resultBytes: result,
      });
    },
    outputValidation:
      `${MODELICA_ISOLATED_OUTPUT_VALIDATOR.id}@${MODELICA_ISOLATED_OUTPUT_VALIDATOR.version}`,
    admittedFields: false,
  });
  const admittedSource = new TextEncoder().encode(
    MODELICA_WORKER_CANDIDATE_ADMITTED_SOURCE,
  );
  const admitted = await composeProfileContext({
    record,
    importRecordFingerprint,
    stateRoot,
    host,
    profileId: MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID,
    execution: admittedExecution,
    executionProfile: admittedProfile.executionProfile,
    isolationPolicy: admittedProfile.isolationPolicy,
    outputManifest: admittedProfile.outputManifest,
    profileFingerprint: admittedProfile.profileFingerprint,
    runtime: admittedProfile.runtime,
    sourceBytes: admittedSource,
    startedAtFor,
    validateOutputs: async (_receipt, bytesByRole) => {
      const evidence = bytesByRole.get("evidence");
      const result = bytesByRole.get("result");
      if (!evidence || !result) {
        throw new Error(
          "The admitted candidate publication has an incomplete role set.",
        );
      }
      for (const output of admittedProfile.outputManifest) {
        const bytes = bytesByRole.get(output.role);
        if (!bytes) {
          throw new Error("The admitted candidate output declaration is missing.");
        }
        validateAdmittedModelicaIsolatedOutput(output, bytes);
      }
      const authorized = await authorizeAdmittedModelicaSource(admittedSource);
      const csv = new TextDecoder("utf-8", { fatal: true }).decode(result);
      normalizeAdmittedResult(csv, authorized.source);
      const parsed = parseAdmittedModelicaIsolatedEvidence(evidence);
      if (
        parsed.inputBundleSha256 !== authorized.sha256 ||
        parsed.result.sha256 !== await fingerprintResourceBytes(result) ||
        parsed.result.byteCount !== result.byteLength ||
        parsed.modelName !== "GenericMotion"
      ) {
        throw new Error(
          "The admitted candidate evidence does not bind the code-owned GenericMotion fixture.",
        );
      }
    },
    outputValidation:
      `${MODELICA_ADMITTED_OUTPUT_VALIDATOR.id}@${MODELICA_ADMITTED_OUTPUT_VALIDATOR.version}`,
    admittedFields: true,
  });
  return {
    record,
    importRecordFingerprint,
    stateRoot,
    observedHost: host.identity,
    kit,
    admitted,
  };
}

async function composeProfileContext(input: {
  readonly record: FirstPartyMicrosandboxImageCandidateImportRecord;
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly host: {
    readonly observation: CapabilityRuntimeHostObservation;
    readonly identity: CapabilityRuntimeObservedHost & {
      readonly platform: "linux/arm64";
    };
  };
  readonly profileId: ModelicaWorkerCandidateProfileProofId;
  readonly execution: IsolatedExecution;
  readonly executionProfile: { readonly id: string; readonly version: string };
  readonly isolationPolicy: IsolatedCodePolicyRef;
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  readonly profileFingerprint: ContentFingerprint;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly sourceBytes: Uint8Array;
  readonly startedAtFor: (existing: string | undefined) => string;
  readonly validateOutputs: (
    receipt: IsolatedCodeExecutionReceipt,
    bytesByRole: ReadonlyMap<string, Uint8Array>,
  ) => Promise<void>;
  readonly outputValidation: string;
  readonly admittedFields: boolean;
}): Promise<ProfileContext> {
  const sourceSha256 = await fingerprintResourceBytes(input.sourceBytes);
  const executionRunId = `modelica-worker-candidate-qualification-${input.profileId}-${
    (await sha256Fingerprint({
      schemaVersion: "modelica-worker-candidate-qualification-run/1.0",
      profileId: input.profileId,
      importRecordFingerprint: input.importRecordFingerprint,
      candidateReference: input.record.candidate.microsandbox.candidateReference,
      microsandboxManifestDigest: input.record.identities.microsandboxManifestDigest,
      observedHost: input.host.identity.fingerprint,
      sourceSha256,
    })).digest
  }`;
  const root = profileRoot(input.stateRoot, input.profileId);
  const wal = new FileModelicaWorkerCandidateProfileAttemptStore(
    `${root}/attempts`,
    input.stateRoot,
  );
  const existing = await wal.read();
  const identity: ModelicaWorkerCandidateProfileAttemptIdentity = Object.freeze({
    profileId: input.profileId,
    importRecordFingerprint: input.importRecordFingerprint,
    candidateReference: input.record.candidate.microsandbox.candidateReference,
    microsandboxManifestDigest: input.record.identities.microsandboxManifestDigest,
    observedHostFingerprint: input.host.identity.fingerprint,
    profileFingerprint: input.profileFingerprint,
    executionRunId,
    sourceSha256,
    startedAt: input.startedAtFor(existing?.identity.startedAt),
  });
  if (
    existing !== undefined &&
    deterministicJson(existing.identity) !== deterministicJson({
        ...identity,
        startedAt: existing.identity.startedAt,
      })
  ) {
    throw new Error(
      "The Modelica candidate profile WAL identity diverged from the bound import.",
    );
  }
  return {
    record: input.record,
    importRecordFingerprint: input.importRecordFingerprint,
    stateRoot: input.stateRoot,
    observedHost: input.host.identity,
    profileId: input.profileId,
    identity: existing?.identity ?? identity,
    execution: input.execution,
    executionProfile: input.executionProfile,
    isolationPolicy: input.isolationPolicy,
    outputManifest: input.outputManifest,
    profileFingerprint: input.profileFingerprint,
    runtime: input.runtime,
    sourceBytes: input.sourceBytes,
    sourceSha256,
    wal,
    proofPath: `${root}/proof.json`,
    validateOutputs: input.validateOutputs,
    outputValidation: input.outputValidation,
    admittedFields: input.admittedFields,
  };
}

async function settleProfile(
  ctx: ProfileContext,
  mode: "run" | "recover",
): Promise<ProfileOutcome> {
  const attempt = await ctx.wal.read();
  try {
    if (mode === "recover" && attempt === undefined) {
      throw new Error(
        "Modelica candidate qualification recovery requires an existing WAL attempt.",
      );
    }
    if (attempt?.phase === "attested") {
      return { status: "passed", proof: await rereadAttested(ctx, attempt) };
    }
    if (attempt?.phase === "dispatching") {
      return { status: "passed", proof: await recoverDispatching(ctx, attempt) };
    }
    if (attempt?.phase === "prepared" && mode === "recover") {
      throw new Error(
        "Modelica candidate qualification recovery does not dispatch a prepared attempt.",
      );
    }
    if (mode === "recover") {
      throw new Error(
        "Modelica candidate qualification recovery requires an existing WAL attempt.",
      );
    }
    return { status: "passed", proof: await dispatchAndRun(ctx, attempt) };
  } catch (error) {
    if (mode === "recover" || isFailClosed(error)) throw error;
    return { status: "failed" };
  }
}

async function dispatchAndRun(
  ctx: ProfileContext,
  attempt: ModelicaWorkerCandidateProfileAttempt | undefined,
): Promise<ModelicaWorkerCandidateProfileProof> {
  if (attempt === undefined) {
    await ctx.wal.prepare(ctx.identity);
  }
  const current = await ctx.wal.read();
  if (current?.phase === "prepared") {
    await ctx.wal.markDispatching(ctx.identity);
  }
  const receipt = await ctx.execution.runner.run({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: ctx.identity.executionRunId,
    producerGeneration: 0,
    profile: ctx.executionProfile,
    source: { bytes: ctx.sourceBytes, sha256: ctx.sourceSha256 },
    policy: ctx.isolationPolicy,
    outputs: ctx.outputManifest,
  });
  return await settleFromReceipt(ctx, receipt);
}

async function recoverDispatching(
  ctx: ProfileContext,
  attempt: Extract<ModelicaWorkerCandidateProfileAttempt, { phase: "dispatching" }>,
): Promise<ModelicaWorkerCandidateProfileProof> {
  let resolution;
  try {
    resolution = await ctx.execution.publications.resolvePublicationByRunId(
      attempt.identity.executionRunId,
      attempt.dispatch.producerGeneration,
    );
  } catch {
    throw new Error(
      "The Modelica candidate qualification publication could not be resolved safely; no redispatch occurs.",
    );
  }
  if (resolution.status === "outcome-unknown") {
    throw new Error(
      "The Modelica candidate qualification publication outcome is unknown; no redispatch occurs.",
    );
  }
  if (resolution.status !== "published") {
    throw new Error(
      "The Modelica candidate qualification publication is unpublished; recovery does not redispatch.",
    );
  }
  const receipt = await ctx.execution.publications.readReceipt(resolution.ref);
  if (receipt === undefined) {
    throw new Error(
      "The Modelica candidate qualification publication-gated receipt could not be reopened.",
    );
  }
  return await settleFromReceipt(ctx, receipt);
}

async function settleFromReceipt(
  ctx: ProfileContext,
  receipt: IsolatedCodeExecutionReceipt,
): Promise<ModelicaWorkerCandidateProfileProof> {
  if (!runtimeAttestationsEqual(receipt.runtime, ctx.runtime)) {
    throw new Error(
      "The Modelica candidate receipt runtime attestation diverged from the current candidate profile runtime.",
    );
  }
  if (receipt.termination.kind !== "exited" || receipt.termination.exitCode !== 0) {
    throw new Error(
      "The imported Modelica candidate worker did not exit successfully.",
    );
  }
  const resolution = await ctx.execution.publications.resolvePublicationByRunId(
    ctx.identity.executionRunId,
    0,
  );
  if (resolution.status !== "published") {
    throw new Error(
      "The Modelica candidate qualification CAS publication was not durably resolvable.",
    );
  }
  if (receipt.destruction.status !== "proven") {
    throw new Error(
      "Modelica candidate qualification requires proven microVM destruction.",
    );
  }
  if (
    deterministicJson(resolution.receipt) !==
      deterministicJson(isolatedCodeExecutionReceiptRecord(receipt))
  ) {
    throw new Error(
      "The Modelica candidate qualification CAS receipt record differs from the run receipt.",
    );
  }
  const rereadReceipt = await ctx.execution.publications.readReceipt(resolution.ref);
  if (rereadReceipt === undefined) {
    throw new Error(
      "The Modelica candidate qualification publication-gated receipt could not be reopened.",
    );
  }
  if (rereadReceipt.fingerprint.digest !== receipt.fingerprint.digest) {
    throw new Error(
      "The reopened Modelica candidate qualification receipt fingerprint drifted.",
    );
  }
  if (receipt.outputs.length !== ctx.outputManifest.length) {
    throw new Error(
      "The published Modelica candidate qualification receipt does not contain the complete output batch.",
    );
  }
  const bytesByRole = new Map<string, Uint8Array>();
  for (const member of resolution.receipt.outputs) {
    const bytes = await ctx.execution.publications.readPublishedObject(
      resolution.ref,
      member,
    );
    if (bytes === undefined) {
      throw new Error(
        "A publication-gated Modelica candidate output could not be reopened.",
      );
    }
    if (
      bytes.byteLength !== member.byteCount ||
      await fingerprintResourceBytes(bytes) !== member.sha256
    ) {
      throw new Error("A reopened Modelica candidate output drifted after CAS reread.");
    }
    bytesByRole.set(member.role, bytes);
  }
  await ctx.validateOutputs(receipt, bytesByRole);
  const proof = await persistProfileProof(
    ctx.proofPath,
    buildProfileProof(ctx, receipt),
  );
  const current = await ctx.wal.read();
  if (current?.phase !== "attested") {
    await ctx.wal.attest(ctx.identity, {
      receiptFingerprint: receipt.fingerprint,
      outputs: proof.outputs,
      destruction: "proven",
      attestedAt: ctx.identity.startedAt,
    });
  }
  return proof;
}

async function rereadAttested(
  ctx: ProfileContext,
  attempt: Extract<ModelicaWorkerCandidateProfileAttempt, { phase: "attested" }>,
): Promise<ModelicaWorkerCandidateProfileProof> {
  const proof = await readProfileProof(ctx.proofPath);
  const expectedObservedHost = observedHostRecord(ctx.observedHost);
  if (
    proof.profileId !== ctx.profileId ||
    proof.importRecord.fingerprint !== ctx.importRecordFingerprint ||
    deterministicJson(proof.identities) !== deterministicJson(ctx.record.identities) ||
    proof.candidateReference !==
      ctx.record.candidate.microsandbox.candidateReference ||
    deterministicJson(proof.observedHost) !==
      deterministicJson(expectedObservedHost) ||
    proof.executionProfile.id !== ctx.executionProfile.id ||
    proof.executionProfile.version !== ctx.executionProfile.version ||
    !fingerprintsEqual(
      proof.executionProfile.fingerprint,
      ctx.profileFingerprint,
    ) ||
    proof.execution.runId !== attempt.identity.executionRunId ||
    !fingerprintsEqual(
      proof.execution.receiptFingerprint,
      attempt.attestation.receiptFingerprint,
    )
  ) {
    throw new Error(
      "The durable Modelica candidate profile proof diverged from its bound import, host, current server-owned profile, or WAL attestation.",
    );
  }
  const resolution = await ctx.execution.publications.resolvePublicationByRunId(
    attempt.identity.executionRunId,
    0,
  );
  if (resolution.status !== "published") {
    throw new Error(
      "The attested Modelica candidate publication is no longer durably resolvable.",
    );
  }
  const receipt = await ctx.execution.publications.readReceipt(resolution.ref);
  if (receipt === undefined) {
    throw new Error(
      "The attested Modelica candidate receipt could not be reopened.",
    );
  }
  if (
    receipt.runId !== attempt.identity.executionRunId ||
    receipt.producerGeneration !== 0 ||
    !fingerprintsEqual(
      receipt.fingerprint,
      attempt.attestation.receiptFingerprint,
    ) ||
    !fingerprintsEqual(receipt.fingerprint, proof.execution.receiptFingerprint) ||
    deterministicJson(receipt.profile) !== deterministicJson(ctx.executionProfile) ||
    !runtimeAttestationsEqual(receipt.runtime, ctx.runtime) ||
    receipt.sourceSha256 !== ctx.sourceSha256 ||
    deterministicJson(receipt.policy) !== deterministicJson(ctx.isolationPolicy) ||
    receipt.termination.kind !== "exited" ||
    receipt.termination.exitCode !== 0 ||
    receipt.destruction.status !== "proven" ||
    deterministicJson(resolution.receipt) !==
      deterministicJson(isolatedCodeExecutionReceiptRecord(receipt))
  ) {
    throw new Error(
      "The attested Modelica candidate receipt diverged from its proof, WAL attestation, current execution context, or publication resolution.",
    );
  }
  const receiptOutputs = profileOutputEvidence(receipt.outputs);
  const manifestRoles = ctx.outputManifest.map((output) => output.role);
  if (
    deterministicJson(receiptOutputs) !== deterministicJson(proof.outputs) ||
    deterministicJson(receiptOutputs) !==
      deterministicJson(attempt.attestation.outputs) ||
    deterministicJson(receiptOutputs) !==
      deterministicJson(profileOutputEvidence(resolution.receipt.outputs)) ||
    deterministicJson(receiptOutputs.map((output) => output.role)) !==
      deterministicJson(manifestRoles)
  ) {
    throw new Error(
      "The attested Modelica candidate output manifest diverged from its proof, WAL attestation, receipt, or current server-owned manifest.",
    );
  }
  const bytesByRole = new Map<string, Uint8Array>();
  for (const member of resolution.receipt.outputs) {
    const bytes = await ctx.execution.publications.readPublishedObject(
      resolution.ref,
      member,
    );
    if (!bytes) {
      throw new Error("An attested Modelica candidate output could not be reopened.");
    }
    if (
      bytes.byteLength !== member.byteCount ||
      await fingerprintResourceBytes(bytes) !== member.sha256
    ) {
      throw new Error(
        "An attested Modelica candidate output diverged after CAS reread.",
      );
    }
    bytesByRole.set(member.role, bytes);
  }
  await ctx.validateOutputs(receipt, bytesByRole);
  return proof;
}

function profileOutputEvidence(
  outputs: readonly {
    readonly role: string;
    readonly byteCount: number;
    readonly sha256: string;
  }[],
): readonly {
  readonly role: string;
  readonly byteCount: number;
  readonly sha256: string;
}[] {
  return outputs.map((output) => ({
    role: output.role,
    byteCount: output.byteCount,
    sha256: output.sha256,
  }));
}

function buildProfileProof(
  ctx: ProfileContext,
  receipt: IsolatedCodeExecutionReceipt,
): ModelicaWorkerCandidateProfileProof {
  const base = {
    schemaVersion: MODELICA_WORKER_CANDIDATE_PROFILE_PROOF_SCHEMA,
    kind: "candidate-profile-proof" as const,
    physicalImageId: MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
    importRecord: Object.freeze({
      fingerprint: ctx.importRecordFingerprint,
      schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
    }),
    identities: ctx.record.identities,
    candidateReference: ctx.record.candidate.microsandbox.candidateReference,
    observedHost: observedHostRecord(ctx.observedHost),
    executionProfile: Object.freeze({
      id: ctx.executionProfile.id,
      version: ctx.executionProfile.version,
      fingerprint: ctx.profileFingerprint,
    }),
    execution: Object.freeze({
      runId: receipt.runId,
      receiptFingerprint: receipt.fingerprint,
    }),
    outputs: Object.freeze(receipt.outputs.map((output) =>
      Object.freeze({
        role: output.role,
        byteCount: output.byteCount,
        sha256: output.sha256,
      })
    )),
    outputValidation: ctx.outputValidation,
    reread: "publication-gated" as const,
    destruction: "proven" as const,
    runtimeQualification: "passed" as const,
    eligibleForPromotion: false as const,
    evidence: "host-runtime-only" as const,
    engineeringLevels: Object.freeze({
      l3: false as const,
      l4: false as const,
      l5: false as const,
    }),
  };
  if (ctx.admittedFields) {
    return Object.freeze({
      ...base,
      profileId: MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID,
      methodQualification: "unqualified" as const,
      bindingQualification: "unqualified" as const,
    });
  }
  return Object.freeze({
    ...base,
    profileId: MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID,
  });
}

function buildAggregate(
  composed: ComposedModelicaWorkerCandidateQualification,
  kit: ModelicaWorkerCandidateQualifiedKitProof,
  admitted: ModelicaWorkerCandidateAdmittedProof,
): ModelicaWorkerCandidateQualificationAggregate {
  return parseModelicaWorkerCandidateQualificationAggregate({
    schemaVersion: MODELICA_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA,
    kind: "candidate-qualification",
    status: "passed",
    physicalImageId: MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
    importRecord: {
      fingerprint: composed.importRecordFingerprint,
      schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
    },
    identities: composed.record.identities,
    candidateReference: composed.record.candidate.microsandbox.candidateReference,
    observedHost: observedHostRecord(composed.observedHost),
    proofs: [kit, admitted],
    runtimeQualification: "passed",
    eligibleForPromotion: false,
    evidence: "host-runtime-only",
    engineeringLevels: { l3: false, l4: false, l5: false },
    admittedMethodQualification: "unqualified",
  });
}

export function parseModelicaWorkerCandidateQualificationAggregate(
  value: unknown,
): ModelicaWorkerCandidateQualificationAggregate {
  const root = jsonObject(value, "Modelica candidate qualification aggregate");
  if (root.schemaVersion !== MODELICA_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA) {
    throw new TypeError(
      "Modelica candidate qualification aggregate schema is not modelica-worker-candidate-qualification/1.0.",
    );
  }
  const importRecord = jsonObject(root.importRecord, "aggregate import record");
  const identities = jsonObject(root.identities, "aggregate identities");
  const observedHost = jsonObject(root.observedHost, "aggregate observed host");
  const engineeringLevels = jsonObject(
    root.engineeringLevels,
    "aggregate engineering levels",
  );
  if (!Array.isArray(root.proofs) || root.proofs.length !== 2) {
    throw new TypeError(
      "Modelica candidate qualification aggregate requires exactly two distinct profile proofs.",
    );
  }
  const kit = parseProfileProof(root.proofs[0]);
  const admitted = parseProfileProof(root.proofs[1]);
  if (kit.profileId !== MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID) {
    throw new TypeError(
      "The first aggregate proof must be openmodelica-qualified-kit.",
    );
  }
  if (admitted.profileId !== MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID) {
    throw new TypeError(
      "The second aggregate proof must be openmodelica-admitted-modelica.",
    );
  }
  if (!("methodQualification" in admitted) || !("bindingQualification" in admitted)) {
    throw new TypeError(
      "The admitted Modelica candidate proof must keep method and binding unqualified.",
    );
  }
  const physicalImageId = requiredString(
    root.physicalImageId,
    "aggregate physicalImageId",
  );
  if (physicalImageId !== MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID) {
    throw new TypeError("Modelica candidate aggregate physicalImageId is foreign.");
  }
  const importRecordFingerprint = requiredString(
    importRecord.fingerprint,
    "aggregate import-record fingerprint",
  );
  const rebuiltIdentities = {
    ociIndexDigest: requiredSha256(
      identities.ociIndexDigest,
      "aggregate OCI index digest",
    ),
    ociPlatformManifestDigest: requiredSha256(
      identities.ociPlatformManifestDigest,
      "aggregate OCI platform-manifest digest",
    ),
    microsandboxManifestDigest: requiredSha256(
      identities.microsandboxManifestDigest,
      "aggregate Microsandbox digest",
    ),
  };
  const candidateReference = firstPartyMicrosandboxImageCandidateReference(
    MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
    rebuiltIdentities.microsandboxManifestDigest,
  );
  if (root.candidateReference !== candidateReference) {
    throw new TypeError(
      "Modelica candidate aggregate candidateReference is not the bound Microsandbox candidate.",
    );
  }
  assertProofBound(kit, {
    importRecordFingerprint,
    identities: rebuiltIdentities,
    candidateReference,
    observedHost,
  });
  assertProofBound(admitted, {
    importRecordFingerprint,
    identities: rebuiltIdentities,
    candidateReference,
    observedHost,
  });
  if (kit.execution.runId === admitted.execution.runId) {
    throw new TypeError(
      "Modelica candidate aggregate proofs must have distinct run ids.",
    );
  }
  if (
    fingerprintsEqual(
      kit.execution.receiptFingerprint,
      admitted.execution.receiptFingerprint,
    )
  ) {
    throw new TypeError(
      "Modelica candidate aggregate proofs must have distinct receipt fingerprints.",
    );
  }
  if (
    root.kind !== "candidate-qualification" ||
    root.status !== "passed" ||
    root.runtimeQualification !== "passed" ||
    root.eligibleForPromotion !== false ||
    root.evidence !== "host-runtime-only" ||
    root.admittedMethodQualification !== "unqualified" ||
    importRecord.schemaVersion !==
      FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA ||
    engineeringLevels.l3 !== false ||
    engineeringLevels.l4 !== false ||
    engineeringLevels.l5 !== false
  ) {
    throw new TypeError(
      "Modelica candidate aggregate must remain host-runtime evidence with eligibleForPromotion=false.",
    );
  }
  const rebuilt: ModelicaWorkerCandidateQualificationAggregate = Object.freeze({
    schemaVersion: MODELICA_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA,
    kind: "candidate-qualification",
    status: "passed",
    physicalImageId: MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
    importRecord: Object.freeze({
      fingerprint: importRecordFingerprint,
      schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
    }),
    identities: Object.freeze(rebuiltIdentities),
    candidateReference,
    observedHost: parseObservedHost(observedHost),
    proofs: Object.freeze([kit, admitted] as const),
    runtimeQualification: "passed",
    eligibleForPromotion: false,
    evidence: "host-runtime-only",
    engineeringLevels: Object.freeze({
      l3: false as const,
      l4: false as const,
      l5: false as const,
    }),
    admittedMethodQualification: "unqualified",
  });
  if (deterministicJson(rebuilt) !== deterministicJson(value)) {
    throw new TypeError(
      "Modelica candidate qualification aggregate is not the exact rebuilt record.",
    );
  }
  return rebuilt;
}

export function parseModelicaWorkerCandidateProfileProof(
  value: unknown,
): ModelicaWorkerCandidateProfileProof {
  return parseProfileProof(value);
}

function parseProfileProof(value: unknown): ModelicaWorkerCandidateProfileProof {
  const root = jsonObject(value, "Modelica candidate profile proof");
  if (root.schemaVersion !== MODELICA_WORKER_CANDIDATE_PROFILE_PROOF_SCHEMA) {
    throw new TypeError(
      "Modelica candidate profile proof schema is not modelica-worker-candidate-profile-proof/1.0.",
    );
  }
  const profileId = parseProfileId(root.profileId);
  const importRecord = jsonObject(root.importRecord, "profile proof import record");
  const identities = jsonObject(root.identities, "profile proof identities");
  const observedHost = jsonObject(root.observedHost, "profile proof observed host");
  const executionProfile = jsonObject(
    root.executionProfile,
    "profile proof execution profile",
  );
  const execution = jsonObject(root.execution, "profile proof execution");
  const engineeringLevels = jsonObject(
    root.engineeringLevels,
    "profile proof engineering levels",
  );
  if (
    root.kind !== "candidate-profile-proof" ||
    root.physicalImageId !== MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID ||
    root.runtimeQualification !== "passed" ||
    root.eligibleForPromotion !== false ||
    root.evidence !== "host-runtime-only" ||
    root.reread !== "publication-gated" ||
    root.destruction !== "proven" ||
    importRecord.schemaVersion !==
      FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA ||
    engineeringLevels.l3 !== false ||
    engineeringLevels.l4 !== false ||
    engineeringLevels.l5 !== false
  ) {
    throw new TypeError(
      "Modelica candidate profile proof must remain host-runtime evidence with eligibleForPromotion=false.",
    );
  }
  if (!Array.isArray(root.outputs) || root.outputs.length === 0) {
    throw new TypeError("Modelica candidate profile proof outputs are incomplete.");
  }
  const base = {
    schemaVersion: MODELICA_WORKER_CANDIDATE_PROFILE_PROOF_SCHEMA,
    kind: "candidate-profile-proof" as const,
    physicalImageId: MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
    importRecord: Object.freeze({
      fingerprint: requiredSha256(
        importRecord.fingerprint,
        "profile proof import-record fingerprint",
      ),
      schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
    }),
    identities: Object.freeze({
      ociIndexDigest: requiredSha256(
        identities.ociIndexDigest,
        "profile proof OCI index digest",
      ),
      ociPlatformManifestDigest: requiredSha256(
        identities.ociPlatformManifestDigest,
        "profile proof OCI platform-manifest digest",
      ),
      microsandboxManifestDigest: requiredSha256(
        identities.microsandboxManifestDigest,
        "profile proof Microsandbox digest",
      ),
    }),
    candidateReference: requiredString(
      root.candidateReference,
      "profile proof candidateReference",
    ),
    observedHost: parseObservedHost(observedHost),
    executionProfile: Object.freeze({
      id: requiredString(executionProfile.id, "profile proof executionProfile.id"),
      version: requiredString(
        executionProfile.version,
        "profile proof executionProfile.version",
      ),
      fingerprint: contentFingerprint(
        executionProfile.fingerprint,
        "profile proof executionProfile.fingerprint",
      ),
    }),
    execution: Object.freeze({
      runId: requiredString(execution.runId, "profile proof runId"),
      receiptFingerprint: contentFingerprint(
        execution.receiptFingerprint,
        "profile proof receipt fingerprint",
      ),
    }),
    outputs: Object.freeze(root.outputs.map((item, index) => {
      const output = jsonObject(item, `profile proof outputs[${index}]`);
      return Object.freeze({
        role: requiredString(output.role, `profile proof outputs[${index}].role`),
        byteCount: requiredPositiveInteger(
          output.byteCount,
          `profile proof outputs[${index}].byteCount`,
        ),
        sha256: requiredHex(output.sha256, `profile proof outputs[${index}].sha256`),
      });
    })),
    outputValidation: requiredString(
      root.outputValidation,
      "profile proof outputValidation",
    ),
    reread: "publication-gated" as const,
    destruction: "proven" as const,
    runtimeQualification: "passed" as const,
    eligibleForPromotion: false as const,
    evidence: "host-runtime-only" as const,
    engineeringLevels: Object.freeze({
      l3: false as const,
      l4: false as const,
      l5: false as const,
    }),
  };
  const rebuilt = profileId === MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID
    ? Object.freeze({
      ...base,
      profileId,
      methodQualification: "unqualified" as const,
      bindingQualification: "unqualified" as const,
    })
    : Object.freeze({ ...base, profileId });
  if (
    profileId === MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID &&
    (root.methodQualification !== "unqualified" ||
      root.bindingQualification !== "unqualified")
  ) {
    throw new TypeError(
      "The admitted Modelica candidate proof must keep method and binding unqualified.",
    );
  }
  if (deterministicJson(rebuilt) !== deterministicJson(value)) {
    throw new TypeError(
      "Modelica candidate profile proof is not the exact rebuilt record.",
    );
  }
  return rebuilt;
}

function assertProofBound(
  proof: ModelicaWorkerCandidateProfileProof,
  expected: {
    readonly importRecordFingerprint: string;
    readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
    readonly candidateReference: string;
    readonly observedHost: Record<string, unknown>;
  },
): void {
  if (
    proof.importRecord.fingerprint !== expected.importRecordFingerprint ||
    proof.identities.microsandboxManifestDigest !==
      expected.identities.microsandboxManifestDigest ||
    proof.identities.ociIndexDigest !== expected.identities.ociIndexDigest ||
    proof.identities.ociPlatformManifestDigest !==
      expected.identities.ociPlatformManifestDigest ||
    proof.candidateReference !== expected.candidateReference ||
    proof.observedHost.platform !== "linux/arm64" ||
    deterministicJson(proof.observedHost.identityFingerprint) !==
      deterministicJson(expected.observedHost.identityFingerprint)
  ) {
    throw new TypeError(
      "A Modelica candidate profile proof is foreign or divergent from the aggregate import/host/digest.",
    );
  }
}

async function persistAggregate(
  stateRoot: string,
  record: ModelicaWorkerCandidateQualificationAggregate,
): Promise<ModelicaWorkerCandidateQualificationAggregate> {
  const parsed = parseModelicaWorkerCandidateQualificationAggregate(
    JSON.parse(deterministicJson(record)),
  );
  await Deno.mkdir(stateRoot, { recursive: true });
  return await persistExactJson(`${stateRoot}/qualification.json`, parsed);
}

async function persistProfileProof(
  path: string,
  proof: ModelicaWorkerCandidateProfileProof,
): Promise<ModelicaWorkerCandidateProfileProof> {
  const parsed = parseProfileProof(JSON.parse(deterministicJson(proof)));
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  return await persistExactJson(path, parsed);
}

async function readProfileProof(
  path: string,
): Promise<ModelicaWorkerCandidateProfileProof> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error("The attested Modelica candidate profile proof is missing.");
    }
    throw error;
  }
  const parsed = parseProfileProof(JSON.parse(text));
  if (`${deterministicJson(parsed)}\n` !== text) {
    throw new Error("The attested Modelica candidate profile proof is not canonical.");
  }
  return parsed;
}

async function persistExactJson<T>(path: string, value: T): Promise<T> {
  const text = `${deterministicJson(value)}\n`;
  try {
    const existing = await Deno.readTextFile(path);
    if (existing === text) return value;
    throw new Error(
      "A different candidate qualification record already occupies this import-record identity.",
    );
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.writeTextFile(path, text, { createNew: true });
  if (await Deno.readTextFile(path) !== text) {
    throw new Error("The candidate qualification record failed durable reread.");
  }
  return value;
}

function observedHostRecord(
  host: CapabilityRuntimeObservedHost & { readonly platform: "linux/arm64" },
): ModelicaWorkerCandidateObservedHost {
  return Object.freeze({
    identityFingerprint: host.identityFingerprint,
    platform: "linux/arm64",
    fingerprint: host.fingerprint,
  });
}

function parseObservedHost(
  value: Record<string, unknown>,
): ModelicaWorkerCandidateObservedHost {
  if (value.platform !== "linux/arm64") {
    throw new TypeError(
      "Candidate qualification requires authoritative linux/arm64 host observation.",
    );
  }
  return Object.freeze({
    identityFingerprint: contentFingerprint(
      value.identityFingerprint,
      "observed host identity",
    ),
    platform: "linux/arm64",
    fingerprint: contentFingerprint(value.fingerprint, "observed host fingerprint"),
  });
}

function assertCandidateProfile(
  label: string,
  imageReference: string,
  digest: string,
  expectedImageReference: string,
  expectedDigest: string,
): void {
  if (imageReference !== expectedImageReference || digest !== expectedDigest) {
    throw new Error(
      `The composed Modelica ${label} candidate profile did not retain the bound Microsandbox candidate reference and digest.`,
    );
  }
}

function requireExecution<T>(
  execution: T | undefined,
  label: string,
): T {
  if (execution === undefined) {
    throw new Error(
      `The imported Modelica ${label} candidate runtime was not composed.`,
    );
  }
  return execution;
}

function profileRoot(
  stateRoot: string,
  profileId: ModelicaWorkerCandidateProfileProofId,
): string {
  return modelicaWorkerCandidateProfileRoot(stateRoot, profileId);
}

function isFailClosed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /outcome is unknown|unpublished|diverged|already occupies|requires an existing WAL|does not dispatch a prepared|foreign or divergent|not the exact rebuilt|linux\/arm64|substitute the active catalogue pin|did not retain the bound/u
    .test(message);
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requiredSha256(value: unknown, label: string): string {
  const digest = requiredString(value, label);
  if (!SHA256.test(digest)) {
    throw new TypeError(`${label} must be an exact lowercase sha256 digest.`);
  }
  return digest;
}

function requiredHex(value: unknown, label: string): string {
  const digest = requiredString(value, label);
  if (!SHA256_DIGEST.test(digest)) {
    throw new TypeError(`${label} must be an exact lowercase sha256 digest.`);
  }
  return digest;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function contentFingerprint(value: unknown, label: string): ContentFingerprint {
  const root = jsonObject(value, label);
  if (root.algorithm !== "sha256") {
    throw new TypeError(`${label} algorithm must be sha256.`);
  }
  return Object.freeze({
    algorithm: "sha256" as const,
    digest: requiredHex(root.digest, `${label} digest`),
  });
}

interface IsolatedExecution {
  readonly runner: IsolatedCodeRunner;
  readonly recovery: IsolatedCodeRunRecovery;
  readonly publications: IsolatedOutputPublicationReader;
}

function requireQualifiedKitProof(
  proof: ModelicaWorkerCandidateProfileProof,
): ModelicaWorkerCandidateQualifiedKitProof {
  if (proof.profileId !== MODELICA_WORKER_CANDIDATE_QUALIFIED_KIT_PROOF_ID) {
    throw new Error("Expected the openmodelica-qualified-kit candidate proof.");
  }
  return proof;
}

function requireAdmittedProof(
  proof: ModelicaWorkerCandidateProfileProof,
): ModelicaWorkerCandidateAdmittedProof {
  if (proof.profileId !== MODELICA_WORKER_CANDIDATE_ADMITTED_PROOF_ID) {
    throw new Error("Expected the openmodelica-admitted-modelica candidate proof.");
  }
  return proof;
}

interface ProfileContext {
  readonly record: FirstPartyMicrosandboxImageCandidateImportRecord;
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly observedHost: CapabilityRuntimeObservedHost & {
    readonly platform: "linux/arm64";
  };
  readonly profileId: ModelicaWorkerCandidateProfileProofId;
  readonly identity: ModelicaWorkerCandidateProfileAttemptIdentity;
  readonly execution: IsolatedExecution;
  readonly executionProfile: { readonly id: string; readonly version: string };
  readonly isolationPolicy: IsolatedCodePolicyRef;
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  readonly profileFingerprint: ContentFingerprint;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly sourceBytes: Uint8Array;
  readonly sourceSha256: string;
  readonly wal: FileModelicaWorkerCandidateProfileAttemptStore;
  readonly proofPath: string;
  readonly validateOutputs: (
    receipt: IsolatedCodeExecutionReceipt,
    bytesByRole: ReadonlyMap<string, Uint8Array>,
  ) => Promise<void>;
  readonly outputValidation: string;
  readonly admittedFields: boolean;
}

interface ComposedModelicaWorkerCandidateQualification {
  readonly record: FirstPartyMicrosandboxImageCandidateImportRecord;
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly observedHost: CapabilityRuntimeObservedHost & {
    readonly platform: "linux/arm64";
  };
  readonly kit: ProfileContext;
  readonly admitted: ProfileContext;
}

type ProfileOutcome =
  | { readonly status: "passed"; readonly proof: ModelicaWorkerCandidateProfileProof }
  | { readonly status: "failed" };
