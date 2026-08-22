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

Deno.test("native Workbench applies the verification-case read model after pure projection", async () => {
  const r2 = genericArchitectureThreadSnapshot(2);
  const r3 = genericArchitectureThreadSnapshot(3, r2);
  const project = genericArchitectureProject("completed", r2, r3);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    verificationCaseCaptures: {
      mechanicalProof: { read: () => Promise.resolve(undefined) },
      sensitivityStudy: { read: () => Promise.resolve(undefined) },
    },
  });

  const response = await handler(
    new Request("http://localhost/api/thread/workbench"),
  );
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.surface, "evidence");
  assertEquals(body.thread.verificationCases, {
    schemaVersion: "thread-verification-cases/1.0",
    status: "observed",
    coverage: [
      { family: "mechanical-proof", status: "observed" },
      { family: "sensitivity-study", status: "observed" },
          ],
    cases: [],
    issues: [],
  });
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
    cockpitFleet: async () => ({
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
    cockpitFleet: async () => ({
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
    "/api/thread/workbench/events",
    "/api/fleet",
    `/api/thread/assets/${digest}.glb`,
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
    schemaVersion: "1.0",
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
  return {
    schemaVersion: "1.0",
    id: "generic-architecture-project:r1",
    revision: 1,
    generatedAt: "2026-08-08T05:00:00.000Z",
    project: {
      id: "generic-architecture-project",
      name: "Generic architecture project",
      subjectId: r2.subject.id,
      objective: {
        title: "Generic architecture",
        statement: "Keep the approved generic architecture traceable.",
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
      phaseId: "architecture",
      title: "Author generic architecture",
      description: "Run the registered generic architecture operation.",
      kind: "architect",
      operation: { ...MODEL_WRITE_ARCHITECTURE_OPERATION, bindings: [] },
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
  constructor(public value: CockpitFocusSnapshot) {}

  get(_workspaceId: string): Promise<CockpitFocusSnapshot> {
    return Promise.resolve(this.value);
  }

  select(snapshot: CockpitFocusSnapshot): Promise<CockpitFocusSnapshot> {
    this.value = snapshot;
    return Promise.resolve(snapshot);
  }
}
