import { assertEquals } from "@std/assert";
import type {
  CrossDomainImpactApprovedBriefGates,
  CrossDomainImpactBriefGateReader,
} from "../../ports/out/impact/cross-domain-impact-brief-gate-reader.ts";
import type {
  CrossDomainImpactManifestReader,
  ReopenedCrossDomainImpactManifest,
} from "../../ports/out/impact/cross-domain-impact-manifest-reader.ts";
import type {
  CrossDomainImpactThreadLineage,
  CrossDomainImpactThreadLineageReader,
} from "../../ports/out/impact/cross-domain-impact-thread-lineage-reader.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import { crossDomainImpactManifestUri } from "../../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { validCrossDomainImpactManifest } from "../../../testing/cross-domain-impact-fixtures.ts";
import { PrepareProjectCrossDomainImpactManifestSealReview } from "./prepare-project-cross-domain-impact-manifest-seal-review.ts";

Deno.test("impact-manifest review produces only canonical MRTR material and never calls a solver", async () => {
  const fixture = await reviewFixture();
  const result = await fixture.review.execute(fixture.command);
  assertEquals(result.status, "resolved");
  assertEquals(
    result.status === "resolved" && result.decisionParameters.length > 0,
    true,
  );
  assertEquals(fixture.manifests.reads, 1);
  assertEquals(fixture.lineage.reads, 1);
  assertEquals(fixture.briefs.reads, 1);
  // The dependency set has no solver/provider port. This counter exists only
  // to make the negative execution boundary explicit in the focused test.
  assertEquals(fixture.solverCalls, 0);
});

Deno.test("impact-manifest review keeps bad project, subject, basis, and manifest fingerprint literal unresolved", async () => {
  for (const mutation of ["project", "subject", "basis", "reference"] as const) {
    const fixture = await reviewFixture();
    if (mutation === "project") {
      fixture.lineage.value.project = {
        ...fixture.lineage.value.project,
        id: "foreign.project",
      };
    }
    if (mutation === "subject") {
      fixture.lineage.value.subject = {
        ...fixture.lineage.value.subject,
        id: "foreign.subject",
      };
    }
    if (mutation === "basis") {
      fixture.lineage.value.basis = {
        ...fixture.lineage.value.basis,
        revision: fixture.lineage.value.basis.revision + 1,
      };
    }
    if (mutation === "reference") {
      fixture.manifests.value.reference = {
        fingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      };
    }
    const result = await fixture.review.execute(fixture.command);
    assertEquals(result.status, "unresolved", mutation);
  }
});

Deno.test("impact-manifest review refuses a non-V2 brief, missing gate, or missing explicit dependency", async () => {
  for (const mutation of ["v1", "gate", "dependency"] as const) {
    const fixture = await reviewFixture();
    if (mutation === "v1") fixture.briefs.value.contractVersion = "1.0";
    if (mutation === "gate") {
      fixture.briefs.value.gates = fixture.briefs.value.gates.slice(1);
    }
    if (mutation === "dependency") {
      fixture.briefs.value.gates = fixture.briefs.value.gates.map((gate: {
        id: string;
        kind: "success-criterion";
        fingerprint: { algorithm: "sha256"; digest: string };
        dependsOnItemIds?: readonly string[];
      }, index: number) =>
        index === 0 ? { ...gate, dependsOnItemIds: undefined } : gate
      );
    }
    const result = await fixture.review.execute(fixture.command);
    assertEquals(result.status, "unresolved", mutation);
  }
});

Deno.test("impact-manifest review accepts unsorted unique Brief V2 dependencies as a canonical copy", async () => {
  const fixture = await reviewFixture();
  const persisted = ["brief.source.thermal", "brief.source.electrical"];
  fixture.briefs.value.gates = fixture.briefs.value.gates.map((
    gate: {
      id: string;
      kind: "success-criterion";
      fingerprint: { algorithm: "sha256"; digest: string };
      dependsOnItemIds?: readonly string[];
    },
    index: number,
  ) => index === 0 ? gate : { ...gate, dependsOnItemIds: persisted });
  const result = await fixture.review.execute(fixture.command);
  assertEquals(result.status, "resolved");
  assertEquals(
    result.status === "resolved" &&
      result.admission.brief.gates
        .filter((gate) => gate.dependsOnItemIds.length > 0)
        .every((gate) =>
          gate.dependsOnItemIds[0] === "brief.source.electrical" &&
          gate.dependsOnItemIds[1] === "brief.source.thermal" &&
          gate.dependsOnItemIds.length === 2
        ),
    true,
  );
  assertEquals(
    fixture.briefs.value.gates
      .filter((gate: { dependsOnItemIds?: readonly string[] }) =>
        (gate.dependsOnItemIds?.length ?? 0) > 0
      )
      .map((gate: { dependsOnItemIds?: readonly string[] }) => gate.dependsOnItemIds),
    [persisted, persisted],
  );
});

Deno.test("impact-manifest review keeps duplicate Brief V2 dependencies unresolved", async () => {
  const fixture = await reviewFixture();
  fixture.briefs.value.gates = fixture.briefs.value.gates.map((
    gate: {
      id: string;
      kind: "success-criterion";
      fingerprint: { algorithm: "sha256"; digest: string };
      dependsOnItemIds?: readonly string[];
    },
    index: number,
  ) =>
    index === 0
      ? gate
      : { ...gate, dependsOnItemIds: ["brief.source.impact", "brief.source.impact"] }
  );
  const result = await fixture.review.execute(fixture.command);
  assertEquals(result.status, "unresolved");
  assertEquals(
    result.status !== "resolved" &&
      result.diagnostics[0]?.code === "brief_gate_unresolved",
    true,
  );
});

Deno.test("impact-manifest review rejects caller-injected branches, edges, artifacts, and provider envelopes", async () => {
  for (const field of ["branch", "edge", "artifact", "provider"] as const) {
    const fixture = await reviewFixture();
    const result = await fixture.review.execute({
      ...fixture.command,
      [field]: { forged: true },
    });
    assertEquals(result.status, "unresolved", field);
  }
});

Deno.test("impact-manifest review recrosses unique current work-item gate claims before MRTR", async () => {
  const fixture = await reviewFixture();
  const result = await fixture.review.execute(fixture.command);
  assertEquals(result.status, "resolved");
  assertEquals(fixture.projects.reads >= 1, true);
});

Deno.test("impact-manifest review keeps missing or ambiguous work-item gate claims unresolved before MRTR", async () => {
  const missing = await reviewFixture();
  missing.projects.value.workItems = [];
  const missingResult = await missing.review.execute(missing.command);
  assertEquals(missingResult.status, "unresolved");
  assertEquals(
    missingResult.status !== "resolved" &&
      missingResult.diagnostics[0]?.code === "work_item_claim_unresolved",
    true,
  );
  assertEquals(
    missingResult.status !== "resolved" &&
      missingResult.diagnostics[0]?.message.includes("gate-electrical") === true,
    true,
  );

  const ambiguous = await reviewFixture();
  const original = ambiguous.projects.value.workItems[0]!;
  ambiguous.projects.value.workItems = [
    ...ambiguous.projects.value.workItems,
    { ...original, id: `${original.id}-duplicate` },
  ];
  const ambiguousResult = await ambiguous.review.execute(ambiguous.command);
  assertEquals(ambiguousResult.status, "unresolved");
  assertEquals(
    ambiguousResult.status !== "resolved" &&
      ambiguousResult.diagnostics[0]?.code === "work_item_claim_unresolved",
    true,
  );
  assertEquals(
    ambiguousResult.status !== "resolved" &&
      ambiguousResult.diagnostics[0]?.message.includes("ambiguous") === true,
    true,
  );
});

Deno.test("impact-manifest review keeps stale or mismatched declared mechanical evidence unresolved", async () => {
  for (const mutation of ["stale", "fingerprint"] as const) {
    const fixture = await reviewFixture();
    const evidence = fixture.lineage.value.mechanicalEvidence[0];
    if (mutation === "stale") evidence.evidenceFreshness = "stale";
    if (mutation === "fingerprint") {
      evidence.evidence = {
        ...evidence.evidence,
        fingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      };
    }
    const result = await fixture.review.execute(fixture.command);
    assertEquals(result.status, "unresolved", mutation);
  }
});

async function reviewFixture() {
  const manifest = await validCrossDomainImpactManifest();
  const reference = await sha256Fingerprint(manifest);
  const lineage: CrossDomainImpactThreadLineage = {
    project: manifest.project,
    subject: manifest.subject,
    basis: manifest.basis,
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
  const manifests = new MemoryManifestReader({
    reference: { fingerprint: reference },
    uri: crossDomainImpactManifestUri(reference),
    manifest,
  });
  const lineages = new MemoryLineageReader(lineage);
  const briefs = new MemoryBriefGateReader({
    projectId: manifest.project.id,
    contractVersion: "2.0" as const,
    brief: {
      id: "brief.impact",
      revision: 2,
      fingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
    },
    gates: manifest.gateMap.map((mapping, index) => ({
      id: mapping.gateItemId,
      kind: "success-criterion" as const,
      fingerprint: { algorithm: "sha256" as const, digest: `${index + 1}`.repeat(64) },
      dependsOnItemIds: index === 0 ? [] : ["brief.source.impact"],
    })),
  });
  const projects = new MemoryProjectReader({
    project: { id: manifest.project.id },
    workItems: manifest.gateMap.map((mapping) => ({
      id: `work-${mapping.branchId}`,
      gateClaims: [{
        gateItemId: mapping.gateItemId,
        role: mapping.role,
        status: "current" as const,
      }],
    })),
  });
  const review = new PrepareProjectCrossDomainImpactManifestSealReview({
    manifests,
    lineage: lineages,
    briefGates: briefs,
    projects,
  });
  return {
    review,
    command: {
      projectId: manifest.project.id,
      manifestRef: { fingerprint: reference },
    },
    manifests,
    lineage: lineages,
    briefs,
    projects,
    solverCalls: 0,
  };
}

class MemoryManifestReader implements CrossDomainImpactManifestReader {
  reads = 0;
  constructor(readonly value: MutableReopenedCrossDomainImpactManifest) {}
  read(): Promise<ReopenedCrossDomainImpactManifest | undefined> {
    this.reads += 1;
    return Promise.resolve(this.value);
  }
}

class MemoryLineageReader implements CrossDomainImpactThreadLineageReader {
  reads = 0;
  constructor(readonly value: MutableCrossDomainImpactThreadLineage) {}
  read(): Promise<CrossDomainImpactThreadLineage | undefined> {
    this.reads += 1;
    return Promise.resolve(this.value);
  }
}

class MemoryBriefGateReader implements CrossDomainImpactBriefGateReader {
  reads = 0;
  constructor(readonly value: MutableCrossDomainImpactApprovedBriefGates) {}
  read(): Promise<CrossDomainImpactApprovedBriefGates | undefined> {
    this.reads += 1;
    return Promise.resolve(this.value);
  }
}

class MemoryProjectReader {
  reads = 0;
  constructor(
    readonly value: {
      project: { id: string };
      workItems: Array<{
        id: string;
        gateClaims?: Array<{
          gateItemId: string;
          role: "satisfies" | "contributes-to";
          status: "current" | "impact-unresolved" | "invalidated" | "carried-forward";
        }>;
      }>;
    },
  ) {}
  get(projectId: string) {
    this.reads += 1;
    if (this.value.project.id !== projectId) return Promise.resolve(undefined);
    return Promise.resolve(this.value as unknown as EngineeringProjectSnapshot);
  }
}

type MutableReopenedCrossDomainImpactManifest = {
  reference: ReopenedCrossDomainImpactManifest["reference"];
  uri: string;
  manifest: ReopenedCrossDomainImpactManifest["manifest"];
};

type MutableCrossDomainImpactThreadLineage = {
  project: CrossDomainImpactThreadLineage["project"];
  subject: CrossDomainImpactThreadLineage["subject"];
  basis: CrossDomainImpactThreadLineage["basis"];
  sourceAnchors: CrossDomainImpactThreadLineage["sourceAnchors"];
  mechanicalEvidence: readonly {
    assertionId: string;
    evidence: CrossDomainImpactThreadLineage["mechanicalEvidence"][number]["evidence"];
    evidenceFreshness:
      CrossDomainImpactThreadLineage["mechanicalEvidence"][number]["evidenceFreshness"];
    consumptions:
      CrossDomainImpactThreadLineage["mechanicalEvidence"][number]["consumptions"];
  }[];
};

type MutableCrossDomainImpactApprovedBriefGates = {
  projectId: string;
  contractVersion: "1.0" | "2.0";
  brief: CrossDomainImpactApprovedBriefGates["brief"];
  gates: Array<{
    id: string;
    kind: "success-criterion";
    fingerprint: ContentFingerprint;
    dependsOnItemIds?: readonly string[];
  }>;
};
