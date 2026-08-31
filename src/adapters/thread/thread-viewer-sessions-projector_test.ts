import { assertEquals, assertRejects } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  isThreadViewerSessionsProjection,
  type ThreadViewerSessionsProjection,
} from "../../presentation/workbench/thread/viewer-sessions.ts";
import { projectThreadViewerSessions } from "./thread-viewer-sessions-projector.ts";

const CONTEXT = {
  projectId: "project-generic",
  projectRevision: 12,
  subjectId: "GEN-01",
  sequence: 7,
  thread: { id: GENERIC_THREAD_FIXTURE.id, revision: 42 },
} as const;

Deno.test("viewer sessions project only an exact represented GLB", async () => {
  const snapshot = exactGlbFixture();
  const projection = await projectThreadViewerSessions(CONTEXT, snapshot);

  assertEquals(projection.schemaVersion, "thread-viewer-sessions/1.0");
  assertEquals(projection.basis, {
    projectId: "project-generic",
    projectRevision: 12,
    subjectId: "GEN-01",
    thread: { id: GENERIC_THREAD_FIXTURE.id, revision: 42 },
  });
  assertEquals(
    /^sha256:[a-f0-9]{64}$/.test(projection.projectionFingerprint),
    true,
  );
  assertEquals(projection.sequence, 7);
  assertEquals(projection.sessions.length, 1);
  assertEquals(projection.sessions[0], {
    id: projection.sessions[0]?.id,
    kind: "native-cad-glb",
    anchor: { kind: "part-definition", id: "part-bracket" },
    asset: {
      id: "glb-bracket",
      uri: `/api/thread/assets/${"a".repeat(64)}.glb`,
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    semanticSelection: {
      status: "unavailable",
      reason: "viewer-selection-not-supported",
    },
  });
  assertEquals(
    /^native-cad-glb:[a-f0-9]{64}$/.test(projection.sessions[0]!.id),
    true,
  );
  assertEquals(isThreadViewerSessionsProjection(projection), true);
  assertEquals(
    await projectThreadViewerSessions(CONTEXT, exactGlbFixture()),
    projection,
  );
});

Deno.test("viewer sessions refuse lookalike links and mismatched asset bytes", async () => {
  const wrongRelation = exactGlbFixture();
  wrongRelation.graph.edges[wrongRelation.graph.edges.length - 1]!.relation =
    "derived_from";
  assertEquals(
    (await projectThreadViewerSessions(CONTEXT, wrongRelation)).sessions,
    [],
  );

  const wrongDigest = exactGlbFixture();
  wrongDigest.artifacts.at(-1)!.uri = `/api/thread/assets/${"b".repeat(64)}.glb`;
  assertEquals(
    (await projectThreadViewerSessions(CONTEXT, wrongDigest)).sessions,
    [],
  );

  const noArtifactNode = exactGlbFixture();
  noArtifactNode.graph.nodes = noArtifactNode.graph.nodes.filter((node) =>
    !(node.ref.kind === "artifact" && node.ref.id === "glb-bracket")
  );
  assertEquals(
    (await projectThreadViewerSessions(CONTEXT, noArtifactNode)).sessions,
    [],
  );

  const labelOnly = structuredClone(GENERIC_THREAD_FIXTURE);
  labelOnly.artifacts.push(exactGlbFixture().artifacts.at(-1)!);
  assertEquals(
    (await projectThreadViewerSessions(CONTEXT, labelOnly)).sessions,
    [],
  );
});

Deno.test("viewer session contract preserves complete semantic references", async () => {
  const projection = await projectThreadViewerSessions(
    CONTEXT,
    exactGlbFixture(),
  );
  const available = structuredClone(projection) as MutableProjection;
  available.sessions[0]!.semanticSelection = {
    status: "available",
    semanticRef: {
      domain: "cad",
      kind: "face",
      id: "face-12",
      basisFingerprint: "c".repeat(64),
    },
  };
  assertEquals(isThreadViewerSessionsProjection(available), true);

  const invented = structuredClone(available) as unknown as {
    sessions: Array<{ semanticSelection: { semanticRef: Record<string, unknown> } }>;
  };
  invented.sessions[0]!.semanticSelection.semanticRef.label = "nearby face";
  assertEquals(isThreadViewerSessionsProjection(invented), false);

  const prefixedBasis = structuredClone(available) as MutableProjection;
  const availableSelection = prefixedBasis.sessions[0]!.semanticSelection;
  if (availableSelection.status !== "available") {
    throw new Error("expected available semantic selection");
  }
  availableSelection.semanticRef.basisFingerprint = `sha256:${"c".repeat(64)}`;
  assertEquals(isThreadViewerSessionsProjection(prefixedBasis), false);

  const wrongAsset = structuredClone(projection) as MutableProjection;
  wrongAsset.sessions[0]!.asset.fingerprint = `sha256:${"d".repeat(64)}`;
  assertEquals(isThreadViewerSessionsProjection(wrongAsset), false);
});

Deno.test("viewer sessions require the exact canonical Thread identity", async () => {
  await assertRejects(
    () =>
      projectThreadViewerSessions(
        { ...CONTEXT, sequence: -1 },
        exactGlbFixture(),
      ),
    TypeError,
    "non-negative integer",
  );
  await assertRejects(
    () =>
      projectThreadViewerSessions(
        { ...CONTEXT, subjectId: "other-subject" },
        exactGlbFixture(),
      ),
    TypeError,
    "does not match",
  );
  await assertRejects(
    () =>
      projectThreadViewerSessions(
        { ...CONTEXT, thread: { id: "other-thread", revision: 42 } },
        exactGlbFixture(),
      ),
    TypeError,
    "exact canonical Thread identity",
  );
});

function exactGlbFixture() {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const digest = "a".repeat(64);
  snapshot.artifacts.push({
    id: "glb-bracket",
    label: "Bracket presentation derivative",
    kind: "cad-model",
    system: "build123d",
    revision: "glb-bracket@42",
    freshness: "fresh",
    fingerprint: `sha256:${digest}`,
    uri: `/api/thread/assets/${digest}.glb`,
    dependsOn: [],
  });
  snapshot.graph.nodes.push(
    {
      id: "part-definition:part-bracket",
      ref: { kind: "part-definition", id: "part-bracket" },
      entityKind: "part-definition",
      label: "Bracket",
      system: "SysON",
      freshness: "fresh",
      summary: "Exact SysON PartDefinition.",
    },
    {
      id: "artifact:glb-bracket",
      ref: { kind: "artifact", id: "glb-bracket" },
      entityKind: "artifact",
      artifactKind: "cad-model",
      label: "Bracket presentation derivative",
      system: "build123d",
      freshness: "fresh",
      summary: "Exact content-addressed GLB.",
    },
  );
  snapshot.graph.edges.push({
    id: "structure:represented-by:part-bracket:glb-bracket",
    from: { kind: "part-definition", id: "part-bracket" },
    to: { kind: "artifact", id: "glb-bracket" },
    relation: "represented_by",
    rationale: "Recorded component-catalog GLB derivative.",
    origin: "structure",
  });
  return snapshot;
}

type MutableProjection = {
  -readonly [Key in keyof ThreadViewerSessionsProjection]:
    ThreadViewerSessionsProjection[Key] extends readonly (infer Item)[]
      ? Array<Mutable<Item>>
      : Mutable<ThreadViewerSessionsProjection[Key]>;
};

type Mutable<Value> = Value extends object ? {
    -readonly [Key in keyof Value]: Mutable<Value[Key]>;
  }
  : Value;
