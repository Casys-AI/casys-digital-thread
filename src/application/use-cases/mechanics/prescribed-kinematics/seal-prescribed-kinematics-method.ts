/** Exact resource/MRTR-bound provider-free method seal. */

import type {
  SealPrescribedKinematicsMethodCommand,
  SealPrescribedKinematicsMethodUseCase,
} from "../../../ports/in/mechanics/prescribed-kinematics/seal-prescribed-kinematics-method.ts";
import { fingerprintsEqual } from "../../../../domain/kernel/deterministic-json.ts";
import {
  canonicalizePrescribedKinematicsMethodSheetSource,
  sealPrescribedKinematicsMethodSheet,
} from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-method-sheet.ts";
import { JSON_SOURCE_ACCEPTED_MIME_TYPES } from "../../../../domain/resource/agent-resource-reference.ts";
import type { ReopenAgentResource } from "../../../use-cases/resource/reopen-agent-resource.ts";

export class SealPrescribedKinematicsMethod
  implements SealPrescribedKinematicsMethodUseCase {
  readonly #resources: ReopenAgentResource;
  constructor(resources: ReopenAgentResource) {
    this.#resources = resources;
  }

  async execute(command: SealPrescribedKinematicsMethodCommand) {
    if (
      !fingerprintsEqual(
        command.resourceRef.fingerprint,
        command.signedResourceFingerprint,
      )
    ) {
      throw new TypeError(
        "The prescribed-kinematics method resource bytes do not match the signed MRTR identity.",
      );
    }
    const reopened = await this.#resources.reopenUtf8Text(command.resourceRef, {
      acceptedMimeTypes: JSON_SOURCE_ACCEPTED_MIME_TYPES,
      maxBytes: 262_144,
    });
    let canonical;
    try {
      canonical = canonicalizePrescribedKinematicsMethodSheetSource(
        JSON.parse(reopened.text),
      );
    } catch {
      throw new TypeError(
        "The exact signed prescribed-kinematics method resource is not a valid method-sheet source.",
      );
    }
    if (canonical.text !== reopened.text) {
      throw new TypeError(
        "The signed prescribed-kinematics method bytes are not canonical source bytes.",
      );
    }
    return await sealPrescribedKinematicsMethodSheet({
      source: canonical.source,
      sealedCase: command.sealedCase,
      observation: command.observation,
    });
  }
}
