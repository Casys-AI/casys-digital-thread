/**
 * One code-owned local binding for isolated CalculiX execution.
 *
 * The server composition, the active vertical, and the imported-candidate
 * qualification gate share these exact limits, wrapper digest and policy
 * fields. Callers never select an image, digest, command, or backend. The
 * candidate factory accepts only an already-bound import record.
 */

import type { IsolatedCodeExecutionLimits } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { FirstPartyMicrosandboxImageCandidateImportRecord } from "../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  assertBoundCandidateImportPhysicalImageId,
  CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
} from "../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import type { CalculixIsolatedExecutionServerOptions } from "./calculix-isolated-execution-composition.ts";
import { LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE } from "./local-calculix-image-reference.ts";

export { LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE } from "./local-calculix-image-reference.ts";

export const LOCAL_CALCULIX_WRAPPER_SHA256 =
  "507c29da72e346aa87465ce96572b19b42e96105c64b2854be73d6894592e4e2" as const;

export const LOCAL_CALCULIX_EXECUTION_LIMITS: IsolatedCodeExecutionLimits = Object
  .freeze({
    maxWallTimeMs: 180_000,
    maxCpuTimeMs: 160_000,
    maxMemoryBytes: 3 * 1_073_741_824,
    maxProcesses: 64,
    maxStdoutBytes: 1_048_576,
    maxStderrBytes: 1_048_576,
    maxOutputFileBytes: 128 * 1_048_576,
    maxOutputTotalBytes: 256 * 1_048_576,
  });

export function calculixIsolatedExecutionPolicyBody(imageReference: string) {
  return Object.freeze({
    schemaVersion: "calculix-microsandbox-policy/1.0",
    backend: "microsandbox-local@0.6.8",
    imageReference,
    network: "deny-all",
    pullPolicy: "never",
    securityProfile: "restricted",
    workerUser: "65532:65532",
    fixedExecutables: ["gmsh", "ccx"],
    limits: LOCAL_CALCULIX_EXECUTION_LIMITS,
  });
}

export const LOCAL_CALCULIX_EXECUTION_POLICY_BODY = calculixIsolatedExecutionPolicyBody(
  LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
);

/**
 * No environment value or CLI input can select the image, policy, limits,
 * command, network, lifecycle, or backend for the active catalogue pin.
 */
export async function createLocalCalculixIsolatedExecutionServerOptions(): Promise<
  CalculixIsolatedExecutionServerOptions
> {
  return await createCalculixIsolatedExecutionServerOptionsForImage(
    LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE,
  );
}

/**
 * Internal adapter factory: the bound import record already selected the
 * candidate. This is not a raw image-selector API.
 */
export async function createCalculixIsolatedExecutionServerOptionsForBoundCandidateImport(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<CalculixIsolatedExecutionServerOptions> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    CALCULIX_WORKER_PHYSICAL_IMAGE_ID,
  );
  return await createCalculixIsolatedExecutionServerOptionsForImage(
    record.candidate.microsandbox.candidateReference,
  );
}

async function createCalculixIsolatedExecutionServerOptionsForImage(
  imageReference: string,
): Promise<CalculixIsolatedExecutionServerOptions> {
  const policy = Object.freeze({
    id: "calculix-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      calculixIsolatedExecutionPolicyBody(imageReference),
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference,
      wrapperSha256: LOCAL_CALCULIX_WRAPPER_SHA256,
      policy,
      limits: LOCAL_CALCULIX_EXECUTION_LIMITS,
    }),
    runtime: Object.freeze({}),
  });
}
