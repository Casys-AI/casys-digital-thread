import { assert, assertEquals, assertRejects } from "@std/assert";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import type { CalculixIsolatedExecutionEvidence } from "../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import {
  buildCalculixViewerBinding,
  type CalculixExecutionEvidenceReader,
} from "./calculix-viewer-binding.ts";
import { staticProofPublicationIdentity } from "../../domain/fea/isolated-v3/static-proof-publication-identity.ts";
import type { InstalledThreadViewerAppPackage } from "./thread-viewer-app-packages.ts";
import { CALCULIX_VIEWER_EVIDENCE_DIRECTORY } from "./thread-viewer-app-registrar.ts";

Deno.test("CalculiX automatic registration reopens the server-composed evidence store", () => {
  assertEquals(
    CALCULIX_VIEWER_EVIDENCE_DIRECTORY,
    "state/local/recorded-analysis/calculix/isolated-execution/evidence",
  );
});

Deno.test("CalculiX viewer binding preserves the exact isolated @3 evidence result", async () => {
  const fixture = await calculixFixture();
  try {
    const binding = await buildCalculixViewerBinding(fixture);
    assertEquals(
      binding?.session.schema,
      "io.casys.mcp-calculix.recorded-static-proof-session/1.0",
    );
    assertEquals(
      (binding?.session.payload.provenance as { operation: string }).operation,
      "verify.run-fea-static-proof@3",
    );
    assertEquals(
      (binding?.session.payload.projection as { result: { requestId: string } }).result
        .requestId,
      "request:viewer-proof",
    );
    assert(/^sha256:[a-f0-9]{64}$/.test(
      (binding?.session.payload.basis as { sessionFingerprint: string })
        .sessionFingerprint,
    ));
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("CalculiX viewer binding rejects a result whose evidence producer differs", async () => {
  const fixture = await calculixFixture();
  try {
    fixture.evidence.read = () =>
      Promise.resolve({
        ...fixture.value,
        agentRunId: "run:other",
      });
    await assertRejects(
      () => buildCalculixViewerBinding(fixture),
      TypeError,
      "producer",
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("CalculiX viewer binding rejects a tampered evidence fingerprint", async () => {
  const fixture = await calculixFixture();
  try {
    fixture.evidence.read = () =>
      Promise.resolve({
        ...fixture.value,
        fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
      });
    await assertRejects(
      () => buildCalculixViewerBinding(fixture),
      TypeError,
      "producer",
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("CalculiX viewer binding accepts the exact run-scoped publication layout", async () => {
  const fixture = await calculixFixture();
  try {
    fixture.thread = withCalculixLayout(fixture.thread, "run-scoped");
    fixture.artifactId = fixture.thread.artifacts.find((artifact) =>
      artifact.kind === "solver-result"
    )!.id;
    const binding = await buildCalculixViewerBinding(fixture);
    assertEquals(
      binding?.session.schema,
      "io.casys.mcp-calculix.recorded-static-proof-session/1.0",
    );
    assertEquals(binding?.anchor.id, fixture.artifactId);
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("CalculiX viewer binding rejects mixed or cross-run publication identities", async () => {
  const mixed = await calculixFixture();
  try {
    mixed.thread = withCalculixLayout(mixed.thread, "mixed-evidence");
    await assertRejects(
      () => buildCalculixViewerBinding(mixed),
      TypeError,
      "execution-evidence",
    );
  } finally {
    await Deno.remove(mixed.root, { recursive: true });
  }

  const crossRun = await calculixFixture();
  try {
    crossRun.thread = withCalculixLayout(crossRun.thread, "cross-run");
    crossRun.artifactId = crossRun.thread.artifacts.find((artifact) =>
      artifact.kind === "solver-result"
    )!.id;
    const binding = await buildCalculixViewerBinding(crossRun);
    assertEquals(binding, undefined);
  } finally {
    await Deno.remove(crossRun.root, { recursive: true });
  }
});

Deno.test("CalculiX viewer binding is unavailable without its exact installed package", async () => {
  const fixture = await calculixFixture();
  try {
    const binding = await buildCalculixViewerBinding({ ...fixture, packages: [] });
    assertEquals(binding, undefined);
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("CalculiX viewer binding rejects archived dependent evidence or input", async () => {
  for (
    const artifactPrefix of [
      "calculix-isolated-evidence-",
      "calculix-isolated-input-step-",
    ]
  ) {
    const fixture = await calculixFixture();
    try {
      const artifact = fixture.thread.artifacts.find((candidate) =>
        candidate.id.startsWith(artifactPrefix)
      )!;
      fixture.thread = archiveArtifact(fixture.thread, artifact.id);
      await assertRejects(
        () => buildCalculixViewerBinding(fixture),
        Error,
      );
    } finally {
      await Deno.remove(fixture.root, { recursive: true });
    }
  }
});

Deno.test("CalculiX viewer binding rejects stale dependent evidence or input", async () => {
  for (
    const artifactPrefix of [
      "calculix-isolated-evidence-",
      "calculix-isolated-input-step-",
    ]
  ) {
    const fixture = await calculixFixture();
    try {
      const artifact = fixture.thread.artifacts.find((candidate) =>
        candidate.id.startsWith(artifactPrefix)
      )!;
      fixture.thread = staleArtifact(fixture.thread, artifact.id);
      await assertRejects(
        () => buildCalculixViewerBinding(fixture),
        Error,
      );
    } finally {
      await Deno.remove(fixture.root, { recursive: true });
    }
  }
});

async function calculixFixture(): Promise<{
  root: string;
  project: EngineeringProjectSnapshot;
  thread: ThreadSnapshot;
  artifactId: string;
  evidence: { read: CalculixExecutionEvidenceReader["read"] };
  value: CalculixIsolatedExecutionEvidence;
  packages: readonly InstalledThreadViewerAppPackage[];
}> {
  const root = await Deno.makeTempDir({ prefix: "calculix-viewer-binding-" });
  const at = "2026-09-07T12:00:00.000Z";
  const digest = (letter: string) => letter.repeat(64);
  const fp = (letter: string) => ({
    algorithm: "sha256" as const,
    digest: digest(letter),
  });
  const producer: ThreadOperationRef = {
    serverId: "digital-thread",
    tool: "verify.run-fea-static-proof@3",
    runId: "run:viewer-proof",
  };
  const fresh = { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
  const input = artifact({
    id: `calculix-isolated-input-step-${digest("a")}`,
    kind: "solver-input",
    fingerprint: fp("a"),
    uri: `casys://isolated-output/sha256/${digest("a")}`,
    mediaType: "model/step",
    producer,
    freshness: fresh,
  });
  const result = artifact({
    id: `calculix-isolated-result-json-${digest("b")}`,
    kind: "solver-result",
    fingerprint: fp("b"),
    uri: `casys://isolated-output/sha256/${digest("b")}`,
    mediaType: "application/json",
    producer,
    freshness: fresh,
  });
  const evidenceArtifact = artifact({
    id: `calculix-isolated-evidence-${digest("c")}`,
    kind: "evidence",
    fingerprint: fp("c"),
    uri: `casys://calculix-isolated-execution-evidence/sha256/${digest("c")}`,
    mediaType: "application/json",
    producer,
    inputArtifactIds: [result.id],
    freshness: fresh,
  });
  const thread = {
    schemaVersion: "1.0",
    id: "project:calc-viewer:r1",
    revision: 1,
    generatedAt: at,
    subject: {
      id: "project:calc-viewer",
      name: "CalculiX viewer fixture",
      kind: "system",
      version: digest("d"),
      modelArtifactId: input.id,
    },
    freshness: fresh,
    changeSet: {
      id: "changes-r1",
      name: "fixture",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [],
    },
    artifacts: [input, result, evidenceArtifact],
    consumptions: [{
      id: "consume-evidence-result",
      artifactId: result.id,
      consumer: producer,
      observedFingerprint: result.fingerprint,
      verifiedAt: at,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "evidence-derived-from-result",
      relation: "derived_from",
      from: { kind: "artifact", id: evidenceArtifact.id },
      to: { kind: "artifact", id: result.id },
      rationale: "Fixture preserves exact output provenance.",
    }, {
      id: "evidence-uses-result",
      relation: "uses",
      from: { kind: "consumption", id: "consume-evidence-result" },
      to: { kind: "artifact", id: result.id },
      rationale: "Fixture preserves exact output consumption.",
    }],
    proposedActions: [],
  } as ThreadSnapshot;
  const project = await projectFor(root, thread.id, thread.subject.id, at);
  const value = {
    projectId: project.project.id,
    agentRunId: producer.runId,
    fingerprint: fp("c"),
    result: {
      schemaVersion: "calculix-isolated-static-result/1.0",
      requestId: "request:viewer-proof",
      inputArtifact: { mediaType: "model/step", byteCount: 1, sha256: digest("a") },
    },
    outputs: [
      {
        role: "input.step",
        sha256: digest("a"),
        casUri: input.uri,
        mediaType: "model/step",
        byteCount: 1,
      },
      {
        role: "result.json",
        sha256: digest("b"),
        casUri: result.uri,
        mediaType: "application/json",
        byteCount: 1,
      },
    ],
  } as unknown as CalculixIsolatedExecutionEvidence;
  return {
    root,
    project,
    thread,
    artifactId: result.id,
    evidence: { read: () => Promise.resolve(value) },
    value,
    packages: [{
      app: { id: "io.casys.mcp-calculix.results", version: "0.8.6" },
      manifest: {
        uri: "ui://mcp-calculix/app-manifest",
        path: "/manifest.json",
        fingerprint: "sha256:unused",
      },
      resources: [{
        uri: "ui://mcp-calculix/results-viewer",
        path: "/results.html",
        fingerprint: "sha256:unused",
        resultSchemas: [],
        sessionSchemas: ["io.casys.mcp-calculix.recorded-static-proof-session/1.0"],
        acceptedActions: ["viewer.session.apply"],
      }],
    }],
  };
}

function withCalculixLayout(
  thread: ThreadSnapshot,
  layout: "run-scoped" | "mixed-evidence" | "cross-run",
): ThreadSnapshot {
  const runId =
    thread.artifacts.find((artifact) => artifact.kind === "solver-result")!.producer
      .runId;
  const nextId = (artifact: ThreadArtifact): string => {
    if (layout === "cross-run" && artifact.kind === "solver-result") {
      return staticProofPublicationIdentity(artifact.id, "run:other");
    }
    if (layout === "mixed-evidence") {
      return artifact.kind === "evidence"
        ? staticProofPublicationIdentity(artifact.id, runId)
        : artifact.id;
    }
    if (
      artifact.kind === "solver-result" || artifact.kind === "solver-input" ||
      artifact.kind === "evidence"
    ) {
      return staticProofPublicationIdentity(artifact.id, runId);
    }
    return artifact.id;
  };
  const idMap = new Map(
    thread.artifacts.map((artifact) => [artifact.id, nextId(artifact)]),
  );
  const mapped = (id: string) => idMap.get(id) ?? id;
  const mapRef = <T extends { readonly kind: string; readonly id: string }>(
    ref: T,
  ): T => (ref.kind === "artifact" ? { ...ref, id: mapped(ref.id) } : ref);
  return {
    ...thread,
    subject: {
      ...thread.subject,
      modelArtifactId: mapped(thread.subject.modelArtifactId),
    },
    artifacts: thread.artifacts.map((artifact) => ({
      ...artifact,
      id: mapped(artifact.id),
      inputArtifactIds: artifact.inputArtifactIds.map(mapped),
    })),
    consumptions: thread.consumptions.map((consumption) => ({
      ...consumption,
      artifactId: mapped(consumption.artifactId),
    })),
    provenance: thread.provenance.map((link) => ({
      ...link,
      from: mapRef(link.from),
      to: mapRef(link.to),
    })),
  };
}

function archiveArtifact(thread: ThreadSnapshot, artifactId: string): ThreadSnapshot {
  return {
    ...thread,
    changeSet: {
      ...thread.changeSet,
      changes: [...thread.changeSet.changes, {
        id: `archive-${artifactId}`,
        kind: "archived",
        target: { kind: "artifact", id: artifactId },
        summary: "Fixture archives dependent viewer evidence.",
      }],
    },
  };
}

function staleArtifact(thread: ThreadSnapshot, artifactId: string): ThreadSnapshot {
  return {
    ...thread,
    artifacts: thread.artifacts.map((artifact) =>
      artifact.id === artifactId
        ? {
          ...artifact,
          freshness: {
            ...artifact.freshness,
            status: "stale" as const,
            invalidatedByChangeIds: ["fixture-stale"],
          },
        }
        : artifact
    ),
  };
}

function artifact(
  value:
    & Omit<ThreadArtifact, "name" | "version" | "inputArtifactIds">
    & Partial<Pick<ThreadArtifact, "inputArtifactIds">>,
): ThreadArtifact {
  return {
    name: String(value.id),
    version: value.fingerprint.digest,
    inputArtifactIds: [],
    ...value,
  } as ThreadArtifact;
}

async function projectFor(
  root: string,
  snapshotId: string,
  subjectId: string,
  at: string,
): Promise<EngineeringProjectSnapshot> {
  const briefs = new ProjectBriefCommandService(
    new FileEngineeringProjectRevisionStore(root),
    () => at,
  );
  const agent = { kind: "agent" as const, actorId: "agent:test" };
  const human = { kind: "human" as const, actorId: "human:test" };
  let project = await briefs.startProject(agent, {
    commandId: "start",
    projectId: "calc-viewer",
    projectName: "CalculiX viewer fixture",
    issuedAt: at,
    intent: "Exercise recorded evidence.",
    intentSource: { kind: "human", reference: "conversation:test" },
  });
  project = await briefs.proposeBrief(agent, {
    commandId: "brief",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: at,
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Exercise viewer.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "scenario",
      kind: "mission-scenario",
      statement: "Reopen recorded static evidence.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Preserve the exact evidence identity.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(human, {
    commandId: "approve",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: at,
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "fixture",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  return { ...project, threadSnapshots: [{ snapshotId, revision: 1, subjectId }] };
}
