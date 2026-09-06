/**
 * One code-owned local binding for isolated Build123d execution.
 *
 * The server composition, the active vertical, and the imported-candidate
 * qualification gate share these exact limits and policy fields. Callers
 * never select an image, digest, command, or backend. The candidate factory
 * accepts only an already-bound import record.
 */

import type { IsolatedCodeExecutionLimits } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { FirstPartyMicrosandboxImageCandidateImportRecord } from "../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  assertBoundCandidateImportPhysicalImageId,
  BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
} from "../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import { LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE } from "../../control-plane/first-party-capability-runtime-identities.ts";
import type { Build123dExecutionServerOptions } from "./build123d-execution-composition.ts";

export const LOCAL_BUILD123D_EXECUTION_LIMITS: IsolatedCodeExecutionLimits = Object
  .freeze({
    maxWallTimeMs: 30_000,
    maxCpuTimeMs: 25_000,
    maxMemoryBytes: 1_024 * 1_048_576,
    maxProcesses: 32,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 128 * 1_048_576,
    maxOutputTotalBytes: 128 * 1_048_576,
  });

export function build123dExecutionPolicyBody(imageReference: string) {
  return Object.freeze({
    schemaVersion: "build123d-microsandbox-policy/1.0",
    backend: "microsandbox-local@0.6.8",
    imageReference,
    network: "deny-all",
    pullPolicy: "never",
    securityProfile: "restricted",
    supervisorUser: "0:0",
    untrustedChildUser: "65532:65532",
    limits: LOCAL_BUILD123D_EXECUTION_LIMITS,
  });
}

export const LOCAL_BUILD123D_EXECUTION_POLICY_BODY = build123dExecutionPolicyBody(
  LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
);

/**
 * No environment value or CLI input can select the image, policy, limits,
 * command, network, lifecycle, or backend for the active catalogue pin.
 */
export async function createLocalBuild123dExecutionServerOptions(): Promise<
  Build123dExecutionServerOptions
> {
  return await createBuild123dExecutionServerOptionsForImage(
    LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
  );
}

/**
 * Internal adapter factory: the bound import record already selected the
 * candidate. This is not a raw image-selector API.
 */
export async function createBuild123dExecutionServerOptionsForBoundCandidateImport(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<Build123dExecutionServerOptions> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID,
  );
  return await createBuild123dExecutionServerOptionsForImage(
    record.candidate.microsandbox.candidateReference,
  );
}

async function createBuild123dExecutionServerOptionsForImage(
  imageReference: string,
): Promise<Build123dExecutionServerOptions> {
  const policy = Object.freeze({
    id: "build123d-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      build123dExecutionPolicyBody(imageReference),
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference,
      policy,
      limits: LOCAL_BUILD123D_EXECUTION_LIMITS,
    }),
    runtime: Object.freeze({}),
  });
}
