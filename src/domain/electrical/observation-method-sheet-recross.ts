/**
 * Identity recross for a reviewed `electrical-observation-method-sheet/1.0`.
 *
 * The sheet names brief gate items and native ngspice observation names. This
 * module checks those identities against reopened facts. It never infers an
 * alias, never calls SysON, and never runs ngspice.
 */

import { fingerprintsEqual } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import type { ElectricalObservationMethodSheet } from "./observation-method-sheet.ts";
import { methodSheetNativeObservationNames } from "./observation-method-sheet.ts";
import { parseNativeName } from "./spice/admitted/isolated-output.ts";
import { resolveNamedAdmittedSpiceL3Lineage } from "./spice/evaluation/lineage.ts";
import type { ThreadSnapshot } from "../thread/thread-snapshot.ts";

export type ElectricalObservationMethodSheetRecrossErrorCode =
  | "identity_mismatch"
  | "brief_unavailable"
  | "brief_unresolved"
  | "native_unresolved"
  | "spice_unresolved";

export class ElectricalObservationMethodSheetRecrossError extends Error {
  constructor(
    readonly code: ElectricalObservationMethodSheetRecrossErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ElectricalObservationMethodSheetRecrossError";
  }
}

export interface ElectricalObservationMethodSheetBriefGate {
  readonly id: string;
  readonly kind: "success-criterion" | "verification-activity";
}

export interface ElectricalObservationMethodSheetRecross {
  readonly briefGates: "matched";
  readonly briefItemIds: readonly string[];
  readonly nativeObservationNames: readonly string[];
}

export function recrossElectricalObservationMethodSheet(
  sheet: ElectricalObservationMethodSheet,
  briefGates: readonly ElectricalObservationMethodSheetBriefGate[] | undefined,
  expectedBasis?: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
    readonly subjectId: string;
    readonly projectId: string;
  },
  snapshot?: ThreadSnapshot,
): ElectricalObservationMethodSheetRecross {
  if (sheet.project.subjectId !== sheet.subject.id) {
    throw recrossError(
      "identity_mismatch",
      "The electrical observation method sheet project subject is unresolved against its subject identity.",
    );
  }
  if (expectedBasis) {
    if (
      sheet.project.id !== expectedBasis.projectId ||
      sheet.subject.id !== expectedBasis.subjectId ||
      sheet.basis.snapshotId !== expectedBasis.snapshotId ||
      sheet.basis.revision !== expectedBasis.revision ||
      !fingerprintsEqual(sheet.basis.fingerprint, expectedBasis.fingerprint)
    ) {
      throw recrossError(
        "identity_mismatch",
        "The electrical observation method sheet is not the exact project Thread basis.",
      );
    }
  }
  if (briefGates === undefined) {
    throw recrossError(
      "brief_unavailable",
      "The exact approved brief gates are unavailable.",
    );
  }
  const briefItemIds: string[] = [];
  for (const criterion of sheet.criteria) {
    const matches = briefGates.filter((gate) => gate.id === criterion.briefItem.id);
    if (matches.length !== 1) {
      throw recrossError(
        "brief_unresolved",
        `Brief gate "${criterion.briefItem.id}" is unresolved on the exact approved brief.`,
      );
    }
    if (matches[0]!.kind !== criterion.briefItem.kind) {
      throw recrossError(
        "brief_unresolved",
        `Brief gate "${criterion.briefItem.id}" kind is unresolved: expected ${criterion.briefItem.kind}, observed ${
          matches[0]!.kind
        }.`,
      );
    }
    briefItemIds.push(criterion.briefItem.id);
  }
  const nativeObservationNames = methodSheetNativeObservationNames(sheet);
  for (const name of nativeObservationNames) {
    try {
      parseNativeName(name, "$sheet.native");
    } catch {
      throw recrossError(
        "native_unresolved",
        `Native observation "${name}" is not an admitted ngspice name.`,
      );
    }
  }
  if (snapshot) {
    try {
      const lineage = resolveNamedAdmittedSpiceL3Lineage(snapshot, sheet);
      const observedNames = new Set(
        lineage.observations.map((observation) => observation.metric),
      );
      for (const name of nativeObservationNames) {
        if (!observedNames.has(name)) {
          throw new TypeError(
            `Native observation "${name}" is absent from the exact admitted SPICE L3 branch.`,
          );
        }
      }
    } catch (error) {
      throw recrossError(
        "spice_unresolved",
        error instanceof Error
          ? error.message
          : "The named admitted SPICE L3 branch is unresolved on the exact Thread tip.",
      );
    }
  }
  return {
    briefGates: "matched",
    briefItemIds: [...new Set(briefItemIds)],
    nativeObservationNames,
  };
}

function recrossError(
  code: ElectricalObservationMethodSheetRecrossErrorCode,
  message: string,
): ElectricalObservationMethodSheetRecrossError {
  return new ElectricalObservationMethodSheetRecrossError(code, message);
}
