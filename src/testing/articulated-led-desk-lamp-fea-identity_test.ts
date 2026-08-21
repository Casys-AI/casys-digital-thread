import { assertEquals } from "@std/assert";
import { ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID } from "./articulated-led-desk-lamp-brief-fixture.ts";
import { selectUniqueCataloguedProofCase } from "../domain/fea/seal-case/fea-proof-case-catalog.ts";
import { resolveFeaProofSealThreadBindings } from "../domain/fea/seal-case/fea-proof-seal-bindings.ts";
import { validateMechanicalProofCase } from "../domain/fea/seal-case/mechanical-proof-case.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../domain/thread/thread-snapshot.ts";

Deno.test(
  "fresh lamp catalog selection stays absent for historical desk-lamp and CA02 cases",
  () => {
    const selected = selectUniqueCataloguedProofCase(
      ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      [
        {
          caseId: "desk-lamp-dl05-arm-cantilever",
          projectId: "desk-lamp-dl05",
        },
        {
          caseId: "desk-lamp-dl04-arm-cantilever",
          projectId: "desk-lamp-dl04",
        },
        {
          caseId: "cantilever-arm-ca02",
          projectId: "cantilever-arm-ca02",
        },
      ],
    );
    assertEquals(selected.status, "unresolved");
    if (selected.status !== "unresolved") return;
    assertEquals(selected.code, "catalog-absent");
    assertEquals(selected.caseIds, []);
  },
);

Deno.test(
  "fresh lamp proof seal refuses a historical dl05 case instead of joining by label",
  async () => {
    const raw = JSON.parse(
      await Deno.readTextFile(
        "config/mechanical-proof-cases/desk-lamp-dl05-arm-cantilever.json",
      ),
    );
    const proofCase = validateMechanicalProofCase(raw);
    const requirements = requirementsArtifact();
    const result = resolveFeaProofSealThreadBindings(
      lampSnapshot(requirements),
      proofCase,
      ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      requirements,
    );
    assertEquals(result.status, "unresolved");
    if (result.status !== "unresolved") return;
    const codes = result.diagnostics.map((item) => item.code);
    assertEquals(codes.includes("project-mismatch"), true);
    assertEquals(codes.includes("subject-mismatch"), true);
    assertEquals(proofCase.project.id, "desk-lamp-dl05");
  },
);

function lampSnapshot(requirements: ThreadArtifact): ThreadSnapshot {
  const now = "2026-08-21T12:00:00.000Z";
  return {
    schemaVersion: "1.0",
    id: `${ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: now,
    subject: {
      id: ARTICULATED_LED_DESK_LAMP_FIXTURE_PROJECT_ID,
      name: "Articulated LED desk lamp",
      kind: "system",
      version: "r1",
      modelArtifactId: requirements.id,
    },
    freshness: {
      status: "fresh",
      changedAt: now,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "lamp-r1",
      name: "Fresh lamp",
      status: "applied",
      createdAt: now,
      appliedAt: now,
      changes: [],
    },
    artifacts: [requirements],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}

function requirementsArtifact(): ThreadArtifact {
  return {
    id: "lamp-requirements-placeholder",
    name: "Lamp requirements",
    kind: "sysml-model",
    version: "1",
    fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    producer: {
      serverId: "syson",
      tool: "model.write-requirements",
      runId: "run:placeholder",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-21T12:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}
