import { assertEquals, assertThrows } from "@std/assert";
import { sampleAgentResourceReference } from "../../../testing/agent-resource-test-support.ts";
import {
  assembleCadPlacementAnalysisDocument,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  validateCadPlacementAnalysisCaptureLocator,
  validateCadPlacementAnalysisDocument,
} from "./cad-placement-analysis-capture.ts";
import { validateCadImmediatePlacementSource } from "./cad-immediate-placement-source.ts";
import {
  assembleResolvedCadPlacementCaptureReview,
  assembleUnresolvedCadPlacementCaptureReview,
} from "./cad-placement-capture-review.ts";

const DIGEST = "b".repeat(64);

function locator() {
  return {
    schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    kind: "cad-placement-analysis-capture-locator",
    fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    byteCount: 128,
    casUri: `casys://cad-placement-analysis-capture/sha256/${DIGEST}`,
  };
}

function source() {
  return validateCadImmediatePlacementSource({
    schemaVersion: "cad-immediate-placement-source/1.0",
    unitSystem: "mm",
    placementConvention: "right-handed-mm-extrinsic-xyz-degrees",
    placements: [{
      usageElementId: "usage-left",
      partDefinitionElementId: "def-rail",
      placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
    }],
  });
}

function documentFixture() {
  return assembleCadPlacementAnalysisDocument({
    source: source(),
    sourceBytes: {
      schemaVersion: "cad-immediate-placement-source/1.0",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      byteCount: 64,
      casUri: `casys://cad-immediate-placement-source/sha256/${"c".repeat(64)}`,
    },
    workspace: {
      projectId: "project.generic",
      workspaceRevision: 3,
      workspaceEventFingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
      fileId: "file-place",
      fileRevision: 1,
      fileFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
      resourceRef: sampleAgentResourceReference({
        name: "placements.json",
        mimeType: "application/json",
      }),
      fileRole: "cad-placement-source",
    },
    declaredAgainst: {
      thread: {
        snapshotId: "thread:p:r1",
        revision: 1,
        subjectId: "subject.p",
      },
      architecture: {
        artifactId: "architecture-" + "a".repeat(64),
        fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        captureSchema: "architecture-capture/4.0",
      },
    },
    ownerElementId: "def-system",
    attachments: [{
      attachmentId: "att-left",
      attachmentRevision: 1,
      fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
      usageElementId: "usage-left",
    }],
  });
}

Deno.test("cad-placement-analysis-capture locator is opaque and refuses a foreign URI", () => {
  const parsed = validateCadPlacementAnalysisCaptureLocator(locator());
  assertEquals(parsed.schemaVersion, CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA);
  assertThrows(
    () =>
      validateCadPlacementAnalysisCaptureLocator({
        ...locator(),
        casUri: `casys://technical-source-analysis-capture/sha256/${DIGEST}`,
      }),
    TypeError,
    "cad-placement-analysis-capture",
  );
});

Deno.test("cad-placement-analysis-capture document is closed and grants none", () => {
  const document = documentFixture();
  assertEquals(document.grants, "none");
  assertEquals(document.owner.elementId, "def-system");
  const replayed = validateCadPlacementAnalysisDocument(document);
  assertEquals(replayed.placements[0]?.usageElementId, "usage-left");
  assertThrows(
    () =>
      validateCadPlacementAnalysisDocument({
        ...document,
        provider: "build123d",
      }),
    TypeError,
    "unsupported field",
  );
});

Deno.test("cad-placement-capture-review is resolved only with a locator and stays bounded when unresolved", () => {
  const resolved = assembleResolvedCadPlacementCaptureReview({
    reference: locator(),
    owner: { elementKind: "PartDefinition", elementId: "def-system" },
    usageCount: 1,
  });
  assertEquals(resolved.status, "resolved");
  if (resolved.status !== "resolved") return;
  assertEquals(resolved.grants, "none");
  assertEquals(resolved.usageCount, 1);

  const unresolved = assembleUnresolvedCadPlacementCaptureReview([{
    name: "usage-right",
    relation: "placement",
    recovery: "Author the missing mapping.",
  }]);
  assertEquals(unresolved.status, "unresolved");
  if (unresolved.status !== "unresolved") return;
  assertEquals("reference" in unresolved, false);
  assertEquals(unresolved.grants, "none");
});
