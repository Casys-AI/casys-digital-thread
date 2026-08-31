/**
 * Server-owned conversion of an exact sealed mechanism case into the one
 * runtime request understood by the selected binding. The application knows
 * neither the provider name nor its request field names.
 */

import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { PrescribedKinematicsCaseSource } from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";

export interface PrescribedKinematicsLoweredCase {
  /** Exact canonical resource bytes from which this request was derived. */
  readonly sourceFingerprint: ContentFingerprint;
  /** Exact identity of the fixed server-owned lowering contract. */
  readonly loweringFingerprint: ContentFingerprint;
  /** SHA-256 of the ephemeral exact request bytes. */
  readonly requestFingerprint: ContentFingerprint;
  /**
   * Canonical bytes for immediate submission only. They are not an
   * agent-facing command field and are not persisted into Thread evidence.
   */
  readonly exactRequestText: string;
}

export interface PrescribedKinematicsCaseLowerer {
  lower(input: {
    readonly source: PrescribedKinematicsCaseSource;
    readonly sourceFingerprint: ContentFingerprint;
  }): Promise<PrescribedKinematicsLoweredCase>;
}
