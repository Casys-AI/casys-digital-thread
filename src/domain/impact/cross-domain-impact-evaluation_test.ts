import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  CROSS_DOMAIN_IMPACT_GATE_CLAIM_STATUSES,
  evaluateCrossDomainImpact,
  validateCrossDomainImpactEvaluation,
} from "./cross-domain-impact-evaluation.ts";
import { createCrossDomainImpactManifest } from "./cross-domain-impact-manifest.ts";
import {
  documentDefinedCrossDomainImpactManifestBody,
  impactFingerprint,
  motionDeclaredCrossDomainImpactManifestBody,
  validCrossDomainImpactEvaluationInput,
  validCrossDomainImpactManifestBody,
} from "../../testing/cross-domain-impact-fixtures.ts";

Deno.test("cross-domain impact transitions invalidate dependent branches and carry exact mechanics", async () => {
  const result = await evaluateCrossDomainImpact(
    await validCrossDomainImpactEvaluationInput(),
  );

  assertEquals(result.branches, [
    { branchId: "electrical", status: "invalidated" },
    { branchId: "mechanical", status: "carried-forward" },
    { branchId: "thermal", status: "invalidated" },
  ]);
  assertEquals(await validateCrossDomainImpactEvaluation(result), result);
});

Deno.test("no mechanical edge is not an independence assertion", async () => {
  const input = await validCrossDomainImpactEvaluationInput();
  const body = validCrossDomainImpactManifestBody();
  body.independenceAssertions = [];
  const manifest = await createCrossDomainImpactManifest(body);

  const result = await evaluateCrossDomainImpact({
    ...input,
    manifest,
    project: manifest.project,
    subject: manifest.subject,
    basis: manifest.basis,
  });
  assertEquals(
    result.branches.find((item) => item.branchId === "mechanical")?.status,
    "impact-unresolved",
  );
});

Deno.test("unavailable mechanical evidence is explicit and never carried forward", async () => {
  const input = await validCrossDomainImpactEvaluationInput();
  const result = await evaluateCrossDomainImpact({
    ...input,
    mechanicalEvidence: null,
  });

  assertEquals(
    result.branches.find((item) => item.branchId === "mechanical")?.status,
    "impact-unresolved",
  );
});

Deno.test("a stale or mismatched human independence assertion never carries mechanics forward", async () => {
  const input = await validCrossDomainImpactEvaluationInput();
  const staleBody = validCrossDomainImpactManifestBody();
  staleBody.independenceAssertions[0]!.review.expiresAt = "2026-08-21T09:00:00.000Z";
  const staleManifest = await createCrossDomainImpactManifest(staleBody);
  const stale = await evaluateCrossDomainImpact({
    ...input,
    manifest: staleManifest,
    project: staleManifest.project,
    subject: staleManifest.subject,
    basis: staleManifest.basis,
  });
  assertEquals(
    stale.branches.find((item) => item.branchId === "mechanical")?.status,
    "impact-unresolved",
  );

  const mismatched = await evaluateCrossDomainImpact({
    ...input,
    reviewTrigger: { id: "other-review-trigger", fingerprint: impactFingerprint("d") },
  });
  assertEquals(
    mismatched.branches.find((item) => item.branchId === "mechanical")?.status,
    "impact-unresolved",
  );
});

Deno.test("a replaced FEA input never carries mechanics forward", async () => {
  const input = await validCrossDomainImpactEvaluationInput();
  const mechanicalEvidence = input.mechanicalEvidence!;
  const replaced = {
    ...input,
    mechanicalEvidence: {
      ...mechanicalEvidence,
      consumptions: mechanicalEvidence.consumptions.map((consumption) => ({
        ...consumption,
        input: {
          id: "mechanical-step-input",
          fingerprint: impactFingerprint("f"),
        },
      })),
    },
  };

  const result = await evaluateCrossDomainImpact(replaced);
  assertEquals(
    result.branches.find((item) => item.branchId === "mechanical")?.status,
    "impact-unresolved",
  );
});

Deno.test("dependent branches require exact current methods and joins before invalidation", async () => {
  const input = await validCrossDomainImpactEvaluationInput();
  const unavailable = {
    ...input,
    branchReadiness: input.branchReadiness.map((readiness) => {
      if (readiness.branchId === "electrical") {
        return { ...readiness, method: { ...readiness.method, available: false } };
      }
      if (readiness.branchId === "thermal") {
        return {
          ...readiness,
          joins: readiness.joins.map((join) => ({ ...join, current: false })),
        };
      }
      return readiness;
    }),
  };

  const result = await evaluateCrossDomainImpact(unavailable);
  assertEquals(result.branches, [
    { branchId: "electrical", status: "impact-unresolved" },
    { branchId: "mechanical", status: "carried-forward" },
    { branchId: "thermal", status: "impact-unresolved" },
  ]);
});

Deno.test("an unavailable electrical method does not hide the independent thermal invalidation", async () => {
  const input = await validCrossDomainImpactEvaluationInput();
  const result = await evaluateCrossDomainImpact({
    ...input,
    branchReadiness: input.branchReadiness.map((readiness) =>
      readiness.branchId === "electrical"
        ? { ...readiness, method: { ...readiness.method, available: false } }
        : readiness
    ),
  });
  assertEquals(result.branches, [
    { branchId: "electrical", status: "impact-unresolved" },
    { branchId: "mechanical", status: "carried-forward" },
    { branchId: "thermal", status: "invalidated" },
  ]);
});

Deno.test("cross-domain evaluation exposes only the canonical gate claim status vocabulary", async () => {
  const result = await evaluateCrossDomainImpact(
    await validCrossDomainImpactEvaluationInput(),
  );
  for (const item of [...result.branches, ...result.gateClaims]) {
    assert(CROSS_DOMAIN_IMPACT_GATE_CLAIM_STATUSES.includes(item.status));
  }

  const forged = structuredClone(result) as unknown as Record<string, unknown>;
  const branches = forged.branches as Array<Record<string, unknown>>;
  branches[0]!.status = "pass";
  await assertRejects(
    () => validateCrossDomainImpactEvaluation(forged),
    TypeError,
    "impact-unresolved",
  );
});

Deno.test("cross-domain evaluation recrosses a document-defined non-lamp change kind", async () => {
  const manifest = await createCrossDomainImpactManifest(
    documentDefinedCrossDomainImpactManifestBody(),
  );
  const mass = manifest.sourceAnchors.find((item) => item.id === "anchor-mass-change")!;
  const input = await validCrossDomainImpactEvaluationInput();
  const result = await evaluateCrossDomainImpact({
    ...input,
    manifest,
    project: manifest.project,
    subject: manifest.subject,
    basis: manifest.basis,
    changedSources: [{
      sourceAnchorId: mass.id,
      changeKind: mass.changeKind,
      threadChange: mass.threadChange,
      source: mass.source,
    }],
  });

  assertEquals(result.branches, [
    { branchId: "electrical", status: "invalidated" },
    { branchId: "mechanical", status: "carried-forward" },
    { branchId: "thermal", status: "invalidated" },
  ]);
  assertEquals(await validateCrossDomainImpactEvaluation(result), result);
  assertEquals(
    result.changedSources.map((item) => item.changeKind),
    ["mass-change"],
  );
});

Deno.test("a declared motion branch uses the generic nonmechanical policy", async () => {
  const body = motionDeclaredCrossDomainImpactManifestBody();
  const manifest = await createCrossDomainImpactManifest(body);
  const input = await validCrossDomainImpactEvaluationInput();
  const readiness = manifest.branches.map((branch) => ({
    branchId: branch.id,
    method: { reference: branch.method, available: true },
    joins: branch.joins.map((join) => ({ reference: join, current: true })),
  }));

  const withoutEdge = await evaluateCrossDomainImpact({
    ...input,
    manifest,
    project: manifest.project,
    subject: manifest.subject,
    basis: manifest.basis,
    branchReadiness: readiness,
  });
  assertEquals(
    withoutEdge.branches.find((item) => item.branchId === "motion")?.status,
    "impact-unresolved",
  );
  assertEquals(
    withoutEdge.branches.find((item) => item.branchId === "mechanical")?.status,
    "carried-forward",
  );

  const motion = manifest.branches.find((item) => item.id === "motion")!;
  body.causalEdges.push({
    id: "edge-power-motion",
    fromAnchorId: "anchor-electrical-power",
    to: {
      branchId: "motion",
      inputId: motion.inputs[0]!.id,
      inputFingerprint: motion.inputs[0]!.fingerprint,
    },
    relation: "positive-input",
    assertion: {
      source: { id: "source-power-motion", fingerprint: impactFingerprint("c") },
      justification: "Reviewed source states the exact branch input relation.",
    },
    scope: "Exact manifest basis only.",
    evidence: [{ id: "source-power-motion", fingerprint: impactFingerprint("c") }],
  });
  const edged = await createCrossDomainImpactManifest(body);
  const withEdge = await evaluateCrossDomainImpact({
    ...input,
    manifest: edged,
    project: edged.project,
    subject: edged.subject,
    basis: edged.basis,
    branchReadiness: edged.branches.map((branch) => ({
      branchId: branch.id,
      method: { reference: branch.method, available: true },
      joins: branch.joins.map((join) => ({ reference: join, current: true })),
    })),
  });
  assertEquals(
    withEdge.branches.find((item) => item.branchId === "motion")?.status,
    "invalidated",
  );
  assertEquals(withEdge.branches.map((item) => item.branchId), [
    "electrical",
    "mechanical",
    "motion",
    "thermal",
  ]);
});

Deno.test("evaluation readiness must equal the declared manifest branch set in both directions", async () => {
  const input = await validCrossDomainImpactEvaluationInput();
  const extra = {
    ...input,
    branchReadiness: [
      ...input.branchReadiness,
      {
        branchId: "motion",
        method: {
          reference: { id: "motion-method", fingerprint: impactFingerprint("a") },
          available: true,
        },
        joins: [{
          reference: { id: "motion-join", fingerprint: impactFingerprint("b") },
          current: true,
        }],
      },
    ],
  };
  await assertRejects(
    () => evaluateCrossDomainImpact(extra),
    TypeError,
    "sealed manifest branch set",
  );

  const missing = {
    ...input,
    branchReadiness: input.branchReadiness.filter((item) =>
      item.branchId !== "thermal"
    ),
  };
  await assertRejects(
    () => evaluateCrossDomainImpact(missing),
    TypeError,
    "sealed manifest branch set",
  );
});

Deno.test("evaluation body validation rejects extra or missing branches", async () => {
  const result = await evaluateCrossDomainImpact(
    await validCrossDomainImpactEvaluationInput(),
  );
  const extra = structuredClone(result) as unknown as Record<string, unknown>;
  const branches = extra.branches as Array<Record<string, unknown>>;
  branches.push({ branchId: "motion", status: "impact-unresolved" });
  await assertRejects(
    () => validateCrossDomainImpactEvaluation(extra),
    TypeError,
    "sealed manifest branch set",
  );

  const missing = structuredClone(result) as unknown as Record<string, unknown>;
  (missing.branches as Array<Record<string, unknown>>).pop();
  await assertRejects(
    () => validateCrossDomainImpactEvaluation(missing),
    TypeError,
    "sealed manifest branch set",
  );
});
