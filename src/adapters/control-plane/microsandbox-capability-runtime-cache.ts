/** Exact local Microsandbox cache observation for an already catalogued image. */

import type { CapabilityRuntimeMicrosandboxCache } from "../../application/control-plane/capability-runtime-execution-session.ts";
import {
  assertExactMicrosandboxImageInspection,
  type ExactMicrosandboxImageExpectation,
  type MicrosandboxSdk,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";

export interface MicrosandboxCapabilityRuntimeImageExpectation {
  readonly material: { readonly unitId: string; readonly materialId: string };
  readonly image: ExactMicrosandboxImageExpectation;
}

export class LocalMicrosandboxCapabilityRuntimeCache
  implements CapabilityRuntimeMicrosandboxCache {
  readonly #expectations: ReadonlyMap<string, ExactMicrosandboxImageExpectation>;

  constructor(
    private readonly sdk: () => Promise<MicrosandboxSdk>,
    expectations: readonly MicrosandboxCapabilityRuntimeImageExpectation[],
  ) {
    const records = new Map<string, ExactMicrosandboxImageExpectation>();
    for (const expectation of expectations) {
      const key = materialKey(expectation.material);
      if (records.has(key)) {
        throw new TypeError(`Microsandbox capability cache has duplicate ${key}.`);
      }
      records.set(key, structuredClone(expectation.image));
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
  }): Promise<void> {
    if (!input.imageReference.endsWith(`@sha256:${input.material.imageDigest}`)) {
      throw new Error(
        "Catalog image reference does not match the sealed material digest.",
      );
    }
    const expected = this.#expectations.get(materialKey(input.material));
    if (
      !expected || expected.reference !== input.imageReference ||
      expected.manifestDigest !== `sha256:${input.material.imageDigest}`
    ) {
      throw new Error(
        `Microsandbox cache has no registered exact image contract for ${input.material.unitId}/${input.material.materialId}.`,
      );
    }
    const sdk = await this.sdk();
    sdk.assertLocalBackend();
    const inspection = await sdk.inspectImage(input.imageReference);
    try {
      assertExactMicrosandboxImageInspection(inspection, expected);
    } catch {
      throw new Error(
        `Microsandbox local cache does not attest ${input.material.unitId}/${input.material.materialId} with its sealed image contract.`,
      );
    }
  }
}

function materialKey(
  value: { readonly unitId: string; readonly materialId: string },
): string {
  return `${value.unitId}\u0000${value.materialId}`;
}
