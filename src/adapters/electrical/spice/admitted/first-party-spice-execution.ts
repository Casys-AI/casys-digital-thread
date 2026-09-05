/**
 * One code-owned local binding for admitted SPICE closed-subset execution.
 *
 * The server composition and the imported-candidate qualification gate share
 * these exact limits and policy fields. Callers never select an image, digest,
 * command, or backend. The candidate factory accepts only an already-bound
 * import record.
 */

import type { IsolatedCodeExecutionLimits } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import type { FirstPartyMicrosandboxImageCandidateImportRecord } from "../../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  assertBoundCandidateImportPhysicalImageId,
  NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
} from "../../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import type { AdmittedSpiceExecutionServerOptions } from "./execution-composition.ts";
import { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE } from "./local-image-references.ts";
export { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE };

export const LOCAL_ADMITTED_SPICE_EXECUTION_LIMITS: IsolatedCodeExecutionLimits = Object
  .freeze({
    maxWallTimeMs: 30_000,
    maxCpuTimeMs: 25_000,
    maxMemoryBytes: 512 * 1_048_576,
    maxProcesses: 16,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 262_144,
    maxOutputTotalBytes: 524_288,
  });

export function admittedSpiceExecutionPolicyBody(imageReference: string) {
  return Object.freeze({
    schemaVersion: "spice-admitted-microsandbox-policy/1.0",
    backend: "microsandbox-local@0.6.8",
    imageReference,
    network: "deny-all",
    pullPolicy: "never",
    securityProfile: "restricted",
    workerUser: "65532:65532",
    fixedExecutables: ["ngspice"],
    limits: LOCAL_ADMITTED_SPICE_EXECUTION_LIMITS,
  });
}

export const LOCAL_ADMITTED_SPICE_EXECUTION_POLICY_BODY =
  admittedSpiceExecutionPolicyBody(LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE);

/**
 * No environment value or CLI input can select the image, policy, limits,
 * command, network, lifecycle, or backend for the active catalogue pin.
 */
export async function createLocalAdmittedSpiceExecutionServerOptions(): Promise<
  AdmittedSpiceExecutionServerOptions
> {
  return await createAdmittedSpiceExecutionServerOptionsForImage(
    LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
  );
}

/**
 * Internal adapter factory: the bound import record already selected the
 * candidate. This is not a raw image-selector API.
 */
export async function createAdmittedSpiceExecutionServerOptionsForBoundCandidateImport(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<AdmittedSpiceExecutionServerOptions> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
  );
  return await createAdmittedSpiceExecutionServerOptionsForImage(
    record.candidate.microsandbox.candidateReference,
  );
}

async function createAdmittedSpiceExecutionServerOptionsForImage(
  imageReference: string,
): Promise<AdmittedSpiceExecutionServerOptions> {
  const policy = Object.freeze({
    id: "spice-admitted-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      admittedSpiceExecutionPolicyBody(imageReference),
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference,
      policy,
      limits: LOCAL_ADMITTED_SPICE_EXECUTION_LIMITS,
    }),
    runtime: Object.freeze({}),
  });
}
