/**
 * One code-owned local binding for the geometry-module assembler.
 *
 * The server composition and the opt-in qualification gate share these exact
 * values.  This is a runtime candidate, not a capability-catalogue entry or
 * an activation decision. The imported-candidate factory accepts only an
 * already-bound import record.
 */

import type { IsolatedCodeExecutionLimits } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { FirstPartyMicrosandboxImageCandidateImportRecord } from "../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  assertBoundCandidateImportPhysicalImageId,
  GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
} from "../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import {
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
} from "../../control-plane/first-party-capability-runtime-identities.ts";
import type { GeometryModuleAssemblyServerOptions } from "./geometry-module-assembly-composition.ts";

export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_WRAPPER_SHA256 =
  "609eaf93f2564b88b9103d5e0d53d1dd3e93fcdf8e54c61cc313b957370bf581" as const;

export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_LIMITS: IsolatedCodeExecutionLimits = Object
  .freeze({
    maxWallTimeMs: 120_000,
    maxCpuTimeMs: 90_000,
    maxMemoryBytes: 2 * 1_073_741_824,
    maxProcesses: 32,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 64 * 1_048_576,
    maxOutputTotalBytes: 128 * 1_048_576,
  });

export function geometryModuleAssemblyPolicyBody(imageReference: string) {
  return Object.freeze({
    schemaVersion: "geometry-module-assembler-microsandbox-policy/1.0",
    backend: "microsandbox-local@0.6.8",
    imageReference,
    network: "deny-all",
    pullPolicy: "never",
    securityProfile: "restricted",
    workerUser: "65532:65532",
    fixedExecutable: "/usr/local/bin/python3",
    limits: LOCAL_GEOMETRY_MODULE_ASSEMBLY_LIMITS,
  });
}

export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_POLICY_BODY =
  geometryModuleAssemblyPolicyBody(LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE);

/**
 * No environment value or CLI input can select the image, policy, limits,
 * command, network, lifecycle, or backend for this module assembler.
 */
export async function createLocalGeometryModuleAssemblyServerOptions(): Promise<
  GeometryModuleAssemblyServerOptions
> {
  return await createGeometryModuleAssemblyServerOptionsForImage(
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  );
}

/**
 * Internal adapter factory: the bound import record already selected the
 * candidate. This is not a raw image-selector API.
 */
export async function createGeometryModuleAssemblyServerOptionsForBoundCandidateImport(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<GeometryModuleAssemblyServerOptions> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID,
  );
  return await createGeometryModuleAssemblyServerOptionsForImage(
    record.candidate.microsandbox.candidateReference,
  );
}

async function createGeometryModuleAssemblyServerOptionsForImage(
  imageReference: string,
): Promise<GeometryModuleAssemblyServerOptions> {
  const policy = Object.freeze({
    id: "geometry-module-assembler-microsandbox-deny-all-v1",
    version: "1.0.0",
    fingerprint: await sha256Fingerprint(
      geometryModuleAssemblyPolicyBody(imageReference),
    ),
  });
  return Object.freeze({
    profile: Object.freeze({
      imageReference,
      wrapperSha256: LOCAL_GEOMETRY_MODULE_ASSEMBLY_WRAPPER_SHA256,
      policy,
      limits: LOCAL_GEOMETRY_MODULE_ASSEMBLY_LIMITS,
    }),
    runtime: Object.freeze({}),
  });
}
