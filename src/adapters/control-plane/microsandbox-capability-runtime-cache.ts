/** Exact local Microsandbox cache observation for an already catalogued image. */

import type { CapabilityRuntimeMicrosandboxCache } from "../../application/control-plane/capability-runtime-session-primitives.ts";
import type {
  CapabilityRuntimeStateObserver,
} from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  assertExactMicrosandboxImageInspection,
  type ExactMicrosandboxImageExpectation,
  type MicrosandboxSdk,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  capabilityRuntimeMaterialKey,
  type CapabilityRuntimeObservedState,
} from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type {
  CapabilityRuntimeMaterialIdentity,
  CapabilityRuntimePlatform,
} from "../../domain/capability/runtime/capability-runtime-material.ts";

export interface MicrosandboxCapabilityRuntimeImageExpectation {
  readonly material: { readonly unitId: string; readonly materialId: string };
  readonly image: ExactMicrosandboxImageExpectation;
  /**
   * Closed server-owned execution-profile fingerprints allowed to invoke this
   * one material. `ensureExactCached` still receives exactly one fingerprint
   * for the current operation and requires membership in this list.
   */
  readonly allowedExecutionProfileFingerprints: readonly ContentFingerprint[];
}

/**
 * Converts one code-owned material platform into the exact Microsandbox image
 * architecture. The controller process architecture is deliberately absent:
 * a cache contract may only come from its registered material profile.
 */
export function exactMicrosandboxMaterialArchitecture(
  platforms: readonly CapabilityRuntimePlatform[],
): "amd64" | "arm64" {
  if (platforms.length !== 1) {
    throw new TypeError(
      "Microsandbox cache material must declare exactly one code-owned platform.",
    );
  }
  switch (platforms[0]) {
    case "linux/amd64":
      return "amd64";
    case "linux/arm64":
      return "arm64";
  }
}

export class LocalMicrosandboxCapabilityRuntimeCache
  implements CapabilityRuntimeMicrosandboxCache, CapabilityRuntimeStateObserver {
  readonly #expectations: ReadonlyMap<
    string,
    MicrosandboxCapabilityRuntimeImageExpectation
  >;

  constructor(
    private readonly sdk: () => Promise<MicrosandboxSdk>,
    expectations: readonly MicrosandboxCapabilityRuntimeImageExpectation[],
  ) {
    const records = new Map<
      string,
      MicrosandboxCapabilityRuntimeImageExpectation
    >();
    for (const expectation of expectations) {
      const key = materialKey(expectation.material);
      if (records.has(key)) {
        throw new TypeError(`Microsandbox capability cache has duplicate ${key}.`);
      }
      records.set(key, freezeExpectation(expectation, key));
    }
    this.#expectations = records;
  }

  async ensureExactCached(input: {
    readonly material: {
      readonly unitId: string;
      readonly materialId: string;
      readonly imageDigest: string;
    };
    readonly imageReference: string;
    readonly executionProfileFingerprint: ContentFingerprint;
  }): Promise<void> {
    if (!input.imageReference.endsWith(`@sha256:${input.material.imageDigest}`)) {
      throw new Error(
        "Catalog image reference does not match the sealed material digest.",
      );
    }
    const expected = this.#expectations.get(materialKey(input.material));
    if (
      !expected || expected.image.reference !== input.imageReference ||
      expected.image.manifestDigest !== `sha256:${input.material.imageDigest}`
    ) {
      throw new Error(
        `Microsandbox cache has no registered exact image contract for ${input.material.unitId}/${input.material.materialId}.`,
      );
    }
    if (
      !expected.allowedExecutionProfileFingerprints.some((fingerprint) =>
        sameFingerprint(input.executionProfileFingerprint, fingerprint)
      )
    ) {
      throw new Error(
        `Microsandbox cache execution profile does not attest ${input.material.unitId}/${input.material.materialId}.`,
      );
    }
    const sdk = await this.sdk();
    sdk.assertLocalBackend();
    const inspection = await sdk.inspectImage(input.imageReference);
    try {
      assertExactMicrosandboxImageInspection(inspection, expected.image);
    } catch {
      throw new Error(
        `Microsandbox local cache does not attest ${input.material.unitId}/${input.material.materialId} with its sealed image contract.`,
      );
    }
  }

  /**
   * Read-only local cache observation. It does not import an OCI archive,
   * create a sandbox, or lend execution-profile authority to this read. A
   * missing or non-exact cache remains literally absent. Qualification is a
   * separate server projection and is never supplied by host observation.
   */
  async observe(
    materials: readonly CapabilityRuntimeMaterialIdentity[],
  ): Promise<ReadonlyMap<string, CapabilityRuntimeObservedState>> {
    const requested = materials.flatMap((material) => {
      const expected = this.#expectations.get(materialKey(material));
      return expected ? [{ material, expected }] : [];
    });
    if (requested.length === 0) return new Map();
    let sdk: MicrosandboxSdk | undefined;
    try {
      sdk = await this.sdk();
      sdk.assertLocalBackend();
    } catch {
      return new Map(requested.map(({ material }) => [
        capabilityRuntimeMaterialKey(material),
        absentState(),
      ]));
    }
    const observed = await Promise.all(requested.map(async ({ material, expected }) => {
      if (
        expected.image.manifestDigest !== `sha256:${material.imageDigest}` ||
        !expected.image.reference.endsWith(`@sha256:${material.imageDigest}`)
      ) {
        return [capabilityRuntimeMaterialKey(material), absentState()] as const;
      }
      try {
        const inspection = await sdk!.inspectImage(expected.image.reference);
        assertExactMicrosandboxImageInspection(inspection, expected.image);
        return [capabilityRuntimeMaterialKey(material), {
          material: "installed" as const,
          runtime: "inactive" as const,
        }] as const;
      } catch {
        return [capabilityRuntimeMaterialKey(material), absentState()] as const;
      }
    }));
    return new Map(observed);
  }
}

function absentState(): CapabilityRuntimeObservedState {
  return {
    material: "absent",
    runtime: "inactive",
  };
}

function freezeExpectation(
  expectation: MicrosandboxCapabilityRuntimeImageExpectation,
  key: string,
): MicrosandboxCapabilityRuntimeImageExpectation {
  const cloned = structuredClone(expectation);
  const fingerprints = cloned.allowedExecutionProfileFingerprints ?? [];
  const seen = new Set<string>();
  for (const fingerprint of fingerprints) {
    const token = `${fingerprint.algorithm}:${fingerprint.digest}`;
    if (seen.has(token)) {
      throw new TypeError(
        `Microsandbox capability cache has duplicate execution-profile fingerprint for ${key}.`,
      );
    }
    seen.add(token);
  }
  return {
    ...cloned,
    allowedExecutionProfileFingerprints: Object.freeze(fingerprints),
  };
}

function sameFingerprint(
  left: ContentFingerprint,
  right: ContentFingerprint,
): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function materialKey(
  value: { readonly unitId: string; readonly materialId: string },
): string {
  return `${value.unitId}\u0000${value.materialId}`;
}
