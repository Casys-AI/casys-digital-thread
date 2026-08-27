import { assertEquals, assertThrows } from "@std/assert";
import {
  sampleTechnicalSourceAnalysisCaptureLocator,
  sampleTechnicalSourceAttachmentProvenance,
  sampleTechnicalSourceClosureProvenance,
} from "../../../testing/technical-source-capture-test-support.ts";
import {
  assertTechnicalCompilationSourcesShareExactWorkspace,
  assertTechnicalSourceAnalysisCaptureLocatorsEqual,
  assertTechnicalSourceProvenanceIdentitiesEqual,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  technicalSourceAnalysisCaptureLocatorsEqual,
  technicalSourceProvenanceIdentitiesEqual,
  type TechnicalSourceProvenanceIdentity,
  validateTechnicalSourceAnalysisCaptureLocator,
} from "./technical-source-analysis-capture-locator.ts";

function identity(
  overrides: Partial<TechnicalSourceProvenanceIdentity> = {},
): TechnicalSourceProvenanceIdentity {
  const locator = sampleTechnicalSourceAnalysisCaptureLocator();
  const attachment = sampleTechnicalSourceAttachmentProvenance("source.cad");
  const sourceClosure = sampleTechnicalSourceClosureProvenance("source.cad");
  const sourceId = `technical-unit:${sourceClosure.fingerprint.digest}`;
  const sourceFingerprint = { algorithm: "sha256" as const, digest: "2".repeat(64) };
  return {
    sourceId,
    role: "cad-script",
    language: "python",
    profileId: "build123d-closed-subset-v1",
    profileVersion: "1.0.0",
    profileFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    analyzer: { id: "build123d-qualified-lezer", version: "1.6.0" },
    sourceFingerprint,
    captureFingerprint: { algorithm: "sha256", digest: "3".repeat(64) },
    analysisFingerprint: { algorithm: "sha256", digest: "4".repeat(64) },
    effectiveUnit: {
      kind: "authored-root",
      closureKind: "root-only",
      unitId: sourceId,
      closureFingerprint: sourceClosure.fingerprint,
      scriptFingerprint: sourceFingerprint,
    },
    attachment,
    sourceClosure,
    locator,
    ...overrides,
  };
}

Deno.test("opaque locator/4.0 is the only accepted technical-source replay handle", () => {
  const locator = sampleTechnicalSourceAnalysisCaptureLocator();
  assertEquals(
    validateTechnicalSourceAnalysisCaptureLocator(locator),
    locator,
  );
  assertThrows(
    () =>
      validateTechnicalSourceAnalysisCaptureLocator({
        ...locator,
        schemaVersion: "technical-source-analysis-capture-locator/2.0",
      }),
    TypeError,
  );
  assertThrows(
    () =>
      validateTechnicalSourceAnalysisCaptureLocator({
        schemaVersion: "technical-source-analysis-capture/1.0",
        kind: "technical-source-analysis",
        fingerprint: locator.fingerprint,
        byteCount: locator.byteCount,
        casUri: locator.casUri,
      }),
    TypeError,
  );
});

Deno.test("complete attachment, closure and locator identity compares every field", () => {
  const expected = identity();
  assertEquals(technicalSourceProvenanceIdentitiesEqual(expected, expected), true);
  assertTechnicalSourceProvenanceIdentitiesEqual(expected, expected, "$identity");

  const observedAttachment = identity({
    attachment: sampleTechnicalSourceAttachmentProvenance("source.cad", {
      attachmentRevision: 9,
    }),
  });
  assertEquals(
    technicalSourceProvenanceIdentitiesEqual(expected, observedAttachment),
    false,
  );
  assertThrows(
    () =>
      assertTechnicalSourceProvenanceIdentitiesEqual(
        expected,
        observedAttachment,
        "$identity",
      ),
    TypeError,
    "complete technical-source provenance identity",
  );

  const observedClosure = identity({
    sourceClosure: sampleTechnicalSourceClosureProvenance("source.cad", {
      workspaceRevision: 9,
    }),
  });
  assertEquals(
    technicalSourceProvenanceIdentitiesEqual(expected, observedClosure),
    false,
  );

  const locatorMutations = [
    (locator: ReturnType<typeof sampleTechnicalSourceAnalysisCaptureLocator>) => ({
      ...locator,
      fingerprint: { algorithm: "sha256" as const, digest: "9".repeat(64) },
      casUri: `casys://technical-source-analysis-capture/sha256/${"9".repeat(64)}`,
    }),
    (locator: ReturnType<typeof sampleTechnicalSourceAnalysisCaptureLocator>) => ({
      ...locator,
      byteCount: locator.byteCount + 1,
    }),
  ];
  for (const mutate of locatorMutations) {
    const observed = identity({ locator: mutate(expected.locator) });
    assertEquals(
      technicalSourceAnalysisCaptureLocatorsEqual(
        expected.locator,
        observed.locator,
      ),
      false,
    );
    assertThrows(
      () =>
        assertTechnicalSourceAnalysisCaptureLocatorsEqual(
          expected.locator,
          observed.locator,
          "$locator",
        ),
      TypeError,
      "complete opaque locator identity",
    );
  }

  const identityMutations: Array<
    (value: TechnicalSourceProvenanceIdentity) => TechnicalSourceProvenanceIdentity
  > = [
    (value) => ({ ...value, sourceId: "source.other" }),
    (value) => ({ ...value, role: "modelica-model" }),
    (value) => ({ ...value, language: "modelica" }),
    (value) => ({ ...value, profileId: "other-profile" }),
    (value) => ({ ...value, profileVersion: "9.0.0" }),
    (value) => ({
      ...value,
      profileFingerprint: { algorithm: "sha256", digest: "9".repeat(64) },
    }),
    (value) => ({ ...value, analyzer: { ...value.analyzer, id: "other" } }),
    (value) => ({ ...value, analyzer: { ...value.analyzer, version: "9.0.0" } }),
    (value) => ({
      ...value,
      sourceFingerprint: { algorithm: "sha256", digest: "9".repeat(64) },
    }),
    (value) => ({
      ...value,
      captureFingerprint: { algorithm: "sha256", digest: "9".repeat(64) },
    }),
    (value) => ({
      ...value,
      analysisFingerprint: { algorithm: "sha256", digest: "9".repeat(64) },
    }),
  ];
  for (const mutate of identityMutations) {
    assertEquals(
      technicalSourceProvenanceIdentitiesEqual(expected, mutate(expected)),
      false,
    );
    assertThrows(
      () =>
        assertTechnicalSourceProvenanceIdentitiesEqual(
          expected,
          mutate(expected),
          "$identity",
        ),
      TypeError,
      "complete technical-source provenance identity",
    );
  }
});

Deno.test("a preview or admission bundle rejects mixed projects, revisions, and event fingerprints", () => {
  const cad = sampleTechnicalSourceClosureProvenance("source.cad", {
    workspaceRevision: 4,
  });
  const spice = sampleTechnicalSourceClosureProvenance("source.spice", {
    projectId: cad.projectId,
    workspaceRevision: 4,
    workspaceEventFingerprint: cad.workspaceEventFingerprint,
  });
  assertEquals(
    assertTechnicalCompilationSourcesShareExactWorkspace(
      [{ sourceClosure: cad }, { sourceClosure: spice }],
      cad.projectId,
      "$sources",
    ),
    4,
  );
  assertThrows(
    () =>
      assertTechnicalCompilationSourcesShareExactWorkspace(
        [
          { sourceClosure: cad },
          {
            sourceClosure: sampleTechnicalSourceClosureProvenance("source.spice", {
              projectId: cad.projectId,
              workspaceRevision: 5,
              workspaceEventFingerprint: cad.workspaceEventFingerprint,
            }),
          },
        ],
        cad.projectId,
        "$sources",
      ),
    TypeError,
    "identical workspaceRevision",
  );
  assertThrows(
    () =>
      assertTechnicalCompilationSourcesShareExactWorkspace(
        [
          { sourceClosure: cad },
          {
            sourceClosure: sampleTechnicalSourceClosureProvenance("source.spice", {
              projectId: cad.projectId,
              workspaceRevision: 4,
              workspaceEventFingerprint: {
                algorithm: "sha256",
                digest: "9".repeat(64),
              },
            }),
          },
        ],
        cad.projectId,
        "$sources",
      ),
    TypeError,
    "identical workspaceEventFingerprint",
  );
  assertEquals(
    TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    "technical-source-analysis-capture-locator/4.0",
  );
  assertEquals(
    TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND,
    "technical-source-analysis-capture-locator",
  );
});
