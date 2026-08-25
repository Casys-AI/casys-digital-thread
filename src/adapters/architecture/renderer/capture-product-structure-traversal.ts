/**
 * Reopen the unique current architecture-capture/4.0 after the catalog
 * authority checks, then build a disposable Graphology traversal index.
 */

import { fingerprintsEqual } from "../../../domain/kernel/deterministic-json.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { PRODUCT_NAVIGATION_BOUNDS } from "../../../application/ports/in/product-navigation/product-navigation-read-model.ts";
import type {
  OpenedProductStructure,
  ProductStructureTraversal,
} from "../../../application/ports/out/product-navigation/product-structure-traversal.ts";
import {
  architectureCaptureNavigationIndex,
  openedFromIndex,
} from "./architecture-capture-navigation-index.ts";
import { architectureCaptureIsNavigable } from "./architecture-capture-structure.ts";
import {
  type GenericArchitectureCaptureReader,
  reopenVerifiedArchitectureCapture,
} from "./product-structure-catalog.ts";
import type { SysmlSourceAnalysisReader } from "./sysml-source-analysis-capture.ts";

export class CaptureProductStructureTraversal implements ProductStructureTraversal {
  readonly #captures: GenericArchitectureCaptureReader;
  readonly #sysmlSourceAnalysis: SysmlSourceAnalysisReader | undefined;
  readonly #indexes = new Map<string, OpenedProductStructure>();
  readonly #limit: number;

  constructor(
    captures: GenericArchitectureCaptureReader,
    sysmlSourceAnalysis?: SysmlSourceAnalysisReader,
    options?: { readonly indexCacheLimit?: number },
  ) {
    this.#captures = captures;
    this.#sysmlSourceAnalysis = sysmlSourceAnalysis;
    this.#limit = options?.indexCacheLimit ??
      PRODUCT_NAVIGATION_BOUNDS.maxIndexCacheEntries;
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
    if (!architectureCaptureIsNavigable(verified.capture)) return undefined;
    const key = verified.artifact.fingerprint.digest;
    const cached = this.#indexes.get(key);
    if (
      cached &&
      cached.architectureArtifactId === verified.artifact.id &&
      fingerprintsEqual(
        cached.architectureFingerprint,
        verified.artifact.fingerprint,
      )
    ) {
      this.#indexes.delete(key);
      this.#indexes.set(key, cached);
      return cached;
    }
    const index = architectureCaptureNavigationIndex(verified.capture);
    const opened = openedFromIndex(
      verified.artifact.id,
      verified.artifact.fingerprint,
      index,
    );
    this.#indexes.set(key, opened);
    while (this.#indexes.size > this.#limit) {
      const oldest = this.#indexes.keys().next().value;
      if (oldest === undefined) break;
      this.#indexes.delete(oldest);
    }
    return opened;
  }
}
