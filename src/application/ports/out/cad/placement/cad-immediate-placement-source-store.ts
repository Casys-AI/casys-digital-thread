/**
 * Durable codec for one canonical cad-immediate-placement-source/1.0 document.
 */

import type {
  CadImmediatePlacementSource,
} from "../../../../../domain/cad/placement/cad-immediate-placement-source.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export type CadImmediatePlacementSourceStoreErrorCode =
  | "source_size_limit_exceeded"
  | "source_capture_readback_failed"
  | "source_capture_invalid"
  | "source_parse_failed"
  | "source_absent";

export class CadImmediatePlacementSourceStoreError extends Error {
  constructor(
    readonly code: CadImmediatePlacementSourceStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CadImmediatePlacementSourceStoreError";
  }
}

export interface ReopenedCadImmediatePlacementSource {
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
  readonly casUri: string;
  readonly sourceText: string;
  readonly source: CadImmediatePlacementSource;
}

export interface CadImmediatePlacementSourceStore {
  persist(sourceText: string): Promise<ReopenedCadImmediatePlacementSource>;
  reopen(fingerprint: ContentFingerprint): Promise<ReopenedCadImmediatePlacementSource>;
}
