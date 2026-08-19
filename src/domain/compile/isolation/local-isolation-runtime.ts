/**
 * Code-owned identity for a local isolated-execution runtime.
 *
 * This is review evidence, never a runtime capability: it contains no socket,
 * credential, executable, mutable image tag, filesystem path, or caller
 * option. Concrete adapters import this inward contract and prove that their
 * fixed construction matches it.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
} from "../../kernel/case-validation.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type IsolatedCodeExecutionLimits,
  type IsolatedCodeRuntimeAttestation,
  validateIsolatedCodeExecutionLimits,
  validateIsolatedCodeRuntimeAttestation,
} from "./isolated-code-execution.ts";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const OCI_REPOSITORY_SEGMENT = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const OCI_REGISTRY_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const OCI_REGISTRY = /^(.*?)(?::([1-9][0-9]{0,4}))?$/;

export const MICROSANDBOX_LOCAL_RUNTIME_REF = Object.freeze(
  {
    id: "microsandbox-local",
    version: "0.6.8",
    lifecycle: "attached",
    network: "none",
  } as const,
);

export const MICROSANDBOX_LOCAL_ISOLATION_CLASS =
  "microsandbox-local-microvm-v1" as const;

export type MicrosandboxLocalRuntimeRef = typeof MICROSANDBOX_LOCAL_RUNTIME_REF;

export interface MicrosandboxLocalRuntimeIdentity extends MicrosandboxLocalRuntimeRef {
  /** Immutable OCI name plus digest, never a tag or pull credential. */
  readonly imageReference: string;
  readonly imageDigest: ContentFingerprint;
}

export interface MicrosandboxRuntimeAttestationInput {
  readonly imageReference: string;
  readonly limits: IsolatedCodeExecutionLimits;
}

/**
 * Derive the provider-neutral attestation for the fixed local Microsandbox
 * backend. This is a contract constructor, not a capability factory.
 */
export function createMicrosandboxRuntimeAttestation(
  value: MicrosandboxRuntimeAttestationInput,
  path = "$microsandboxRuntime",
): IsolatedCodeRuntimeAttestation {
  const input = exactRecord(value, ["imageReference", "limits"], path);
  const imageReference = pinnedOciImageReference(
    input.imageReference,
    `${path}.imageReference`,
  );
  const limits = validateIsolatedCodeExecutionLimits(
    input.limits,
    `${path}.limits`,
  );
  if (limits.maxWallTimeMs % 1_000 !== 0) {
    throw new TypeError(`${path}.limits.maxWallTimeMs must be a whole second.`);
  }
  if (limits.maxCpuTimeMs % 1_000 !== 0) {
    throw new TypeError(`${path}.limits.maxCpuTimeMs must be a whole second.`);
  }
  if (limits.maxMemoryBytes % 1_048_576 !== 0) {
    throw new TypeError(`${path}.limits.maxMemoryBytes must be a whole MiB.`);
  }
  return validateIsolatedCodeRuntimeAttestation({
    isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
    imageDigest: {
      algorithm: "sha256",
      digest: imageReference.slice(imageReference.lastIndexOf("@sha256:") + 8),
    },
    requestedLimits: limits,
    limitAssurance: {
      maxWallTimeMs: "backend-attested",
      maxCpuTimeMs: "unattested",
      maxMemoryBytes: "backend-attested",
      maxProcesses: "unattested",
      maxStdoutBytes: "broker-observed-cap",
      maxStderrBytes: "broker-observed-cap",
      maxOutputFileBytes: "broker-observed-cap",
      maxOutputTotalBytes: "broker-observed-cap",
    },
  }, `${path}.attestation`);
}

export function validateMicrosandboxLocalRuntimeRef(
  value: unknown,
  path = "$microsandboxLocalRuntime",
): MicrosandboxLocalRuntimeRef {
  const root = exactRecord(
    value,
    ["id", "version", "lifecycle", "network"],
    path,
  );
  for (
    const key of Object.keys(MICROSANDBOX_LOCAL_RUNTIME_REF) as Array<
      keyof MicrosandboxLocalRuntimeRef
    >
  ) {
    literalValue(
      root[key],
      MICROSANDBOX_LOCAL_RUNTIME_REF[key],
      `${path}.${key}`,
    );
  }
  return deepFreeze({ ...MICROSANDBOX_LOCAL_RUNTIME_REF });
}

export function validateMicrosandboxLocalRuntimeIdentity(
  value: unknown,
  path = "$microsandboxLocalRuntimeIdentity",
): MicrosandboxLocalRuntimeIdentity {
  const root = exactRecord(
    value,
    ["id", "version", "lifecycle", "network", "imageReference", "imageDigest"],
    path,
  );
  const ref = validateMicrosandboxLocalRuntimeRef({
    id: root.id,
    version: root.version,
    lifecycle: root.lifecycle,
    network: root.network,
  }, path);
  const imageReference = pinnedOciImageReference(
    root.imageReference,
    `${path}.imageReference`,
  );
  const imageDigest = contentFingerprint(
    root.imageDigest,
    `${path}.imageDigest`,
  );
  const digest = imageReference.slice(imageReference.lastIndexOf("@sha256:") + 8);
  if (imageDigest.digest !== digest) {
    throw new TypeError(
      `${path}.imageDigest must equal the digest-pinned OCI image reference.`,
    );
  }
  return deepFreeze({ ...ref, imageReference, imageDigest });
}

export function pinnedOciImageReference(value: unknown, path: string): string {
  const reference = nonEmptyText(value, path);
  const marker = "@sha256:";
  const markerIndex = reference.lastIndexOf(marker);
  const name = markerIndex < 0 ? "" : reference.slice(0, markerIndex);
  const digest = markerIndex < 0 ? "" : reference.slice(markerIndex + marker.length);
  const segments = name.split("/");
  const hasExplicitRegistry = segments.length > 1 &&
    (segments[0] === "localhost" || segments[0]!.includes(".") ||
      segments[0]!.includes(":"));
  const repositorySegments = hasExplicitRegistry ? segments.slice(1) : segments;
  const registry = hasExplicitRegistry ? segments[0]! : undefined;
  const registryMatch = registry?.match(OCI_REGISTRY);
  const registryHost = registryMatch?.[1];
  const port = registryMatch?.[2];
  if (
    reference.length > 512 || name.length === 0 || name.includes("@") ||
    name.startsWith("/") || name.startsWith("./") || name.startsWith("../") ||
    name.includes("\\") || name.includes("://") || /\s/.test(reference) ||
    !SHA256_HEX.test(digest) || repositorySegments.length === 0 ||
    repositorySegments.some((segment) => !OCI_REPOSITORY_SEGMENT.test(segment)) ||
    (registry !== undefined &&
      (!registryMatch || !validRegistryHost(registryHost!, port !== undefined))) ||
    (port !== undefined && Number(port) > 65_535)
  ) {
    throw new TypeError(
      `${path} must be one OCI image name pinned by a lowercase sha256 digest.`,
    );
  }
  return reference;
}

function validRegistryHost(host: string, hasPort: boolean): boolean {
  return host === "localhost" ||
    ((host.includes(".") || hasPort) &&
      host.split(".").every((label) => OCI_REGISTRY_LABEL.test(label)));
}

function contentFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  if (typeof root.digest !== "string" || !SHA256_HEX.test(root.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: root.digest });
}
