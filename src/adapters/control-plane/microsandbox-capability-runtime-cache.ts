/** Exact local Microsandbox cache observation for an already catalogued image. */

import type { CapabilityRuntimeMicrosandboxCache } from "../../application/control-plane/capability-runtime-execution-session.ts";
import {
  assertExactMicrosandboxImageInspection,
  type ExactMicrosandboxImageExpectation,
  type MicrosandboxSdk,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";

export interface MicrosandboxCapabilityRuntimeImageExpectation {
  readonly material: { readonly unitId: string; readonly materialId: string };
  readonly image: ExactMicrosandboxImageExpectation;
  /** Server-selected execution profile which owns image invocation semantics. */
  readonly executionProfileFingerprint: ContentFingerprint;
}

export class LocalMicrosandboxCapabilityRuntimeCache
  implements CapabilityRuntimeMicrosandboxCache {
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
      records.set(key, structuredClone(expectation));
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
      !sameFingerprint(
        input.executionProfileFingerprint,
        expected.executionProfileFingerprint,
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
