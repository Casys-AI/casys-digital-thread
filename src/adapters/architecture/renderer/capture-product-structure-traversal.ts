/**
 * Reopen the unique current architecture-capture/4.0 after the catalog
 * authority checks, then build a disposable Graphology traversal index.
 */

import { fingerprintsEqual } from "../../../domain/kernel/deterministic-json.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { architectureCaptureNavigationIndex } from "./architecture-capture-navigation-index.ts";
import {
  type GenericArchitectureCaptureReader,
  reopenVerifiedArchitectureCapture,
} from "./product-structure-catalog.ts";
import type { SysmlSourceAnalysisReader } from "./sysml-source-analysis-capture.ts";
import type {
  OpenedProductStructure,
  ProductStructureTraversal,
} from "../../../application/ports/out/product-navigation/product-structure-traversal.ts";

export class CaptureProductStructureTraversal implements ProductStructureTraversal {
  readonly #captures: GenericArchitectureCaptureReader;
  readonly #sysmlSourceAnalysis: SysmlSourceAnalysisReader | undefined;
  readonly #indexes = new Map<string, OpenedProductStructure>();

  constructor(
    captures: GenericArchitectureCaptureReader,
    sysmlSourceAnalysis?: SysmlSourceAnalysisReader,
  ) {
    this.#captures = captures;
    this.#sysmlSourceAnalysis = sysmlSourceAnalysis;
  }

  async open(
    snapshot: ThreadSnapshot,
  ): Promise<OpenedProductStructure | undefined> {
    const verified = await reopenVerifiedArchitectureCapture(
      snapshot,
      this.#captures,
      this.#sysmlSourceAnalysis,
    );
    if (verified.kind !== "one") return undefined;
    const cached = this.#indexes.get(verified.artifact.fingerprint.digest);
    if (
      cached &&
      cached.architectureArtifactId === verified.artifact.id &&
      fingerprintsEqual(
        cached.architectureFingerprint,
        verified.artifact.fingerprint,
      )
    ) {
      return cached;
    }
    const index = architectureCaptureNavigationIndex(verified.capture);
    const opened: OpenedProductStructure = {
      architectureArtifactId: verified.artifact.id,
      architectureFingerprint: verified.artifact.fingerprint,
      root: () => index.root(),
      childrenOf: (node) => index.childrenOf(node),
      path: (usageIds) => index.path(usageIds),
      locate: (id) => index.locate(id),
      neighborhood: (node) => index.neighborhood(node),
      hasDefinition: (id) => index.definition(id) !== undefined,
    };
    this.#indexes.set(verified.artifact.fingerprint.digest, opened);
    return opened;
  }
}
