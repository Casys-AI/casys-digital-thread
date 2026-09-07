import { assertEquals, assertThrows } from "@std/assert";
import {
  isExactStaticProofEvaluationCaptureArtifactId,
  isExactStaticProofEvidenceArtifactId,
  isExactStaticProofOutputArtifactId,
  staticProofEvaluationCaptureArtifactLegacyId,
  staticProofEvidenceArtifactLegacyId,
  staticProofOutputArtifactLegacyId,
  staticProofPublicationIdentity,
  staticProofPublicationLayout,
  staticProofPublicationScope,
} from "./static-proof-publication-identity.ts";

const DIGEST = "a".repeat(64);
const RUN_A = "run:fea-a";
const RUN_B = "run:fea-b";

Deno.test("publication identity keeps the legacy digest-only form when unscoped", () => {
  const legacy = staticProofOutputArtifactLegacyId("input.step", DIGEST);
  assertEquals(legacy, `calculix-isolated-input-step-${DIGEST}`);
  assertEquals(staticProofPublicationIdentity(legacy), legacy);
  assertEquals(staticProofPublicationLayout(legacy, legacy, RUN_A), "legacy");
  assertEquals(staticProofPublicationScope("legacy", RUN_A), undefined);
  assertEquals(
    isExactStaticProofOutputArtifactId(legacy, "input.step", DIGEST, RUN_A),
    true,
  );
});

Deno.test("publication identity accepts only the exact run-scoped form for that runId", () => {
  const legacy = staticProofOutputArtifactLegacyId("result.json", DIGEST);
  const scoped = staticProofPublicationIdentity(legacy, RUN_A);
  assertEquals(scoped, `${legacy}-run-${RUN_A}`);
  assertEquals(staticProofPublicationLayout(scoped, legacy, RUN_A), "run-scoped");
  assertEquals(staticProofPublicationScope("run-scoped", RUN_A), RUN_A);
  assertEquals(
    isExactStaticProofOutputArtifactId(scoped, "result.json", DIGEST, RUN_A),
    true,
  );
  assertEquals(
    isExactStaticProofOutputArtifactId(scoped, "result.json", DIGEST, RUN_B),
    false,
  );
  assertEquals(
    staticProofPublicationLayout(`${legacy}-run-${RUN_B}`, legacy, RUN_A),
    undefined,
  );
  assertEquals(
    staticProofPublicationLayout(`${legacy}-extra`, legacy, RUN_A),
    undefined,
  );
  assertEquals(
    staticProofPublicationLayout(`${legacy}-run-`, legacy, RUN_A),
    undefined,
  );
});

Deno.test("publication identity preserves the exact Thread runId spelling", () => {
  const legacy = staticProofOutputArtifactLegacyId("result.json", DIGEST);
  const runId = " run:fea-a ";
  const scoped = staticProofPublicationIdentity(legacy, runId);
  assertEquals(scoped, `${legacy}-run-${runId}`);
  assertEquals(
    staticProofPublicationLayout(scoped, legacy, runId),
    "run-scoped",
  );
});

Deno.test("publication identity rejects mixed or prefix-only evidence and capture ids", () => {
  const evidenceLegacy = staticProofEvidenceArtifactLegacyId(DIGEST);
  const captureLegacy = staticProofEvaluationCaptureArtifactLegacyId(DIGEST);
  const evidenceScoped = staticProofPublicationIdentity(evidenceLegacy, RUN_A);
  assertEquals(
    isExactStaticProofEvidenceArtifactId(evidenceLegacy, DIGEST, RUN_A),
    true,
  );
  assertEquals(
    isExactStaticProofEvidenceArtifactId(evidenceScoped, DIGEST, RUN_A),
    true,
  );
  assertEquals(
    isExactStaticProofEvidenceArtifactId(evidenceScoped, DIGEST, RUN_B),
    false,
  );
  assertEquals(
    isExactStaticProofEvidenceArtifactId(
      `${evidenceLegacy}-run-${RUN_A}-x`,
      DIGEST,
      RUN_A,
    ),
    false,
  );
  assertEquals(
    isExactStaticProofEvaluationCaptureArtifactId(captureLegacy, DIGEST, RUN_A),
    true,
  );
  assertEquals(
    isExactStaticProofEvaluationCaptureArtifactId(
      staticProofPublicationIdentity(captureLegacy, RUN_A),
      DIGEST,
      RUN_B,
    ),
    false,
  );
  assertThrows(
    () => staticProofPublicationIdentity(evidenceLegacy, ""),
    TypeError,
    "non-empty string",
  );
});
