import { assertEquals } from "@std/assert";
import type { CrossDomainImpactBriefGateReader } from "../../ports/out/impact/cross-domain-impact-brief-gate-reader.ts";
import type { CrossDomainImpactManifestReader } from "../../ports/out/impact/cross-domain-impact-manifest-reader.ts";
import type {
  CrossDomainImpactThreadLineage,
  CrossDomainImpactThreadLineageReader,
} from "../../ports/out/impact/cross-domain-impact-thread-lineage-reader.ts";
import { crossDomainImpactManifestUri } from "../../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import { validCrossDomainImpactManifest } from "../../../testing/cross-domain-impact-fixtures.ts";
import { PrepareProjectCrossDomainImpactManifestSealReview } from "./prepare-project-cross-domain-impact-manifest-seal-review.ts";

Deno.test("impact-manifest review produces only canonical MRTR material and never calls a solver", async () => {
  const fixture = await reviewFixture();
  const result = await fixture.review.execute(fixture.command);
  assertEquals(result.status, "resolved");
  assertEquals(result.status === "resolved" && result.decisionParameters.length > 0, true);
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
    if (mutation === "project") fixture.lineage.value.project = { ...fixture.lineage.value.project, id: "foreign.project" };
    if (mutation === "subject") fixture.lineage.value.subject = { ...fixture.lineage.value.subject, id: "foreign.subject" };
    if (mutation === "basis") fixture.lineage.value.basis = { ...fixture.lineage.value.basis, revision: fixture.lineage.value.basis.revision + 1 };
    if (mutation === "reference") fixture.manifests.value.reference = {
      fingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
    };
    const result = await fixture.review.execute(fixture.command);
    assertEquals(result.status, "unresolved", mutation);
  }
});

Deno.test("impact-manifest review refuses a non-V2 brief, missing gate, or missing explicit dependency", async () => {
  for (const mutation of ["v1", "gate", "dependency"] as const) {
    const fixture = await reviewFixture();
    if (mutation === "v1") fixture.briefs.value.contractVersion = "1.0";
    if (mutation === "gate") fixture.briefs.value.gates = fixture.briefs.value.gates.slice(1);
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

Deno.test("impact-manifest review rejects caller-injected branches, edges, artifacts, and provider envelopes", async () => {
  for (const field of ["branch", "edge", "artifact", "provider"] as const) {
    const fixture = await reviewFixture();
    const result = await fixture.review.execute({ ...fixture.command, [field]: { forged: true } });
    assertEquals(result.status, "unresolved", field);
  }
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
  const review = new PrepareProjectCrossDomainImpactManifestSealReview({
    manifests,
    lineage: lineages,
    briefGates: briefs,
  });
  return {
    review,
    command: { projectId: manifest.project.id, manifestRef: { fingerprint: reference } },
    manifests,
    lineage: lineages,
    briefs,
    solverCalls: 0,
  };
}

class MemoryManifestReader implements CrossDomainImpactManifestReader {
  reads = 0;
  constructor(readonly value: any) {}
  read() {
    this.reads += 1;
    return Promise.resolve(this.value);
  }
}

class MemoryLineageReader implements CrossDomainImpactThreadLineageReader {
  reads = 0;
  constructor(readonly value: any) {}
  read() {
    this.reads += 1;
    return Promise.resolve(this.value);
  }
}

class MemoryBriefGateReader implements CrossDomainImpactBriefGateReader {
  reads = 0;
  constructor(readonly value: any) {}
  read() {
    this.reads += 1;
    return Promise.resolve(this.value);
  }
}
