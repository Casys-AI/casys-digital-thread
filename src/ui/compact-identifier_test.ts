import { assertEquals } from "@std/assert";
import {
  compactEmbeddedFingerprints,
  compactTechnicalIdentifier,
  compactTechnicalSummary,
} from "./src/thread/compact-identifier-model.ts";

Deno.test("compactTechnicalIdentifier keeps short identities intact", () => {
  assertEquals(compactTechnicalIdentifier("REQ-42"), "REQ-42");
});

Deno.test("compactTechnicalIdentifier shortens SHA-256 while preserving its type", () => {
  const digest = "0123456789abcdef".repeat(4);
  assertEquals(
    compactTechnicalIdentifier(`sha256:${digest}`),
    `sha256:${digest.slice(0, 12)}…${digest.slice(-6)}`,
  );
});

Deno.test("compactTechnicalIdentifier shortens UUID and opaque identities predictably", () => {
  assertEquals(
    compactTechnicalIdentifier("b4622b3d-0dd8-4fe3-9070-4ac6bc6de3d3"),
    "b4622b3d…e3d3",
  );
  assertEquals(
    compactTechnicalIdentifier(
      "provider:opaque-identity-with-a-long-version@2.0.0",
    ),
    "provider:opaque-…on@2.0.0",
  );
});

Deno.test("a technical summary keeps its readable segments and shortens only the fingerprints", () => {
  const summary = compactTechnicalSummary(
    "step · a9bbc9d4bc11f1c2c544e0fa2b52cac74788e1f6eeb8cb773e5af9dc394c89f9",
  );
  assertEquals(summary, "step · a9bbc9d4bc11…4c89f9");
});

Deno.test("a fingerprint glued inside a label is shortened without losing the readable words", () => {
  assertEquals(
    compactEmbeddedFingerprints(
      "geometry-preview-1f8d244d7d24d78f13876b4176431ff9f865024723141043c46af58f98abacb8-assembly",
    ),
    "geometry-preview-1f8d244d7d24…abacb8-assembly",
  );
  assertEquals(
    compactEmbeddedFingerprints("maxDisplacement"),
    "maxDisplacement",
  );
});
