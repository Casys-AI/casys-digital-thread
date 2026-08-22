import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import { CrossDomainImpactThreadLineageReadError } from "../../application/ports/out/impact/cross-domain-impact-thread-lineage-reader.ts";
import { createCrossDomainImpactManifest } from "../../domain/impact/cross-domain-impact-manifest.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { validCrossDomainImpactManifestBody } from "../../testing/cross-domain-impact-fixtures.ts";
import { ProjectCrossDomainImpactThreadLineageReader } from "./project-cross-domain-impact-thread-lineage-reader.ts";

const AT = "2026-08-22T09:00:00.000Z";
const PROJECT = "project.impact.lineage";
const SUBJECT = "subject.impact.lineage";

Deno.test("impact Thread lineage rereads exact source and mechanical producer/consumer provenance", async () => {
  const fixture = await lineageFixture();
  const reader = new ProjectCrossDomainImpactThreadLineageReader({
    projects: fixture.projects,
    snapshots: { get: () => Promise.resolve(fixture.snapshot) },
  });
  const reread = await reader.read({ projectId: PROJECT, manifest: fixture.manifest });
  assertEquals(
    reread?.mechanicalEvidence[0]?.consumptions[0]?.consumerEvidence.id,
    "artifact.evidence",
  );

  const producerMismatch = structuredClone(fixture.snapshot) as unknown as {
    consumptions: Array<
      { consumer: { serverId: string; tool: string; runId: string } }
    >;
  };
  producerMismatch.consumptions[0]!.consumer = {
    ...producerMismatch.consumptions[0]!.consumer,
    tool: "verify.other-proof@1",
  };
  const mismatchedReader = new ProjectCrossDomainImpactThreadLineageReader({
    projects: fixture.projects,
    snapshots: {
      get: () => Promise.resolve(producerMismatch as unknown as ThreadSnapshot),
    },
  });
  await assertRejects(
    () => mismatchedReader.read({ projectId: PROJECT, manifest: fixture.manifest }),
    Error,
  );
});

Deno.test(
  "X07 Thread lineage stays unresolved when an extra verified consumption by the evidence producer is omitted from the assertion",
  async () => {
    const fixture = await lineageFixture();
    const extra = extraProducerConsumption(fixture.snapshot);
    const reader = new ProjectCrossDomainImpactThreadLineageReader({
      projects: fixture.projects,
      snapshots: { get: () => Promise.resolve(extra) },
    });
    const error = await assertRejects(
      () => reader.read({ projectId: PROJECT, manifest: fixture.manifest }),
      CrossDomainImpactThreadLineageReadError,
    );
    assertEquals(error.status, "unresolved");
  },
);

async function lineageFixture() {
  const sourceFingerprint = fingerprint("a");
  const inputFingerprint = fingerprint("b");
  const evidenceFingerprint = fingerprint("c");
  const evidenceProducer = {
    serverId: "digital-thread",
    tool: "verify.seal-mechanical-proof@1",
    runId: "run.mechanical-proof",
  } as const;
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "thread.impact.lineage.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT,
      name: "Impact subject",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.source",
    },
    freshness: fresh(),
    changeSet: {
      id: "changes.impact.lineage.r1",
      name: "Impact source change",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.source",
        kind: "modified",
        target: { kind: "artifact", id: "artifact.source" },
        summary: "Reviewed source change.",
        beforeFingerprint: fingerprint("f"),
        afterFingerprint: sourceFingerprint,
      }],
    },
    artifacts: [
      artifact("artifact.source", "Source", sourceFingerprint, {
        serverId: "digital-thread",
        tool: "baseline.from-approved-brief@1",
        runId: "run.source",
      }),
      artifact("artifact.input", "Mechanical input", inputFingerprint, {
        serverId: "digital-thread",
        tool: "design.write-geometry@1",
        runId: "run.geometry",
      }),
      artifact(
        "artifact.evidence",
        "Mechanical evidence",
        evidenceFingerprint,
        evidenceProducer,
        ["artifact.input"],
      ),
    ],
    consumptions: [{
      id: "consume.input.by.evidence",
      artifactId: "artifact.input",
      consumer: evidenceProducer,
      observedFingerprint: inputFingerprint,
      verifiedAt: AT,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: "provenance.change.source",
        relation: "changes",
        from: { kind: "change", id: "change.source" },
        to: { kind: "artifact", id: "artifact.source" },
        rationale: "Reviewed source change.",
      },
      {
        id: "provenance.evidence.uses.input",
        relation: "derived_from",
        from: { kind: "artifact", id: "artifact.evidence" },
        to: { kind: "artifact", id: "artifact.input" },
        rationale: "Mechanical evidence used this exact input.",
      },
      {
        id: "provenance.consumption.input",
        relation: "uses",
        from: { kind: "consumption", id: "consume.input.by.evidence" },
        to: { kind: "artifact", id: "artifact.input" },
        rationale: "The verified consumption reread this exact input.",
      },
    ],
    proposedActions: [],
  });
  const projectIdentity = {
    id: PROJECT,
    name: "Impact lineage project",
    subjectId: SUBJECT,
    objective: { title: "Impact", statement: "Recross exact Thread lineage." },
  };
  const change = snapshot.changeSet.changes[0]!;
  const body = {
    ...validCrossDomainImpactManifestBody(),
    id: "impact-manifest.lineage",
    project: { id: PROJECT, fingerprint: await sha256Fingerprint(projectIdentity) },
    subject: { id: SUBJECT, fingerprint: await sha256Fingerprint(snapshot.subject) },
    basis: {
      projectId: PROJECT,
      subjectId: SUBJECT,
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      fingerprint: await sha256Fingerprint(snapshot),
    },
    changeKinds: ["electrical-power"],
    sourceAnchors: [{
      id: "anchor.source",
      changeKind: "electrical-power" as const,
      role: "reviewed-change-source" as const,
      threadChange: {
        id: change.id,
        kind: change.kind,
        fingerprint: await sha256Fingerprint(change),
      },
      source: {
        kind: "artifact" as const,
        id: "artifact.source",
        fingerprint: sourceFingerprint,
      },
    }],
    causalEdges: [],
    independenceAssertions: [{
      id: "assertion.mechanical",
      branchId: "mechanical" as const,
      assertion: "independent" as const,
      author: { kind: "human" as const, id: "human.impact" },
      source: { id: "source.independence", fingerprint: fingerprint("d") },
      justification: "The review names the exact evidence and consumption.",
      inspectedSourceAnchors: [{
        sourceAnchorId: "anchor.source",
        threadChangeFingerprint: await sha256Fingerprint(change),
        sourceFingerprint,
      }],
      evidence: { id: "artifact.evidence", fingerprint: evidenceFingerprint },
      inspectedConsumptions: [{
        id: "consume.input.by.evidence",
        input: { id: "artifact.input", fingerprint: inputFingerprint },
      }],
      review: {
        trigger: { id: "trigger.impact", fingerprint: fingerprint("e") },
        reviewedAt: AT,
        expiresAt: "2027-08-22T09:00:00.000Z",
      },
    }],
  };
  const manifest = await createCrossDomainImpactManifest(body);
  const projects: Pick<EngineeringProjectRevisionStore, "get"> = {
    get: () =>
      Promise.resolve({ project: projectIdentity } as EngineeringProjectSnapshot),
  };
  return { manifest, projects, snapshot };
}

function extraProducerConsumption(snapshot: ThreadSnapshot): ThreadSnapshot {
  const evidence = snapshot.artifacts.find((item) => item.id === "artifact.evidence")!;
  const source = snapshot.artifacts.find((item) => item.id === "artifact.source")!;
  const extraId = "consume.source.by.evidence.omitted";
  return validateThreadSnapshot({
    ...snapshot,
    consumptions: [
      ...snapshot.consumptions,
      {
        id: extraId,
        artifactId: source.id,
        consumer: evidence.producer,
        observedFingerprint: source.fingerprint,
        verifiedAt: AT,
        status: "verified",
      },
    ],
    provenance: [
      ...snapshot.provenance,
      {
        id: `${extraId}.uses`,
        relation: "uses",
        from: { kind: "consumption", id: extraId },
        to: { kind: "artifact", id: source.id },
        rationale: "Omitted extra consumption by the exact evidence producer.",
      },
    ],
  });
}

function artifact(
  id: string,
  name: string,
  fingerprint: ContentFingerprint,
  producer: {
    readonly serverId: string;
    readonly tool: string;
    readonly runId: string;
  },
  inputArtifactIds: readonly string[] = [],
) {
  return {
    id,
    name,
    kind: "document" as const,
    version: "1",
    fingerprint,
    producer,
    inputArtifactIds,
    freshness: fresh(),
  };
}

function fingerprint(character: string): ContentFingerprint {
  return { algorithm: "sha256", digest: character.repeat(64) };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}
