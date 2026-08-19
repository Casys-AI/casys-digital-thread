/** Reconstructs the one qualified Modelica bundle from code-owned sources. */

import type {
  ModelicaQualifiedKitBundleFactory,
  ModelicaQualifiedKitBundlePreparationRequest,
} from "../../../application/ports/out/modelica/qualified-kit-bundle-factory.ts";
import type {
  PreparedModelicaIsolatedInputBundle,
} from "../../../domain/modelica/qualified-kit/isolated-execution.ts";
import {
  MODELICA_QUALIFIED_EXECUTION_PROFILE_FINGERPRINT,
  MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT,
  validateModelicaQualifiedKitRunExecutionProfileFacts,
} from "../../../domain/modelica/qualified-kit/run-proposal.ts";
import { fingerprintsEqual } from "../../../domain/kernel/deterministic-json.ts";
import { createModelicaMicrosandboxQualificationKit } from "./kit-v1/qualification-kit.ts";

export class CodeOwnedModelicaQualifiedKitBundleFactory
  implements ModelicaQualifiedKitBundleFactory {
  async prepare(
    request: ModelicaQualifiedKitBundlePreparationRequest,
  ): Promise<PreparedModelicaIsolatedInputBundle> {
    const profile = validateModelicaQualifiedKitRunExecutionProfileFacts(
      request.profile,
    );
    if (
      !fingerprintsEqual(
        profile.profileFingerprint,
        MODELICA_QUALIFIED_EXECUTION_PROFILE_FINGERPRINT,
      ) ||
      !fingerprintsEqual(
        request.runtimeQualification.executionProfileFingerprint,
        profile.profileFingerprint,
      ) ||
      !fingerprintsEqual(
        request.runtimeQualification.fingerprint,
        MODELICA_QUALIFIED_RUNTIME_QUALIFICATION_FINGERPRINT,
      )
    ) {
      throw new TypeError(
        "The Modelica kit can only be prepared for the pinned qualified runtime.",
      );
    }
    const kit = await createModelicaMicrosandboxQualificationKit(
      profile.method.engine,
    );
    return Object.freeze({
      ...kit.bundle,
      bytes: Uint8Array.from(kit.bundle.bytes),
    });
  }
}
