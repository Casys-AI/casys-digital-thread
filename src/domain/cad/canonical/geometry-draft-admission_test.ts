import { assertEquals, assertThrows } from "@std/assert";
import {
  assertDraftJoinsAdmission,
  GEOMETRY_DRAFT_ADMISSION_SCHEMA,
  GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
  parseGeometryDraftAdmission,
  requireCanonicalGeometryDraftAdmission,
  requireCanonicalGeometryPartDraftAdmission,
  requireNamedCadLeverInDraftScript,
} from "./geometry-draft-admission.ts";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const ADMISSION = {
  schemaVersion: GEOMETRY_DRAFT_ADMISSION_SCHEMA,
  artifactId: `technical-compilation-admission-${DIGEST_A}`,
  fingerprint: { algorithm: "sha256" as const, digest: DIGEST_A },
  sourceFingerprint: { algorithm: "sha256" as const, digest: DIGEST_B },
};
const PARAMETERIZED = [
  "from build123d import Box",
  "thickness = 10",
  "result = Box(10, 10, thickness)",
  "",
].join("\n");
const PHOTO = "from build123d import Box\nresult = Box(10, 10, 10)\n";

Deno.test("parseGeometryDraftAdmission accepts the exact admission stamp", () => {
  assertEquals(parseGeometryDraftAdmission(ADMISSION), ADMISSION);
});

Deno.test("parseGeometryDraftAdmission refuses a non-derived artifact id", () => {
  assertThrows(
    () =>
      parseGeometryDraftAdmission({
        ...ADMISSION,
        artifactId: "technical-compilation-admission-other",
      }),
    TypeError,
    "must derive from the admission fingerprint",
  );
});

Deno.test("a draft script hash must equal the stamped admission source", () => {
  assertDraftJoinsAdmission(ADMISSION.sourceFingerprint, ADMISSION);
  assertThrows(
    () =>
      assertDraftJoinsAdmission({ algorithm: "sha256", digest: DIGEST_A }, ADMISSION),
    TypeError,
    "does not equal the stamped admission source",
  );
});

Deno.test("constructor-only CAD is not a named lever", () => {
  requireNamedCadLeverInDraftScript(PARAMETERIZED);
  assertThrows(
    () => requireNamedCadLeverInDraftScript(PHOTO),
    TypeError,
    "named numeric lever",
  );
});

Deno.test("requireCanonicalGeometryDraftAdmission joins a v1 parameterized draft", () => {
  const admission = requireCanonicalGeometryDraftAdmission({
    script: PARAMETERIZED,
    scriptHash: ADMISSION.sourceFingerprint,
    admission: ADMISSION,
  });
  assertEquals(admission, ADMISSION);
});

Deno.test("requireCanonicalGeometryDraftAdmission refuses a photo preview draft", () => {
  assertThrows(
    () =>
      requireCanonicalGeometryDraftAdmission({
        script: PHOTO,
        scriptHash: ADMISSION.sourceFingerprint,
      }),
    TypeError,
    "admission",
  );
  assertThrows(
    () =>
      requireCanonicalGeometryDraftAdmission({
        script: PHOTO,
        scriptHash: ADMISSION.sourceFingerprint,
        admission: ADMISSION,
      }),
    TypeError,
    "named numeric lever",
  );
});

Deno.test("requireCanonicalGeometryPartDraftAdmission rejects the dropped 1.0 schema", () => {
  assertThrows(
    () =>
      requireCanonicalGeometryPartDraftAdmission({
        schemaVersion: "geometry-part-draft-capture/1.0",
        target: {
          partDefinitionElementId: "part-definition:frame",
          label: "Frame",
          script: PARAMETERIZED,
          scriptHash: ADMISSION.sourceFingerprint,
          files: [],
        },
        admission: {
          ...ADMISSION,
          schemaVersion: GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
          target: {
            partDefinitionElementId: "part-definition:frame",
            label: "Frame",
          },
        },
      }),
    TypeError,
    "geometry-part-draft-capture/1.1",
  );
});
