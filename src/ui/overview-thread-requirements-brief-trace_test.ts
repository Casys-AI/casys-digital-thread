import { assertEquals, assertStringIncludes } from "@std/assert";
import { GENERIC_ENGINEERING_WORKBENCH_FIXTURE } from "../testing/workbench/generic-engineering-workbench-fixture.ts";
import { isEngineeringWorkbenchSnapshot } from "./src/thread/types.ts";

Deno.test("overview selection discloses only the explicit requirements brief trace", async () => {
  const evidence = await Deno.readTextFile(
    new URL(
      "../presentation/workbench/engineering/evidence.ts",
      import.meta.url,
    ),
  );
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const disclosure = await Deno.readTextFile(
    new URL(
      "./src/project/overview-thread-requirements-brief-trace.tsx",
      import.meta.url,
    ),
  );
  const selection = await Deno.readTextFile(
    new URL(
      "./src/project/overview-thread-selection-note.tsx",
      import.meta.url,
    ),
  );

  assertStringIncludes(hero, "requirementsBriefTraces = []");
  assertStringIncludes(hero, "<OverviewThreadRequirementsBriefTrace");
  assertStringIncludes(selection, "readonly supplement?: ReactNode;");
  assertStringIncludes(disclosure, 'reference.kind === "artifact"');
  assertStringIncludes(disclosure, 'reference.kind === "requirement"');
  assertStringIncludes(disclosure, "TRACE GAP");
  assertStringIncludes(disclosure, "sourceItem.sourceRefs.map");
  assertStringIncludes(evidence, 'kind: "retrospective-documentary"');
  assertStringIncludes(evidence, "requirementsArtifactId");
  assertStringIncludes(evidence, "claimId");
  assertStringIncludes(evidence, "revision");
  assertStringIncludes(disclosure, "Documentary requirement correspondence");
  assertStringIncludes(disclosure, "Initial approved brief source");
  assertStringIncludes(disclosure, "trace.declaration.linkedAt");
  assertStringIncludes(disclosure, "trace.declaration.requirementsArtifactId");
  assertStringIncludes(disclosure, "trace.declaration.claimId");
  assertStringIncludes(disclosure, "onFollowBriefSource");
  assertEquals(disclosure.includes("onOpenEvidence"), false);
  assertEquals(disclosure.includes("fetch("), false);
});

Deno.test("browser contract accepts only an explicit requirements trace key", () => {
  const workbench = structuredClone(GENERIC_ENGINEERING_WORKBENCH_FIXTURE);
  const artifactId = workbench.thread.artifacts[0]!.id;
  const requirementId = workbench.thread.requirements[0]!.id;
  const withGap = {
    ...workbench,
    requirementsBriefTraces: [{
      artifactId,
      status: "TRACE GAP" as const,
      threadRequirementIds: [requirementId],
    }],
  };
  assertEquals(isEngineeringWorkbenchSnapshot(withGap), true);
  assertEquals(
    isEngineeringWorkbenchSnapshot({
      ...withGap,
      requirementsBriefTraces: [{
        ...withGap.requirementsBriefTraces[0],
        inferredClause: "must not cross browser boundary",
      }],
    }),
    false,
  );
});

Deno.test("browser contract admits only a closed retrospective documentary declaration", () => {
  const workbench = structuredClone(GENERIC_ENGINEERING_WORKBENCH_FIXTURE);
  const artifactId = workbench.thread.artifacts[0]!.id;
  const requirementsArtifactId = workbench.thread.artifacts[1]!.id;
  const requirementId = workbench.thread.requirements[0]!.id;
  const brief = workbench.project.framing!.currentBrief!;
  const sourceItem = brief.items[0]!;
  const trace = {
    artifactId,
    status: "available" as const,
    threadRequirementIds: [requirementId],
    originalBrief: {
      briefId: brief.briefId,
      snapshotId: brief.id,
      revision: brief.revision,
    },
    container: {
      sourceItemId: sourceItem.id,
      originalSourceItem: sourceItem,
      state: "unchanged" as const,
    },
    requirements: [{
      threadRequirementId: requirementId,
      requirementId: "fixture_metric",
      sourceItemId: sourceItem.id,
      originalSourceItem: sourceItem,
      state: "unchanged" as const,
    }],
    declaration: {
      kind: "retrospective-documentary" as const,
      linkedAt: "2026-09-07T12:00:00.000Z",
      artifactId,
      requirementsArtifactId,
      claimId: `requirements-brief-claim-${"a".repeat(64)}`,
      revision: 1,
    },
  };
  const withDeclaration = { ...workbench, requirementsBriefTraces: [trace] };
  assertEquals(isEngineeringWorkbenchSnapshot(withDeclaration), true);

  for (
    const declaration of [
      { ...trace.declaration, extra: true },
      { ...trace.declaration, kind: "retrospective" },
      { ...trace.declaration, linkedAt: "2026-09-07T12:00:00+00:00" },
      { ...trace.declaration, artifactId: "not a stable id" },
      { ...trace.declaration, artifactId: "" },
      { ...trace.declaration, artifactId: "ART-UNKNOWN" },
      { ...trace.declaration, artifactId: workbench.thread.artifacts[2]!.id },
      { ...trace.declaration, requirementsArtifactId: "not a stable id" },
      { ...trace.declaration, requirementsArtifactId: "ART-UNKNOWN" },
      { ...trace.declaration, requirementsArtifactId: artifactId },
      {
        ...trace.declaration,
        claimId: "requirements-brief-claim-not-a-digest",
      },
      { ...trace.declaration, revision: 0 },
      (({ linkedAt: _linkedAt, ...remaining }) => remaining)(trace.declaration),
      (({ kind: _kind, ...remaining }) => remaining)(trace.declaration),
      (({ artifactId: _artifactId, ...remaining }) => remaining)(
        trace.declaration,
      ),
      (({ requirementsArtifactId: _requirementsArtifactId, ...remaining }) =>
        remaining)(trace.declaration),
      (({ claimId: _claimId, ...remaining }) => remaining)(trace.declaration),
      (({ revision: _revision, ...remaining }) => remaining)(trace.declaration),
    ]
  ) {
    assertEquals(
      isEngineeringWorkbenchSnapshot({
        ...workbench,
        requirementsBriefTraces: [{ ...trace, declaration }],
      }),
      false,
    );
  }
});

Deno.test("claim selection keeps multiple claims ahead of an initial gap", async () => {
  const disclosure = await Deno.readTextFile(
    new URL(
      "./src/project/overview-thread-requirements-brief-trace.tsx",
      import.meta.url,
    ),
  );
  const claims = disclosure.indexOf("claims.map");
  const originals = disclosure.indexOf("originals.map");
  assertEquals(claims >= 0, true);
  assertEquals(originals > claims, true);
  assertStringIncludes(
    disclosure,
    "trace.declaration.requirementsArtifactId === reference.id",
  );
  assertStringIncludes(
    disclosure,
    "right.declaration.revision - left.declaration.revision",
  );
  assertStringIncludes(disclosure, "Initial brief source: TRACE GAP");
});

Deno.test("brief-source reading note follows only exact projected records", async () => {
  const note = await Deno.readTextFile(
    new URL(
      "./src/project/overview-thread-brief-source-note.tsx",
      import.meta.url,
    ),
  );
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  const canvas = await Deno.readTextFile(
    new URL("./src/styles/19-project-thread-canvas.css", import.meta.url),
  );
  const chrome = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );

  assertStringIncludes(note, "OverviewBriefSourceHeroNode");
  assertStringIncludes(
    note,
    "onSelectRequirement(correspondence.threadRequirementId)",
  );
  assertStringIncludes(
    note,
    "onInspectClaim({",
  );
  assertStringIncludes(note, 'kind: "artifact"');
  assertEquals(note.includes("onOpenEvidence"), false);
  assertEquals(note.includes("fetch("), false);
  assertStringIncludes(
    note,
    '"overview-thread-selection-note overview-thread-brief-source-note"',
  );
  assertStringIncludes(note, "whiteboardNote");
  assertStringIncludes(hero, 'selectedItem?.kind === "brief-source"');
  assertStringIncludes(hero, "onSelectRequirement={(requirementId)");
  assertStringIncludes(hero, 'if (item.kind === "brief-source") return [];');
  assertStringIncludes(flow, 'item.kind === "brief-source"');
  assertStringIncludes(flow, "Read brief source");
  assertStringIncludes(canvas, ".overview-thread-selection-note {");
  assertStringIncludes(canvas, "z-index: 31;");
  assertStringIncludes(canvas, "position: absolute;");
  assertStringIncludes(note, 'whiteboardNotePart({ part: "header" })');
  assertStringIncludes(chrome, "sticky top-0");
});
