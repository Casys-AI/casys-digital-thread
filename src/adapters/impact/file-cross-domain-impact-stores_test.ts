import { assertEquals, assertRejects } from "@std/assert";
import {
  CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA,
  crossDomainImpactManifestUri,
} from "../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import {
  CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_SCHEMA,
  validateCrossDomainImpactManifestSealCapture,
} from "../../domain/impact/cross-domain-impact-manifest-seal-capture.ts";
import {
  CROSS_DOMAIN_IMPACT_EVALUATION_CAPTURE_SCHEMA,
  validateCrossDomainImpactEvaluationCapture,
} from "../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import { evaluateCrossDomainImpact } from "../../domain/impact/cross-domain-impact-evaluation.ts";
import { ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION } from "../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import {
  impactFingerprint,
  validCrossDomainImpactEvaluationInput,
  validCrossDomainImpactManifest,
} from "../../testing/cross-domain-impact-fixtures.ts";
import { evaluateMechanicalPreservation } from "../../domain/impact/cross-domain-impact-mechanical-preservation.ts";
import { validateMechanicalPreservationCapture } from "../../domain/impact/cross-domain-impact-mechanical-preservation-capture.ts";
import {
  ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION,
  MECHANICAL_PRESERVATION_LIMITS,
} from "../../domain/impact/cross-domain-impact-mechanical-preservation-proposal.ts";
import { validMechanicalPreservationInput } from "../../testing/mechanical-preservation-fixtures.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import { FileCrossDomainImpactEvaluationCaptureStore } from "./file-cross-domain-impact-evaluation-capture-store.ts";
import { FileMechanicalPreservationCaptureStore } from "./file-cross-domain-impact-mechanical-preservation-capture-store.ts";
import { FileCrossDomainImpactManifestSealCaptureStore } from "./file-cross-domain-impact-manifest-seal-capture-store.ts";
import { FileCrossDomainImpactManifestStore } from "./file-cross-domain-impact-manifest-store.ts";

Deno.test("impact manifest and seal capture readers reopen only their closed content address", async () => {
  const root = await Deno.makeTempDir({ prefix: "impact-store-" });
  try {
    const manifestsRaw = new FileCaptureStore({
      kind: "cross-domain-impact-manifest" as const,
      directory: `${root}/manifests`,
      uriNamespace: "cross-domain-impact-manifest",
      label: "Test impact manifest",
    });
    const manifests = new FileCrossDomainImpactManifestStore(manifestsRaw);
    const manifest = await validCrossDomainImpactManifest();
    const saved = await manifests.save(manifest);
    assertEquals(Object.keys(saved).sort(), ["reference"]);
    assertEquals(Object.keys(saved.reference), ["fingerprint"]);
    const reopened = await manifests.read(saved.reference);
    assertEquals(reopened?.reference, saved.reference);
    assertEquals(reopened?.manifest.fingerprint, manifest.fingerprint);
    assertEquals("uri" in saved, false);

    const captureRaw = new FileCaptureStore({
      kind: "cross-domain-impact-manifest-seal-capture" as const,
      directory: `${root}/seals`,
      uriNamespace: "cross-domain-impact-manifest-seal-capture",
      label: "Test impact seal",
    });
    const captures = new FileCrossDomainImpactManifestSealCaptureStore(captureRaw);
    const capture = validateCrossDomainImpactManifestSealCapture({
      schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_CAPTURE_SCHEMA,
      kind: "cross-domain-impact-manifest-seal",
      operation: { id: "verify.seal-cross-domain-impact-manifest", version: "2" },
      trustedRunId: "run.impact.store",
      decisionId: "decision.impact.store",
      sealedAt: "2026-08-22T09:00:00.000Z",
      admission: await admissionFixture(manifest, saved.reference.fingerprint),
    });
    const storedCapture = await captures.save(capture);
    const reopenedCapture = await captures.read(storedCapture.fingerprint);
    assertEquals(reopenedCapture?.trustedRunId, capture.trustedRunId);

    await Deno.writeTextFile(
      manifestsRaw.pathFor(saved.reference.fingerprint),
      '{"forged":true}',
    );
    await assertRejects(() => manifests.read(saved.reference));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("impact evaluation capture store preserves the exact server-reread artifact set", async () => {
  const root = await Deno.makeTempDir({ prefix: "impact-evaluation-store-" });
  try {
    const raw = new FileCaptureStore({
      kind: "cross-domain-impact-evaluation-capture" as const,
      directory: `${root}/evaluations`,
      uriNamespace: "cross-domain-impact-evaluation-capture",
      label: "Test impact evaluation",
    });
    const captures = new FileCrossDomainImpactEvaluationCaptureStore(raw);
    const capture = await evaluationCaptureFixture();
    const stored = await captures.save(capture);
    const reopened = await captures.read(stored.fingerprint);
    assertEquals(reopened?.artifactInputs, capture.artifactInputs);
    assertEquals(
      stored.uri,
      `casys://cross-domain-impact-evaluation-capture/sha256/${stored.fingerprint.digest}`,
    );

    const forged = structuredClone(capture) as unknown as { artifactInputs: unknown[] };
    forged.artifactInputs = forged.artifactInputs.filter((item) =>
      (item as { id: string }).id !== "mechanical-step-input"
    );
    await assertRejects(
      () => validateCrossDomainImpactEvaluationCapture(forged),
      TypeError,
      "artifactInputs",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("mechanical preservation capture store reopens only its closed content address", async () => {
  const root = await Deno.makeTempDir({ prefix: "impact-preservation-store-" });
  try {
    const raw = new FileCaptureStore({
      kind: "cross-domain-impact-mechanical-preservation-capture" as const,
      directory: `${root}/preservations`,
      uriNamespace: "cross-domain-impact-mechanical-preservation-capture",
      label: "Test mechanical preservation",
    });
    const store = new FileMechanicalPreservationCaptureStore(raw);
    const input = await validMechanicalPreservationInput();
    const preservation = await evaluateMechanicalPreservation(input);
    const decision = {
      id: "impact-decision-document",
      fingerprint: impactFingerprint("4"),
    };
    const evaluationDoc = {
      id: "impact-evaluation-document",
      fingerprint: impactFingerprint("5"),
    };
    const manifestSeal = {
      id: "manifest-seal-document",
      fingerprint: impactFingerprint("9"),
    };
    const artifactInputs = [
      decision,
      evaluationDoc,
      manifestSeal,
      {
        id: preservation.feaEvidence!.execution.id,
        fingerprint: preservation.feaEvidence!.execution.fingerprint,
      },
      {
        id: preservation.feaEvidence!.sealedProof.id,
        fingerprint: preservation.feaEvidence!.sealedProof.fingerprint,
      },
      {
        id: preservation.feaEvidence!.canonicalStep.id,
        fingerprint: preservation.feaEvidence!.canonicalStep.fingerprint,
      },
      {
        id: preservation.feaEvidence!.l4Evaluation.id,
        fingerprint: preservation.feaEvidence!.l4Evaluation.fingerprint,
      },
      preservation.closeout!.artifact,
    ].sort((left, right) =>
      `${left.id}:${left.fingerprint.digest}`.localeCompare(
        `${right.id}:${right.fingerprint.digest}`,
      )
    );
    const capture = await validateMechanicalPreservationCapture({
      schemaVersion: "cross-domain-impact-mechanical-preservation-capture/2.0",
      kind: "cross-domain-impact-mechanical-preservation",
      operation: ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION,
      trustedRunId: "run-mechanical-preservation",
      evaluatedAt: "2026-08-22T09:00:00.000Z",
      decision: { artifact: decision, trustedRunId: "run-impact-decision" },
      evaluation: {
        artifact: evaluationDoc,
        trustedRunId: "run-impact-evaluation",
      },
      manifestSeal: { artifact: manifestSeal, trustedRunId: "run-manifest-seal" },
      artifactInputs,
      manifest: {
        id: preservation.manifest.id,
        fingerprint: preservation.manifest.fingerprint,
        reference: impactFingerprint("8"),
      },
      brief: {
        id: "brief-mechanical-preservation",
        revision: 2,
        fingerprint: impactFingerprint("7"),
        gates: input.evaluation.gateClaims.map((claim, index) => ({
          gateItemId: claim.gateItemId,
          kind: "success-criterion" as const,
          branchId: claim.branchId,
          role: claim.role,
          fingerprint: impactFingerprint(String(index + 1)),
          dependsOnItemIds: [],
        })).sort((left, right) => left.gateItemId.localeCompare(right.gateItemId)),
      },
      preservation,
      limits: MECHANICAL_PRESERVATION_LIMITS,
    });
    const stored = await store.save(capture);
    const reopened = await store.read(stored.fingerprint);
    assertEquals(reopened?.preservation.status, "carried-forward");
    assertEquals(
      stored.uri,
      `casys://cross-domain-impact-mechanical-preservation-capture/sha256/${stored.fingerprint.digest}`,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function admissionFixture(
  manifest: Awaited<ReturnType<typeof validCrossDomainImpactManifest>>,
  reference: { readonly algorithm: "sha256"; readonly digest: string },
) {
  const verifiedReference = await sha256Fingerprint(manifest);
  assertEquals(verifiedReference, reference);
  return {
    schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA,
    manifest: {
      schemaVersion: manifest.schemaVersion,
      id: manifest.id,
      revision: manifest.revision,
      fingerprint: manifest.fingerprint,
      reference,
      uri: crossDomainImpactManifestUri(reference),
    },
    project: manifest.project,
    subject: manifest.subject,
    basis: {
      snapshotId: manifest.basis.snapshotId,
      revision: manifest.basis.revision,
      fingerprint: manifest.basis.fingerprint,
    },
    brief: {
      contractVersion: "2.0" as const,
      id: "brief.impact.store",
      revision: 2,
      fingerprint: { algorithm: "sha256" as const, digest: "f".repeat(64) },
      gates: manifest.gateMap.map((gate, index) => ({
        gateItemId: gate.gateItemId,
        kind: "success-criterion" as const,
        branchId: gate.branchId,
        role: gate.role,
        fingerprint: {
          algorithm: "sha256" as const,
          digest: `${index + 1}`.repeat(64),
        },
        dependsOnItemIds: index === 0 ? [] : ["brief.source.impact"],
      })).sort((left, right) => left.gateItemId.localeCompare(right.gateItemId)),
    },
    sourceAnchors: manifest.sourceAnchors,
    mechanicalEvidence: manifest.independenceAssertions.map((assertion) => ({
      assertionId: assertion.id,
      evidence: assertion.evidence,
      evidenceFreshness: "fresh" as const,
      consumptions: assertion.inspectedConsumptions.map((consumption) => ({
        id: consumption.id,
        consumerEvidence: assertion.evidence,
        input: consumption.input,
      })),
    })),
  };
}

async function evaluationCaptureFixture() {
  const input = await validCrossDomainImpactEvaluationInput();
  const evaluation = await evaluateCrossDomainImpact(input);
  const branchFacts = input.branchReadiness.map((branch) => ({
    branchId: branch.branchId,
    method: { reference: branch.method.reference, availability: "available" as const },
    joins: branch.joins.map((join) => ({
      reference: join.reference,
      currentness: "current" as const,
    })),
  }));
  const mechanicalEvidence = input.mechanicalEvidence!;
  const artifactInputs = [
    { id: "manifest-seal-document", fingerprint: impactFingerprint("9") },
    ...branchFacts.flatMap((
      branch,
    ) => [branch.method.reference, ...branch.joins.map((join) => join.reference)]),
    mechanicalEvidence.evidence,
    ...mechanicalEvidence.consumptions.map((item) => item.input),
  ].sort((left, right) =>
    `${left.id}:${left.fingerprint.digest}`.localeCompare(
      `${right.id}:${right.fingerprint.digest}`,
    )
  );
  return await validateCrossDomainImpactEvaluationCapture({
    schemaVersion: CROSS_DOMAIN_IMPACT_EVALUATION_CAPTURE_SCHEMA,
    kind: "cross-domain-impact-evaluation",
    operation: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
    trustedRunId: "run-impact-evaluation-store",
    evaluatedAt: input.evaluatedAt,
    manifestSeal: {
      artifact: { id: "manifest-seal-document", fingerprint: impactFingerprint("9") },
      trustedRunId: "run-manifest-seal-store",
    },
    artifactInputs,
    manifest: {
      id: evaluation.manifest.id,
      fingerprint: evaluation.manifest.fingerprint,
      reference: impactFingerprint("8"),
    },
    brief: {
      id: "brief-impact-evaluation-store",
      revision: 2,
      fingerprint: impactFingerprint("7"),
      gates: evaluation.gateClaims.map((claim, index) => ({
        gateItemId: claim.gateItemId,
        kind: "success-criterion" as const,
        branchId: claim.branchId,
        role: claim.role,
        fingerprint: impactFingerprint(String(index + 1)),
        dependsOnItemIds: [],
      })).sort((left, right) => left.gateItemId.localeCompare(right.gateItemId)),
    },
    branchFacts,
    mechanicalFact: {
      status: "current",
      assertionId: input.manifest.independenceAssertions[0]!.id,
      reviewTrigger: input.reviewTrigger,
      evidence: mechanicalEvidence.evidence,
      evidenceFreshness: "fresh",
      consumptions: mechanicalEvidence.consumptions,
    },
    evaluation,
    limits: {
      providerCalls: "none",
      solverCalls: "none",
      gateClaimTransitions: "none",
      workItemInvalidations: "none",
      rerunProposals: "none",
    },
  });
}
