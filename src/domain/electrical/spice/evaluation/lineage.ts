/**
 * Unique sealed electrical method sheet plus the exact L3 SPICE branch named
 * by that sheet. Multiple successful L3 runs may exist; the sheet, not latest
 * or caller parameters, selects the branch.
 */

import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../kernel/deterministic-json.ts";
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

/**
 * Exact fresh L3 branch exposed while an agent authors the later method sheet.
 *
 * Selection is deliberately by the registered producer and canonical artifact
 * topology, never by labels, timestamps or array order. The method sheet can
 * then name this branch without learning anything about the runtime binding.
 */
export interface FreshAdmittedSpiceL3Lineage {
  readonly spiceCapture: ThreadArtifact;
  readonly evidence: ThreadArtifact;
  readonly result: ThreadArtifact;
  readonly observations: readonly ThreadObservation[];
}

export function uniqueFreshAdmittedSpiceL3Lineage(
  snapshot: ThreadSnapshot,
): FreshAdmittedSpiceL3Lineage {
  const archived = archivedRefKeys(snapshot);
  const captures = freshL3Artifacts(
    snapshot,
    archived,
    "document",
    SPICE_CAPTURE_ARTIFACT_ID_PREFIX,
  );
  const evidence = freshL3Artifacts(
    snapshot,
    archived,
    "evidence",
    SPICE_EVIDENCE_ARTIFACT_ID_PREFIX,
  );
  const results = freshL3Artifacts(
    snapshot,
    archived,
    "solver-result",
    SPICE_RESULT_ARTIFACT_ID_PREFIX,
  );
  const runIds = new Set(
    [...captures, ...evidence, ...results].map((artifact) => artifact.producer.runId),
  );
  if (runIds.size === 0) {
    throw new TypeError(
      "The current Thread tip has no fresh admitted SPICE L3 branch.",
    );
  }
  if (runIds.size !== 1) {
    throw new TypeError(
      `The current Thread tip has ${runIds.size} fresh admitted SPICE L3 producer branches; the server will not choose one.`,
    );
  }
  const runId = [...runIds][0]!;
  if (captures.length !== 1 || evidence.length !== 1 || results.length !== 1) {
    throw new TypeError(
      "The unique fresh admitted SPICE L3 producer must expose exactly one capture, evidence and result artifact.",
    );
  }
  const spiceCapture = captures[0]!;
  const evidenceArtifact = evidence[0]!;
  const result = results[0]!;
  if (
    spiceCapture.producer.runId !== runId ||
    evidenceArtifact.producer.runId !== runId || result.producer.runId !== runId
  ) {
    throw new TypeError(
      "The admitted SPICE L3 artifacts do not share one exact producer run.",
    );
  }
  const observations = exactFreshAdmittedSpiceObservations(
    snapshot,
    runId,
    evidenceArtifact.id,
    result.id,
  );
  return {
    spiceCapture,
    evidence: evidenceArtifact,
    result,
    observations,
  };
}

/**
 * Reopen the exact fresh L3 branch named by an unsealed method sheet.
 *
 * This deliberately does not require an electrical method-sheet seal artifact:
 * it is the pre-seal recross used to decide whether that seal may be proposed.
 */
export function resolveNamedAdmittedSpiceL3Lineage(
  snapshot: ThreadSnapshot,
  sheet: ElectricalObservationMethodSheet,
  expected?: {
    readonly captureFingerprint?: ContentFingerprint;
    readonly evidenceFingerprint?: ContentFingerprint;
    readonly resultFingerprint?: ContentFingerprint;
  },
): FreshAdmittedSpiceL3Lineage {
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
  return {
    spiceCapture,
    evidence,
    result,
    observations: exactFreshAdmittedSpiceObservations(
      snapshot,
      sheet.spice.producer.runId,
      evidence.id,
      result.id,
    ),
  };
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
  const l3 = resolveNamedAdmittedSpiceL3Lineage(snapshot, sheet, expected);
  if (
    expected?.sheetFingerprint &&
    !fingerprintsEqual(methodSheet.fingerprint, expected.sheetFingerprint)
  ) {
    throw new TypeError(
      "The sealed electrical observation method sheet is not the signed fingerprint.",
    );
  }
  return {
    methodSheet,
    ...l3,
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

function freshL3Artifacts(
  snapshot: ThreadSnapshot,
  archived: ReadonlySet<string>,
  kind: ThreadArtifact["kind"],
  prefix: string,
): ThreadArtifact[] {
  return snapshot.artifacts.filter((artifact) =>
    shapedFreshArtifact(artifact, kind, prefix, ADMITTED_RUN_TOOL) &&
    !archived.has(`artifact:${artifact.id}`)
  );
}

function exactFreshAdmittedSpiceObservations(
  snapshot: ThreadSnapshot,
  runId: string,
  evidenceArtifactId: string,
  resultArtifactId: string,
): ThreadObservation[] {
  const observations = snapshot.observations.filter((observation) =>
    observation.source.operation.serverId === "digital-thread" &&
    observation.source.operation.tool === ADMITTED_RUN_TOOL &&
    observation.source.operation.runId === runId &&
    observation.freshness.status === "fresh"
  );
  if (observations.length === 0) {
    throw new TypeError(
      "The admitted SPICE L3 branch has no factual observations.",
    );
  }
  const expectedArtifactIds = [evidenceArtifactId, resultArtifactId];
  if (
    observations.some((observation) =>
      deterministicJson(observation.source.artifactIds) !==
        deterministicJson(expectedArtifactIds)
    ) || new Set(observations.map((observation) => observation.metric)).size !==
      observations.length
  ) {
    throw new TypeError(
      "The admitted SPICE L3 observations do not recross the exact evidence/result topology or have duplicate native names.",
    );
  }
  return observations;
}
