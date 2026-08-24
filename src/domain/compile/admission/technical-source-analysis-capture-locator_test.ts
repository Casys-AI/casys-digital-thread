import { assertEquals, assertThrows } from "@std/assert";
import {
  sampleTechnicalProjectSourceAnchor,
  sampleTechnicalSourceAnalysisCaptureLocator,
} from "../../../testing/technical-source-capture-test-support.ts";
import {
  assertTechnicalCompilationSourcesShareExactWorkspace,
  assertTechnicalProjectSourceAnchorsEqual,
  assertTechnicalSourceAnalysisCaptureLocatorsEqual,
  assertTechnicalSourceProvenanceIdentitiesEqual,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA,
  technicalProjectSourceAnchorsEqual,
  technicalSourceAnalysisCaptureLocatorsEqual,
  technicalSourceProvenanceIdentitiesEqual,
  type TechnicalSourceProvenanceIdentity,
  validateTechnicalSourceAnalysisCaptureLocator,
} from "./technical-source-analysis-capture-locator.ts";

function identity(
  overrides: Partial<TechnicalSourceProvenanceIdentity> = {},
): TechnicalSourceProvenanceIdentity {
  const locator = sampleTechnicalSourceAnalysisCaptureLocator();
  const projectSource = sampleTechnicalProjectSourceAnchor("source.cad");
  return {
    sourceId: "source.cad",
    role: "cad-script",
    language: "python",
    profileId: "build123d-closed-subset-v1",
    profileVersion: "1.0.0",
    profileFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    analyzer: { id: "build123d-qualified-lezer", version: "1.6.0" },
    sourceFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
    captureFingerprint: { algorithm: "sha256", digest: "3".repeat(64) },
    analysisFingerprint: { algorithm: "sha256", digest: "4".repeat(64) },
    projectSource,
    locator,
    ...overrides,
  };
}

Deno.test("opaque locator/2.0 is the only accepted technical-source replay handle", () => {
  const locator = sampleTechnicalSourceAnalysisCaptureLocator();
  assertEquals(
    validateTechnicalSourceAnalysisCaptureLocator(locator),
    locator,
  );
  assertThrows(
    () =>
      validateTechnicalSourceAnalysisCaptureLocator({
        schemaVersion: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA,
        kind: "technical-source-analysis",
        fingerprint: locator.fingerprint,
        byteCount: locator.byteCount,
        casUri: locator.casUri,
      }),
    TypeError,
  );
  assertThrows(
    () =>
      validateTechnicalSourceAnalysisCaptureLocator({
        schemaVersion: "technical-source-analysis-capture-locator/1.0",
        kind: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND,
        fingerprint: locator.fingerprint,
        byteCount: locator.byteCount,
        casUri: locator.casUri,
      }),
    TypeError,
  );
  assertThrows(
    () =>
      validateTechnicalSourceAnalysisCaptureLocator({
        ...locator,
        casUri: `casys://technical-source/sha256/${locator.fingerprint.digest}`,
      }),
    TypeError,
    "casys://technical-source-analysis-capture/sha256/",
  );
});

Deno.test("complete project-source and locator identity compares every field", () => {
  const expected = identity();
  assertEquals(technicalSourceProvenanceIdentitiesEqual(expected, expected), true);
  assertTechnicalSourceProvenanceIdentitiesEqual(expected, expected, "$identity");

  const projectMutations: Array<
    (
      anchor: ReturnType<typeof sampleTechnicalProjectSourceAnchor>,
    ) => ReturnType<typeof sampleTechnicalProjectSourceAnchor>
  > = [
    (anchor) => ({ ...anchor, projectId: "project.foreign" }),
    (anchor) => ({ ...anchor, workspaceRevision: 9 }),
    (anchor) => ({
      ...anchor,
      workspaceEventFingerprint: { algorithm: "sha256", digest: "9".repeat(64) },
    }),
    (anchor) => ({ ...anchor, fileId: "source.other" }),
    (anchor) => ({ ...anchor, fileRevision: 8 }),
    (anchor) => ({
      ...anchor,
      fileFingerprint: { algorithm: "sha256", digest: "8".repeat(64) },
    }),
    (anchor) => ({
      ...anchor,
      resourceRef: {
        ...anchor.resourceRef,
        name: "other.py",
      },
    }),
    (anchor) => ({
      ...anchor,
      resourceRef: {
        ...anchor.resourceRef,
        mimeType: "text/plain",
      },
    }),
  ];
  for (const mutate of projectMutations) {
    const observed = identity({
      projectSource: mutate(expected.projectSource),
    });
    assertEquals(
      technicalProjectSourceAnchorsEqual(
        expected.projectSource,
        observed.projectSource,
      ),
      false,
    );
    assertThrows(
      () =>
        assertTechnicalProjectSourceAnchorsEqual(
          expected.projectSource,
          observed.projectSource,
          "$projectSource",
        ),
      TypeError,
      "complete project-source anchor",
    );
  }

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
  const cad = sampleTechnicalProjectSourceAnchor("source.cad", {
    workspaceRevision: 4,
  });
  const spice = sampleTechnicalProjectSourceAnchor("source.spice", {
    projectId: cad.projectId,
    workspaceRevision: 4,
    workspaceEventFingerprint: cad.workspaceEventFingerprint,
  });
  assertEquals(
    assertTechnicalCompilationSourcesShareExactWorkspace(
      [{ projectSource: cad }, { projectSource: spice }],
      cad.projectId,
      "$sources",
    ),
    4,
  );
  assertThrows(
    () =>
      assertTechnicalCompilationSourcesShareExactWorkspace(
        [
          { projectSource: cad },
          {
            projectSource: sampleTechnicalProjectSourceAnchor("source.spice", {
              projectId: "project.foreign",
              workspaceRevision: 4,
              workspaceEventFingerprint: cad.workspaceEventFingerprint,
            }),
          },
        ],
        cad.projectId,
        "$sources",
      ),
    TypeError,
    "exact project",
  );
  assertThrows(
    () =>
      assertTechnicalCompilationSourcesShareExactWorkspace(
        [
          { projectSource: cad },
          {
            projectSource: sampleTechnicalProjectSourceAnchor("source.spice", {
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
          { projectSource: cad },
          {
            projectSource: sampleTechnicalProjectSourceAnchor("source.spice", {
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
});
