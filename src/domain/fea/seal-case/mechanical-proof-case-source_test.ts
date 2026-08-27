import { assertEquals, assertThrows } from "@std/assert";
import { safeId } from "../../kernel/case-validation.ts";
import {
  canonicalizeMechanicalProofCaseSource,
  compileMechanicalProofCase,
  mechanicalProofSealIdentities,
  parametricCadSourceFromPartScript,
  validateMechanicalProofCaseSource,
} from "./mechanical-proof-case-source.ts";
import {
  mechanicalProofCaseSourceFixture,
  mechanicalProofCaseSourceText,
} from "../../../testing/fea-proof-case-source-fixtures.ts";

Deno.test("mechanical-proof-case-source/1.0 accepts a new non-lamp project JSON", () => {
  const source = validateMechanicalProofCaseSource(
    JSON.parse(mechanicalProofCaseSourceText()),
  );
  assertEquals(source.schemaVersion, "mechanical-proof-case-source/1.0");
  assertEquals(source.id, "bracket-br01-static");
  assertEquals(source.project.id, "bracket-br01");
  assertEquals(source.analysis.kind, "linear-static");
  assertEquals(source.analysis.mesh.kind, "tetrahedral-volume");
  assertEquals(source.analysis.supports[0]?.kind, "fixed");
  assertEquals(source.analysis.loads[0]?.kind, "force");
  assertEquals(source.requirements.map((item) => item.metric), [
    "maximum-displacement",
    "maximum-von-mises-stress",
  ]);
  assertEquals("authorization" in source, false);
  assertEquals("solver" in source, false);
  assertEquals("cadSource" in source, false);
});

Deno.test("mechanical-proof-case-source canonicalizer is exact and replay-stable", () => {
  const raw = mechanicalProofCaseSourceFixture();
  const shuffled = {
    requirements: raw.requirements,
    analysis: raw.analysis,
    requirementsSource: raw.requirementsSource,
    target: raw.target,
    project: raw.project,
    evidenceBoundary: raw.evidenceBoundary,
    scope: raw.scope,
    revision: raw.revision,
    id: raw.id,
    schemaVersion: raw.schemaVersion,
  };
  const first = canonicalizeMechanicalProofCaseSource(shuffled);
  const second = canonicalizeMechanicalProofCaseSource(JSON.parse(first.text));
  assertEquals(second.text, first.text);
  assertEquals(second.source.id, "bracket-br01-static");
});

Deno.test("mechanical-proof-case-source refuses authorization, solver, provider, expectedCadArtifact, fingerprint and extra keys", () => {
  for (
    const [key, value] of [
      ["authorization", { workItemId: "w", decisionId: "d" }],
      ["solver", { provider: "calculix" }],
      ["provider", "calculix"],
      ["expectedCadArtifact", { format: "step", sha256: "a".repeat(64), bytes: 1 }],
      ["fingerprint", "a".repeat(64)],
      ["runtime", "latest"],
    ] as const
  ) {
    const input = mechanicalProofCaseSourceFixture({ [key]: value });
    assertThrows(
      () => validateMechanicalProofCaseSource(input),
      TypeError,
      "unsupported field",
    );
  }
  assertThrows(
    () =>
      validateMechanicalProofCaseSource(
        mechanicalProofCaseSourceFixture({ extra: true }),
      ),
    TypeError,
    "unsupported field extra",
  );
});

Deno.test("mechanical-proof-case-source refuses baseThreadSnapshot, requirementsSource.provider and cadSource", () => {
  const withSnapshot = mechanicalProofCaseSourceFixture();
  (withSnapshot.project as Record<string, unknown>).baseThreadSnapshot = {
    id: "snap",
    revision: 1,
    subjectId: "project:bracket-br01",
  };
  assertThrows(
    () => validateMechanicalProofCaseSource(withSnapshot),
    TypeError,
    "unsupported field",
  );
  const withProvider = mechanicalProofCaseSourceFixture();
  (withProvider.requirementsSource as Record<string, unknown>).provider = "syson";
  assertThrows(
    () => validateMechanicalProofCaseSource(withProvider),
    TypeError,
    "unsupported field",
  );
  assertThrows(
    () =>
      validateMechanicalProofCaseSource(
        mechanicalProofCaseSourceFixture({
          cadSource: { kind: "parametric" },
        }),
      ),
    TypeError,
    "unsupported field cadSource",
  );
});

Deno.test("mechanical-proof-case-source refuses a max-length id that cannot derive both seal identities", () => {
  const id = "a".repeat(256);
  assertEquals(safeId(id, "$id"), id);
  assertThrows(
    () =>
      validateMechanicalProofCaseSource(
        mechanicalProofCaseSourceFixture({ id }),
      ),
    TypeError,
    "authorization.workItemId",
  );
  const source = validateMechanicalProofCaseSource(
    mechanicalProofCaseSourceFixture(),
  );
  assertEquals(source.id, "bracket-br01-static");
  assertEquals(mechanicalProofSealIdentities(source), {
    workItemId: "wi-proof-seal-bracket-br01-static-r1",
    decisionId: "dec-proof-seal-bracket-br01-static-r1",
  });
});

Deno.test("server compilation fills Thread, CAD, solver and derived work/decision identities", () => {
  const source = validateMechanicalProofCaseSource(
    JSON.parse(mechanicalProofCaseSourceText()),
  );
  const compiled = compileMechanicalProofCase({
    source,
    baseThreadSnapshot: {
      id: "snap-br01",
      revision: 4,
      subjectId: "project:bracket-br01",
    },
    cadSource: parametricCadSourceFromPartScript({
      sha256: "b".repeat(64),
      bytes: 80,
    }),
    expectedCadArtifact: {
      format: "step",
      sha256: "c".repeat(64),
      bytes: 1234,
    },
  });
  assertEquals(compiled.schemaVersion, "mechanical-proof-case/1.0");
  assertEquals(compiled.project.baseThreadSnapshot.revision, 4);
  assertEquals(compiled.solver.provider, "calculix");
  assertEquals(compiled.requirementsSource.provider, "syson");
  assertEquals(compiled.authorization, mechanicalProofSealIdentities(source));
  assertEquals(
    compiled.authorization.workItemId,
    "wi-proof-seal-bracket-br01-static-r1",
  );
  assertEquals(compiled.expectedCadArtifact.bytes, 1234);
  assertEquals(compiled.cadSource.kind, "parametric");
});
