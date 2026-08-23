/**
 * Provider-free draft-CAS capture of one closed impact-manifest body.
 *
 * The use case parses exact JSON object keys, constructs the canonical
 * document so the server computes fingerprints, persists draft CAS, and
 * rereads the stored document. It writes no EngineeringProject or Thread
 * state and grants no seal, MRTR, evaluation, or provider authority.
 */

import {
  assembleCrossDomainImpactManifestCaptureReview,
  type CrossDomainImpactManifestCaptureReview,
} from "../../../domain/impact/cross-domain-impact-manifest-capture-review.ts";
import {
  createCrossDomainImpactManifest,
  CROSS_DOMAIN_IMPACT_MANIFEST_BODY_KEYS,
} from "../../../domain/impact/cross-domain-impact-manifest.ts";
import { exactRecord } from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../domain/kernel/deterministic-json.ts";
import { JSON_SOURCE_ACCEPTED_MIME_TYPES } from "../../../domain/resource/agent-resource-reference.ts";
import { parseAgentResourceReference } from "../../../domain/resource/agent-resource-reference.ts";
import {
  CROSS_DOMAIN_IMPACT_MANIFEST_CAPTURE_SOURCE_MAX_CHARS,
  type ProjectCrossDomainImpactManifestCaptureCommand,
  type ProjectCrossDomainImpactManifestCaptureUseCase,
} from "../../ports/in/impact/project-cross-domain-impact-manifest-capture.ts";
import type { CrossDomainImpactManifestStore } from "../../ports/out/impact/cross-domain-impact-manifest-store.ts";
import {
  AgentResourceReopenError,
  type ReopenAgentResource,
} from "../resource/reopen-agent-resource.ts";

export type ProjectCrossDomainImpactManifestCaptureErrorCode =
  | "invalid_request"
  | "invalid_manifest"
  | "source_capture_failed";

export class ProjectCrossDomainImpactManifestCaptureError extends Error {
  constructor(
    readonly code: ProjectCrossDomainImpactManifestCaptureErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectCrossDomainImpactManifestCaptureError";
  }
}

export interface PrepareProjectCrossDomainImpactManifestCaptureDependencies {
  readonly manifests: CrossDomainImpactManifestStore;
  readonly resources: ReopenAgentResource;
}

export class PrepareProjectCrossDomainImpactManifestCapture
  implements ProjectCrossDomainImpactManifestCaptureUseCase {
  readonly #manifests: CrossDomainImpactManifestStore;
  readonly #resources: ReopenAgentResource;

  constructor(
    dependencies: PrepareProjectCrossDomainImpactManifestCaptureDependencies,
  ) {
    this.#manifests = dependencies.manifests;
    this.#resources = dependencies.resources;
  }

  async capture(
    value: ProjectCrossDomainImpactManifestCaptureCommand,
  ): Promise<CrossDomainImpactManifestCaptureReview> {
    let command: ProjectCrossDomainImpactManifestCaptureCommand;
    try {
      command = parseCommand(value);
    } catch (cause) {
      throw new ProjectCrossDomainImpactManifestCaptureError(
        "invalid_request",
        "The cross-domain impact-manifest capture request failed exact validation.",
        cause,
      );
    }

    let sourceText: string;
    try {
      sourceText = (await this.#resources.reopenUtf8Text(command.resourceRef, {
        acceptedMimeTypes: JSON_SOURCE_ACCEPTED_MIME_TYPES,
        maxBytes: CROSS_DOMAIN_IMPACT_MANIFEST_CAPTURE_SOURCE_MAX_CHARS,
      })).text;
    } catch (cause) {
      if (cause instanceof AgentResourceReopenError) throw cause;
      throw new ProjectCrossDomainImpactManifestCaptureError(
        "invalid_request",
        "The cross-domain impact-manifest resource could not be reopened.",
        cause,
      );
    }

    let manifest;
    try {
      manifest = await createCrossDomainImpactManifest(
        parseManifestBody(sourceText),
      );
    } catch (cause) {
      if (cause instanceof ProjectCrossDomainImpactManifestCaptureError) {
        throw cause;
      }
      throw new ProjectCrossDomainImpactManifestCaptureError(
        "invalid_manifest",
        "The cross-domain impact-manifest source is not a closed exact body.",
        cause,
      );
    }

    try {
      const saved = await this.#manifests.save(manifest);
      const reopened = await this.#manifests.read(saved.reference);
      if (!reopened) {
        throw new Error("Cross-domain impact manifest was missing after capture save.");
      }
      if (
        !fingerprintsEqual(
          reopened.reference.fingerprint,
          saved.reference.fingerprint,
        ) ||
        deterministicJson(reopened.manifest) !== deterministicJson(manifest)
      ) {
        throw new Error(
          "Reopened cross-domain impact manifest does not match the captured document.",
        );
      }
      return assembleCrossDomainImpactManifestCaptureReview({
        reference: saved.reference,
        manifest: reopened.manifest,
      });
    } catch (cause) {
      if (cause instanceof ProjectCrossDomainImpactManifestCaptureError) {
        throw cause;
      }
      throw new ProjectCrossDomainImpactManifestCaptureError(
        "source_capture_failed",
        "The cross-domain impact manifest could not be captured and reread.",
        cause,
      );
    }
  }
}

function parseCommand(
  value: unknown,
): ProjectCrossDomainImpactManifestCaptureCommand {
  const input = exactRecord(
    value,
    ["resourceRef"],
    "$impactManifestCapture",
  );
  return {
    resourceRef: parseAgentResourceReference(
      input.resourceRef,
      "$impactManifestCapture.resourceRef",
    ),
  };
}

function parseManifestBody(sourceText: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceText);
  } catch (cause) {
    throw new ProjectCrossDomainImpactManifestCaptureError(
      "invalid_manifest",
      "The cross-domain impact-manifest source is not exact JSON.",
      cause,
    );
  }
  return exactRecord(
    parsed,
    CROSS_DOMAIN_IMPACT_MANIFEST_BODY_KEYS,
    "$manifest",
  );
}
