/**
 * Tests for fea-proof-proposal.ts.
 *
 * Coverage:
 *   - canonicalProofText: stable regardless of JSON input order
 *   - encode→parse symmetry for the parametric cadSource variant
 *   - encode→parse symmetry for the imported-or-reconstructed cadSource variant
 *   - feaProofDecisionParametersToMap: duplicate_parameter rejection
 *   - parseFeaProofDecisionParameters: unexpected_parameter rejection
 *   - parseFeaProofDecisionParameters: missing_parameter rejection
 *   - parseFeaProofDecisionParameters: invalid_fingerprint rejection
 *   - verifyFeaProofParametersMatchCase: pass on correct params
 *   - verifyFeaProofParametersMatchCase: parameter_mismatch on each divergent field
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  canonicalProofText,
  encodeFeaProofDecisionParameters,
  feaProofDecisionParametersToMap,
  FeaProofProposalError,
  parseFeaProofDecisionParameters,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
  verifyFeaProofParametersMatchCase,
} from "./fea-proof-proposal.ts";
import { validateMechanicalProofCase } from "./mechanical-proof-case.ts";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const PROOF_JSON = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../../../src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl04-arm-cantilever.json",
      import.meta.url,
    ),
  ),
);

const PROOF_CASE = validateMechanicalProofCase(PROOF_JSON);

const GEOMETRY_ARTIFACT = {
  id: "cad-model-articulated-arm-step-abc123",
  fingerprint: {
    algorithm: "sha256" as const,
    digest: "a".repeat(64),
  },
};

const REQUIREMENTS_ARTIFACT = {
  id: "requirements-articulated-arm-abc123",
  fingerprint: {
    algorithm: "sha256" as const,
    digest: "b".repeat(64),
  },
};

const SOURCE_FINGERPRINT = "1".repeat(64);

/** Return the active parametric proof declaration used by these contract tests. */
function makeParametricProofCase() {
  return PROOF_CASE;
}

/** Build a minimal imported-or-reconstructed proof case by patching cadSource. */
function makeImportedProofCase() {
  const raw = structuredClone(PROOF_JSON) as Record<string, unknown>;
  raw["cadSource"] = {
    kind: "imported-or-reconstructed",
    method: "import",
    sources: [
      {
        id: "src-1",
        name: "Articulated arm STEP from supplier",
        format: "step",
        sha256: "c".repeat(64),
        bytes: 12345,
        sourceUri: "https://example.com/articulated-arm.step",
      },
    ],
    license: {
      identifier: "proprietary-supplier-2026",
      evidenceUri: "https://example.com/license.pdf",
    },
    conversion: {
      tool: "FreeCAD",
      revision: "0.21",
      losses: ["Parametric history not preserved", "Sketch constraints absent"],
    },
    engineeringBoundary: {
      designIntent: "partial",
      editableCad: "reconstructed",
      manufacturability: "not-established",
      limitations: [
        "No editable parametric model; tolerances not verified.",
        "Mesh quality depends on import fidelity.",
      ],
    },
  };
  return validateMechanicalProofCase(raw);
}

// ── Operation constant ────────────────────────────────────────────────────────

Deno.test("VERIFY_SEAL_PROOF_CASE_OPERATION has the specified id and version", () => {
  assertEquals(VERIFY_SEAL_PROOF_CASE_OPERATION.id, "verify.seal-proof-case");
  assertEquals(VERIFY_SEAL_PROOF_CASE_OPERATION.version, "1");
});

// ── canonicalProofText ────────────────────────────────────────────────────────

Deno.test("canonicalProofText is stable regardless of JSON input key order", () => {
  const proofA = validateMechanicalProofCase(PROOF_JSON);
  // Shuffle keys at the root level in a clone.
  const shuffled = structuredClone(PROOF_JSON) as Record<string, unknown>;
  const entries = Object.entries(shuffled);
  entries.reverse();
  const reordered: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    reordered[key] = value;
  }
  const proofB = validateMechanicalProofCase(reordered);
  assertEquals(canonicalProofText(proofA), canonicalProofText(proofB));
});

Deno.test("canonicalProofText contains requirements in maximum-displacement-first order", () => {
  const text = canonicalProofText(PROOF_CASE);
  const indexDisp = text.indexOf("maximum-displacement");
  const indexVm = text.indexOf("maximum-von-mises-stress");
  assertEquals(indexDisp < indexVm, true);
});

// ── Encode→parse symmetry: parametric cadSource ──────────────────────────────

Deno.test("encode→parse round-trip is symmetric for the parametric cadSource variant", () => {
  const proofCase = makeParametricProofCase();
  const proofDigest = "d".repeat(64);

  const encoded = encodeFeaProofDecisionParameters(
    proofDigest,
    proofCase,
    GEOMETRY_ARTIFACT,
    REQUIREMENTS_ARTIFACT,
    SOURCE_FINGERPRINT,
  );
  const map = feaProofDecisionParametersToMap(encoded);
  const parsed = parseFeaProofDecisionParameters(map);

  assertEquals(parsed.proofDigest, proofDigest);
  assertEquals(parsed.sourceFingerprint, SOURCE_FINGERPRINT);
  assertEquals(parsed.schemaVersion, "mechanical-proof-case/1.0");
  assertEquals(parsed.id, proofCase.id);
  assertEquals(parsed.revision, proofCase.revision);
  assertEquals(parsed.scope, proofCase.scope);
  assertEquals(parsed.evidenceBoundary, proofCase.evidenceBoundary);
  assertEquals(parsed.reviewBasis.snapshotId, proofCase.project.baseThreadSnapshot.id);
  assertEquals(
    parsed.reviewBasis.revision,
    proofCase.project.baseThreadSnapshot.revision,
  );
  assertEquals(parsed.target.id, proofCase.target.id);
  assertEquals(parsed.target.modelElementId, proofCase.target.modelElementId);
  assertEquals(parsed.geometryArtifact.id, GEOMETRY_ARTIFACT.id);
  assertEquals(
    parsed.geometryArtifact.fingerprint.digest,
    GEOMETRY_ARTIFACT.fingerprint.digest,
  );
  assertEquals(parsed.requirementsArtifact.id, REQUIREMENTS_ARTIFACT.id);
  assertEquals(
    parsed.requirementsArtifact.fingerprint.digest,
    REQUIREMENTS_ARTIFACT.fingerprint.digest,
  );
  assertEquals(
    parsed.requirementsSource.editingContextId,
    proofCase.requirementsSource.editingContextId,
  );
  assertEquals(
    parsed.requirementsSource.elementId,
    proofCase.requirementsSource.elementId,
  );
  assertEquals(parsed.step.digest, proofCase.expectedCadArtifact.sha256);
  assertEquals(parsed.step.bytes, proofCase.expectedCadArtifact.bytes);
  assertEquals(
    parsed.material.youngModulusMpa,
    proofCase.analysis.material.youngModulus.value,
  );
  assertEquals(
    parsed.material.poissonRatio,
    proofCase.analysis.material.poissonRatio.value,
  );
  assertEquals(parsed.material.basis, proofCase.analysis.material.basis);
  assertEquals(
    parsed.mesh.targetSizeMm,
    proofCase.analysis.mesh.targetSize.value,
  );
  assertEquals(parsed.supports.length, proofCase.analysis.supports.length);
  assertEquals(parsed.loads.length, proofCase.analysis.loads.length);
  assertEquals(parsed.requirements.length, proofCase.requirements.length);
  assertEquals(parsed.requirements[0].metric, "maximum-displacement");
  assertEquals(parsed.requirements[1].metric, "maximum-von-mises-stress");

  if (proofCase.cadSource.kind !== "parametric") throw new Error("fixture mismatch");
  if (parsed.cadSource.kind !== "parametric") throw new Error("parsed kind mismatch");
  assertEquals(
    parsed.cadSource.generator.provider,
    proofCase.cadSource.generator.provider,
  );
  assertEquals(
    parsed.cadSource.generator.definition.sha256,
    proofCase.cadSource.generator.definition.sha256,
  );
  assertEquals(
    parsed.cadSource.engineeringBoundary.designIntent,
    proofCase.cadSource.engineeringBoundary.designIntent,
  );
});

// ── Encode→parse symmetry: imported-or-reconstructed cadSource ───────────────

Deno.test("encode→parse round-trip is symmetric for the imported-or-reconstructed cadSource variant", () => {
  const proofCase = makeImportedProofCase();
  const proofDigest = "e".repeat(64);

  const encoded = encodeFeaProofDecisionParameters(
    proofDigest,
    proofCase,
    GEOMETRY_ARTIFACT,
    REQUIREMENTS_ARTIFACT,
    SOURCE_FINGERPRINT,
  );
  const map = feaProofDecisionParametersToMap(encoded);
  const parsed = parseFeaProofDecisionParameters(map);

  if (parsed.cadSource.kind !== "imported-or-reconstructed") {
    throw new Error("parsed kind must be imported-or-reconstructed");
  }
  if (proofCase.cadSource.kind !== "imported-or-reconstructed") {
    throw new Error("fixture cadSource kind mismatch");
  }
  assertEquals(parsed.cadSource.method, proofCase.cadSource.method);
  assertEquals(parsed.cadSource.sources.length, proofCase.cadSource.sources.length);
  assertEquals(parsed.cadSource.sources[0].id, proofCase.cadSource.sources[0].id);
  assertEquals(
    parsed.cadSource.sources[0].sha256,
    proofCase.cadSource.sources[0].sha256,
  );
  assertEquals(
    parsed.cadSource.license.identifier,
    proofCase.cadSource.license.identifier,
  );
  assertEquals(
    parsed.cadSource.conversion.tool,
    proofCase.cadSource.conversion.tool,
  );
  assertEquals(
    parsed.cadSource.conversion.losses.length,
    proofCase.cadSource.conversion.losses.length,
  );
  assertEquals(
    parsed.cadSource.engineeringBoundary.limitations.length,
    proofCase.cadSource.engineeringBoundary.limitations.length,
  );
});

// ── feaProofDecisionParametersToMap: duplicate rejection ─────────────────────

Deno.test("feaProofDecisionParametersToMap rejects duplicate_parameter", () => {
  const params = [
    { key: "fea.proof.id", value: "first" },
    { key: "fea.proof.id", value: "second" },
  ];
  assertThrows(
    () => feaProofDecisionParametersToMap(params),
    FeaProofProposalError,
    "fea.proof.id",
  );
  const err = (() => {
    try {
      feaProofDecisionParametersToMap(params);
    } catch (e) {
      return e as FeaProofProposalError;
    }
  })();
  assertEquals(err?.code, "duplicate_parameter");
});

// ── parseFeaProofDecisionParameters: unexpected_parameter ────────────────────

Deno.test("parseFeaProofDecisionParameters rejects an unexpected_parameter", () => {
  const proofCase = makeParametricProofCase();
  const encoded = encodeFeaProofDecisionParameters(
    "f".repeat(64),
    proofCase,
    GEOMETRY_ARTIFACT,
    REQUIREMENTS_ARTIFACT,
    SOURCE_FINGERPRINT,
  );
  const withExtra = [...encoded, { key: "fea.proof.injected", value: "evil" }];
  const map = feaProofDecisionParametersToMap(withExtra);
  const err = (() => {
    try {
      parseFeaProofDecisionParameters(map);
    } catch (e) {
      return e as FeaProofProposalError;
    }
  })();
  assertEquals(err?.code, "unexpected_parameter");
});

// ── parseFeaProofDecisionParameters: missing_parameter ───────────────────────

Deno.test("parseFeaProofDecisionParameters rejects a missing_parameter", () => {
  const proofCase = makeParametricProofCase();
  const encoded = encodeFeaProofDecisionParameters(
    "0".repeat(64),
    proofCase,
    GEOMETRY_ARTIFACT,
    REQUIREMENTS_ARTIFACT,
    SOURCE_FINGERPRINT,
  );
  // Drop the proof digest entry.
  const withoutDigest = encoded.filter((p) => p.key !== "fea.proof.digest");
  const map = feaProofDecisionParametersToMap(withoutDigest);
  const err = (() => {
    try {
      parseFeaProofDecisionParameters(map);
    } catch (e) {
      return e as FeaProofProposalError;
    }
  })();
  assertEquals(err?.code, "missing_parameter");
});

// ── parseFeaProofDecisionParameters: invalid_fingerprint ─────────────────────

Deno.test("parseFeaProofDecisionParameters rejects an invalid_fingerprint", () => {
  const proofCase = makeParametricProofCase();
  const encoded = encodeFeaProofDecisionParameters(
    "1".repeat(64),
    proofCase,
    GEOMETRY_ARTIFACT,
    REQUIREMENTS_ARTIFACT,
    SOURCE_FINGERPRINT,
  );
  const withBadFp = encoded.map((p) =>
    p.key === "fea.proof.digest" ? { ...p, value: "not-a-fingerprint" } : p
  );
  const map = feaProofDecisionParametersToMap(withBadFp);
  const err = (() => {
    try {
      parseFeaProofDecisionParameters(map);
    } catch (e) {
      return e as FeaProofProposalError;
    }
  })();
  assertEquals(err?.code, "invalid_fingerprint");
});

// ── verifyFeaProofParametersMatchCase: correct params pass ───────────────────

Deno.test("verifyFeaProofParametersMatchCase passes when params match the proof case", () => {
  const proofCase = makeParametricProofCase();
  const encoded = encodeFeaProofDecisionParameters(
    "2".repeat(64),
    proofCase,
    GEOMETRY_ARTIFACT,
    REQUIREMENTS_ARTIFACT,
    SOURCE_FINGERPRINT,
  );
  const map = feaProofDecisionParametersToMap(encoded);
  const parsed = parseFeaProofDecisionParameters(map);
  // Must not throw.
  verifyFeaProofParametersMatchCase(parsed, proofCase);
});

// ── verifyFeaProofParametersMatchCase: parameter_mismatch fields ──────────────

Deno.test("verifyFeaProofParametersMatchCase detects a divergent proof id", () => {
  const proofCase = makeParametricProofCase();
  const encoded = encodeFeaProofDecisionParameters(
    "3".repeat(64),
    proofCase,
    GEOMETRY_ARTIFACT,
    REQUIREMENTS_ARTIFACT,
    SOURCE_FINGERPRINT,
  );
  const tampered = encoded.map((p) =>
    p.key === "fea.proof.id" ? { ...p, value: "tampered-id" } : p
  );
  const map = feaProofDecisionParametersToMap(tampered);
  const parsed = parseFeaProofDecisionParameters(map);
  const err = (() => {
    try {
      verifyFeaProofParametersMatchCase(parsed, proofCase);
    } catch (e) {
      return e as FeaProofProposalError;
    }
  })();
  assertEquals(err?.code, "parameter_mismatch");
});

Deno.test("verifyFeaProofParametersMatchCase detects a divergent step digest", () => {
  const proofCase = makeParametricProofCase();
  const encoded = encodeFeaProofDecisionParameters(
    "4".repeat(64),
    proofCase,
    GEOMETRY_ARTIFACT,
    REQUIREMENTS_ARTIFACT,
    SOURCE_FINGERPRINT,
  );
  const tampered = encoded.map((p) =>
    p.key === "fea.proof.step.digest" ? { ...p, value: "0".repeat(64) } : p
  );
  const map = feaProofDecisionParametersToMap(tampered);
  const parsed = parseFeaProofDecisionParameters(map);
  const err = (() => {
    try {
      verifyFeaProofParametersMatchCase(parsed, proofCase);
    } catch (e) {
      return e as FeaProofProposalError;
    }
  })();
  assertEquals(err?.code, "parameter_mismatch");
});

Deno.test("verifyFeaProofParametersMatchCase detects a divergent requirement limit value", () => {
  const proofCase = makeParametricProofCase();
  const encoded = encodeFeaProofDecisionParameters(
    "5".repeat(64),
    proofCase,
    GEOMETRY_ARTIFACT,
    REQUIREMENTS_ARTIFACT,
    SOURCE_FINGERPRINT,
  );
  // Tamper the first requirement's limit value.
  const tampered = encoded.map((p) =>
    p.key === "fea.proof.requirements.0.limit.value" ? { ...p, value: 9999 } : p
  );
  const map = feaProofDecisionParametersToMap(tampered);
  const parsed = parseFeaProofDecisionParameters(map);
  const err = (() => {
    try {
      verifyFeaProofParametersMatchCase(parsed, proofCase);
    } catch (e) {
      return e as FeaProofProposalError;
    }
  })();
  assertEquals(err?.code, "parameter_mismatch");
});

Deno.test("verifyFeaProofParametersMatchCase detects a divergent cadSource generator tool", () => {
  const proofCase = makeParametricProofCase();
  const encoded = encodeFeaProofDecisionParameters(
    "6".repeat(64),
    proofCase,
    GEOMETRY_ARTIFACT,
    REQUIREMENTS_ARTIFACT,
    SOURCE_FINGERPRINT,
  );
  const tampered = encoded.map((p) =>
    p.key === "fea.proof.cadSource.generator.tool" ? { ...p, value: "evil_tool" } : p
  );
  const map = feaProofDecisionParametersToMap(tampered);
  const parsed = parseFeaProofDecisionParameters(map);
  const err = (() => {
    try {
      verifyFeaProofParametersMatchCase(parsed, proofCase);
    } catch (e) {
      return e as FeaProofProposalError;
    }
  })();
  assertEquals(err?.code, "parameter_mismatch");
});

// ── verifyFeaProofParametersMatchCase: imported-or-reconstructed variant ──────

Deno.test("verifyFeaProofParametersMatchCase passes for the imported-or-reconstructed variant", () => {
  const proofCase = makeImportedProofCase();
  const encoded = encodeFeaProofDecisionParameters(
    "7".repeat(64),
    proofCase,
    GEOMETRY_ARTIFACT,
    REQUIREMENTS_ARTIFACT,
    SOURCE_FINGERPRINT,
  );
  const map = feaProofDecisionParametersToMap(encoded);
  const parsed = parseFeaProofDecisionParameters(map);
  verifyFeaProofParametersMatchCase(parsed, proofCase);
});
