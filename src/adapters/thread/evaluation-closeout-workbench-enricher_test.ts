import { assertEquals } from "@std/assert";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ThreadWorkbenchSnapshot } from "../../presentation/workbench/thread/snapshot.ts";
import {
  canonicalStaticMechanicalEvaluationCloseoutCaptureText,
  EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX,
  validateStaticMechanicalEvaluationCloseoutCapture,
} from "../fea/evaluation-closeout/static-mechanical-evaluation-closeout-capture.ts";
import { enrichThreadWorkbenchWithEvaluationCloseouts } from "./evaluation-closeout-workbench-enricher.ts";

const DIGESTS = ["a", "b", "c", "d", "e"].map((value) => value.repeat(64));

Deno.test("Workbench projects an exact, read-only current static-mechanical L5 closeout", async () => {
  const fixture = await workbenchFixture();
  const enriched = await enrichThreadWorkbenchWithEvaluationCloseouts(
    fixture.snapshot,
    {
      read: (fingerprint) =>
        Promise.resolve(
          fingerprint.digest === fixture.digest ? fixture.text : undefined,
        ),
    },
  );
  const index = enriched.evaluationCloseouts!;
  const card = index.cards[0]!;
  assertEquals(index.status, "current");
  assertEquals(card.status, "current");
  assertEquals(card.humanDisposition, "accept");
  assertEquals(card.acceptanceEligibility, true);
  assertEquals(card.basis, {
    snapshotId: "fea-result-thread",
    revision: 7,
    fingerprint: `sha256:${DIGESTS[0]}`,
  });
  assertEquals(card.criteria.map((criterion) => criterion.status), ["pass"]);
  assertEquals(card.proofLimitations.cadEngineeringBoundary.limitations, [
    "boundary-a",
    "boundary-b",
  ]);
  assertEquals(card.evidence.canonicalStep, {
    id: "canonical-step",
    fingerprint: `sha256:${DIGESTS[1]}`,
    producerRunId: "run-cad",
    freshness: "fresh",
  });
  assertEquals(JSON.stringify(index).includes("command"), false);
  assertEquals(JSON.stringify(index).includes("mcp"), false);
});

Deno.test("Workbench keeps a prior closeout historical after a later Thread successor", async () => {
  const fixture = await workbenchFixture();
  const later = {
    ...fixture.snapshot,
    id: "later-thread",
    previous: { snapshotId: fixture.snapshot.id, revision: 8 },
  } as ThreadWorkbenchSnapshot;
  const enriched = await enrichThreadWorkbenchWithEvaluationCloseouts(
    later,
    {
      read: (fingerprint) =>
        Promise.resolve(
          fingerprint.digest === fixture.digest ? fixture.text : undefined,
        ),
    },
  );
  assertEquals(enriched.evaluationCloseouts?.status, "historical");
  assertEquals(enriched.evaluationCloseouts?.cards[0]?.status, "historical");
});

async function workbenchFixture() {
  const [basis, step, proof, execution, evaluation] = DIGESTS;
  const capture = validateStaticMechanicalEvaluationCloseoutCapture({
    schemaVersion: "evaluation-closeout-capture/1.0",
    kind: "static-mechanical-evaluation-closeout",
    operation: { id: "decide.accept-evaluation-closeout", version: "1" },
    trustedRunId: "run-closeout",
    decisionId: "decision-closeout",
    sealedAt: "2026-08-22T00:00:00.000Z",
    admission: {
      schemaVersion: "evaluation-closeout-admission/1.0",
      family: "static-mechanical",
      consequence: "accept",
      rejectionDisposition: "none",
      projectId: "project-static",
      subjectId: "subject-static",
      basis: {
        snapshotId: "fea-result-thread",
        revision: 7,
        fingerprint: { algorithm: "sha256", digest: basis! },
      },
      canonicalStep: identity("canonical-step", step!, "run-cad"),
      sealedProof: identity("sealed-proof", proof!, "run-proof"),
      executionEvidence: identity("execution-evidence", execution!, "run-fea"),
      evaluationCapture: identity("evaluation-capture", evaluation!, "run-fea"),
      criteria: [{
        proofCriterionId: "criterion-displacement",
        evaluationId: "evaluation-displacement",
        status: "pass",
        evidenceArtifactId: "evaluation-capture",
      }],
      proofLimitations: {
        proofScope: "recorded-static-scope",
        evidenceBoundary: "sealed-local-evidence-only",
        cadEngineeringBoundary: {
          designIntent: "partial",
          editableCad: "reconstructed",
          manufacturability: "not-established",
          limitations: ["boundary-a", "boundary-b"],
        },
      },
      limits: {
        engineCalls: "none",
        sysonCalls: "none",
        l4PassIsNotL5: true,
        rejectionGrants: "none",
      },
    },
    inputs: {
      canonicalStep: identity("canonical-step", step!, "run-cad"),
      sealedProof: identity("sealed-proof", proof!, "run-proof"),
      executionEvidence: identity("execution-evidence", execution!, "run-fea"),
      evaluationCapture: identity("evaluation-capture", evaluation!, "run-fea"),
    },
    proofLimitations: {
      proofScope: "recorded-static-scope",
      evidenceBoundary: "sealed-local-evidence-only",
      cadEngineeringBoundary: {
        designIntent: "partial",
        editableCad: "reconstructed",
        manufacturability: "not-established",
        limitations: ["boundary-a", "boundary-b"],
      },
    },
    limits: {
      engineCalls: "none",
      sysonCalls: "none",
      l4PassIsNotL5: true,
      rejectionGrants: "none",
    },
  });
  const text = canonicalStaticMechanicalEvaluationCloseoutCaptureText(capture);
  const digest = (await sha256Fingerprint(capture)).digest;
  const snapshot = {
    id: "closeout-thread",
    previous: { snapshotId: "fea-result-thread", revision: 7 },
    artifacts: [
      artifact("canonical-step", step!, "run-cad", "design.write-geometry@1", "step"),
      artifact(
        "sealed-proof",
        proof!,
        "run-proof",
        "verify.seal-proof-case@1",
        "document",
      ),
      artifact(
        "execution-evidence",
        execution!,
        "run-fea",
        "verify.run-fea-static-proof@3",
        "evidence",
      ),
      artifact(
        "evaluation-capture",
        evaluation!,
        "run-fea",
        "verify.run-fea-static-proof@3",
        "evidence",
      ),
      {
        ...artifact(
          `evaluation-closeout-${digest}`,
          digest,
          "run-closeout",
          "decide.accept-evaluation-closeout@1",
          "document",
        ),
        uri: `${EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX}sha256/${digest}`,
        dependsOn: [
          "canonical-step",
          "sealed-proof",
          "execution-evidence",
          "evaluation-capture",
        ],
      },
    ],
  } as unknown as ThreadWorkbenchSnapshot;
  return { snapshot, text, digest };
}

function identity(id: string, digest: string, producerRunId: string) {
  return {
    id,
    fingerprint: { algorithm: "sha256" as const, digest },
    producerRunId,
  };
}

function artifact(
  id: string,
  digest: string,
  producerRunId: string,
  producedBy: string,
  kind: string,
) {
  return {
    id,
    label: id,
    kind,
    system: "digital-thread",
    revision: digest,
    freshness: "fresh" as const,
    fingerprint: `sha256:${digest}`,
    uri: `casys://fixture/sha256/${digest}`,
    producedBy,
    producerRunId,
    dependsOn: [],
  };
}
