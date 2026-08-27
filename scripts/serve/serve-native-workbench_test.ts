import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import type { CockpitFocusStore } from "../../src/application/ports/out/project/cockpit-focus-store.ts";
import type { EngineeringProjectSnapshot } from "../../src/domain/project/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../../src/application/ports/out/engineering-project-revision-store.ts";
import type { CockpitFocusSnapshot } from "../../src/domain/project/cockpit-focus.ts";
import { COCKPIT_FOCUS_SCHEMA_VERSION } from "../../src/domain/project/cockpit-focus.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../src/domain/architecture/renderer/architecture-proposal.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../src/domain/cad/canonical/geometry-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../src/domain/architecture/requirements/requirements-proposal.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "../../src/domain/compile/admission/technical-compilation-proposal.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../src/domain/cad/isolated/build123d-execution-proposal.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_OPERATION,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
} from "../../src/domain/fea/seal-case/fea-proof-proposal.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "../../src/domain/modelica/qualified-kit/run-proposal.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "../../src/domain/modelica/admitted/run-proposal.ts";
import { ARCHIVE_LINEAGE_OPERATION } from "../../src/domain/thread/thread-retirement.ts";
import {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
} from "../../src/domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "../../src/orchestration/operations/fea-isolated-static-proof.ts";
import type { ThreadSnapshot } from "../../src/domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../src/domain/thread/thread-snapshot-store.ts";
import {
  createFocusedWorkspaceHandler,
  createNativeWorkbenchHandler,
  hasUnattachedDurableProjectOperationForTest,
  resolveNativeWorkbenchProjectId,
  resolveNativeWorkbenchStartupTarget,
  resolveNativeWorkbenchSubjectId,
  resolveWorkbenchUiAssetPath,
} from "./serve-native-workbench.ts";
import { verifiedArchitectureNavigationFixture } from "../../src/adapters/architecture/renderer/capture-product-structure-traversal_test.ts";
import { sampleAgentResourceReference } from "../../src/testing/agent-resource-test-support.ts";
import {
  applyProjectSourceWorkspaceCommand,
  emptyProjectSourceWorkspace,
} from "../../src/domain/project-source-workspace/transitions.ts";
import type { ProjectSourceWorkspaceState } from "../../src/domain/project-source-workspace/types.ts";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("native Workbench resolves an agent-selected project and its subject", async () => {
  const project = projectFixture("project-one", "subject-one");
  const projects = new ProjectStore([project]);

  assertEquals(
    resolveNativeWorkbenchProjectId(undefined, undefined),
    undefined,
  );
  assertEquals(
    resolveNativeWorkbenchProjectId(undefined, "subject-one"),
    undefined,
  );
  assertEquals(
    resolveNativeWorkbenchProjectId("project-one", "subject-one"),
    "project-one",
  );
  assertEquals(
    await resolveNativeWorkbenchSubjectId("project-one", undefined, projects),
    "subject-one",
  );
  assertEquals(
    await resolveNativeWorkbenchSubjectId("project-one", "subject-override", projects),
    "subject-override",
  );
});

Deno.test("native Workbench startup requires a durable focus or explicit target", () => {
  assertEquals(
    resolveNativeWorkbenchStartupTarget({
      "no-seed": "true",
      "workspace-id": "primary",
    }),
    {
      hostname: "127.0.0.1",
      port: 5175,
      noSeed: true,
      workspaceId: "primary",
      projectId: undefined,
      explicitSubjectId: undefined,
    },
  );
  assertThrows(
    () => resolveNativeWorkbenchStartupTarget({}),
    TypeError,
    "--workspace-id or --project-id is required",
  );
  assertThrows(
    () => resolveNativeWorkbenchStartupTarget({ "no-seed": "true" }),
    TypeError,
    "--workspace-id or --project-id is required",
  );
  assertThrows(
    () => resolveNativeWorkbenchStartupTarget({ subject: "subject-one" }),
    TypeError,
    "--subject requires --project-id.",
  );
});

Deno.test("native Workbench rejects a non-loopback bind host", () => {
  for (const hostname of ["0.0.0.0", "workbench.test"]) {
    assertThrows(
      () => resolveNativeWorkbenchStartupTarget({ host: hostname }),
      TypeError,
      "--host must be an explicit loopback hostname",
    );
  }
  assertEquals(
    resolveNativeWorkbenchStartupTarget({
      host: "localhost",
      "workspace-id": "primary",
    }).hostname,
    "localhost",
  );
});

Deno.test("native Workbench health is independent of focus and project state", async () => {
  let focusReads = 0;
  const focus: CockpitFocusStore = {
    get: () => {
      focusReads += 1;
      return Promise.resolve(undefined);
    },
    select: (snapshot) => Promise.resolve(snapshot),
  };
  const native = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([]),
    html: "unused",
  });
  const handler = createFocusedWorkspaceHandler({
    focus,
    workspaceId: "primary",
    native,
  });

  const response = await handler(new Request("http://localhost/healthz"));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ok",
    service: "native-workbench",
  });
  assertEquals(focusReads, 0);
  const rejected = await handler(
    new Request("http://localhost/healthz", { method: "POST" }),
  );
  assertEquals(rejected.status, 405);
  assertEquals(focusReads, 0);

  const unavailable = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals(unavailable.status, 409);
  assertEquals((await unavailable.json()).error, "cockpit_focus_not_selected");
  assertEquals(focusReads, 1);
});

Deno.test("native Workbench exposes persisted projects without inventing a default focus", async () => {
  const focus = new MutableFocus(undefined);
  const catalog = {
    schemaVersion: "native-workbench-project-catalog/1.0" as const,
    state: "available" as const,
    projects: [{
      id: "project-<one>",
      name: "Pump & <script>alert(1)</script>",
      revision: 7,
      subjectId: "subject-one",
    }],
  };
  const native = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([]),
    html: "unused",
    projectCatalog: () => Promise.resolve(catalog),
  });
  const handler = createFocusedWorkspaceHandler({
    focus,
    workspaceId: "primary",
    native,
    projectCatalog: () => Promise.resolve(catalog),
  });

  const projects = await handler(new Request("http://localhost/api/projects"));
  assertEquals(projects.status, 200);
  assertEquals(await projects.json(), catalog);
  assertEquals(projects.headers.get("X-Content-Type-Options"), "nosniff");

  const page = await handler(new Request("http://localhost/"));
  const html = await page.text();
  assertEquals(page.status, 200);
  assertStringIncludes(html, "Pump &amp; &lt;script&gt;alert(1)&lt;/script&gt;");
  assertStringIncludes(html, "project-&lt;one&gt;");
  assertEquals(html.includes("<script>alert(1)</script>"), false);
  assertEquals(html.includes("href="), false);
  assertEquals(html.includes("<form"), false);
  assertStringIncludes(
    page.headers.get("Content-Security-Policy") ?? "",
    "connect-src 'self'",
  );

  const rejected = await handler(
    new Request("http://localhost/", { method: "POST" }),
  );
  assertEquals(rejected.status, 405);
  assertEquals(rejected.headers.get("Allow"), "GET");
  assertEquals(rejected.headers.get("X-Frame-Options"), "DENY");
});

Deno.test("native Workbench labels persisted-project discovery literally unavailable", async () => {
  const unavailable = {
    schemaVersion: "native-workbench-project-catalog/1.0" as const,
    state: "unavailable" as const,
    projects: [] as const,
    reason: "Persisted project revisions could not be reopened exactly.",
  };
  const native = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([]),
    html: "unused",
    projectCatalog: () => Promise.resolve(unavailable),
  });
  const handler = createFocusedWorkspaceHandler({
    focus: new MutableFocus(undefined),
    workspaceId: "primary",
    native,
    projectCatalog: () => Promise.resolve(unavailable),
  });

  const projects = await handler(new Request("http://localhost/api/projects"));
  assertEquals(projects.status, 503);
  assertEquals((await projects.json()).state, "unavailable");
  const page = await handler(new Request("http://localhost/"));
  assertStringIncludes(await page.text(), "<strong>unavailable</strong>");
});

Deno.test("native Workbench serves a planning-only project without borrowing a thread", async () => {
  const project = projectFixture("project-one", "subject-one");
  const store = new EmptyThreadStore();
  const handler = createNativeWorkbenchHandler({
    store,
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("X-Casys-Data-Source"), "engineering-project-plan");
  assertEquals(body.surface, "planning");
  assertEquals(body.project.threadSnapshots, []);
  assertEquals(body.planning.technicalBaseline.status, "not-created");
  assertEquals(store.latestCalls, 0);
});

Deno.test("native Workbench keeps a durable unattached generic architecture snapshot out of preview until completion attaches it", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const projects = new ProjectStore([
    genericArchitectureProject("queued", r2, r3),
  ]);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: projects,
    projectId: "generic-architecture-project",
    subjectId: r2.subject.id,
    html: "unused",
  });

  for (const status of ["queued", "running", "publishing", "failed"] as const) {
    projects.replace(genericArchitectureProject(status, r2, r3));
    assertEquals(await previewThreadId(handler), r2.id);
  }

  projects.replace(genericArchitectureProject("completed", r2, r3));
  assertEquals(await previewThreadId(handler), r3.id);
});

Deno.test("native Workbench labels a dangling decision evidence reference instead of failing the projection", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  const withDanglingDecision: EngineeringProjectSnapshot = {
    ...project,
    decisions: [{
      id: "decision:abandoned-work",
      phaseId: "architecture",
      title: "Approve work that was later abandoned",
      question: "Should the abandoned binding be executed?",
      status: "required",
      requestedAt: "2026-08-08T05:10:00.000Z",
      inputEvidenceRefs: [{
        snapshotId: r3.id,
        snapshotRevision: r3.revision,
        kind: "artifact",
        id: "artifact-that-never-existed",
      }],
      approvalIds: [],
    }],
  };
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([withDanglingDecision]),
    projectId: "generic-architecture-project",
    subjectId: r2.subject.id,
    html: "unused",
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.surface, "evidence");
  assertEquals(body.unresolvedEvidenceReferences.length, 1);
  assertEquals(
    body.unresolvedEvidenceReferences[0].path,
    "$.decisions[0].inputEvidenceRefs[0]",
  );
  assertEquals(
    Object.keys(body.unresolvedEvidenceReferences[0]).toSorted(),
    ["message", "path"],
  );
});

Deno.test("native Workbench applies the engineering-case read model after pure projection", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    engineeringCaseCaptures: {
      mechanicalProof: { read: () => Promise.resolve(undefined) },
      sensitivityStudy: { read: () => Promise.resolve(undefined) },
      printabilityCheck: { read: () => Promise.resolve(undefined) },
      printEstimate: { read: () => Promise.resolve(undefined) },
      dfmCheck: { read: () => Promise.resolve(undefined) },
    },
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.surface, "evidence");
  assertEquals(body.thread.engineeringCases, {
    schemaVersion: "engineering-cases/1.0",
    status: "observed",
    coverage: [
      { family: "mechanical-proof", status: "observed" },
      { family: "sensitivity-study", status: "observed" },
      { family: "printability-check", status: "observed" },
      { family: "print-estimate", status: "observed" },
      { family: "dfm-check", status: "observed" },
    ],
    cases: [],
    issues: [],
  });
});

Deno.test("native Workbench applies source-file and requirements-target enrichers after pure projection", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  let workspaceLoads = 0;
  let requirementReads = 0;
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    technicalCompilationAdmissions: {
      read: () => Promise.resolve(undefined),
    },
    projectSourceWorkspace: {
      load: () => {
        workspaceLoads += 1;
        return Promise.reject(new Error("no workspace for this snapshot"));
      },
      loadAtFresh: () => {
        workspaceLoads += 1;
        return Promise.reject(new Error("no workspace for this snapshot"));
      },
    },
    requirementsCaptures: {
      read: () => {
        requirementReads += 1;
        return Promise.resolve(undefined);
      },
    },
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.surface, "evidence");
  assertEquals(body.thread.sourceFiles, {
    schemaVersion: "thread-source-files/1.0",
    status: "unavailable",
    files: [],
  });
  assertEquals(
    body.thread.requirements.every((item: { targetElementId?: string }) =>
      item.targetElementId === undefined
    ),
    true,
  );
  assertEquals(workspaceLoads, 0);
  assertEquals(requirementReads, 0);
});

Deno.test("native Workbench publishes the product-navigation slice from the architecture capture port", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    productStructureCaptures: {
      read: () => Promise.resolve(undefined),
    },
  });
  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.thread.productNavigation, {
    schemaVersion: "product-navigation-query/2.0",
    status: "unavailable",
    roots: [],
    children: [],
    attachments: {
      sources: [],
      geometry: [],
      physics: [],
      requirements: [],
    },
  });
});

Deno.test("native Workbench product-navigation GET publishes exact roots and default projection", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
  });
  const roots = await (await handler(
    new Request("http://localhost/api/thread/product-navigation?view=roots"),
  )).json();
  assertEquals(roots.status, "observed");
  assertEquals(roots.focus.element.elementId, "sys-def-001");
  assertEquals(
    roots.basis.architectureArtifactId,
    `architecture-${fixture.fingerprint.digest}`,
  );
  assertEquals(
    roots.basis.architectureFingerprint,
    `sha256:${fixture.fingerprint.digest}`,
  );
  const def = await (await handler(
    new Request("http://localhost/api/thread/product-navigation"),
  )).json();
  assertEquals(def.status, "observed");
  assertEquals(def.roots[0]?.element.elementId, "sys-def-001");
  assertEquals(
    def.children.map((node: { element: { elementId: string } }) =>
      node.element.elementId
    ),
    ["alpha-use-001"],
  );
  assertEquals(def.basis.architectureArtifactId, roots.basis.architectureArtifactId);
});

Deno.test("native Workbench product-navigation GET stays on the declared Thread tip", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const descendant: ThreadSnapshot = {
    ...fixture.snapshot,
    id: `${fixture.snapshot.subject.id}:r2-undeclared`,
    revision: fixture.snapshot.revision + 1,
    previous: {
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
    },
  };
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot, descendant]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
  });
  const roots = await (await handler(
    new Request("http://localhost/api/thread/product-navigation?view=roots"),
  )).json();
  assertEquals(roots.status, "observed");
  assertEquals(roots.basis.threadSnapshotId, fixture.snapshot.id);
  assertEquals(roots.basis.threadRevision, fixture.snapshot.revision);
  assertEquals(roots.basis.threadSubjectId, fixture.snapshot.subject.id);
  const def = await (await handler(
    new Request("http://localhost/api/thread/product-navigation"),
  )).json();
  assertEquals(def.status, "observed");
  assertEquals(def.basis.threadSnapshotId, fixture.snapshot.id);
  assertEquals(def.basis.threadRevision, fixture.snapshot.revision);
  assertEquals(def.basis.threadSubjectId, fixture.snapshot.subject.id);
});

Deno.test("native Workbench product-navigation children and neighborhood GET stay exact to the semantic root or a PartUsage", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
  });
  for (const view of ["children", "neighborhood"]) {
    const root = await (await handler(
      new Request(
        `http://localhost/api/thread/product-navigation?view=${view}&kind=part-definition&id=sys-def-001`,
      ),
    )).json();
    assertEquals(root.status, "observed", view);
    assertEquals(root.schemaVersion, "product-explore/1.0");
    assertEquals(root.focus.element, {
      elementKind: "PartDefinition",
      elementId: "sys-def-001",
    });
    assertEquals(root.focus.occurrence, undefined);
    assertEquals(
      root.children.map((node: { element: { elementId: string } }) =>
        node.element.elementId
      ),
      ["alpha-use-001"],
    );

    const usage = await (await handler(
      new Request(
        `http://localhost/api/thread/product-navigation?view=${view}&kind=part-usage&id=alpha-use-001&path=alpha-use-001`,
      ),
    )).json();
    assertEquals(usage.status, "observed", view);
    assertEquals(usage.focus.element, {
      elementKind: "PartUsage",
      elementId: "alpha-use-001",
    });
    assertEquals(usage.focus.occurrence.path, ["alpha-use-001"]);

    const nested = await (await handler(
      new Request(
        `http://localhost/api/thread/product-navigation?view=${view}&kind=part-definition&id=alpha-def-001`,
      ),
    )).json();
    assertEquals(nested.status, "unattached", view);
    assertEquals(nested.focus, undefined);
    assertEquals(nested.children, []);
    assertEquals(nested.diagnostics[0]?.code, "selection.unattached");
    assertEquals(
      nested.basis.architectureArtifactId,
      root.basis.architectureArtifactId,
    );

    for (
      const url of [
        `http://localhost/api/thread/product-navigation?view=${view}&id=sys-def-001`,
        `http://localhost/api/thread/product-navigation?view=${view}&id=alpha-def-001`,
        `http://localhost/api/thread/product-navigation?view=${view}&kind=latest&id=sys-def-001`,
        `http://localhost/api/thread/product-navigation?view=${view}&kind=part&id=sys-def-001`,
      ]
    ) {
      const response = await handler(new Request(url));
      assertEquals(response.status, 400, url);
      assertStringIncludes(await response.text(), "kind");
    }
  }
});

Deno.test("native Workbench product-navigation GET refuses latest in exact paths", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
  });
  for (
    const url of [
      "http://localhost/api/thread/product-navigation?view=path&usagePath=latest",
      "http://localhost/api/thread/product-navigation?view=path&usagePath=foo,latest",
      "http://localhost/api/thread/product-navigation?view=children&path=latest",
    ]
  ) {
    const response = await handler(new Request(url));
    assertEquals(response.status, 400, url);
    assertStringIncludes(await response.text(), "latest");
  }
});

Deno.test("native Workbench product-navigation GET is read-only and shares the application port", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    productStructureCaptures: {
      read: () => Promise.resolve(undefined),
    },
  });
  const post = await handler(
    new Request("http://localhost/api/thread/product-navigation", {
      method: "POST",
    }),
  );
  assertEquals(post.status, 405);
  const response = await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=search&id=def-system",
    ),
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.schemaVersion, "product-search/1.0");
  assertEquals(body.status, "unavailable");
});

Deno.test("native Workbench product-navigation GET publishes authoring attachments from the shared port", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const workspace = await authoringWorkspaceForFixture(projectId, fixture);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
    projectSourceWorkspace: workspace.store,
  });
  const response = await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001",
    ),
  );
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.schemaVersion, "product-inspect/1.0");
  assertEquals(body.status, "observed");
  assertEquals(body.grants, "none");
  assertEquals(
    body.authoringAttachments.attachments.map((item: { attachmentId: string }) =>
      item.attachmentId
    ),
    ["att-system"],
  );
  assertEquals(body.authoringAttachments.attachments[0]?.target, {
    elementId: "sys-def-001",
    elementKind: "PartDefinition",
  });
  assertEquals(body.authoringAttachments.attachments[0]?.basisStatus, "exact-basis");
  const usage = await (await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-usage&id=alpha-use-001&path=alpha-use-001",
    ),
  )).json();
  assertEquals(usage.authoringAttachments.attachments, []);
  const projection = await (await handler(
    new Request("http://localhost/api/thread/product-navigation"),
  )).json();
  assertEquals(projection.attachments.sources, []);
  assertEquals("workspaceRevision" in projection, false);
  assertEquals(Array.isArray(projection.attachments), false);
});

Deno.test("native Workbench product-navigation authoring attachments GET refuses invalid input and POST", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
    projectSourceWorkspace: {
      load: () => Promise.resolve(emptyProjectSourceWorkspace(projectId)),
      loadAtFresh: () => Promise.resolve(emptyProjectSourceWorkspace(projectId)),
    },
  });
  const post = await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=authoring-attachments",
      { method: "POST" },
    ),
  );
  assertEquals(post.status, 405);
  for (
    const url of [
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=latest&id=sys-def-001",
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=latest",
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&path=latest",
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&pageSize=latest",
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&pageSize=51",
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&cursor=latest",
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&cursor=not-a-cursor",
    ]
  ) {
    const response = await handler(new Request(url));
    assertEquals(response.status, 400, url);
  }
});

Deno.test("native Workbench authoring attachments GET pins nextCursor across two requests", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const projectId = "project.verified-architecture";
  const project = {
    project: {
      id: projectId,
      subjectId: fixture.snapshot.subject.id,
    },
    threadSnapshots: [{
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
      subjectId: fixture.snapshot.subject.id,
    }],
  } as unknown as EngineeringProjectSnapshot;
  const workspace = await authoringWorkspaceForFixture(projectId, fixture, {
    extraFile: true,
  });
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([fixture.snapshot]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: fixture.snapshot.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
    projectSourceWorkspace: workspace.store,
  });
  const first = await (await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&pageSize=1",
    ),
  )).json();
  assertEquals(first.status, "observed");
  assertEquals(
    first.authoringAttachments.attachments.map((item: { attachmentId: string }) =>
      item.attachmentId
    ),
    ["att-extra"],
  );
  assertEquals(typeof first.authoringAttachments.nextCursor, "string");
  const second = await (await handler(
    new Request(
      `http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&pageSize=1&cursor=${
        encodeURIComponent(first.authoringAttachments.nextCursor)
      }`,
    ),
  )).json();
  assertEquals(second.status, "observed");
  assertEquals(
    second.authoringAttachments.workspaceRevision,
    first.authoringAttachments.workspaceRevision,
  );
  assertEquals(
    second.authoringAttachments.attachments.map((item: { attachmentId: string }) =>
      item.attachmentId
    ),
    ["att-system"],
  );
  const forged = await handler(
    new Request(
      `http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001&cursor=${
        encodeURIComponent(
          btoa(JSON.stringify({
            kind: "attachment-list",
            workspaceRevision: first.workspaceRevision,
            filter: {
              target: { elementId: "sys-def-001", elementKind: "PartDefinition" },
            },
          })),
        )
      }`,
    ),
  );
  assertEquals(forged.status, 400);
});

Deno.test("native Workbench hides durable unattached generic requirements and geometry snapshots", async () => {
  for (
    const operation of [
      MODEL_WRITE_REQUIREMENTS_OPERATION,
      DESIGN_WRITE_GEOMETRY_OPERATION,
    ]
  ) {
    const r2 = genericArchitectureThreadSnapshot(2);
    const r3 = genericArchitectureThreadSnapshot(3, r2);
    const projects = new ProjectStore([
      projectWithOperation(genericArchitectureProject("queued", r2, r3), operation),
    ]);
    const handler = createNativeWorkbenchHandler({
      store: new ThreadStore([r2, r3]),
      projectStore: projects,
      projectId: "generic-architecture-project",
      subjectId: r2.subject.id,
      html: "unused",
    });

    for (const status of ["queued", "running", "publishing", "failed"] as const) {
      projects.replace(
        projectWithOperation(genericArchitectureProject(status, r2, r3), operation),
      );
      assertEquals(await previewThreadId(handler), r2.id, operation.id);
    }

    projects.replace(
      projectWithOperation(genericArchitectureProject("completed", r2, r3), operation),
    );
    assertEquals(await previewThreadId(handler), r3.id, operation.id);
  }
});

Deno.test("native Workbench hides an unattached technical compilation seal until project completion", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const projects = new ProjectStore([
    projectWithOperation(
      genericArchitectureProject("running", r2, r3),
      COMPILE_SEAL_ADMISSION_OPERATION,
    ),
  ]);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: projects,
    projectId: "generic-architecture-project",
    subjectId: r2.subject.id,
    html: "unused",
  });

  for (const status of ["running", "publishing", "failed"] as const) {
    projects.replace(
      projectWithOperation(
        genericArchitectureProject(status, r2, r3),
        COMPILE_SEAL_ADMISSION_OPERATION,
      ),
    );
    assertEquals(await previewThreadId(handler), r2.id, status);
  }

  projects.replace(
    projectWithOperation(
      genericArchitectureProject("completed", r2, r3),
      COMPILE_SEAL_ADMISSION_OPERATION,
    ),
  );
  assertEquals(await previewThreadId(handler), r3.id);
});

Deno.test("native Workbench classifies every known durable writer before attachment", () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const operations = [
    VERIFY_SEAL_PROOF_CASE_OPERATION,
    VERIFY_RUN_FEA_STATIC_PROOF_OPERATION,
    COMPILE_SEAL_ADMISSION_OPERATION,
    DESIGN_EXECUTE_BUILD123D_OPERATION,
    VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
    SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
    SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
    VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
    ARCHIVE_LINEAGE_OPERATION,
    ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
    ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
    MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
  ] as const;
  for (const operation of operations) {
    for (const status of ["running", "publishing", "failed"] as const) {
      const project = projectWithOperation(
        genericArchitectureProject(status, r2, r3),
        operation,
      );
      assertEquals(
        hasUnattachedDurableProjectOperationForTest(project),
        true,
        `${operation.id}@${operation.version} ${status}`,
      );
    }
    const completed = projectWithOperation(
      genericArchitectureProject("completed", r2, r3),
      operation,
    );
    assertEquals(
      hasUnattachedDurableProjectOperationForTest(completed),
      false,
      `${operation.id}@${operation.version} completed`,
    );
  }
});

Deno.test("native Workbench follows durable focus without a static target", async () => {
  const first = projectFixture("project-one", "subject-one");
  const second = projectFixture("project-two", "subject-two");
  const focus = new MutableFocus(focusSnapshot("project-one"));
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([first, second]),
    cockpitFocus: focus,
    workspaceId: "primary",
    html: "unused",
  });

  let response = await handler(new Request("http://localhost/api/thread/workbench"));
  assertEquals((await response.json()).project.project.id, "project-one");

  focus.value = focusSnapshot("project-two", 2);
  response = await handler(new Request("http://localhost/api/thread/workbench"));
  assertEquals((await response.json()).project.project.id, "project-two");
});

Deno.test("native Workbench resolves hashed Vite assets and rejects traversal", () => {
  const directory = "/tmp/ui-dist";
  assertEquals(
    resolveWorkbenchUiAssetPath(directory, "/assets/app-aaaa.js"),
    "/tmp/ui-dist/assets/app-aaaa.js",
  );
  assertEquals(
    resolveWorkbenchUiAssetPath(directory, "/assets/app-aaaa.css"),
    "/tmp/ui-dist/assets/app-aaaa.css",
  );
  assertEquals(
    resolveWorkbenchUiAssetPath(directory, "/assets/../secret.js"),
    undefined,
  );
  assertEquals(
    resolveWorkbenchUiAssetPath(directory, "/assets/%2e%2e/secret.js"),
    undefined,
  );
  assertEquals(
    resolveWorkbenchUiAssetPath(directory, "/native-workbench.html"),
    undefined,
  );
  assertEquals(
    resolveWorkbenchUiAssetPath(directory, "/api/thread/workbench"),
    undefined,
  );
});

Deno.test("native Workbench serves hashed Vite JS and CSS without a command path", async () => {
  const directory = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${directory}/assets`);
    await Deno.writeTextFile(
      `${directory}/native-workbench.html`,
      `<html><script type="module" src="./assets/app-aaaa.js"></script></html>`,
    );
    await Deno.writeTextFile(
      `${directory}/assets/app-aaaa.js`,
      "export const ready = true;\n",
    );
    await Deno.writeTextFile(
      `${directory}/assets/app-aaaa.css`,
      "body{color:red}\n",
    );
    const project = projectFixture("project-one", "subject-one");
    const handler = createNativeWorkbenchHandler({
      store: new EmptyThreadStore(),
      projectStore: new ProjectStore([project]),
      projectId: project.project.id,
      subjectId: project.project.subjectId,
      htmlPath: `${directory}/native-workbench.html`,
    });

    const page = await handler(new Request("http://localhost/"));
    assertEquals(page.status, 200);
    assertStringIncludes(await page.text(), "./assets/app-aaaa.js");
    assertStringIncludes(
      page.headers.get("Content-Security-Policy") ?? "",
      "script-src 'self'",
    );

    const js = await handler(
      new Request("http://localhost/assets/app-aaaa.js"),
    );
    assertEquals(js.status, 200);
    assertStringIncludes(js.headers.get("Content-Type") ?? "", "javascript");
    assertEquals(await js.text(), "export const ready = true;\n");

    const css = await handler(
      new Request("http://localhost/assets/app-aaaa.css"),
    );
    assertEquals(css.status, 200);
    assertStringIncludes(css.headers.get("Content-Type") ?? "", "text/css");
    assertEquals(await css.text(), "body{color:red}\n");

    assertEquals(
      (await handler(new Request("http://localhost/assets/missing.js"))).status,
      404,
    );
    assertEquals(
      (await handler(new Request("http://localhost/api/project/commands"))).status,
      404,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("native Workbench keeps its BFF read-only and frame-protected", async () => {
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "<html><body>Workbench</body></html>",
  });

  const page = await handler(new Request("http://localhost/"));
  assertEquals(page.status, 200);
  assertStringIncludes(await page.text(), "Workbench");
  assertStringIncludes(
    page.headers.get("Content-Security-Policy") ?? "",
    "frame-ancestors 'none'",
  );
  assertEquals(page.headers.get("X-Frame-Options"), "DENY");

  const rejected = await handler(
    new Request("http://localhost/api/thread/workbench", {
      method: "POST",
    }),
  );
  assertEquals(rejected.status, 405);
  assertEquals(rejected.headers.get("Allow"), "GET");
  assertEquals(
    (await handler(new Request("http://localhost/api/project/commands"))).status,
    404,
  );
});

Deno.test("native Workbench serves declared fleet identity without health", async () => {
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "<html><body>Workbench</body></html>",
    cockpitFleet: () =>
      Promise.resolve({
        servers: [{
          id: "syson",
          displayName: "SysON",
          role: "System model",
          required: true,
        }],
      }),
  });

  const response = await handler(new Request("http://localhost/api/fleet"));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    servers: [{
      id: "syson",
      displayName: "SysON",
      role: "System model",
      required: true,
    }],
  });
  assertEquals(
    (await handler(
      new Request("http://localhost/api/fleet", { method: "POST" }),
    )).status,
    405,
  );
});

Deno.test("native Workbench degrades when declared fleet is unavailable", async () => {
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "<html><body>Workbench</body></html>",
  });
  assertEquals(
    (await handler(new Request("http://localhost/api/fleet"))).status,
    404,
  );
});

Deno.test("native Workbench API routes reject non-GET verbs and keep SSE on GET", async () => {
  const digest = "a".repeat(64);
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "<html><body>Workbench</body></html>",
    assetReader: () => Promise.resolve(undefined),
    draftAssetReader: () => Promise.resolve(undefined),
    cockpitFleet: () =>
      Promise.resolve({
        servers: [{
          id: "syson",
          displayName: "SysON",
          role: "System model",
          required: true,
        }],
      }),
    pollIntervalMs: 50,
  });

  const routes = [
    "/healthz",
    "/api/thread/workbench",
    "/api/thread/product-navigation",
    "/api/thread/workbench/events",
    "/api/fleet",
    `/api/thread/assets/${digest}.glb`,
    `/api/thread/assets/${digest}.step`,
    `/api/draft-assets/${digest}`,
    "/",
    "/native-workbench.html",
  ];
  for (const path of routes) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const rejected = await handler(
        new Request(`http://localhost${path}`, { method }),
      );
      assertEquals(rejected.status, 405, `${method} ${path}`);
      assertEquals(rejected.headers.get("Allow"), "GET");
    }
  }

  const sse = await handler(
    new Request("http://localhost/api/thread/workbench/events"),
  );
  assertEquals(sse.status, 200);
  assertEquals(
    sse.headers.get("Content-Type"),
    "text/event-stream; charset=utf-8",
  );
  await sse.body?.cancel();

  assertEquals(
    (await handler(
      new Request("http://localhost/api/review-intents", { method: "POST" }),
    )).status,
    404,
  );
  assertEquals(
    (await handler(new Request("http://localhost/api/review-intents"))).status,
    404,
  );
});

Deno.test("native Workbench carries the assembly-integrity index through both GET and SSE projections", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  const emptyAssemblyIntegrityCaptures = {
    observations: { read: () => Promise.resolve(undefined) },
    evaluations: { read: () => Promise.resolve(undefined) },
    closeouts: { read: () => Promise.resolve(undefined) },
  };
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    assemblyIntegrityCaptures: emptyAssemblyIntegrityCaptures,
    pollIntervalMs: 50,
  });

  const get = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals(get.status, 200);
  const projection = await get.json() as {
    surface: string;
    thread?: {
      assemblyIntegrity?: {
        schemaVersion?: string;
        status?: string;
        family?: string;
        chains?: unknown[];
      };
    };
  };
  assertEquals(projection.surface, "evidence");
  assertEquals(projection.thread?.assemblyIntegrity, {
    schemaVersion: "thread-assembly-integrity/1.0",
    family: "assembly-integrity",
    status: "not-recorded",
    chains: [],
  });

  const events = await handler(
    new Request("http://localhost/api/thread/workbench/events"),
  );
  const reader = events.body!.getReader();
  const first = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(first.value);
  assertStringIncludes(text, "event: workbench-snapshot");
  assertStringIncludes(text, '"assemblyIntegrity"');
  assertStringIncludes(text, '"not-recorded"');
});

Deno.test("native Workbench SSE invalidates a fixed project and Thread tip when its authoring workspace advances", async () => {
  const fixture = await verifiedArchitectureNavigationFixture();
  const r2 = fixture.snapshot;
  const r3: ThreadSnapshot = {
    ...fixture.snapshot,
    id: `${fixture.snapshot.id}:r2`,
    revision: fixture.snapshot.revision + 1,
    previous: {
      snapshotId: fixture.snapshot.id,
      revision: fixture.snapshot.revision,
    },
  };
  const project = genericArchitectureProject("completed", r2, r3);
  const projectId = project.project.id;
  let workspace = await authoringWorkspaceAtRevision(projectId, fixture, 15);
  const revisions = new Map<number, ProjectSourceWorkspaceState>([
    [workspace.workspaceRevision, workspace],
  ]);
  const workspaceStore = {
    load: () => Promise.resolve(workspace),
    loadAtFresh: (_projectId: string, workspaceRevision: number) => {
      const revision = revisions.get(workspaceRevision);
      if (!revision) {
        return Promise.reject(new Error(`missing revision ${workspaceRevision}`));
      }
      return Promise.resolve(revision);
    },
  };
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId,
    subjectId: r3.subject.id,
    html: "unused",
    productStructureCaptures: fixture.reader,
    sysmlSourceAnalysis: fixture.sourceAnalysis,
    projectSourceWorkspace: workspaceStore,
    pollIntervalMs: 5,
  });

  const authoringR15 = await (await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001",
    ),
  )).json();
  assertEquals(authoringR15.authoringAttachments.workspaceRevision, 15);
  assertEquals(authoringR15.authoringAttachments.attachments.length, 1);

  const events = await handler(
    new Request("http://localhost/api/thread/workbench/events"),
  );
  const reader = events.body!.getReader();
  const first = await reader.read();
  const firstEvent = workbenchSnapshotEvent(new TextDecoder().decode(first.value));
  assertEquals(firstEvent.snapshot.project.revision, project.revision);
  assertEquals(firstEvent.snapshot.thread.id, r3.id);
  assertStringIncludes(
    firstEvent.id,
    `workspace:15:${workspace.lastEventFingerprint!.algorithm}:${
      workspace.lastEventFingerprint!.digest
    }`,
  );

  workspace = (await applyProjectSourceWorkspaceCommand(workspace, {
    projectId,
    mutationId: "detach-at-r16",
    expectedWorkspaceRevision: 15,
    mutation: {
      kind: "attachment_detach",
      attachmentId: "att-system",
      activeAttachmentRevision: 1,
    },
  })).state;
  revisions.set(workspace.workspaceRevision, workspace);
  assertEquals(workspace.workspaceRevision, 16);

  const authoringR16 = await (await handler(
    new Request(
      "http://localhost/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=sys-def-001",
    ),
  )).json();
  assertEquals(authoringR16.authoringAttachments.workspaceRevision, 16);
  assertEquals(authoringR16.authoringAttachments.attachments, []);
  assertEquals(
    authoringR16.authoringAttachments.workspaceEventFingerprint ===
      authoringR15.authoringAttachments.workspaceEventFingerprint,
    false,
  );

  const second = await reader.read();
  await reader.cancel();
  const secondEvent = workbenchSnapshotEvent(
    new TextDecoder().decode(second.value),
  );
  assertEquals(secondEvent.id === firstEvent.id, false);
  assertEquals(secondEvent.snapshot.project.revision, project.revision);
  assertEquals(secondEvent.snapshot.thread.id, r3.id);
  assertStringIncludes(
    secondEvent.id,
    `workspace:16:${workspace.lastEventFingerprint!.algorithm}:${
      workspace.lastEventFingerprint!.digest
    }`,
  );
});

Deno.test("native Workbench refuses mutated canonical content-addressed bytes", async () => {
  const digest = "a".repeat(64);
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    assetReader: () => Promise.resolve(new TextEncoder().encode("mutated")),
  });

  const response = await handler(
    new Request(`http://localhost/api/thread/assets/${digest}.gltf`),
  );
  assertEquals(response.status, 404);
});

Deno.test("native Workbench serves exact canonical GLB bytes with their binary media type", async () => {
  const bytes = new TextEncoder().encode("exact-glb-bytes");
  const digest = await sha256Hex(bytes);
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    assetReader: () => Promise.resolve(bytes),
  });

  const response = await handler(
    new Request(`http://localhost/api/thread/assets/${digest}.glb`),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "model/gltf-binary");
  assertEquals(new Uint8Array(await response.arrayBuffer()), bytes);
});

Deno.test("native Workbench serves exact canonical STEP bytes with model/step", async () => {
  const bytes = new TextEncoder().encode("exact-step-bytes");
  const digest = await sha256Hex(bytes);
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    assetReader: () => Promise.resolve(bytes),
  });

  const response = await handler(
    new Request(`http://localhost/api/thread/assets/${digest}.step`),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "model/step");
  assertEquals(new Uint8Array(await response.arrayBuffer()), bytes);
});

Deno.test("native Workbench refuses mutated draft bytes under a signed digest", async () => {
  const digest = "a".repeat(64);
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    draftAssetReader: () => Promise.resolve(new TextEncoder().encode("mutated")),
  });

  const response = await handler(
    new Request(`http://localhost/api/draft-assets/${digest}`),
  );
  assertEquals(response.status, 404);
});

Deno.test("native Workbench serves only exact draft bytes under their SHA-256", async () => {
  const bytes = new TextEncoder().encode("reviewed-draft-bytes");
  const digest = await sha256Hex(bytes);
  const project = projectFixture("project-one", "subject-one");
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    draftAssetReader: (observedDigest) => {
      assertEquals(observedDigest, digest);
      return Promise.resolve(bytes);
    },
  });

  const response = await handler(
    new Request(`http://localhost/api/draft-assets/${digest}`),
  );
  assertEquals(response.status, 200);
  assertEquals(new Uint8Array(await response.arrayBuffer()), bytes);
});

Deno.test("native Workbench reports an unknown selected project without substituting another one", async () => {
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([]),
    cockpitFocus: new MutableFocus(focusSnapshot("missing")),
    html: "unused",
  });

  const response = await handler(new Request("http://localhost/api/thread/workbench"));
  assertEquals(response.status, 404);
  assertEquals((await response.json()).error, "engineering_project_not_found");
});

function projectFixture(
  projectId: string,
  subjectId: string,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: `${projectId}:r1`,
    revision: 1,
    generatedAt: "2026-08-03T12:00:00.000Z",
    project: {
      id: projectId,
      name: projectId,
      subjectId,
      objective: { title: "Project", statement: "Project" },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function genericArchitectureProject(
  status: "queued" | "running" | "publishing" | "failed" | "completed",
  r2: ThreadSnapshot,
  r3: ThreadSnapshot,
): EngineeringProjectSnapshot {
  const completed = status === "completed";
  const evidence = {
    snapshotId: r3.id,
    snapshotRevision: r3.revision,
    kind: "artifact" as const,
    id: r3.artifacts[0]!.id,
  };
  const reference = (snapshot: ThreadSnapshot) => ({
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  });
  const generatedAt = "2026-08-08T05:00:00.000Z";
  const briefFingerprint = {
    algorithm: "sha256" as const,
    digest: "e".repeat(64),
  };
  const approvedBriefBasis = {
    kind: "approved-brief" as const,
    projectId: "generic-architecture-project",
    projectSnapshotId: "generic-architecture-project:r1",
    projectRevision: 2,
    briefId: "generic-architecture-project:brief",
    briefSnapshotId: "generic-architecture-project:brief:r1:fixture",
    briefRevision: 1,
    approvedBriefFingerprint: briefFingerprint,
  };
  const runBasis = {
    kind: "thread-snapshot" as const,
    ...reference(r2),
  };
  return {
    schemaVersion: "4.0",
    id: "generic-architecture-project:r1",
    revision: 2,
    generatedAt,
    previous: {
      snapshotId: "generic-architecture-project:r0-start",
      revision: 1,
    },
    project: {
      id: "generic-architecture-project",
      name: "Generic architecture project",
      subjectId: r2.subject.id,
      objective: {
        title: "Keep the approved generic architecture traceable.",
        statement: "Keep the approved generic architecture traceable.",
      },
    },
    framing: {
      intent: {
        statement: "Keep the approved generic architecture traceable.",
        source: { kind: "human", reference: "paired-conversation" },
        capturedAt: generatedAt,
        capturedBy: { id: "human:owner", origin: "human" },
      },
      questions: [],
      answers: [],
      currentBrief: {
        briefId: "generic-architecture-project:brief",
        id: "generic-architecture-project:brief:r1:fixture",
        revision: 1,
        items: [{
          id: "objective",
          kind: "objective",
          statement: "Keep the approved generic architecture traceable.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement: "Keep the approved generic architecture traceable.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement: "The architecture remains bound to exact evidence.",
          sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
        }],
        proposedAt: generatedAt,
        proposedBy: { id: "agent:planner", origin: "agent" },
      },
      currentBriefApproval: {
        briefSnapshotId: "generic-architecture-project:brief:r1:fixture",
        briefRevision: 1,
        status: "approved",
        inputFingerprint: briefFingerprint,
        requestedAt: generatedAt,
        decidedAt: generatedAt,
        decidedBy: { id: "human:owner", origin: "human" },
        rationale: "Confirmed in the paired conversation.",
      },
    },
    threadSnapshots: completed ? [reference(r2), reference(r3)] : [reference(r2)],
    phases: [{
      id: "architecture",
      name: "Architecture",
      order: 1,
      description: "Publish the generic SysON architecture.",
      workItemIds: ["author-generic-architecture"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "author-generic-architecture",
      activityId: "activity:author-generic-architecture",
      phaseId: "architecture",
      title: "Author generic architecture",
      description: "Run the registered generic architecture operation.",
      kind: "architect",
      operation: {
        id: MODEL_WRITE_ARCHITECTURE_OPERATION.id,
        version: MODEL_WRITE_ARCHITECTURE_OPERATION.version,
        bindings: [],
      },
      status: completed ? "completed" : "in-progress",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: completed ? [evidence] : [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run:generic-architecture",
      workItemId: "author-generic-architecture",
      status,
      summary: "Author the approved generic architecture.",
      queuedAt: "2026-08-08T04:45:00.000Z",
      basis: runBasis,
      inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      ...(status === "queued" ? {} : {
        startedAt: "2026-08-08T04:46:00.000Z",
        claimedAt: "2026-08-08T04:46:00.000Z",
        claimedBy: { origin: "agent" as const, id: "agent:engineering" },
      }),
      ...(completed
        ? {
          completedAt: "2026-08-08T04:47:00.000Z",
          resultSnapshot: reference(r3),
          evidenceRefs: [evidence],
        }
        : status === "failed"
        ? {
          completedAt: "2026-08-08T04:47:00.000Z",
          failure: {
            code: "readback-unavailable",
            message: "r3 durable but unattached",
          },
          evidenceRefs: [],
        }
        : { evidenceRefs: [] }),
    }],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "start-generic-architecture",
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: {
        snapshotId: "generic-architecture-project:r0-start",
        revision: 1,
      },
    }, {
      commandId: "approve-generic-architecture-brief",
      type: "project.brief-approve",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: {
        snapshotId: "generic-architecture-project:r1",
        revision: 2,
      },
      approvedBriefBasis,
    }],
  };
}

function projectWithOperation(
  project: EngineeringProjectSnapshot,
  operation: { readonly id: string; readonly version: string },
): EngineeringProjectSnapshot {
  return {
    ...project,
    workItems: project.workItems.map((item) => ({
      ...item,
      operation: { ...operation, bindings: item.operation?.bindings ?? [] },
    })),
  };
}

function genericArchitectureThreadSnapshot(
  revision: number,
  previous?: ThreadSnapshot,
): ThreadSnapshot {
  const at = "2026-08-08T05:00:00.000Z";
  const digest = String(revision).repeat(64);
  const artifactId = `architecture-${digest}`;
  const changeId = `generic-architecture-change-r${revision}`;
  return {
    schemaVersion: "1.0",
    id: `generic-architecture-thread-r${revision}`,
    revision,
    ...(previous
      ? { previous: { snapshotId: previous.id, revision: previous.revision } }
      : {}),
    generatedAt: at,
    subject: {
      id: "project:generic-architecture",
      name: "Generic architecture",
      kind: "system",
      version: String(revision),
      modelArtifactId: artifactId,
    },
    freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: changeId,
      name: "Record generic architecture",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: `generic-architecture-artifact-r${revision}`,
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary: "Recorded one exact generic architecture artifact.",
        afterFingerprint: { algorithm: "sha256", digest },
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Generic architecture",
      kind: "sysml-model",
      version: digest,
      fingerprint: { algorithm: "sha256", digest },
      uri: `casys://architecture-capture/sha256/${digest}`,
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: `run:generic-architecture-r${revision}`,
      },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `generic-architecture-provenance-r${revision}`,
      relation: "changes",
      from: { kind: "change", id: changeId },
      to: { kind: "artifact", id: artifactId },
      rationale: "The exact snapshot records this generic architecture artifact.",
    }],
    proposedActions: [],
  };
}

async function previewThreadId(
  handler: (request: Request) => Promise<Response>,
): Promise<string> {
  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  assertEquals(response.status, 200);
  const body = await response.json() as {
    surface?: unknown;
    thread?: { id?: unknown };
  };
  assertEquals(body.surface, "evidence");
  if (typeof body.thread?.id !== "string") {
    throw new Error("expected an evidence Workbench thread id");
  }
  return body.thread.id;
}

function focusSnapshot(projectId: string, revision = 1): CockpitFocusSnapshot {
  return {
    schemaVersion: COCKPIT_FOCUS_SCHEMA_VERSION,
    workspaceId: "primary",
    revision,
    commandId: `focus-${revision}`,
    selectedAt: "2026-08-03T12:00:00.000Z",
    selectedBy: { kind: "agent", actorId: "mcp:test@1" },
    target: { kind: "project", projectId },
    ...(revision === 1 ? {} : { previous: { revision: revision - 1 } }),
  };
}

class EmptyThreadStore implements ThreadSnapshotStore {
  latestCalls = 0;

  get(_snapshotId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(undefined);
  }

  latest(_subjectId: string): Promise<ThreadSnapshot | undefined> {
    this.latestCalls += 1;
    return Promise.resolve(undefined);
  }

  save(_snapshot: ThreadSnapshot): Promise<void> {
    return Promise.resolve();
  }
}

async function authoringWorkspaceForFixture(
  projectId: string,
  fixture: Awaited<ReturnType<typeof verifiedArchitectureNavigationFixture>>,
  options: { extraFile?: boolean } = {},
) {
  let state = emptyProjectSourceWorkspace(projectId);
  state = (await applyProjectSourceWorkspaceCommand(state, {
    projectId,
    mutationId: "m1",
    expectedWorkspaceRevision: 0,
    mutation: {
      kind: "module_put",
      moduleId: "mod-a",
      slug: "mech",
      displayName: "Mech",
    },
  })).state;
  state = (await applyProjectSourceWorkspaceCommand(state, {
    projectId,
    mutationId: "f1",
    expectedWorkspaceRevision: 1,
    mutation: {
      kind: "file_put",
      fileId: "file-system",
      moduleId: "mod-a",
      logicalName: "system.py",
      role: "script",
      dependencies: [],
      resourceRef: sampleAgentResourceReference({
        name: "system.py",
        mimeType: "text/plain",
        byteCount: 1,
      }),
    },
  })).state;
  state = (await applyProjectSourceWorkspaceCommand(state, {
    projectId,
    mutationId: "a1",
    expectedWorkspaceRevision: 2,
    mutation: {
      kind: "attachment_put",
      attachmentId: "att-system",
      fileId: "file-system",
      role: { id: "design-source", version: 1 },
      target: { elementId: "sys-def-001", elementKind: "PartDefinition" },
      declaredAgainst: {
        thread: {
          snapshotId: fixture.snapshot.id,
          revision: fixture.snapshot.revision,
          subjectId: fixture.snapshot.subject.id,
        },
        architecture: {
          artifactId: `architecture-${fixture.fingerprint.digest}`,
          fingerprint: fixture.fingerprint,
          captureSchema: "architecture-capture/4.0",
        },
      },
    },
  })).state;
  if (options.extraFile) {
    state = (await applyProjectSourceWorkspaceCommand(state, {
      projectId,
      mutationId: "f-extra",
      expectedWorkspaceRevision: 3,
      mutation: {
        kind: "file_put",
        fileId: "file-extra",
        moduleId: "mod-a",
        logicalName: "extra.py",
        role: "script",
        dependencies: [],
        resourceRef: sampleAgentResourceReference({
          name: "extra.py",
          mimeType: "text/plain",
          byteCount: 1,
        }),
      },
    })).state;
    state = (await applyProjectSourceWorkspaceCommand(state, {
      projectId,
      mutationId: "a-extra",
      expectedWorkspaceRevision: 4,
      mutation: {
        kind: "attachment_put",
        attachmentId: "att-extra",
        fileId: "file-extra",
        role: { id: "design-source", version: 1 },
        target: { elementId: "sys-def-001", elementKind: "PartDefinition" },
        declaredAgainst: {
          thread: {
            snapshotId: fixture.snapshot.id,
            revision: fixture.snapshot.revision,
            subjectId: fixture.snapshot.subject.id,
          },
          architecture: {
            artifactId: `architecture-${fixture.fingerprint.digest}`,
            fingerprint: fixture.fingerprint,
            captureSchema: "architecture-capture/4.0",
          },
        },
      },
    })).state;
  }
  const revisions = new Map<number, ProjectSourceWorkspaceState>([
    [state.workspaceRevision, state],
  ]);
  return {
    state,
    store: {
      load: () => Promise.resolve(state),
      loadAtFresh: (_projectId: string, workspaceRevision: number) => {
        const named = revisions.get(workspaceRevision);
        if (!named) {
          return Promise.reject(new Error(`missing revision ${workspaceRevision}`));
        }
        return Promise.resolve(named);
      },
    },
  };
}

async function authoringWorkspaceAtRevision(
  projectId: string,
  fixture: Awaited<ReturnType<typeof verifiedArchitectureNavigationFixture>>,
  workspaceRevision: number,
): Promise<ProjectSourceWorkspaceState> {
  let state = (await authoringWorkspaceForFixture(projectId, fixture)).state;
  for (
    let revision = state.workspaceRevision + 1;
    revision <= workspaceRevision;
    revision++
  ) {
    state = (await applyProjectSourceWorkspaceCommand(state, {
      projectId,
      mutationId: `padding-${revision}`,
      expectedWorkspaceRevision: state.workspaceRevision,
      mutation: {
        kind: "module_put",
        moduleId: `module-${revision}`,
        slug: `module-${revision}`,
        displayName: `Module ${revision}`,
      },
    })).state;
  }
  return state;
}

function workbenchSnapshotEvent(text: string): {
  readonly id: string;
  readonly snapshot: {
    readonly project: { readonly revision: number };
    readonly thread: { readonly id: string };
  };
} {
  const id = /^id: (.+)$/m.exec(text)?.[1];
  const data = /^data: (.+)$/m.exec(text)?.[1];
  if (!id || !data) throw new Error("expected a workbench snapshot SSE event");
  return {
    id,
    snapshot: JSON.parse(data),
  };
}

class ThreadStore implements ThreadSnapshotStore {
  readonly #snapshots = new Map<string, ThreadSnapshot>();

  constructor(snapshots: readonly ThreadSnapshot[]) {
    for (const snapshot of snapshots) this.#snapshots.set(snapshot.id, snapshot);
  }

  get(snapshotId: string): Promise<ThreadSnapshot | undefined> {
    return Promise.resolve(this.#snapshots.get(snapshotId));
  }

  latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    const latest = [...this.#snapshots.values()]
      .filter((snapshot) => snapshot.subject.id === subjectId)
      .sort((left, right) => right.revision - left.revision)[0];
    return Promise.resolve(latest);
  }

  save(snapshot: ThreadSnapshot): Promise<void> {
    this.#snapshots.set(snapshot.id, snapshot);
    return Promise.resolve();
  }
}

class ProjectStore implements EngineeringProjectRevisionStore {
  readonly #projects = new Map<string, EngineeringProjectSnapshot>();

  constructor(projects: readonly EngineeringProjectSnapshot[]) {
    for (const project of projects) this.#projects.set(project.project.id, project);
  }

  replace(project: EngineeringProjectSnapshot): void {
    this.#projects.set(project.project.id, project);
  }

  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(this.#projects.get(projectId));
  }

  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = this.#projects.get(projectId);
    return Promise.resolve(project?.revision === revision ? project : undefined);
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    return Promise.resolve(snapshot);
  }

  commit(snapshot: EngineeringProjectSnapshot): Promise<EngineeringProjectSnapshot> {
    return Promise.resolve(snapshot);
  }
}

class MutableFocus implements CockpitFocusStore {
  constructor(public value: CockpitFocusSnapshot | undefined) {}

  get(_workspaceId: string): Promise<CockpitFocusSnapshot | undefined> {
    return Promise.resolve(this.value);
  }

  select(snapshot: CockpitFocusSnapshot): Promise<CockpitFocusSnapshot> {
    this.value = snapshot;
    return Promise.resolve(snapshot);
  }
}
