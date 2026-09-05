/**
 * Maintainer-only qualification of an imported geometry-module assembler
 * candidate. Policy, limits, worker command, fixture and oracle stay
 * code-owned. The CLI/gate never accepts a provider, image, digest, platform,
 * command, endpoint, tool, worker, binding, unit, or args.
 *
 * The active-pin qualification path is unchanged. This path binds one imported
 * candidate exactly and isolates its WAL, captures and outputs under a
 * candidate-specific root.
 */

import { pinnedOciImageReference } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  fingerprintFirstPartyMicrosandboxImageCandidateImportRecord,
  type FirstPartyMicrosandboxImageCandidateImportRecord,
} from "../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  assertBoundCandidateImportPhysicalImageId,
  buildFirstPartyMicrosandboxImageCandidateQualificationRecord,
  type FirstPartyMicrosandboxImageCandidateQualificationRecord,
  firstPartyMicrosandboxImageCandidateQualificationRoot,
  GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
  persistFirstPartyMicrosandboxImageCandidateQualificationRecord,
  readObservedLinuxArm64Host,
} from "../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import { FileCapabilityRuntimeQualificationAttemptStore } from "../../control-plane/file-capability-runtime-qualification-attempt-store.ts";
import { FileCapabilityRuntimeQualificationAttestationStore } from "../../control-plane/file-capability-runtime-qualification-attestation-store.ts";
import { FileIsolatedOutputCas } from "../../shared/cas/file-isolated-output-cas.ts";
import type { CapabilityRuntimeHostObservation } from "../../../domain/capability/runtime/capability-runtime-catalog.ts";
import {
  createGeometryModuleAssemblyComposition,
  type GeometryModuleAssemblyComposition,
  type GeometryModuleAssemblyCompositionPaths,
  type GeometryModuleAssemblyServerOptions,
} from "./geometry-module-assembly-composition.ts";
import { createGeometryModuleAssemblyServerOptionsForBoundCandidateImport } from "./first-party-geometry-module-assembly.ts";
import {
  createGeometryModuleAssemblerMicrosandboxQualificationCandidateFromBoundImport,
  FileGeometryModuleAssemblerMicrosandboxQualificationStore,
  type GeometryModuleAssemblerQualificationResult,
  GeometryModuleAssemblerQualificationService,
} from "./geometry-module-assembly-microsandbox-qualification.ts";

export const GEOMETRY_MODULE_ASSEMBLER_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA =
  "geometry-module-assembler-worker-candidate-qualification-plan/1.0" as const;
export const GEOMETRY_MODULE_ASSEMBLER_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA =
  "geometry-module-assembler-worker-candidate-qualification/1.0" as const;

export interface GeometryModuleAssemblerWorkerCandidateQualificationPlan {
  readonly schemaVersion:
    typeof GEOMETRY_MODULE_ASSEMBLER_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly mode: "plan";
  readonly mutation: false;
  readonly physicalImageId: typeof GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID;
  readonly candidateReference: string;
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly runtimeQualification: "not-run";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
}

export interface GeometryModuleAssemblerWorkerCandidateQualificationResult {
  readonly schemaVersion:
    typeof GEOMETRY_MODULE_ASSEMBLER_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly physicalImageId: typeof GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID;
  readonly candidateReference: string;
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly runtimeQualification: "passed" | "unavailable" | "pending" | "revoked";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
  readonly engineeringLevels: {
    readonly l3: false;
    readonly l4: false;
    readonly l5: false;
  };
  readonly qualification:
    | FirstPartyMicrosandboxImageCandidateQualificationRecord
    | null;
  readonly result: GeometryModuleAssemblerQualificationResult;
}

export interface GeometryModuleAssemblerWorkerCandidateQualificationPorts {
  readonly compose?: (
    options: GeometryModuleAssemblyServerOptions,
    paths: GeometryModuleAssemblyCompositionPaths,
  ) => Promise<GeometryModuleAssemblyComposition>;
  readonly observedHost: { read(): Promise<CapabilityRuntimeHostObservation> };
  readonly stateRoot?: string;
}

export async function planGeometryModuleAssemblerWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<GeometryModuleAssemblerWorkerCandidateQualificationPlan> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
  );
  const importRecordFingerprint =
    await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record);
  const plan: GeometryModuleAssemblerWorkerCandidateQualificationPlan = {
    schemaVersion: GEOMETRY_MODULE_ASSEMBLER_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA,
    kind: "candidate-qualification",
    mode: "plan",
    mutation: false,
    physicalImageId: GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
    candidateReference: record.candidate.microsandbox.candidateReference,
    identities: record.identities,
    importRecordFingerprint,
    stateRoot: firstPartyMicrosandboxImageCandidateQualificationRoot(
      GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
      importRecordFingerprint,
    ),
    runtimeQualification: "not-run",
    eligibleForPromotion: false,
    evidence: "host-runtime-only",
  };
  return Object.freeze(plan);
}

export function renderGeometryModuleAssemblerWorkerCandidateQualificationPlanText(
  plan: GeometryModuleAssemblerWorkerCandidateQualificationPlan,
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

export async function applyGeometryModuleAssemblerWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: GeometryModuleAssemblerWorkerCandidateQualificationPorts,
): Promise<GeometryModuleAssemblerWorkerCandidateQualificationResult> {
  const service = await composeGeometryModuleAssemblerWorkerCandidateQualification(
    record,
    ports,
  );
  const result = await service.service.apply();
  return await settleGeometryModuleAssemblerWorkerCandidateQualification(
    record,
    service,
    result,
  );
}

export async function recoverGeometryModuleAssemblerWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: GeometryModuleAssemblerWorkerCandidateQualificationPorts,
): Promise<GeometryModuleAssemblerWorkerCandidateQualificationResult> {
  const service = await composeGeometryModuleAssemblerWorkerCandidateQualification(
    record,
    ports,
  );
  const result = await service.service.recover();
  return await settleGeometryModuleAssemblerWorkerCandidateQualification(
    record,
    service,
    result,
  );
}

export function geometryCandidateRuntimeQualification(
  status: GeometryModuleAssemblerQualificationResult["status"],
): GeometryModuleAssemblerWorkerCandidateQualificationResult["runtimeQualification"] {
  return status === "qualified" ? "passed" : status;
}

export function renderGeometryModuleAssemblerWorkerCandidateQualificationResultText(
  result: GeometryModuleAssemblerWorkerCandidateQualificationResult,
): string {
  return [
    `schemaVersion=${result.schemaVersion}`,
    `kind=${result.kind}`,
    `status=${result.result.status}`,
    `phase=${result.result.phase}`,
    `physicalImageId=${result.physicalImageId}`,
    `candidateReference=${result.candidateReference}`,
    `microsandbox.manifestDigest=${result.identities.microsandboxManifestDigest}`,
    `importRecord.fingerprint=${result.importRecordFingerprint}`,
    `runtimeQualification=${result.runtimeQualification}`,
    `eligibleForPromotion=${result.eligibleForPromotion}`,
    "Candidate qualification only. Promotion is false.",
    "This is not L3/L4/L5 engineering evidence.",
    "",
  ].join("\n");
}

async function composeGeometryModuleAssemblerWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: GeometryModuleAssemblerWorkerCandidateQualificationPorts,
): Promise<{
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly observedHost: CapabilityRuntimeHostObservation;
  readonly service: GeometryModuleAssemblerQualificationService;
}> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
  );
  const host = await readObservedLinuxArm64Host(ports.observedHost);
  const options =
    await createGeometryModuleAssemblyServerOptionsForBoundCandidateImport(
      record,
    );
  const importRecordFingerprint =
    await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record);
  const stateRoot = ports.stateRoot ??
    firstPartyMicrosandboxImageCandidateQualificationRoot(
      GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
      importRecordFingerprint,
    );
  const outputCasDirectory = `${stateRoot}/outputs`;
  const compose = ports.compose ?? createGeometryModuleAssemblyComposition;
  const composition = await compose(options, { outputCasDirectory });
  if (!composition.execution) {
    throw new Error("The imported geometry-module candidate runtime was not composed.");
  }
  const profile = await composition.profiles.initial();
  const expectedImageReference = pinnedOciImageReference(
    record.candidate.microsandbox.candidateReference,
    "$geometryModuleAssemblerWorkerCandidate.imageReference",
  );
  const expectedDigest = record.identities.microsandboxManifestDigest.slice(
    "sha256:".length,
  );
  if (
    profile.imageReference !== expectedImageReference ||
    profile.runtime.imageDigest.digest !== expectedDigest ||
    profile.runtimeBackend.imageReference !== expectedImageReference
  ) {
    throw new Error(
      "The composed geometry-module candidate profile did not retain the bound Microsandbox candidate reference and digest.",
    );
  }
  const expectedCandidate = () =>
    createGeometryModuleAssemblerMicrosandboxQualificationCandidateFromBoundImport(
      record,
    );
  const observedHostSnapshot = {
    read: () => Promise.resolve(host.observation),
  };
  const service = new GeometryModuleAssemblerQualificationService({
    candidate: expectedCandidate,
    expectedCandidate,
    observedHost: observedHostSnapshot,
    profiles: composition.profiles,
    runner: composition.execution.runner,
    publications: composition.execution.publications,
    recovery: composition.execution.recovery,
    restartPublications: () => new FileIsolatedOutputCas(outputCasDirectory),
    attempts: new FileCapabilityRuntimeQualificationAttemptStore(
      `${stateRoot}/attempts`,
    ),
    attestations: new FileCapabilityRuntimeQualificationAttestationStore(
      `${stateRoot}/attestations`,
    ),
    captures: new FileGeometryModuleAssemblerMicrosandboxQualificationStore(
      `${stateRoot}/captures`,
    ),
  });
  return {
    importRecordFingerprint,
    stateRoot,
    observedHost: host.observation,
    service,
  };
}

async function settleGeometryModuleAssemblerWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  composed: {
    readonly importRecordFingerprint: string;
    readonly stateRoot: string;
    readonly observedHost: CapabilityRuntimeHostObservation;
  },
  result: GeometryModuleAssemblerQualificationResult,
): Promise<GeometryModuleAssemblerWorkerCandidateQualificationResult> {
  const qualification = result.status === "qualified"
    ? await persistFirstPartyMicrosandboxImageCandidateQualificationRecord(
      composed.stateRoot,
      await buildFirstPartyMicrosandboxImageCandidateQualificationRecord(record, {
        observedHost: composed.observedHost,
        runId: result.runId,
        receiptFingerprint: geometryCandidateReceiptFingerprint(result),
      }),
    )
    : null;
  const settled: GeometryModuleAssemblerWorkerCandidateQualificationResult = {
    schemaVersion:
      GEOMETRY_MODULE_ASSEMBLER_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA,
    kind: "candidate-qualification",
    physicalImageId: GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
    candidateReference: record.candidate.microsandbox.candidateReference,
    identities: record.identities,
    importRecordFingerprint: composed.importRecordFingerprint,
    stateRoot: composed.stateRoot,
    runtimeQualification: geometryCandidateRuntimeQualification(result.status),
    eligibleForPromotion: false,
    evidence: "host-runtime-only",
    engineeringLevels: { l3: false, l4: false, l5: false },
    qualification,
    result,
  };
  return Object.freeze(settled);
}

function geometryCandidateReceiptFingerprint(
  result: GeometryModuleAssemblerQualificationResult,
): NonNullable<GeometryModuleAssemblerQualificationResult["receiptFingerprint"]> {
  if (result.receiptFingerprint === null) {
    throw new Error(
      "Geometry-module candidate qualification lacks the exact receipt fingerprint.",
    );
  }
  return result.receiptFingerprint;
}
