/**
 * Tests for fea-solver-capture.ts.
 *
 * Fixtures are pinned to the real `calculix_solve_static` structuredContent
 * contract attested by the live probe: `inputArtifact {path, sourcePath,
 * sha256, bytes}`, `mesh {nodes, elements, nodesPerSelection}`, `metrics
 * {maxDisplacement {value, unit:"mm", nodeId, vectorMm}, maxVonMises
 * {value, unit:"MPa", elementId}}`.  Any contract change in the tool must be
 * reflected here simultaneously.
 *
 * Each rejection test mutates exactly one field of the valid fixture so the
 * error source is unambiguous.  The round-trip test confirms that
 * `buildFeaSolverCaptureEnvelope` → `parseFeaSolverCaptureEnvelope` produces
 * an envelope that is structurally identical to the one built from the same
 * inputs and that `fingerprintDigest` equals `sha256(canonicalText bytes)`.
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import {
  buildFeaSolverCaptureEnvelope,
  FEA_SOLVER_CAPTURE_SCHEMA,
  parseFeaSolverCaptureEnvelope,
  parseFeaSolverResponse,
} from "./fea-solver-capture.ts";
import type { FeaSolverCaptureUpstreamIdentities } from "./fea-solver-capture.ts";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const STEP_DIGEST = "b".repeat(64);
const STEP_BYTES = 15000;
const STAGED_PATH = `/exports/fea-${"b".repeat(64)}-abcd1234.step` as const;

const SUPPORTS = [
  {
    id: "support-1",
    selection: "FIXED-FACE",
    box: { min: [-10, 0, -5], max: [10, 1, 5] },
  },
];
const LOADS = [
  {
    id: "load-1",
    selection: "LOADED-FACE",
    box: { min: [-10, -1, -5], max: [10, 0, 5] },
    forceN: [0, 0, -100],
  },
];

function validResponse(): unknown {
  return {
    schemaVersion: "2.0",
    kind: "static-solve",
    inputArtifact: {
      path: "/tmp/private/fea-run-001.step",
      sourcePath: STAGED_PATH,
      sha256: STEP_DIGEST,
      bytes: STEP_BYTES,
    },
    constraints: {
      fixedSelections: structuredClone(SUPPORTS),
      loads: structuredClone(LOADS),
    },
    mesh: {
      nodes: 500,
      elements: 300,
      nodesPerSelection: { "FIXED-FACE": 50, "LOADED-FACE": 30, PART: 500 },
    },
    metrics: {
      maxDisplacement: {
        value: 0.234,
        unit: "mm",
        nodeId: 42,
        vectorMm: [0.01, 0.02, -0.234],
      },
      maxVonMises: { value: 5.67, unit: "MPa", elementId: 88 },
    },
  };
}

const UPSTREAM: FeaSolverCaptureUpstreamIdentities = {
  proofDigest: "c".repeat(64),
  stepArtifactId: "artifact:step:drip-tray-001",
  stepFingerprint: { algorithm: "sha256", digest: STEP_DIGEST },
  stagedPath: STAGED_PATH,
};

const EXPECTED = {
  stagedPath: STAGED_PATH,
  stepDigest: STEP_DIGEST,
  stepBytes: STEP_BYTES,
  fixedSelections: SUPPORTS,
  loads: LOADS,
};

const CAPTURED_AT = "2026-08-10T08:00:00.000Z";

// ── parseFeaSolverResponse ────────────────────────────────────────────────────

Deno.test(
  "FEA solver response parser accepts a valid CalculiX response and verifies all structural invariants",
  () => {
    const result = parseFeaSolverResponse(validResponse(), EXPECTED);
    assertEquals(result.inputArtifact.sourcePath, STAGED_PATH);
    assertEquals(result.inputArtifact.sha256, STEP_DIGEST);
    assertEquals(result.inputArtifact.bytes, STEP_BYTES);
    assertEquals(result.mesh.nodes, 500);
    assertEquals(result.mesh.elements, 300);
    assertEquals(result.mesh.nodesPerSelection["FIXED-FACE"], 50);
    assertEquals(result.mesh.nodesPerSelection["LOADED-FACE"], 30);
    assertEquals(result.metrics.maxDisplacement.value, 0.234);
    assertEquals(result.metrics.maxDisplacement.unit, "mm");
    assertEquals(result.metrics.maxDisplacement.nodeId, 42);
    assertEquals(result.metrics.maxVonMises.value, 5.67);
    assertEquals(result.metrics.maxVonMises.unit, "MPa");
    assertEquals(result.metrics.maxVonMises.elementId, 88);
  },
);

Deno.test(
  "FEA solver response parser rejects when sourcePath does not match the staged path",
  () => {
    const response = validResponse() as Record<string, unknown>;
    (response.inputArtifact as Record<string, unknown>).sourcePath =
      "/exports/other.step";
    assertThrows(
      () => parseFeaSolverResponse(response, EXPECTED),
      Error,
      "sourcePath does not match the staged STEP path",
    );
  },
);

Deno.test(
  "FEA solver response parser rejects when sha256 does not match the expected step digest",
  () => {
    const response = validResponse() as Record<string, unknown>;
    (response.inputArtifact as Record<string, unknown>).sha256 = "a".repeat(64);
    assertThrows(
      () => parseFeaSolverResponse(response, EXPECTED),
      Error,
      "sha256 does not match the expected STEP digest",
    );
  },
);

Deno.test(
  "FEA solver response parser rejects when bytes do not match the expected step byte count",
  () => {
    const response = validResponse() as Record<string, unknown>;
    (response.inputArtifact as Record<string, unknown>).bytes = 99999;
    assertThrows(
      () => parseFeaSolverResponse(response, EXPECTED),
      Error,
      "bytes does not match the expected STEP byte count",
    );
  },
);

Deno.test(
  "FEA solver response parser rejects when the fixed-selection echo differs from what was dispatched",
  () => {
    const response = validResponse() as Record<string, unknown>;
    (response.constraints as Record<string, unknown>).fixedSelections = [
      "WRONG-FACE",
    ];
    assertThrows(
      () => parseFeaSolverResponse(response, EXPECTED),
      Error,
      "constraints.fixedSelections differ from the dispatched fixed selections",
    );
  },
);

Deno.test(
  "FEA solver response parser rejects when loads echo differs from proof loads",
  () => {
    const response = validResponse() as Record<string, unknown>;
    (response.constraints as Record<string, unknown>).loads = [];
    assertThrows(
      () => parseFeaSolverResponse(response, EXPECTED),
      Error,
      "constraints.loads differ from the proof loads",
    );
  },
);

Deno.test(
  "FEA solver response parser rejects when supports is missing from constraints",
  () => {
    const response = validResponse() as Record<string, unknown>;
    const constraints = response.constraints as Record<string, unknown>;
    delete constraints.fixedSelections;
    assertThrows(
      () => parseFeaSolverResponse(response, EXPECTED),
      TypeError,
    );
  },
);

Deno.test(
  "FEA solver response parser rejects when displacement unit is not mm",
  () => {
    const response = validResponse() as Record<string, unknown>;
    const metrics = response.metrics as Record<string, unknown>;
    (metrics.maxDisplacement as Record<string, unknown>).unit = "m";
    assertThrows(
      () => parseFeaSolverResponse(response, EXPECTED),
      TypeError,
      '"mm"',
    );
  },
);

Deno.test(
  "FEA solver response parser rejects when von Mises unit is not MPa",
  () => {
    const response = validResponse() as Record<string, unknown>;
    const metrics = response.metrics as Record<string, unknown>;
    (metrics.maxVonMises as Record<string, unknown>).unit = "Pa";
    assertThrows(
      () => parseFeaSolverResponse(response, EXPECTED),
      TypeError,
      '"MPa"',
    );
  },
);

Deno.test(
  "FEA solver response parser rejects when nodesPerSelection is empty",
  () => {
    const response = validResponse() as Record<string, unknown>;
    (response.mesh as Record<string, unknown>).nodesPerSelection = {};
    assertThrows(
      () => parseFeaSolverResponse(response, EXPECTED),
      TypeError,
      "must not be empty",
    );
  },
);

Deno.test(
  "FEA solver response parser rejects when displacement value is non-finite",
  () => {
    const response = validResponse() as Record<string, unknown>;
    const metrics = response.metrics as Record<string, unknown>;
    (metrics.maxDisplacement as Record<string, unknown>).value = Infinity;
    assertThrows(
      () => parseFeaSolverResponse(response, EXPECTED),
      TypeError,
      "non-negative",
    );
  },
);

Deno.test(
  "FEA solver response parser rejects when an unexpected top-level key is present",
  () => {
    const response = { ...(validResponse() as object), extra: true };
    assertThrows(
      () => parseFeaSolverResponse(response, EXPECTED),
      TypeError,
    );
  },
);

// ── buildFeaSolverCaptureEnvelope + parseFeaSolverCaptureEnvelope ─────────────

Deno.test(
  "FEA solver capture envelope round-trips through canonicalText without modification",
  async () => {
    const parsed = parseFeaSolverResponse(validResponse(), EXPECTED);
    const { canonicalText, fingerprintDigest } = await buildFeaSolverCaptureEnvelope(
      parsed,
      {
        trustedRunId: "run:verify.run-fea-static-proof@1:abc123",
        operation: "verify.run-fea-static-proof@1",
        upstreamIdentities: UPSTREAM,
        capturedAt: CAPTURED_AT,
      },
    );

    // fingerprintDigest must equal sha256(canonicalText bytes) so that
    // FileCaptureStore.save({ algorithm: "sha256", digest: fingerprintDigest },
    //   canonicalText) succeeds without an integrity conflict.
    const expectedFp = await sha256Fingerprint(JSON.parse(canonicalText));
    assertEquals(fingerprintDigest, expectedFp.digest);

    // The canonical text must be valid JSON parseable by the inverse parser.
    const recovered = parseFeaSolverCaptureEnvelope(canonicalText);
    assertEquals(recovered.schemaVersion, FEA_SOLVER_CAPTURE_SCHEMA);
    assertEquals(recovered.operation, "verify.run-fea-static-proof@1");
    assertEquals(recovered.trustedRunId, "run:verify.run-fea-static-proof@1:abc123");
    assertEquals(recovered.capturedAt, CAPTURED_AT);
    assertEquals(recovered.upstreamIdentities.proofDigest, "c".repeat(64));
    assertEquals(recovered.upstreamIdentities.stepArtifactId, UPSTREAM.stepArtifactId);
    assertEquals(recovered.upstreamIdentities.stepFingerprint.digest, STEP_DIGEST);
    assertEquals(recovered.upstreamIdentities.stagedPath, STAGED_PATH);
    assertEquals(recovered.inputArtifact.sha256, STEP_DIGEST);
    assertEquals(recovered.inputArtifact.bytes, STEP_BYTES);
    assertEquals(recovered.mesh.nodes, 500);
    assertEquals(recovered.metrics.maxDisplacement.unit, "mm");
    assertEquals(recovered.metrics.maxVonMises.unit, "MPa");
    assertEquals(recovered.metrics.maxVonMises.elementId, 88);
  },
);

Deno.test(
  "FEA solver capture envelope rejects an ISO-8601 capturedAt violation",
  async () => {
    const parsed = parseFeaSolverResponse(validResponse(), EXPECTED);
    await assertRejects(
      () =>
        buildFeaSolverCaptureEnvelope(parsed, {
          trustedRunId: "run-001",
          operation: "verify.run-fea-static-proof@1",
          upstreamIdentities: UPSTREAM,
          capturedAt: "not-a-date",
        }),
      TypeError,
      "ISO-8601",
    );
  },
);

Deno.test(
  "FEA solver capture envelope parser rejects a tampered schemaVersion",
  async () => {
    const parsed = parseFeaSolverResponse(validResponse(), EXPECTED);
    const { canonicalText } = await buildFeaSolverCaptureEnvelope(parsed, {
      trustedRunId: "run-001",
      operation: "verify.run-fea-static-proof@1",
      upstreamIdentities: UPSTREAM,
      capturedAt: CAPTURED_AT,
    });
    const obj = JSON.parse(canonicalText) as Record<string, unknown>;
    obj.schemaVersion = "wrong/1.0";
    assertThrows(
      () => parseFeaSolverCaptureEnvelope(JSON.stringify(obj)),
      Error,
      "unsupported schema version",
    );
  },
);
