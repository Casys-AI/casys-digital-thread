/** Exact Microsandbox cached-microVM inspection and non-forced image removal. */

import {
  CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_OBSERVATION_SCHEMA,
  type CapabilityRuntimeNonpersistentMaterialRemovalObservation,
  type CapabilityRuntimeNonpersistentMaterialRemovalOutcome,
  type CapabilityRuntimeNonpersistentMaterialRemovalPlan,
  createCapabilityRuntimeNonpersistentMaterialRemovalOutcome,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import type {
  AuthorizedNonpersistentMaterialRemoval,
} from "../../application/ports/out/capability/capability-runtime-nonpersistent-material-removal.ts";
import { consumeAuthorizedNonpersistentMaterialRemoval } from "../../application/control-plane/capability-runtime-nonpersistent-material-removal-authorization.ts";
import {
  assertExactMicrosandboxImageInspection,
  type ExactMicrosandboxImageExpectation,
  type MicrosandboxSdk,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";

export interface MicrosandboxCacheCapabilityRuntimeMaterialRemovalOptions {
  readonly sdk: () => Promise<MicrosandboxSdk>;
  readonly expectations: readonly {
    readonly material: { readonly unitId: string; readonly materialId: string };
    readonly image: ExactMicrosandboxImageExpectation;
  }[];
  readonly clock?: () => string;
}

export class MicrosandboxCacheCapabilityRuntimeMaterialRemovalHost {
  readonly #sdk: () => Promise<MicrosandboxSdk>;
  readonly #expectations: ReadonlyMap<string, ExactMicrosandboxImageExpectation>;
  readonly #clock: () => string;

  constructor(options: MicrosandboxCacheCapabilityRuntimeMaterialRemovalOptions) {
    const records = new Map<string, ExactMicrosandboxImageExpectation>();
    for (const entry of options.expectations) {
      const key = materialKey(entry.material);
      if (records.has(key)) {
        throw new TypeError(
          `Microsandbox cache removal has duplicate ${key}.`,
        );
      }
      records.set(key, structuredClone(entry.image));
    }
    this.#sdk = options.sdk;
    this.#expectations = records;
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  async inspect(input: {
    readonly material: CapabilityRuntimeNonpersistentMaterialRemovalPlan["material"];
  }): Promise<CapabilityRuntimeNonpersistentMaterialRemovalObservation> {
    return await this.#observe(input.material);
  }

  async mutate(input: {
    readonly authorization: AuthorizedNonpersistentMaterialRemoval;
    readonly plan: CapabilityRuntimeNonpersistentMaterialRemovalPlan;
  }): Promise<CapabilityRuntimeNonpersistentMaterialRemovalOutcome> {
    const intent = consumeAuthorizedNonpersistentMaterialRemoval(input.authorization);
    if (!intent) {
      throw new Error(
        "Non-persistent material removal authorization is absent or consumed.",
      );
    }
    if (input.plan.backend !== "microsandbox-cache") {
      return await this.#outcome(
        intent,
        "failed",
        null,
        "Microsandbox cache removal received a non-microsandbox-cache plan.",
      );
    }
    const before = await this.#observe(input.plan.material);
    if (before.safety !== "exact") {
      return await this.#outcome(
        intent,
        before.safety === "unknown" ? "uncertain" : "failed",
        null,
        before.safety === "unknown"
          ? "Microsandbox cache image ownership cannot be observed exactly."
          : "Microsandbox cache image is foreign or does not match its sealed contract.",
      );
    }
    if (before.state === "absent") {
      return await this.#outcome(intent, "succeeded", "absent", null);
    }
    const sdk = await this.#requireSdk();
    if (!sdk) {
      return await this.#outcome(
        intent,
        "uncertain",
        null,
        "Microsandbox local backend is unavailable.",
      );
    }
    try {
      await sdk.removeExactCachedImage(input.plan.material.imageReference);
    } catch (error) {
      const afterFailure = await this.#observe(input.plan.material);
      if (afterFailure.safety !== "exact") {
        return await this.#outcome(
          intent,
          "uncertain",
          null,
          compact(error),
        );
      }
      if (afterFailure.state === "absent") {
        return await this.#outcome(intent, "succeeded", "absent", null);
      }
      return await this.#outcome(
        intent,
        "failed",
        afterFailure.state,
        compact(error) ||
          "Microsandbox refused exact cached-image removal while the image remains.",
      );
    }
    const after = await this.#observe(input.plan.material);
    if (after.safety !== "exact") {
      return await this.#outcome(
        intent,
        after.safety === "unknown" ? "uncertain" : "failed",
        null,
        after.safety === "unknown"
          ? "Microsandbox cache image post-state cannot be observed exactly."
          : "Microsandbox cache image became foreign after removal.",
      );
    }
    if (after.state === "absent") {
      return await this.#outcome(intent, "succeeded", "absent", null);
    }
    return await this.#outcome(
      intent,
      "failed",
      after.state,
      "Microsandbox cache image remained after a non-forced removal.",
    );
  }

  async #observe(
    material: CapabilityRuntimeNonpersistentMaterialRemovalPlan["material"],
  ): Promise<CapabilityRuntimeNonpersistentMaterialRemovalObservation> {
    const expected = this.#expectations.get(materialKey(material));
    if (
      !expected ||
      expected.reference !== material.imageReference ||
      expected.manifestDigest !== `sha256:${material.imageDigest}`
    ) {
      return observation(material, "owned", "unknown");
    }
    const sdk = await this.#requireSdk();
    if (!sdk) return observation(material, "owned", "unknown");
    let inspection;
    try {
      inspection = await sdk.inspectImage(material.imageReference);
    } catch (error) {
      if (sdk.isImageNotFound(error)) {
        return observation(material, "absent", "exact");
      }
      return observation(material, "owned", "unknown");
    }
    try {
      assertExactMicrosandboxImageInspection(inspection, expected);
      return observation(material, "owned", "exact");
    } catch {
      return observation(material, "owned", "foreign");
    }
  }

  async #requireSdk(): Promise<MicrosandboxSdk | undefined> {
    try {
      const sdk = await this.#sdk();
      sdk.assertLocalBackend();
      return sdk;
    } catch {
      return undefined;
    }
  }

  async #outcome(
    intent: {
      readonly id: string;
      readonly fingerprint:
        CapabilityRuntimeNonpersistentMaterialRemovalPlan["fingerprint"];
    },
    status: CapabilityRuntimeNonpersistentMaterialRemovalOutcome["status"],
    observedState:
      CapabilityRuntimeNonpersistentMaterialRemovalOutcome["observedState"],
    detail: string | null,
  ): Promise<CapabilityRuntimeNonpersistentMaterialRemovalOutcome> {
    return await createCapabilityRuntimeNonpersistentMaterialRemovalOutcome({
      intentId: intent.id,
      intentFingerprint: intent.fingerprint,
      recordedAt: this.#clock(),
      status,
      observedState,
      detail,
    });
  }
}

function observation(
  material: CapabilityRuntimeNonpersistentMaterialRemovalPlan["material"],
  state: CapabilityRuntimeNonpersistentMaterialRemovalObservation["state"],
  safety: CapabilityRuntimeNonpersistentMaterialRemovalObservation["safety"],
): CapabilityRuntimeNonpersistentMaterialRemovalObservation {
  return {
    schemaVersion: CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_OBSERVATION_SCHEMA,
    material: structuredClone(material),
    backend: "microsandbox-cache",
    state,
    safety,
  };
}

function materialKey(
  value: { readonly unitId: string; readonly materialId: string },
): string {
  return `${value.unitId}\u0000${value.materialId}`;
}

function compact(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error);
  if (!text) return null;
  return text.length > 512 ? `${text.slice(0, 509)}...` : text;
}
