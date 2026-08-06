import type {
  EvidenceArtifact,
  RunDetail,
  RunMeasurement,
} from "../domain/kernel/types.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadFreshness,
  ThreadOperationRef,
} from "../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotExtension } from "../domain/thread/thread-snapshot-extension.ts";

/**
 * Strict, transport-independent subset of a persisted mcp-modelica run.
 *
 * This deliberately has no requirement or verdict fields: a successful
 * OpenModelica run is physical evidence, not product compliance.
 */
export interface PersistedModelicaRunEvidence {
  runId: string;
  completedAt: string;
  fingerprint: ContentFingerprint;
  model: { id: string; version: string; fingerprint: ContentFingerprint };
  scenario: { id: string; fingerprint: ContentFingerprint };
  measurements: readonly {
    id: string;
    name: string;
    value: number;
    unit: string;
  }[];
  artifacts: readonly {
    kind: EvidenceArtifact["kind"];
    name: string;
    uri: string;
    fingerprint: ContentFingerprint;
    bytes: number;
  }[];
}

/** Stable provider identity for a Modelica branch; subject assignment is external. */
export interface ModelicaRunBinding {
  runId: string;
  fingerprint: ContentFingerprint;
  model: { id: string; version: string; fingerprint: ContentFingerprint };
  scenario: { id: string; fingerprint: ContentFingerprint };
}

/**
 * A generic extension plus the exact Modelica identity it carries.
 *
 * `subjectId` is supplied by the workspace assembler or an explicit base
 * snapshot. It is never guessed from `model.id`, `scenario.id`, or a label.
 */
export interface ObservedModelicaRunExtension extends ThreadSnapshotExtension {
  modelica: ModelicaRunBinding;
}

export interface ObservedModelicaRunExtensionOptions {
  /** Optional human-readable label for the persisted evidence source. */
  sourceLabel?: string;
}

/**
 * Parse an observed run returned by ModelicaRunObserver into canonical evidence.
 *
 * The parser only accepts the unmodified, not-evaluated simulation projection.
 * In particular it refuses a scenario-contract overlay, failed/running work, a
 * loose model hash, or an un-hashed artifact list.
 */
export function parsePersistedModelicaRunEvidence(
  detail: RunDetail,
): PersistedModelicaRunEvidence {
  if (detail.source !== "observed") {
    throw new Error("Modelica thread evidence must come from an observed run.");
  }
  if (detail.status !== "succeeded") {
    throw new Error("Only a succeeded persisted Modelica run can be attached.");
  }
  if (detail.verdictStatus !== "not_evaluated" || detail.requirements.length !== 0) {
    throw new Error(
      "Modelica thread evidence must not contain an attached requirement verdict.",
    );
  }
  if (!detail.modelicaEvidence) {
    throw new Error("Observed Modelica run is missing its model/scenario identity.");
  }
  const identity = detail.modelicaEvidence;
  if (detail.id !== `modelica:${identity.runId}`) {
    throw new Error("Modelica detail id does not match its persisted run id.");
  }
  const completedAt = isoDate(detail.completedAt, "completedAt");
  const fingerprint = sha(identity.fingerprint, "modelica fingerprint");
  const modelFingerprint = sha(identity.model.sha256, "model sha256");
  const scenarioFingerprint = sha(identity.scenario.sha256, "scenario sha256");
  const measurements = detail.measurements.map(parseMeasurement);
  unique(measurements.map((item) => item.id), "Modelica measurement ids");
  if (measurements.length === 0) {
    throw new Error("Persisted Modelica run has no measurements.");
  }
  const artifacts = detail.evidence.map(parseArtifact);
  unique(
    artifacts.map((item) => `${item.kind}:${item.fingerprint.digest}`),
    "Modelica artifacts",
  );
  const modelArtifact = artifacts.find((artifact) => artifact.kind === "model");
  if (!modelArtifact) {
    throw new Error("Persisted Modelica run is missing its model artifact.");
  }
  if (modelArtifact.fingerprint.digest !== modelFingerprint.digest) {
    throw new Error(
      "Persisted Modelica model artifact does not match the run model SHA-256.",
    );
  }
  if (!artifacts.some((artifact) => artifact.kind === "result")) {
    throw new Error("Persisted Modelica run is missing its result artifact.");
  }
  if (!artifacts.some((artifact) => artifact.kind === "evidence")) {
    throw new Error("Persisted Modelica run is missing its evidence artifact.");
  }

  return {
    runId: identity.runId,
    completedAt,
    fingerprint,
    model: {
      id: nonEmpty(identity.model.id, "model id"),
      version: nonEmpty(identity.model.version, "model version"),
      fingerprint: modelFingerprint,
    },
    scenario: {
      id: nonEmpty(identity.scenario.id, "scenario id"),
      fingerprint: scenarioFingerprint,
    },
    measurements,
    artifacts,
  };
}

/**
 * Build one independent thermal evidence branch for a ThreadSnapshot.
 *
 * The caller applies this branch through applyThreadSnapshotExtension, which
 * alone owns snapshot revisioning. This adapter does not assert a CAD-to-
 * thermal dependency. It only records what the persisted Modelica run itself
 * proves: its versioned model was consumed by modelica_simulate, and its
 * measured quantities came from the stored evidence artifact.
 */
export function createObservedModelicaRunExtension(
  subjectId: string,
  detail: RunDetail,
  options: ObservedModelicaRunExtensionOptions = {},
): ObservedModelicaRunExtension {
  if (!subjectId.trim()) {
    throw new Error("ThreadSnapshot subject id must be non-empty.");
  }
  const run = parsePersistedModelicaRunEvidence(detail);
  const prefix = `modelica-${slug(run.runId)}`;
  const modelArtifactId = `${prefix}-model-${
    run.model.fingerprint.digest.slice(0, 12)
  }`;
  const scenarioArtifactId = `${prefix}-scenario-${
    run.scenario.fingerprint.digest.slice(0, 12)
  }`;
  const evidenceArtifact = run.artifacts.find((artifact) =>
    artifact.kind === "evidence"
  )!;
  const evidenceArtifactId = artifactId(prefix, evidenceArtifact);
  const resultArtifact = run.artifacts.find((artifact) => artifact.kind === "result")!;
  const resultArtifactId = artifactId(prefix, resultArtifact);
  const operation: ThreadOperationRef = {
    serverId: "modelica",
    tool: "modelica_simulate",
    runId: run.runId,
  };
  const branchFreshness: ThreadFreshness = {
    status: "fresh",
    changedAt: run.completedAt,
    invalidatedByChangeIds: [],
  };
  const consumptionId = `consume-${modelArtifactId}-by-${slug(run.runId)}`;
  const scenarioConsumptionId = `consume-${scenarioArtifactId}-by-${slug(run.runId)}`;
  const artifacts = run.artifacts.map((artifact): ThreadArtifact => ({
    id: artifactId(prefix, artifact),
    name: artifact.name,
    kind: threadArtifactKind(artifact.kind),
    version: artifact.fingerprint.digest.slice(0, 12),
    fingerprint: artifact.fingerprint,
    uri: artifact.uri,
    mediaType: mediaType(artifact.kind),
    producer: operation,
    inputArtifactIds: artifact.kind === "result"
      ? [modelArtifactId, scenarioArtifactId]
      : [],
    freshness: branchFreshness,
  }));
  const observations = run.measurements.map((measurement) => ({
    id: `${prefix}-observation-${slug(measurement.id)}`,
    name: measurement.name,
    metric: measurement.id,
    quantity: { value: measurement.value, unit: measurement.unit },
    source: {
      operation,
      artifactIds: [evidenceArtifactId],
      capturedAt: run.completedAt,
    },
    freshness: branchFreshness,
  }));
  const sourceLabel = options.sourceLabel ?? "persisted mcp-modelica run";
  return {
    id: `modelica-run-${slug(run.runId)}-model-scenario-bound`,
    name: `Attach ${sourceLabel} thermal evidence`,
    subjectId,
    capturedAt: run.completedAt,
    bindingProofs: [{ provider: "modelica", kind: "run", id: run.runId }],
    artifacts: [{
      id: scenarioArtifactId,
      name: `Modelica scenario ${run.scenario.id}`,
      kind: "evidence",
      version: run.scenario.fingerprint.digest.slice(0, 12),
      fingerprint: run.scenario.fingerprint,
      producer: { serverId: "modelica", tool: "modelica_run_get", runId: run.runId },
      inputArtifactIds: [],
      freshness: branchFreshness,
    }, ...artifacts],
    consumptions: [
      {
        id: consumptionId,
        artifactId: modelArtifactId,
        consumer: operation,
        observedFingerprint: run.model.fingerprint,
        verifiedAt: run.completedAt,
        status: "verified",
      },
      {
        id: scenarioConsumptionId,
        artifactId: scenarioArtifactId,
        consumer: operation,
        observedFingerprint: run.scenario.fingerprint,
        verifiedAt: run.completedAt,
        status: "verified",
      },
    ],
    observations,
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: `link-${consumptionId}-${modelArtifactId}`,
        relation: "uses",
        from: { kind: "consumption", id: consumptionId },
        to: { kind: "artifact", id: modelArtifactId },
        rationale:
          "The persisted run identifies the exact versioned Modelica model it consumed.",
      },
      {
        id: `link-${resultArtifactId}-${modelArtifactId}`,
        relation: "derived_from",
        from: { kind: "artifact", id: resultArtifactId },
        to: { kind: "artifact", id: modelArtifactId },
        rationale:
          "The persisted simulation result was produced from this declared model fingerprint.",
      },
      {
        id: `link-${scenarioConsumptionId}-${scenarioArtifactId}`,
        relation: "uses",
        from: { kind: "consumption", id: scenarioConsumptionId },
        to: { kind: "artifact", id: scenarioArtifactId },
        rationale:
          "The persisted run identifies the exact versioned Modelica scenario it consumed.",
      },
      {
        id: `link-${resultArtifactId}-${scenarioArtifactId}`,
        relation: "derived_from",
        from: { kind: "artifact", id: resultArtifactId },
        to: { kind: "artifact", id: scenarioArtifactId },
        rationale:
          "The persisted simulation result was produced for this declared scenario fingerprint.",
      },
      ...observations.map((observation) => ({
        id: `link-${observation.id}-${evidenceArtifactId}`,
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: observation.id },
        to: { kind: "artifact" as const, id: evidenceArtifactId },
        rationale:
          "The quantity was read from this persisted Modelica evidence artifact.",
      })),
    ],
    proposedActions: [],
    modelica: modelicaRunBinding(run),
  };
}

export function modelicaRunBinding(
  run: PersistedModelicaRunEvidence,
): ModelicaRunBinding {
  return {
    runId: run.runId,
    fingerprint: run.fingerprint,
    model: structuredClone(run.model),
    scenario: structuredClone(run.scenario),
  };
}

function parseMeasurement(
  value: RunMeasurement,
): PersistedModelicaRunEvidence["measurements"][number] {
  return {
    id: nonEmpty(value.id, "measurement id"),
    name: nonEmpty(value.label, "measurement label"),
    value: finite(value.value.value, `measurement ${value.id} value`),
    unit: nonEmpty(value.value.unit, `measurement ${value.id} unit`),
  };
}

function parseArtifact(
  value: EvidenceArtifact,
): PersistedModelicaRunEvidence["artifacts"][number] {
  const kind = supportedArtifactKind(value.kind);
  return {
    kind,
    name: nonEmpty(value.label, `artifact ${kind} label`),
    uri: nonEmpty(value.path, `artifact ${kind} path`),
    fingerprint: sha(value.sha256, `artifact ${kind} sha256`),
    bytes: nonNegativeInteger(value.bytes, `artifact ${kind} bytes`),
  };
}

function artifactId(
  prefix: string,
  artifact: PersistedModelicaRunEvidence["artifacts"][number],
): string {
  return `${prefix}-${slug(artifact.kind)}-${artifact.fingerprint.digest.slice(0, 12)}`;
}

function threadArtifactKind(kind: EvidenceArtifact["kind"]): ThreadArtifact["kind"] {
  if (kind === "model") return "simulation-model";
  if (kind === "script") return "script";
  if (kind === "result") return "solver-result";
  return "evidence";
}

function mediaType(kind: EvidenceArtifact["kind"]): string {
  if (kind === "model") return "text/x-modelica";
  if (kind === "script") return "text/plain";
  if (kind === "result") return "text/csv";
  return "application/json";
}

function supportedArtifactKind(
  value: EvidenceArtifact["kind"],
): EvidenceArtifact["kind"] {
  const kinds: readonly EvidenceArtifact["kind"][] = [
    "request",
    "resolved-parameters",
    "model",
    "script",
    "cad",
    "solve-case",
    "diagnostics",
    "result",
    "evidence",
    "verdict",
  ];
  if (!kinds.includes(value)) {
    throw new Error(`Unsupported Modelica artifact kind ${value}.`);
  }
  return value;
}

function sha(value: unknown, label: string): ContentFingerprint {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return { algorithm: "sha256", digest: value.toLowerCase() };
}

function isoDate(value: unknown, label: string): string {
  const text = nonEmpty(value, label);
  if (Number.isNaN(Date.parse(text))) throw new Error(`${label} must be ISO-8601.`);
  return text;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be unique.`);
  }
}

function slug(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}
