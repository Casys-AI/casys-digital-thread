/**
 * One code-owned local binding for isolated Modelica execution.
 *
 * Qualified-kit and admitted closed-subset share this physical image, limits
 * and worker user. They keep distinct policy ids and fingerprints. Callers
 * never select an image, digest, command, or backend. Candidate factories
 * accept only an already-bound import record.
 */

import type { IsolatedCodeExecutionLimits } from "../../domain/compile/isolation/isolated-code-execution.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import { LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE } from "../../domain/modelica/local-execution-image.ts";
export { LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE };
import type { FirstPartyMicrosandboxImageCandidateImportRecord } from "../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  assertBoundCandidateImportPhysicalImageId,
  MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
} from "../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import type { AdmittedModelicaExecutionServerOptions } from "./admitted/execution-composition.ts";
import type { ModelicaIsolatedExecutionServerOptions } from "./qualified-kit/execution-composition.ts";

export const LOCAL_MODELICA_EXECUTION_LIMITS: IsolatedCodeExecutionLimits = Object
  .freeze({
    maxWallTimeMs: 120_000,
    maxCpuTimeMs: 120_000,
    maxMemoryBytes: 3 * 1_073_741_824,
    maxProcesses: 64,
    maxStdoutBytes: 1_048_576,
    maxStderrBytes: 1_048_576,
    maxOutputFileBytes: 16 * 1_048_576,
    maxOutputTotalBytes: 17 * 1_048_576,
  });

export const LOCAL_MODELICA_ENGINE = Object.freeze({
  name: "OpenModelica" as const,
  version: "1.27.0",
  mslVersion: "4.1.0",
});

export function modelicaIsolatedExecutionPolicyBody(imageReference: string) {
  return Object.freeze({
    schemaVersion: "modelica-microsandbox-policy/1.0",
    backend: "microsandbox-local@0.6.8",
    imageReference,
    network: "deny-all",
    pullPolicy: "never",
    securityProfile: "restricted",
    workerUser: "65532:65532",
    fixedExecutables: ["omc", "perl"],
    limits: LOCAL_MODELICA_EXECUTION_LIMITS,
  });
}

export function admittedModelicaExecutionPolicyBody(imageReference: string) {
  return Object.freeze({
    schemaVersion: "modelica-admitted-microsandbox-policy/1.0",
    backend: "microsandbox-local@0.6.8",
    imageReference,
    network: "deny-all",
    pullPolicy: "never",
    securityProfile: "restricted",
    workerUser: "65532:65532",
    fixedExecutables: ["omc", "perl"],
    limits: LOCAL_MODELICA_EXECUTION_LIMITS,
  });
}

export const LOCAL_MODELICA_EXECUTION_POLICY_BODY = modelicaIsolatedExecutionPolicyBody(
  LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
);

export const LOCAL_ADMITTED_MODELICA_EXECUTION_POLICY_BODY =
  admittedModelicaExecutionPolicyBody(LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE);

/**
 * No environment value or CLI input can select the image, policy, limits,
 * command, network, lifecycle, or backend for the active catalogue pin.
 */
export async function createLocalModelicaIsolatedExecutionServerOptions(): Promise<
  ModelicaIsolatedExecutionServerOptions
> {
  return await createModelicaIsolatedExecutionServerOptionsForImage(
    LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
  );
}

/** Code-owned binding for admitted Modelica closed-subset execution. */
export async function createLocalAdmittedModelicaExecutionServerOptions(): Promise<
  AdmittedModelicaExecutionServerOptions
> {
  return await createAdmittedModelicaExecutionServerOptionsForImage(
    LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
  );
}

/**
 * Internal adapter factory: the bound import record already selected the
 * candidate. This is not a raw image-selector API.
 */
export async function createModelicaIsolatedExecutionServerOptionsForBoundCandidateImport(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<ModelicaIsolatedExecutionServerOptions> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
  );
  return await createModelicaIsolatedExecutionServerOptionsForImage(
    record.candidate.microsandbox.candidateReference,
  );
}

/**
 * Internal adapter factory: the bound import record already selected the
 * candidate. This is not a raw image-selector API.
 */
export async function createAdmittedModelicaExecutionServerOptionsForBoundCandidateImport(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<AdmittedModelicaExecutionServerOptions> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID,
  );
  return await createAdmittedModelicaExecutionServerOptionsForImage(
    record.candidate.microsandbox.candidateReference,
  );
}

async function createModelicaIsolatedExecutionServerOptionsForImage(
  imageReference: string,
): Promise<ModelicaIsolatedExecutionServerOptions> {
  const policy = Object.freeze({
    id: "modelica-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      modelicaIsolatedExecutionPolicyBody(imageReference),
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference,
      policy,
      limits: LOCAL_MODELICA_EXECUTION_LIMITS,
      engine: LOCAL_MODELICA_ENGINE,
    }),
    runtime: Object.freeze({}),
  });
}

async function createAdmittedModelicaExecutionServerOptionsForImage(
  imageReference: string,
): Promise<AdmittedModelicaExecutionServerOptions> {
  const policy = Object.freeze({
    id: "modelica-admitted-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      admittedModelicaExecutionPolicyBody(imageReference),
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference,
      policy,
      limits: LOCAL_MODELICA_EXECUTION_LIMITS,
    }),
    runtime: Object.freeze({}),
  });
}
