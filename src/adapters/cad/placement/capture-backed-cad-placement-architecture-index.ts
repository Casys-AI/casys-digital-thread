/**
 * Reopen one exact architecture-capture/4.0 and project owner/usage/typed_by
 * identities through the disposable navigation index.
 */

import type {
  CadPlacementArchitectureIndex,
  CadPlacementArchitectureOpen,
} from "../../../application/ports/out/cad/placement/cad-placement-architecture-index.ts";
import type { CadPlacementArchitectureFacts } from "../../../domain/cad/placement/cad-placement-coverage.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { architectureCaptureNavigationIndex } from "../../architecture/renderer/architecture-capture-navigation-index.ts";
import { parseExactArchitectureCapture } from "../../architecture/renderer/architecture-capture.ts";

export interface CadPlacementArchitectureCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export class CaptureBackedCadPlacementArchitectureIndex
  implements CadPlacementArchitectureIndex {
  readonly #captures: CadPlacementArchitectureCaptureReader;

  constructor(captures: CadPlacementArchitectureCaptureReader) {
    this.#captures = captures;
  }

  async open(
    query: CadPlacementArchitectureOpen,
  ): Promise<CadPlacementArchitectureFacts | undefined> {
    if (
      query.artifactId.length === 0 ||
      query.artifactId.toLowerCase() === "latest" ||
      query.artifactId !== `architecture-${query.fingerprint.digest}`
    ) {
      return undefined;
    }
    const text = await this.#captures.read(query.fingerprint);
    if (text === undefined) return undefined;
    let capture;
    try {
      capture = parseExactArchitectureCapture(JSON.parse(text));
    } catch {
      return undefined;
    }
    const index = architectureCaptureNavigationIndex(capture);
    if (index.root() === undefined) return undefined;
    return {
      ownerDefinitionId: (usageId) => index.ownerDefinitionId(usageId),
      immediateUsageIds: (definitionId) => index.immediateUsageIds(definitionId),
      typedDefinitionId: (usageId) => index.typedDefinition(usageId)?.element.elementId,
    };
  }
}
