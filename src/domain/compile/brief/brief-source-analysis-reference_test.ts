import { assertEquals, assertThrows } from "@std/assert";
import {
  briefSourceIdFor,
  validateBriefSourceAnalysisReference,
} from "./brief-source-analysis-reference.ts";

const fp = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("brief source-analysis reference is exact, canonical, and frozen", () => {
  const reference = validateBriefSourceAnalysisReference({
    briefId: "brief",
    briefSnapshotId: "brief:r1",
    briefRevision: 1,
    sourceId: "brief-source:abc",
    sourceFingerprint: fp,
    sourceCaptureFingerprint: fp,
    analysisFingerprint: fp,
  });
  assertEquals(Object.isFrozen(reference), true);
  assertEquals(reference.briefRevision, 1);
  assertThrows(
    () => validateBriefSourceAnalysisReference({ ...reference, unexpected: true }),
    TypeError,
  );
  assertThrows(
    () => validateBriefSourceAnalysisReference({ ...reference, briefRevision: 0 }),
    TypeError,
  );
  assertThrows(
    () =>
      validateBriefSourceAnalysisReference({
        ...reference,
        analysisFingerprint: { algorithm: "sha256", digest: "not-a-digest" },
      }),
    TypeError,
  );
});

Deno.test("brief source identity hashes the exact tuple without delimiter collisions", async () => {
  const left = await briefSourceIdFor("a:b", "c", 1);
  const right = await briefSourceIdFor("a", "b:c", 1);
  assertEquals(left === right, false);
});
