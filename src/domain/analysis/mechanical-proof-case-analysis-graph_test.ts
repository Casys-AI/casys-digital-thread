import { assert, assertEquals, assertThrows } from "@std/assert";
import { deterministicJson } from "../kernel/deterministic-json.ts";
import { validateMechanicalProofCase } from "./mechanical-proof-case.ts";
import { buildMechanicalProofCaseAnalysisGraph } from "./mechanical-proof-case-analysis-graph.ts";

const CASE_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "b".repeat(64),
};
const PROOF_DECLARATION_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "d".repeat(64),
};

Deno.test("mechanical proof graph records declared target inputs and requirements only", async () => {
  const proofCase = validateMechanicalProofCase(
    JSON.parse(
      await Deno.readTextFile(
        "config/mechanical-proof-cases/coffee-machine-cm01-drip-tray-v1.json",
      ),
    ),
  );
  const graph = buildMechanicalProofCaseAnalysisGraph({
    proofCase,
    proofFingerprint: PROOF_DECLARATION_FINGERPRINT,
    evidence: { id: "proof-case-seal", fingerprint: CASE_FINGERPRINT },
  });

  const structural = graph.relations.filter((relation) =>
    relation.assertion.relation === "structural-incidence"
  );
  const declaredRequirements = graph.relations.filter((relation) =>
    relation.assertion.relation === "declared-dependency"
  );
  assertEquals(
    structural.length,
    3 + proofCase.analysis.loads.length * 3 + proofCase.analysis.supports.length +
      proofCase.requirements.length,
  );
  assertEquals(declaredRequirements.length, proofCase.requirements.length);
  assertEquals(
    graph.nodes.find((node) => node.kind === "component")?.semanticRef,
    {
      domain: "sysml",
      kind: "component",
      id: proofCase.target.modelElementId,
    },
  );

  for (const relation of graph.relations) {
    assertEquals(relation.assertion.epistemicBasis, "declared");
    assertEquals(relation.assertion.evidence, [{
      id: "proof-case-seal",
      fingerprint: CASE_FINGERPRINT,
    }]);
    assertEquals(relation.assertion.scope, {
      kind: "basis",
      basisFingerprint: PROOF_DECLARATION_FINGERPRINT,
    });
  }
  assert(
    !graph.relations.some((relation) =>
      relation.assertion.from.kind === "parameter" &&
      relation.assertion.to.kind === "metric"
    ),
  );
  assertEquals(
    graph.nodes.filter((node) => node.kind === "fixed-support").length,
    proofCase.analysis.supports.length,
  );
});

Deno.test("mechanical proof graph is deterministic for a reordered declaration", async () => {
  const source = JSON.parse(
    await Deno.readTextFile(
      "config/mechanical-proof-cases/coffee-machine-cm01-drip-tray-v1.json",
    ),
  ) as Record<string, unknown>;
  const proofCase = validateMechanicalProofCase(source);
  const reordered = validateMechanicalProofCase({
    ...source,
    requirements: [...(source.requirements as unknown[])].reverse(),
  });
  const evidence = { id: "proof-case-seal", fingerprint: CASE_FINGERPRINT };

  assertEquals(
    deterministicJson(
      buildMechanicalProofCaseAnalysisGraph({
        proofCase,
        proofFingerprint: PROOF_DECLARATION_FINGERPRINT,
        evidence,
      }),
    ),
    deterministicJson(
      buildMechanicalProofCaseAnalysisGraph({
        proofCase: reordered,
        proofFingerprint: PROOF_DECLARATION_FINGERPRINT,
        evidence,
      }),
    ),
  );
});

Deno.test("mechanical proof graph rejects an evidence artifact without an exact fingerprint", async () => {
  const proofCase = validateMechanicalProofCase(
    JSON.parse(
      await Deno.readTextFile(
        "config/mechanical-proof-cases/coffee-machine-cm01-drip-tray-v1.json",
      ),
    ),
  );
  assertThrows(
    () =>
      buildMechanicalProofCaseAnalysisGraph({
        proofCase,
        proofFingerprint: PROOF_DECLARATION_FINGERPRINT,
        evidence: {
          id: "proof-case-seal",
          fingerprint: { algorithm: "sha256", digest: "not-a-fingerprint" },
        },
      }),
    TypeError,
    "lowercase SHA-256",
  );
});

Deno.test("mechanical proof nodes remain stable across seal occurrences while assertion evidence stays distinct", async () => {
  const proofCase = validateMechanicalProofCase(
    JSON.parse(
      await Deno.readTextFile(
        "config/mechanical-proof-cases/coffee-machine-cm01-drip-tray-v1.json",
      ),
    ),
  );
  const first = buildMechanicalProofCaseAnalysisGraph({
    proofCase,
    proofFingerprint: PROOF_DECLARATION_FINGERPRINT,
    evidence: { id: "seal-1", fingerprint: CASE_FINGERPRINT },
  });
  const secondFingerprint = {
    algorithm: "sha256" as const,
    digest: "e".repeat(64),
  };
  const second = buildMechanicalProofCaseAnalysisGraph({
    proofCase,
    proofFingerprint: PROOF_DECLARATION_FINGERPRINT,
    evidence: { id: "seal-2", fingerprint: secondFingerprint },
  });

  assertEquals(first.nodes, second.nodes);
  assertEquals(
    first.relations.map((relation) => relation.assertion.id).some((id) =>
      second.relations.some((relation) => relation.assertion.id === id)
    ),
    false,
  );
  assertEquals(
    first.relations[0]?.assertion.evidence[0]?.fingerprint,
    CASE_FINGERPRINT,
  );
  assertEquals(
    second.relations[0]?.assertion.evidence[0]?.fingerprint,
    secondFingerprint,
  );
});
