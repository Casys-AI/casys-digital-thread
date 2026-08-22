/**
 * Unique sealed electrical method sheet plus the exact L3 SPICE branch named
 * by that sheet. Multiple successful L3 runs may exist; the sheet, not latest
 * or caller parameters, selects the branch.
 */

import { fingerprintsEqual } from "../../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../kernel/primitives.ts";
import type { ElectricalObservationMethodSheet } from "../../observation-method-sheet.ts";
import { SIMULATE_RUN_ADMITTED_SPICE_OPERATION } from "../admitted/run-proposal.ts";
import { VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION } from "../../observation-method-sheet-proposal.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadObservation,
  type ThreadSnapshot,
} from "../../../thread/thread-snapshot.ts";

const ADMITTED_RUN_TOOL =
  `${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id}@${SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version}` as const;
const METHOD_SHEET_SEAL_TOOL =
  `${VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.id}@${VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.version}` as const;

export const SPICE_CAPTURE_ARTIFACT_ID_PREFIX = "spice-admitted-capture-" as const;
export const SPICE_EVIDENCE_ARTIFACT_ID_PREFIX = "spice-admitted-evidence-" as const;
export const SPICE_RESULT_ARTIFACT_ID_PREFIX = "spice-admitted-result-" as const;
export const METHOD_SHEET_ARTIFACT_ID_PREFIX =
  "electrical-observation-method-sheet-seal-" as const;

export interface AdmittedSpiceEvaluationLineage {
  readonly methodSheet: ThreadArtifact;
  readonly spiceCapture: ThreadArtifact;
  readonly evidence: ThreadArtifact;
  readonly result: ThreadArtifact;
  readonly observations: readonly ThreadObservation[];
}

export function namedFreshAdmittedSpiceCapture(
  snapshot: ThreadSnapshot,
  sheet: ElectricalObservationMethodSheet,
): ThreadArtifact {
  return namedFreshSpiceArtifact(
    snapshot,
    sheet,
    "document",
    SPICE_CAPTURE_ARTIFACT_ID_PREFIX,
    sheet.spice.capture,
    "admitted SPICE capture",
  );
}

export function namedFreshAdmittedSpiceEvidence(
  snapshot: ThreadSnapshot,
  sheet: ElectricalObservationMethodSheet,
): ThreadArtifact {
  return namedFreshSpiceArtifact(
    snapshot,
    sheet,
    "evidence",
    SPICE_EVIDENCE_ARTIFACT_ID_PREFIX,
    sheet.spice.evidence,
    "admitted SPICE evidence",
  );
}

export function namedFreshAdmittedSpiceResult(
  snapshot: ThreadSnapshot,
  sheet: ElectricalObservationMethodSheet,
): ThreadArtifact {
  return namedFreshSpiceArtifact(
    snapshot,
    sheet,
    "solver-result",
    SPICE_RESULT_ARTIFACT_ID_PREFIX,
    sheet.spice.result,
    "admitted SPICE result",
  );
}

export function uniqueFreshElectricalMethodSheetSeal(
  snapshot: ThreadSnapshot,
): ThreadArtifact {
  return uniqueFresh(
    snapshot,
    "document",
    METHOD_SHEET_ARTIFACT_ID_PREFIX,
    METHOD_SHEET_SEAL_TOOL,
    "electrical observation method-sheet seal",
  );
}

export function resolveAdmittedSpiceEvaluationLineage(
  snapshot: ThreadSnapshot,
  sheet: ElectricalObservationMethodSheet,
  expected?: {
    readonly sheetFingerprint?: ContentFingerprint;
    readonly captureFingerprint?: ContentFingerprint;
    readonly evidenceFingerprint?: ContentFingerprint;
    readonly resultFingerprint?: ContentFingerprint;
  },
): AdmittedSpiceEvaluationLineage {
  const methodSheet = uniqueFreshElectricalMethodSheetSeal(snapshot);
  const spiceCapture = namedFreshAdmittedSpiceCapture(snapshot, sheet);
  const evidence = namedFreshAdmittedSpiceEvidence(snapshot, sheet);
  const result = namedFreshAdmittedSpiceResult(snapshot, sheet);
  if (
    spiceCapture.producer.runId !== sheet.spice.producer.runId ||
    evidence.producer.runId !== sheet.spice.producer.runId ||
    result.producer.runId !== sheet.spice.producer.runId
  ) {
    throw new TypeError(
      "The admitted SPICE capture, evidence and result do not share the method-sheet producer run.",
    );
  }
  if (
    expected?.sheetFingerprint &&
    !fingerprintsEqual(methodSheet.fingerprint, expected.sheetFingerprint)
  ) {
    throw new TypeError(
      "The sealed electrical observation method sheet is not the signed fingerprint.",
    );
  }
  if (
    expected?.captureFingerprint &&
    !fingerprintsEqual(spiceCapture.fingerprint, expected.captureFingerprint)
  ) {
    throw new TypeError("The admitted SPICE capture is not the signed fingerprint.");
  }
  if (
    expected?.evidenceFingerprint &&
    !fingerprintsEqual(evidence.fingerprint, expected.evidenceFingerprint)
  ) {
    throw new TypeError("The admitted SPICE evidence is not the signed fingerprint.");
  }
  if (
    expected?.resultFingerprint &&
    !fingerprintsEqual(result.fingerprint, expected.resultFingerprint)
  ) {
    throw new TypeError("The admitted SPICE result is not the signed fingerprint.");
  }
  const observations = snapshot.observations.filter((observation) =>
    observation.source.operation.tool === ADMITTED_RUN_TOOL &&
    observation.source.operation.runId === evidence.producer.runId &&
    observation.freshness.status === "fresh"
  );
  return {
    methodSheet,
    spiceCapture,
    evidence,
    result,
    observations,
  };
}

function uniqueFresh(
  snapshot: ThreadSnapshot,
  kind: ThreadArtifact["kind"],
  prefix: string,
  tool: string,
  label: string,
): ThreadArtifact {
  const archived = archivedRefKeys(snapshot);
  const matches = snapshot.artifacts.filter((artifact) =>
    shapedFreshArtifact(artifact, kind, prefix, tool) &&
    !archived.has(`artifact:${artifact.id}`)
  );
  if (matches.length === 0) {
    throw new TypeError(
      `The current Thread tip has no fresh digital-thread ${label}.`,
    );
  }
  if (matches.length !== 1) {
    throw new TypeError(
      `The current Thread tip has ${matches.length} fresh ${label} artifacts; the server will not choose one.`,
    );
  }
  return matches[0]!;
}

function namedFreshSpiceArtifact(
  snapshot: ThreadSnapshot,
  sheet: ElectricalObservationMethodSheet,
  kind: ThreadArtifact["kind"],
  prefix: string,
  declared: ElectricalObservationMethodSheet["spice"]["capture"],
  label: string,
): ThreadArtifact {
  const archived = archivedRefKeys(snapshot);
  const matches = snapshot.artifacts.filter((artifact) =>
    shapedFreshArtifact(artifact, kind, prefix, ADMITTED_RUN_TOOL) &&
    artifact.id === declared.id &&
    fingerprintsEqual(artifact.fingerprint, declared.fingerprint) &&
    artifact.producer.runId === sheet.spice.producer.runId &&
    !archived.has(`artifact:${artifact.id}`)
  );
  if (matches.length === 0) {
    throw new TypeError(
      `The method sheet names no fresh digital-thread ${label} on the current Thread tip.`,
    );
  }
  if (matches.length !== 1) {
    throw new TypeError(
      `The method sheet names ${matches.length} fresh ${label} artifacts; the server will not choose one.`,
    );
  }
  return matches[0]!;
}

function shapedFreshArtifact(
  artifact: ThreadArtifact,
  kind: ThreadArtifact["kind"],
  prefix: string,
  tool: string,
): boolean {
  return artifact.kind === kind &&
    artifact.freshness.status === "fresh" &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === tool &&
    artifact.fingerprint.algorithm === "sha256" &&
    artifact.id === `${prefix}${artifact.fingerprint.digest}` &&
    artifact.version === artifact.fingerprint.digest;
}
