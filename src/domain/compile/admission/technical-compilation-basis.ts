/**
 * Shared immutable Thread/SysML facts for technical-source capture and
 * technical compilation. This contract is deliberately independent from the
 * compiler and capture-locator implementations so each can validate the same
 * exact basis without coupling their module boundaries.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";

export interface TechnicalThreadBasis {
  readonly projectId: string;
  readonly subjectId: string;
  readonly snapshotId: string;
  readonly revision: number;
  /** Fingerprint attested by the authoritative Thread snapshot reader. */
  readonly snapshotFingerprint: ContentFingerprint;
}

export interface TechnicalSysmlElementRef {
  readonly id: string;
  /** Exact native SysML metaclass/kind observed in the capture. */
  readonly kind: string;
  /** Exact immutable capture whose provider readback attests this element. */
  readonly provenance: TechnicalSysmlElementProvenance;
  /**
   * Capture-attested label used only for unique compile joins.
   * Absent on historical documents; never invented by the compiler.
   */
  readonly name?: string;
  /**
   * Exact captured PartDefinition owner of an AttributeUsage. Historical
   * documents omit this field; it is never reconstructed from labels.
   */
  readonly parentElementId?: string;
}

export interface TechnicalSysmlElementProvenance {
  readonly artifactId: string;
  readonly artifactFingerprint: ContentFingerprint;
  readonly captureId: string;
}

export interface TechnicalSysmlAnchor {
  readonly artifactId: string;
  /** Exact fingerprint of the authoritative Thread artifact/capture bytes. */
  readonly artifactFingerprint: ContentFingerprint;
  readonly captureId: string;
  readonly editingContextId: string;
  /** Human-reviewable semantic root of this exact captured scope. */
  readonly rootElementId: string;
  readonly rootElementKind: "Package";
  readonly elements: readonly TechnicalSysmlElementRef[];
}

export interface TechnicalCompilationBasis {
  readonly thread: TechnicalThreadBasis;
  readonly sysmlAnchor: TechnicalSysmlAnchor;
  readonly sysmlAnchorFingerprint: ContentFingerprint;
}
