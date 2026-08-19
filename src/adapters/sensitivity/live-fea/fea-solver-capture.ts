/**
 * Generic FEA solver result capture for `verify.run-fea-static-proof@1`.
 *
 * The generic executor needs a proof-agnostic parser that checks only
 * structural invariants: sourcePath matches stagedPath, hash/bytes match,
 * fixedSelections/loads echo exactly via deterministicJson, and units are the
 * two reviewed ones. It then produces a canonical content-addressed envelope
 * for the WAL and CAS store.
 *
 * Timestamp invariant: `capturedAt` always comes from the run's
 * `requiredStart`, never from `Date.now()`. This makes the envelope
 * deterministic given the same inputs and the same run start.
 */

import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { exactRecord } from "../../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../../domain/thread/thread-snapshot.ts";
import type {
  StaticStructuralCaptureToken,
  StaticStructuralLoad,
  StaticStructuralSolveExecution,
  StaticStructuralSolveResult,
  StaticStructuralSupport,
} from "../../../domain/sensitivity/live-fea/static-structural-solver.ts";

// ── Schema constant ───────────────────────────────────────────────────────────

export const FEA_SOLVER_CAPTURE_SCHEMA = "fea-solver-result-capture/1.0" as const;

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Provenance context that the executor records alongside the solver result.
 *
 * The executor builds the artifact triplets (derived_from, uses, consumed)
 * from this record — it must never re-parse the envelope to obtain them.
 */
export interface FeaSolverCaptureUpstreamIdentities {
  /** SHA-256 hex digest of the canonical proof case text. */
  readonly proofDigest: string;
  /** Thread artifact id of the STEP file consumed by this run. */
  readonly stepArtifactId: string;
  /** Content fingerprint of the STEP artifact (the version key). */
  readonly stepFingerprint: ContentFingerprint;
  /** Staged container path that CalculiX read from (anti-TOCTOU). */
  readonly stagedPath: string;
}

/** Strict wire DTO for a validated `calculix_solve_static` response. */
export interface ParsedFeaSolverResult {
  readonly inputArtifact: {
    /** Provider-private path of its staging copy. */
    readonly path: string;
    /** Provider echo, verified against the exact dispatched staging path. */
    readonly sourcePath: string;
    readonly sha256: string;
    readonly bytes: number;
  };
  readonly constraints: {
    readonly fixedSelections: readonly unknown[];
    readonly loads: readonly unknown[];
  };
  readonly mesh: {
    readonly nodes: number;
    readonly elements: number;
    readonly nodesPerSelection: Readonly<Record<string, number>>;
  };
  readonly metrics: {
    readonly maxDisplacement: {
      readonly value: number;
      readonly unit: "mm";
      readonly nodeId: number;
      readonly vectorMm: readonly [number, number, number];
    };
    readonly maxVonMises: {
      readonly value: number;
      readonly unit: "MPa";
      readonly elementId: number;
    };
  };
}

export interface FeaSolverResponseExpectation {
  readonly stagedPath: string;
  readonly stepDigest: string;
  readonly stepBytes: number;
  readonly fixedSelections: readonly unknown[];
  readonly loads: readonly unknown[];
}

export interface StaticStructuralSemanticExpectation {
  readonly inputFingerprint: ContentFingerprint;
  readonly inputByteCount: number;
  readonly supports: readonly StaticStructuralSupport[];
  readonly loads: readonly StaticStructuralLoad[];
}

const exactCaptureByToken = new WeakMap<
  StaticStructuralCaptureToken,
  ParsedFeaSolverResult
>();

/**
 * Canonical content-addressed envelope persisted by `FileCaptureStore`.
 *
 * The CAS address is `sha256(deterministicJson(envelope))` — there is no
 * self-referential fingerprint field inside the stored JSON.  The WAL records
 * both `canonicalSolverCaptureText` and `solverCaptureFp` so a restart can
 * reconstruct the envelope from the WAL without reading the CAS store.
 */
export interface FeaSolverCaptureEnvelope {
  readonly schemaVersion: typeof FEA_SOLVER_CAPTURE_SCHEMA;
  /** Registered operation identity, e.g. `"verify.run-fea-static-proof@1"`. */
  readonly operation: string;
  /** Orchestrator-assigned run identity (server-fixed, never agent-supplied). */
  readonly trustedRunId: string;
  /** Run `requiredStart` timestamp — never `Date.now()`. */
  readonly capturedAt: string;
  readonly upstreamIdentities: FeaSolverCaptureUpstreamIdentities;
  readonly inputArtifact: ParsedFeaSolverResult["inputArtifact"];
  readonly constraints: {
    readonly fixedSelections: readonly unknown[];
    readonly loads: readonly unknown[];
  };
  readonly mesh: ParsedFeaSolverResult["mesh"];
  readonly metrics: ParsedFeaSolverResult["metrics"];
}

// ── Parseur ───────────────────────────────────────────────────────────────────

/**
 * Fail-closed parser for `calculix_solve_static` structuredContent.
 *
 * Verifies every structural and semantic invariant before returning:
 *   - `schemaVersion "2.0"`, `kind "static-solve"`
 *   - `inputArtifact.sourcePath === expected.stagedPath`
 *   - `inputArtifact.sha256 === expected.stepDigest`
 *   - `inputArtifact.bytes === expected.stepBytes`
 *   - `constraints.fixedSelections` echoed exactly via `deterministicJson`
 *   - `constraints.loads` echoed exactly via `deterministicJson`
 *   - `mesh.nodesPerSelection` non-empty, all values positive integers
 *   - `metrics.maxDisplacement.unit === "mm"`, value finite and non-negative
 *   - `metrics.maxVonMises.unit === "MPa"`, value finite and non-negative
 *   - `nodeId` and `elementId` present as positive integers
 */
export function parseFeaSolverResponse(
  structuredContent: unknown,
  expected: FeaSolverResponseExpectation,
): ParsedFeaSolverResult {
  const root = exactRecord(
    structuredContent,
    ["constraints", "inputArtifact", "kind", "mesh", "metrics", "schemaVersion"],
    "calculix_solve_static structuredContent",
  );
  if (root.schemaVersion !== "2.0" || root.kind !== "static-solve") {
    throw new Error(
      "calculix_solve_static returned an unsupported contract version.",
    );
  }

  // inputArtifact — anti-TOCTOU attestation and hash/bytes verification.
  const ia = exactRecord(
    root.inputArtifact,
    ["bytes", "path", "sha256", "sourcePath"],
    "FEA solver inputArtifact",
  );
  const inputPath = nonEmptyStr(ia.path, "FEA solver inputArtifact.path");
  const sourcePath = nonEmptyStr(ia.sourcePath, "FEA solver inputArtifact.sourcePath");
  if (sourcePath !== expected.stagedPath) {
    throw new Error(
      "CalculiX inputArtifact.sourcePath does not match the staged STEP path.",
    );
  }
  const sha256 = requireSha256(ia.sha256, "FEA solver inputArtifact.sha256");
  if (sha256 !== expected.stepDigest) {
    throw new Error(
      "CalculiX inputArtifact.sha256 does not match the expected STEP digest.",
    );
  }
  const bytes = positiveInt(ia.bytes, "FEA solver inputArtifact.bytes");
  if (bytes !== expected.stepBytes) {
    throw new Error(
      "CalculiX inputArtifact.bytes does not match the expected STEP byte count.",
    );
  }

  // constraints — exact echo verification via deterministicJson.
  const constraints = exactRecord(
    root.constraints,
    ["fixedSelections", "loads"],
    "FEA solver constraints",
  );
  if (!Array.isArray(constraints.fixedSelections)) {
    throw new TypeError(
      "FEA solver constraints.fixedSelections must be an array.",
    );
  }
  if (!Array.isArray(constraints.loads)) {
    throw new TypeError("FEA solver constraints.loads must be an array.");
  }
  if (
    deterministicJson(constraints.fixedSelections) !==
      deterministicJson(expected.fixedSelections)
  ) {
    throw new Error(
      "CalculiX constraints.fixedSelections differ from the dispatched fixed selections.",
    );
  }
  if (deterministicJson(constraints.loads) !== deterministicJson(expected.loads)) {
    throw new Error("CalculiX constraints.loads differ from the proof loads.");
  }

  const mesh = parseMesh(root.mesh);
  const metrics = parseMetrics(root.metrics);

  return {
    inputArtifact: { path: inputPath, sourcePath, sha256, bytes },
    constraints: {
      fixedSelections: constraints.fixedSelections as readonly unknown[],
      loads: constraints.loads as readonly unknown[],
    },
    mesh,
    metrics,
  };
}

/**
 * Map the strict provider DTO to the semantic domain result while retaining an
 * opaque handle to the exact validated record for the unchanged CAS capture.
 */
export function bindStaticStructuralSolveExecution(
  parsed: ParsedFeaSolverResult,
  expected: StaticStructuralSemanticExpectation,
): StaticStructuralSolveExecution {
  const captureToken = Object.freeze({}) as StaticStructuralCaptureToken;
  exactCaptureByToken.set(captureToken, parsed);
  const result: StaticStructuralSolveResult = {
    inputAttestation: {
      fingerprint: expected.inputFingerprint,
      byteCount: expected.inputByteCount,
    },
    boundaryConditions: {
      supports: expected.supports,
      loads: expected.loads,
    },
    mesh: {
      nodeCount: parsed.mesh.nodes,
      elementCount: parsed.mesh.elements,
    },
    observations: {
      maximumDisplacement: {
        magnitude: {
          value: parsed.metrics.maxDisplacement.value,
          unit: parsed.metrics.maxDisplacement.unit,
        },
        vector: {
          value: parsed.metrics.maxDisplacement.vectorMm,
          unit: "mm",
        },
      },
      maximumVonMisesStress: {
        magnitude: {
          value: parsed.metrics.maxVonMises.value,
          unit: parsed.metrics.maxVonMises.unit,
        },
      },
    },
  };
  return { result, captureToken };
}

/** Resolve the exact validated provider record at the capture boundary only. */
export function exactFeaSolverResultForCapture(
  captureToken: StaticStructuralCaptureToken,
): ParsedFeaSolverResult {
  const parsed = exactCaptureByToken.get(captureToken);
  if (!parsed) {
    throw new TypeError(
      "Static structural capture token was not issued by the FEA capture adapter.",
    );
  }
  return parsed;
}

// ── Envelope builder ──────────────────────────────────────────────────────────

/**
 * Build the canonical `fea-solver-result-capture/1.0` envelope.
 *
 * The returned `canonicalText` is exactly what `FileCaptureStore.save` will
 * persist.  `fingerprintDigest` is `sha256(canonicalText bytes)` — the CAS
 * address. Both are recorded in the WAL `solver-recorded` state so that a
 * restart can reconstruct the envelope from the WAL without touching the
 * CAS store.
 *
 * `capturedAt` MUST be the run's `requiredStart` — never `Date.now()`.
 */
export async function buildFeaSolverCaptureEnvelope(
  parsed: ParsedFeaSolverResult,
  options: {
    readonly trustedRunId: string;
    readonly operation: string;
    readonly upstreamIdentities: FeaSolverCaptureUpstreamIdentities;
    readonly capturedAt: string;
  },
): Promise<{ readonly canonicalText: string; readonly fingerprintDigest: string }> {
  requireTimestamp(options.capturedAt, "capturedAt");
  const envelope: FeaSolverCaptureEnvelope = {
    schemaVersion: FEA_SOLVER_CAPTURE_SCHEMA,
    operation: nonEmptyStr(options.operation, "operation"),
    trustedRunId: nonEmptyStr(options.trustedRunId, "trustedRunId"),
    capturedAt: options.capturedAt,
    upstreamIdentities: validateUpstreamIdentities(options.upstreamIdentities),
    inputArtifact: parsed.inputArtifact,
    constraints: parsed.constraints,
    mesh: parsed.mesh,
    metrics: parsed.metrics,
  };
  // canonicalText = deterministicJson(envelope) — no self-referential fingerprint
  // field.  The CAS key is sha256(canonicalText bytes), same as what
  // FileCaptureStore.save verifies internally.
  const canonicalText = deterministicJson(envelope);
  const fp = await sha256Fingerprint(envelope);
  return { canonicalText, fingerprintDigest: fp.digest };
}

// ── Envelope parser ───────────────────────────────────────────────────────────

/**
 * Inverse fail-closed parser for the canonical envelope text (WAL recovery).
 *
 * Validates every field's structural and semantic contract. Does NOT verify
 * the fingerprint digest — derive it from the raw text bytes if integrity
 * verification is needed (e.g. `sha256(new TextEncoder().encode(text))`).
 */
export function parseFeaSolverCaptureEnvelope(text: string): FeaSolverCaptureEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("FEA solver capture envelope is not valid JSON.");
  }
  const root = exactRecord(raw, [
    "capturedAt",
    "constraints",
    "inputArtifact",
    "mesh",
    "metrics",
    "operation",
    "schemaVersion",
    "trustedRunId",
    "upstreamIdentities",
  ], "FEA solver capture envelope");

  if (root.schemaVersion !== FEA_SOLVER_CAPTURE_SCHEMA) {
    throw new Error(
      "FEA solver capture envelope has an unsupported schema version.",
    );
  }

  const capturedAt = requireTimestamp(root.capturedAt, "FEA solver capture capturedAt");

  const ia = exactRecord(
    root.inputArtifact,
    ["bytes", "path", "sha256", "sourcePath"],
    "FEA solver capture inputArtifact",
  );

  const constraintsRec = exactRecord(
    root.constraints,
    ["fixedSelections", "loads"],
    "FEA solver capture constraints",
  );
  if (!Array.isArray(constraintsRec.fixedSelections)) {
    throw new TypeError(
      "FEA solver capture constraints.fixedSelections must be an array.",
    );
  }
  if (!Array.isArray(constraintsRec.loads)) {
    throw new TypeError("FEA solver capture constraints.loads must be an array.");
  }

  const mesh = parseMesh(root.mesh);
  const metrics = parseMetrics(root.metrics);
  const upstreamIdentities = parseUpstreamIdentities(root.upstreamIdentities);

  return {
    schemaVersion: FEA_SOLVER_CAPTURE_SCHEMA,
    operation: nonEmptyStr(root.operation, "FEA solver capture operation"),
    trustedRunId: nonEmptyStr(root.trustedRunId, "FEA solver capture trustedRunId"),
    capturedAt,
    upstreamIdentities,
    inputArtifact: {
      path: nonEmptyStr(ia.path, "FEA solver capture inputArtifact.path"),
      sourcePath: nonEmptyStr(
        ia.sourcePath,
        "FEA solver capture inputArtifact.sourcePath",
      ),
      sha256: requireSha256(ia.sha256, "FEA solver capture inputArtifact.sha256"),
      bytes: positiveInt(ia.bytes, "FEA solver capture inputArtifact.bytes"),
    },
    constraints: {
      fixedSelections: constraintsRec.fixedSelections as readonly unknown[],
      loads: constraintsRec.loads as readonly unknown[],
    },
    mesh,
    metrics,
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function parseMesh(value: unknown): ParsedFeaSolverResult["mesh"] {
  const root = exactRecord(
    value,
    ["elements", "nodes", "nodesPerSelection"],
    "FEA solver mesh",
  );
  return {
    nodes: positiveInt(root.nodes, "FEA solver mesh.nodes"),
    elements: positiveInt(root.elements, "FEA solver mesh.elements"),
    nodesPerSelection: parseNodesPerSelection(
      root.nodesPerSelection,
      "FEA solver mesh.nodesPerSelection",
    ),
  };
}

function parseNodesPerSelection(
  value: unknown,
  path: string,
): Readonly<Record<string, number>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.length === 0) {
    throw new TypeError(`${path} must not be empty.`);
  }
  const result: Record<string, number> = {};
  for (const key of keys) {
    result[key] = positiveInt(rec[key], `${path}.${key}`);
  }
  return Object.freeze(result);
}

function parseMetrics(value: unknown): ParsedFeaSolverResult["metrics"] {
  const root = exactRecord(
    value,
    ["maxDisplacement", "maxVonMises"],
    "FEA solver metrics",
  );
  const displacement = exactRecord(
    root.maxDisplacement,
    ["nodeId", "unit", "value", "vectorMm"],
    "FEA solver metrics.maxDisplacement",
  );
  const stress = exactRecord(
    root.maxVonMises,
    ["elementId", "unit", "value"],
    "FEA solver metrics.maxVonMises",
  );
  if (displacement.unit !== "mm") {
    throw new TypeError(
      `FEA solver metrics.maxDisplacement.unit must be "mm", got ${
        JSON.stringify(displacement.unit)
      }.`,
    );
  }
  if (stress.unit !== "MPa") {
    throw new TypeError(
      `FEA solver metrics.maxVonMises.unit must be "MPa", got ${
        JSON.stringify(stress.unit)
      }.`,
    );
  }
  return {
    maxDisplacement: {
      value: nonNegativeFinite(displacement.value, "FEA solver displacement value"),
      unit: "mm",
      nodeId: positiveInt(displacement.nodeId, "FEA solver displacement nodeId"),
      vectorMm: vector3(displacement.vectorMm, "FEA solver displacement vectorMm"),
    },
    maxVonMises: {
      value: nonNegativeFinite(stress.value, "FEA solver von Mises value"),
      unit: "MPa",
      elementId: positiveInt(stress.elementId, "FEA solver von Mises elementId"),
    },
  };
}

function parseUpstreamIdentities(
  value: unknown,
): FeaSolverCaptureUpstreamIdentities {
  const rec = exactRecord(
    value,
    ["proofDigest", "stagedPath", "stepArtifactId", "stepFingerprint"],
    "FEA solver capture upstreamIdentities",
  );
  const fp = exactRecord(
    rec.stepFingerprint,
    ["algorithm", "digest"],
    "FEA solver capture upstreamIdentities.stepFingerprint",
  );
  if (fp.algorithm !== "sha256") {
    throw new TypeError(
      'FEA solver capture upstreamIdentities.stepFingerprint.algorithm must be "sha256".',
    );
  }
  return {
    proofDigest: nonEmptyStr(rec.proofDigest, "upstreamIdentities.proofDigest"),
    stepArtifactId: nonEmptyStr(
      rec.stepArtifactId,
      "upstreamIdentities.stepArtifactId",
    ),
    stepFingerprint: {
      algorithm: "sha256",
      digest: requireSha256(fp.digest, "upstreamIdentities.stepFingerprint.digest"),
    },
    stagedPath: nonEmptyStr(rec.stagedPath, "upstreamIdentities.stagedPath"),
  };
}

function validateUpstreamIdentities(
  value: FeaSolverCaptureUpstreamIdentities,
): FeaSolverCaptureUpstreamIdentities {
  nonEmptyStr(value.proofDigest, "upstreamIdentities.proofDigest");
  nonEmptyStr(value.stepArtifactId, "upstreamIdentities.stepArtifactId");
  nonEmptyStr(value.stagedPath, "upstreamIdentities.stagedPath");
  if (
    !value.stepFingerprint ||
    value.stepFingerprint.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(value.stepFingerprint.digest)
  ) {
    throw new TypeError(
      "upstreamIdentities.stepFingerprint must be a valid sha256 fingerprint.",
    );
  }
  return value;
}

function requireTimestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${path} must be an ISO-8601 timestamp.`);
  }
  return value;
}

function requireSha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(
      `${path} must be a 64-character lowercase hex SHA-256.`,
    );
  }
  return value;
}

function nonEmptyStr(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function nonNegativeFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${path} must be a finite non-negative number.`);
  }
  return value;
}

function positiveInt(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${path} must be a positive integer.`);
  }
  return value as number;
}

function vector3(value: unknown, path: string): readonly [number, number, number] {
  if (
    !Array.isArray(value) || value.length !== 3 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    throw new TypeError(`${path} must be a finite 3-vector.`);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}
