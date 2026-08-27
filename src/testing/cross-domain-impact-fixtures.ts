import {
  createCrossDomainImpactManifest,
  type CrossDomainImpactManifest,
} from "../domain/impact/cross-domain-impact-manifest.ts";
import type {
  CrossDomainImpactEvaluationInput,
} from "../domain/impact/cross-domain-impact-evaluation.ts";

export function impactFingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: character.repeat(64) };
}

/** Mutable body fixture so focused tests can make one adversarial alteration. */
export function validCrossDomainImpactManifestBody() {
  return {
    schemaVersion: "cross-domain-impact-manifest/2.0" as const,
    id: "impact-manifest-led-1",
    revision: 1,
    project: {
      id: "project-led-1",
      fingerprint: impactFingerprint("a"),
    },
    subject: {
      id: "subject-led-1",
      fingerprint: impactFingerprint("b"),
    },
    basis: {
      projectId: "project-led-1",
      subjectId: "subject-led-1",
      snapshotId: "thread-led-r7",
      revision: 7,
      fingerprint: impactFingerprint("c"),
    },
    changeKinds: ["electrical-power", "brightness"],
    sourceAnchors: [
      {
        id: "anchor-electrical-power",
        changeKind: "electrical-power",
        role: "reviewed-change-source" as const,
        threadChange: {
          id: "thread-change-power",
          kind: "modified" as const,
          fingerprint: impactFingerprint("d"),
        },
        source: {
          kind: "requirement" as const,
          id: "requirement-electrical-power",
          fingerprint: impactFingerprint("e"),
        },
      },
      {
        id: "anchor-brightness",
        changeKind: "brightness",
        role: "reviewed-change-source" as const,
        threadChange: {
          id: "thread-change-brightness",
          kind: "modified" as const,
          fingerprint: impactFingerprint("f"),
        },
        source: {
          kind: "sysml-element" as const,
          id: "sysml-brightness-handle",
          fingerprint: impactFingerprint("a"),
        },
      },
    ],
    branches: [
      {
        id: "electrical" as string,
        version: "1.0" as const,
        inputs: [{ id: "electrical-power-input", fingerprint: impactFingerprint("b") }],
        method: {
          id: "electrical-method-evidence",
          fingerprint: impactFingerprint("c"),
        },
        joins: [{ id: "electrical-power-join", fingerprint: impactFingerprint("d") }],
      },
      {
        id: "thermal" as string,
        version: "1.0" as const,
        inputs: [{ id: "thermal-power-input", fingerprint: impactFingerprint("e") }],
        method: { id: "thermal-method-evidence", fingerprint: impactFingerprint("f") },
        joins: [{ id: "thermal-power-join", fingerprint: impactFingerprint("a") }],
      },
      {
        id: "mechanical" as string,
        version: "1.0" as const,
        inputs: [{
          id: "mechanical-static-input",
          fingerprint: impactFingerprint("b"),
        }],
        method: {
          id: "mechanical-method-evidence",
          fingerprint: impactFingerprint("c"),
        },
        joins: [{ id: "mechanical-static-join", fingerprint: impactFingerprint("d") }],
      },
    ],
    causalEdges: [
      {
        id: "edge-power-electrical",
        fromAnchorId: "anchor-electrical-power",
        to: {
          branchId: "electrical" as string,
          inputId: "electrical-power-input",
          inputFingerprint: impactFingerprint("b"),
        },
        relation: "positive-input" as const,
        assertion: {
          source: {
            id: "source-power-electrical",
            fingerprint: impactFingerprint("c"),
          },
          justification: "Reviewed source states the exact branch input relation.",
        },
        scope: "Exact manifest basis only.",
        evidence: [{
          id: "source-power-electrical",
          fingerprint: impactFingerprint("c"),
        }],
      },
      {
        id: "edge-power-thermal",
        fromAnchorId: "anchor-electrical-power",
        to: {
          branchId: "thermal" as string,
          inputId: "thermal-power-input",
          inputFingerprint: impactFingerprint("e"),
        },
        relation: "positive-input" as const,
        assertion: {
          source: { id: "source-power-thermal", fingerprint: impactFingerprint("f") },
          justification: "Reviewed source states the exact branch input relation.",
        },
        scope: "Exact manifest basis only.",
        evidence: [{ id: "source-power-thermal", fingerprint: impactFingerprint("f") }],
      },
    ],
    independenceAssertions: [
      {
        id: "mechanical-independence-r7",
        branchId: "mechanical" as string,
        assertion: "independent" as const,
        author: { kind: "human" as const, id: "human-reviewer-1" },
        source: {
          id: "source-mechanical-independence",
          fingerprint: impactFingerprint("a"),
        },
        justification:
          "The reviewed mechanical evidence consumes only the named exact input.",
        inspectedSourceAnchors: [
          {
            sourceAnchorId: "anchor-electrical-power",
            threadChangeFingerprint: impactFingerprint("d"),
            sourceFingerprint: impactFingerprint("e"),
          },
        ],
        evidence: {
          id: "mechanical-fea-evidence",
          fingerprint: impactFingerprint("b"),
        },
        inspectedConsumptions: [
          {
            id: "mechanical-consumption-step",
            input: { id: "mechanical-step-input", fingerprint: impactFingerprint("c") },
          },
        ],
        review: {
          trigger: {
            id: "impact-review-trigger-r7",
            fingerprint: impactFingerprint("d"),
          },
          reviewedAt: "2026-08-20T09:00:00.000Z",
          expiresAt: "2026-09-20T09:00:00.000Z",
        },
      },
    ],
    gateMap: [
      {
        gateItemId: "gate-electrical",
        branchId: "electrical" as string,
        role: "satisfies" as const,
      },
      {
        gateItemId: "gate-thermal",
        branchId: "thermal" as string,
        role: "contributes-to" as const,
      },
      {
        gateItemId: "gate-mechanical",
        branchId: "mechanical" as string,
        role: "satisfies" as const,
      },
    ],
    limitations: [
      "No interaction without a positive causal edge is proved.",
      "This manifest does not execute or qualify any method.",
    ],
  };
}

/** Adds `motion` as a declared nonmechanical branch with no causal edge. */
export function motionDeclaredCrossDomainImpactManifestBody() {
  const body = validCrossDomainImpactManifestBody();
  body.branches.push({
    id: "motion" as string,
    version: "1.0" as const,
    inputs: [{ id: "motion-input", fingerprint: impactFingerprint("e") }],
    method: { id: "motion-method-evidence", fingerprint: impactFingerprint("f") },
    joins: [{ id: "motion-join", fingerprint: impactFingerprint("a") }],
  });
  body.gateMap.push({
    gateItemId: "gate-motion",
    branchId: "motion" as string,
    role: "contributes-to" as const,
  });
  return body;
}

/** Same closed shape with document-defined kinds that are not a code catalog. */
export function documentDefinedCrossDomainImpactManifestBody() {
  const body = validCrossDomainImpactManifestBody();
  body.id = "impact-manifest-generic-1";
  body.changeKinds = ["mass-change", "geometry-change"];
  body.sourceAnchors[0] = {
    ...body.sourceAnchors[0]!,
    id: "anchor-mass-change",
    changeKind: "mass-change",
  };
  body.sourceAnchors[1] = {
    ...body.sourceAnchors[1]!,
    id: "anchor-geometry-change",
    changeKind: "geometry-change",
  };
  for (const edge of body.causalEdges) {
    if (edge.fromAnchorId === "anchor-electrical-power") {
      edge.fromAnchorId = "anchor-mass-change";
    }
  }
  const inspected = body.independenceAssertions[0]?.inspectedSourceAnchors[0];
  if (inspected?.sourceAnchorId === "anchor-electrical-power") {
    inspected.sourceAnchorId = "anchor-mass-change";
  }
  return body;
}

export async function validCrossDomainImpactManifest(): Promise<
  CrossDomainImpactManifest
> {
  return await createCrossDomainImpactManifest(validCrossDomainImpactManifestBody());
}

export async function validCrossDomainImpactEvaluationInput(): Promise<
  CrossDomainImpactEvaluationInput
> {
  const manifest = await validCrossDomainImpactManifest();
  const power = manifest.sourceAnchors.find((item) =>
    item.id === "anchor-electrical-power"
  )!;
  return {
    manifest,
    project: manifest.project,
    subject: manifest.subject,
    basis: manifest.basis,
    changedSources: [{
      sourceAnchorId: power.id,
      changeKind: power.changeKind,
      threadChange: power.threadChange,
      source: power.source,
    }],
    reviewTrigger: {
      id: "impact-review-trigger-r7",
      fingerprint: impactFingerprint("d"),
    },
    branchReadiness: manifest.branches.map((branch) => ({
      branchId: branch.id,
      method: { reference: branch.method, available: true },
      joins: branch.joins.map((join) => ({ reference: join, current: true })),
    })),
    mechanicalEvidence: {
      evidence: { id: "mechanical-fea-evidence", fingerprint: impactFingerprint("b") },
      consumptions: [{
        id: "mechanical-consumption-step",
        consumerEvidence: {
          id: "mechanical-fea-evidence",
          fingerprint: impactFingerprint("b"),
        },
        input: { id: "mechanical-step-input", fingerprint: impactFingerprint("c") },
      }],
    },
    evaluatedAt: "2026-08-22T09:00:00.000Z",
  };
}
