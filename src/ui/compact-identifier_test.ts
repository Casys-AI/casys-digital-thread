import { assertEquals } from "@std/assert";
import { compactTechnicalIdentifier } from "./src/thread/compact-identifier-model.ts";

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
