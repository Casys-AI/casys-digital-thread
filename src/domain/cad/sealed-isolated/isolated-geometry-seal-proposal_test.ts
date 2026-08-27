import { assertEquals, assertThrows } from "@std/assert";
import {
  encodeIsolatedGeometrySealParameters,
  parseIsolatedGeometrySealParameters,
} from "./isolated-geometry-seal-proposal.ts";

const admission = {
  schemaVersion: "isolated-geometry-seal-admission/1.0" as const,
  executionCapture: {
    id: `build123d-execution-capture-${"a".repeat(64)}`,
    fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
  },
  draft: {
    schemaVersion: "build123d-execution-draft-reference/1.0" as const,
    draftId: `build123d-execution-draft-${"b".repeat(64)}`,
    fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
  },
  publication: {
    fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
  },
  step: {
    role: "geometry" as const,
    basename: "geometry.step" as const,
    mediaType: "model/step" as const,
    format: "step-ap214" as const,
    sha256: "d".repeat(64),
    byteCount: 128,
  },
  basis: {
    snapshotId: "snapshot.isolated-geometry.r2",
    revision: 2,
    subjectId: "subject.isolated-geometry",
    fingerprint: { algorithm: "sha256" as const, digest: "e".repeat(64) },
  },
};

Deno.test("isolated geometry seal parameters round-trip exact execution identities", () => {
  const parameters = encodeIsolatedGeometrySealParameters(admission);
  assertEquals(parseIsolatedGeometrySealParameters(parameters), admission);
  assertEquals(parameters.length, 18);
  assertEquals(
    parameters.map((parameter) => parameter.key),
    [
      "design.isolatedGeometry.seal.schemaVersion",
      "design.isolatedGeometry.seal.operation",
      "design.isolatedGeometry.seal.executionCapture.id",
      "design.isolatedGeometry.seal.executionCapture.sha256",
      "design.isolatedGeometry.seal.draft.schemaVersion",
      "design.isolatedGeometry.seal.draft.draftId",
      "design.isolatedGeometry.seal.draft.sha256",
      "design.isolatedGeometry.seal.publication.sha256",
      "design.isolatedGeometry.seal.step.role",
      "design.isolatedGeometry.seal.step.basename",
      "design.isolatedGeometry.seal.step.mediaType",
      "design.isolatedGeometry.seal.step.format",
      "design.isolatedGeometry.seal.step.sha256",
      "design.isolatedGeometry.seal.step.byteCount",
      "design.isolatedGeometry.seal.basis.snapshotId",
      "design.isolatedGeometry.seal.basis.revision",
      "design.isolatedGeometry.seal.basis.subjectId",
      "design.isolatedGeometry.seal.basis.sha256",
    ],
  );
});

Deno.test("isolated geometry seal grammar rejects a capture id that does not derive from its sha256", () => {
  assertThrows(() =>
    encodeIsolatedGeometrySealParameters({
      ...admission,
      executionCapture: {
        ...admission.executionCapture,
        id: `build123d-execution-capture-${"f".repeat(64)}`,
      },
    })
  );
});

Deno.test("isolated geometry seal replay rejects a string integer that is not Object.is equal", () => {
  const parameters = encodeIsolatedGeometrySealParameters(admission).map(
    (parameter) =>
      parameter.key === "design.isolatedGeometry.seal.step.byteCount"
        ? { ...parameter, value: "128" }
        : parameter,
  );
  assertThrows(
    () => parseIsolatedGeometrySealParameters(parameters),
    TypeError,
    "non-negative safe integer",
  );
});
