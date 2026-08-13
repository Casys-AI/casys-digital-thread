import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import type { CockpitFocusStore } from "../../src/application/ports/out/cockpit-focus-store.ts";
import {
  FileProjectReviewIntentStore,
} from "../../src/adapters/stores/file-project-review-intent-store.ts";
import type { ProjectReviewIntentStore } from "../../src/application/ports/out/project-review-intent-store.ts";
import type { EngineeringProjectSnapshot } from "../../src/domain/project/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../../src/application/ports/out/engineering-project-revision-store.ts";
import type {
  ProjectReviewIntent,
  ProjectReviewIntentAcknowledgement,
  ProjectReviewIntentRecord,
} from "../../src/domain/project/project-review-intent.ts";
import type { CockpitFocusSnapshot } from "../../src/domain/project/cockpit-focus.ts";
import { COCKPIT_FOCUS_SCHEMA_VERSION } from "../../src/domain/project/cockpit-focus.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../src/domain/engineering/architecture-proposal.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../src/domain/engineering/geometry-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../src/domain/engineering/requirements-proposal.ts";
import type { ThreadSnapshot } from "../../src/domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../src/domain/thread/thread-snapshot-store.ts";
import { INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION } from "../../src/orchestration/operations/inspection-drone-v4.ts";
import {
  createFocusedWorkspaceHandler,
  createNativeWorkbenchHandler,
  resolveNativeWorkbenchProjectId,
  resolveNativeWorkbenchStartupTarget,
  resolveNativeWorkbenchSubjectId,
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
      port: 5173,
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

Deno.test("native Workbench keeps a durable unattached drone architecture snapshot out of preview until completion attaches it", async () => {
  const r2 = droneThreadSnapshot(2);
  const r3 = droneThreadSnapshot(3, r2);
  const projects = new ProjectStore([
    droneArchitectureProject("queued", r2, r3),
  ]);
  const handler = createNativeWorkbenchHandler({
    store: new ThreadStore([r2, r3]),
    projectStore: projects,
    projectId: "inspection-drone-v4",
    subjectId: r2.subject.id,
    html: "unused",
  });

  for (const status of ["queued", "running", "publishing", "failed"] as const) {
    projects.replace(droneArchitectureProject(status, r2, r3));
    assertEquals(await previewThreadId(handler), r2.id);
  }

  projects.replace(droneArchitectureProject("completed", r2, r3));
  assertEquals(await previewThreadId(handler), r3.id);
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

Deno.test("native Workbench durably accepts an exact review intent without mutating the project", async () => {
  const project = proposedDecisionProject();
  const projects = new ProjectStore([project]);
  const reviewIntents = new MemoryReviewIntentStore();
  const before = structuredClone(project);
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: projects,
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    reviewIntents,
  });
  const intent = reviewIntent(project);

  const response = await handler(reviewIntentRequest(intent));
  const body = await response.json();

  assertEquals(response.status, 202);
  assertEquals(body.status, "accepted");
  assertEquals(body.record.intent, intent);
  assertEquals(await reviewIntents.list(project.project.id), [{ intent }]);
  assertEquals(await projects.get(project.project.id), before);

  const listed = await handler(
    new Request("http://localhost/api/review-intents"),
  );
  assertEquals(listed.status, 200);
  assertEquals((await listed.json()).intents, [{ intent }]);
});

Deno.test("native Workbench signals MCP only after the exact review intent is durable", async () => {
  const project = proposedDecisionProject();
  const projects = new ProjectStore([project]);
  const reviewIntents = new MemoryReviewIntentStore();
  const observed: string[] = [];
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: projects,
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    reviewIntents,
    reviewIntentSignal: {
      notify: async (record) => {
        observed.push(record.intent.intentId);
        assertEquals(
          await reviewIntents.list(project.project.id),
          [record],
        );
      },
    },
  });
  const intent = reviewIntent(project);

  const response = await handler(reviewIntentRequest(intent));
  const body = await response.json();

  assertEquals(response.status, 202);
  assertEquals(body.signal, "sent");
  assertEquals(observed, [intent.intentId]);
  assertEquals(await projects.get(project.project.id), project);
});

Deno.test("native Workbench keeps a review intent durable when the MCP signal is unavailable", async () => {
  const project = proposedDecisionProject();
  const reviewIntents = new MemoryReviewIntentStore();
  const failures: unknown[] = [];
  const handler = createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    reviewIntents,
    reviewIntentSignal: {
      notify: () => Promise.reject(new Error("subscriber disconnected")),
    },
    onReviewIntentSignalError: (error) => failures.push(error),
  });
  const intent = reviewIntent(project);

  const response = await handler(reviewIntentRequest(intent));
  const body = await response.json();

  assertEquals(response.status, 202);
  assertEquals(body.signal, "deferred");
  assertEquals(await reviewIntents.list(project.project.id), [{ intent }]);
  assertEquals(failures.length, 1);
  assertEquals((failures[0] as Error).message, "subscriber disconnected");
});

Deno.test("native Workbench accepts only one active intent for an exact proposed decision", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const project = proposedDecisionProject();
    const projects = new ProjectStore([project]);
    const before = structuredClone(project);
    const reviewIntents = new FileProjectReviewIntentStore(directory);
    const handler = createNativeWorkbenchHandler({
      store: new EmptyThreadStore(),
      projectStore: projects,
      projectId: project.project.id,
      subjectId: project.project.subjectId,
      html: "unused",
      reviewIntents,
    });
    const first = reviewIntent(project);
    const competing: ProjectReviewIntent = {
      ...first,
      intentId: "intent:geometry-v2:reviewer-2",
      action: "request-revision",
      comment: "Increase the shade clearance.",
    };

    assertEquals((await handler(reviewIntentRequest(first))).status, 202);
    const rejected = await handler(reviewIntentRequest(competing));

    assertEquals(rejected.status, 409);
    assertEquals((await rejected.json()).error, "review_intent_conflict");
    assertEquals((await reviewIntents.list(project.project.id)).length, 1);
    assertEquals(await projects.get(project.project.id), before);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("native Workbench review-intent POST rejects cross-origin and non-JSON requests", async () => {
  const project = proposedDecisionProject();
  const reviewIntents = new MemoryReviewIntentStore();
  const handler = reviewIntentHandler(project, reviewIntents);
  const intent = reviewIntent(project);

  const crossOrigin = await handler(
    reviewIntentRequest(intent, { origin: "http://attacker.invalid" }),
  );
  assertEquals(crossOrigin.status, 403);
  const wrongType = await handler(
    reviewIntentRequest(intent, { contentType: "text/plain" }),
  );
  assertEquals(wrongType.status, 415);
  assertEquals(await reviewIntents.list(project.project.id), []);
});

Deno.test("native Workbench review-intent POST rejects stale revisions and fingerprint substitution", async () => {
  const project = proposedDecisionProject();
  const reviewIntents = new MemoryReviewIntentStore();
  const handler = reviewIntentHandler(project, reviewIntents);

  const stale = await handler(
    reviewIntentRequest({
      ...reviewIntent(project),
      expectedRevision: project.revision + 1,
    }),
  );
  assertEquals(stale.status, 409);
  assertEquals((await stale.json()).error, "review_intent_stale_revision");

  const substituted = await handler(
    reviewIntentRequest({
      ...reviewIntent(project),
      inputFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    }),
  );
  assertEquals(substituted.status, 409);
  assertEquals(
    (await substituted.json()).error,
    "review_intent_fingerprint_mismatch",
  );
  assertEquals(await reviewIntents.list(project.project.id), []);
});

Deno.test("native Workbench binds a same-fingerprint reproposal to its new pending approval attempt", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const original = proposedDecisionProject();
    const reviewIntents = new FileProjectReviewIntentStore(directory);
    await reviewIntents.append(reviewIntent(original));
    const successorApprovalId = "approval:decision:geometry-v2:proposal-3";
    const current = {
      ...original,
      id: `${original.project.id}:r${original.revision + 1}`,
      revision: original.revision + 1,
      decisions: original.decisions.map((decision) => ({
        ...decision,
        approvalIds: [...decision.approvalIds, successorApprovalId],
      })),
      approvals: [
        ...original.approvals.map((approval) => ({
          ...approval,
          status: "rejected" as const,
          decidedAt: "2026-08-09T10:46:00.000Z",
          decidedBy: "human:reviewer",
          decidedByOrigin: "human" as const,
          rationale: "Revise and propose again.",
        })),
        {
          ...original.approvals[0],
          id: successorApprovalId,
          status: "pending" as const,
          requestedAt: "2026-08-09T10:47:00.000Z",
        },
      ],
    } satisfies EngineeringProjectSnapshot;
    const handler = reviewIntentHandler(current, reviewIntents);
    const successor = {
      ...reviewIntent(current),
      intentId: "intent:geometry-v2:reviewer-successor",
    };

    const oldAttempt = await handler(reviewIntentRequest({
      ...successor,
      intentId: "intent:geometry-v2:stale-approval",
      approvalId: REVIEW_APPROVAL_ID,
    }));
    assertEquals(oldAttempt.status, 409);
    assertEquals(
      (await oldAttempt.json()).error,
      "review_intent_approval_mismatch",
    );

    const accepted = await handler(reviewIntentRequest(successor));
    assertEquals(accepted.status, 202);
    assertEquals(
      (await reviewIntents.list(current.project.id)).map((record) =>
        record.intent.approvalId
      ),
      [REVIEW_APPROVAL_ID, successorApprovalId],
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("native Workbench review-intent POST requires an exact bounded revision comment", async () => {
  const project = proposedDecisionProject();
  const reviewIntents = new MemoryReviewIntentStore();
  const handler = reviewIntentHandler(project, reviewIntents);
  const base = reviewIntent(project);

  const absent = await handler(
    reviewIntentRequest({ ...base, action: "request-revision" }),
  );
  assertEquals(absent.status, 400);
  assertEquals((await absent.json()).error, "invalid_review_intent");

  const oversized = await handler(
    reviewIntentRequest({
      ...base,
      action: "request-revision",
      comment: "x".repeat(2_001),
    }),
  );
  assertEquals(oversized.status, 400);

  const exactComment = "  Increase the shade clearance by 2 mm.  ";
  const accepted = await handler(
    reviewIntentRequest({
      ...base,
      action: "request-revision",
      comment: exactComment,
    }),
  );
  assertEquals(accepted.status, 202);
  assertEquals(
    (await reviewIntents.list(project.project.id))[0].intent.comment,
    exactComment,
  );
});

Deno.test("native Workbench review-intent POST bounds the JSON body before parsing", async () => {
  const project = proposedDecisionProject();
  const reviewIntents = new MemoryReviewIntentStore();
  const handler = reviewIntentHandler(project, reviewIntents);
  const response = await handler(
    new Request("http://localhost/api/review-intents", {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ padding: "x".repeat(17_000) }),
    }),
  );

  assertEquals(response.status, 413);
  assertEquals(await reviewIntents.list(project.project.id), []);
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

const REVIEW_DECISION_DIGEST = "a".repeat(64);
const REVIEW_APPROVAL_ID = "approval:decision:geometry-v2:proposal-2";

function proposedDecisionProject(): EngineeringProjectSnapshot {
  const project = projectFixture("desk-lamp-dl01", "desk-lamp-dl01-thread");
  return {
    ...project,
    decisions: [{
      id: "decision:geometry-v2",
      phaseId: "geometry",
      title: "Approve exact geometry",
      question: "Should this exact geometry replace the prior proposal?",
      status: "proposed",
      requestedAt: "2026-08-09T10:30:00.000Z",
      inputFingerprint: {
        algorithm: "sha256",
        digest: REVIEW_DECISION_DIGEST,
      },
      inputEvidenceRefs: [],
      approvalIds: [REVIEW_APPROVAL_ID],
    }],
    approvals: [{
      id: REVIEW_APPROVAL_ID,
      decisionId: "decision:geometry-v2",
      status: "pending",
      requestedAt: "2026-08-09T10:30:00.000Z",
      inputFingerprint: {
        algorithm: "sha256",
        digest: REVIEW_DECISION_DIGEST,
      },
      inputEvidenceRefs: [],
    }],
  };
}

function reviewIntent(project: EngineeringProjectSnapshot): ProjectReviewIntent {
  return {
    intentId: "intent:geometry-v2:reviewer-1",
    projectId: project.project.id,
    expectedRevision: project.revision,
    decisionId: "decision:geometry-v2",
    approvalId:
      [...project.approvals].reverse().find((approval) =>
        approval.decisionId === "decision:geometry-v2" && approval.status === "pending"
      )!.id,
    inputFingerprint: {
      algorithm: "sha256",
      digest: REVIEW_DECISION_DIGEST,
    },
    action: "validate",
    submittedAt: "2026-08-09T10:45:00.000Z",
  };
}

function reviewIntentRequest(
  body: ProjectReviewIntent,
  options: { readonly origin?: string; readonly contentType?: string } = {},
): Request {
  return new Request("http://localhost/api/review-intents", {
    method: "POST",
    headers: {
      Origin: options.origin ?? "http://localhost",
      "Content-Type": options.contentType ?? "application/json",
    },
    body: JSON.stringify(body),
  });
}

function reviewIntentHandler(
  project: EngineeringProjectSnapshot,
  reviewIntents: ProjectReviewIntentStore,
): (request: Request) => Promise<Response> {
  return createNativeWorkbenchHandler({
    store: new EmptyThreadStore(),
    projectStore: new ProjectStore([project]),
    projectId: project.project.id,
    subjectId: project.project.subjectId,
    html: "unused",
    reviewIntents,
  });
}

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

function droneArchitectureProject(
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
    id: "inspection-drone-v4:project:r1",
    revision: 1,
    generatedAt: "2026-08-08T05:00:00.000Z",
    project: {
      id: "inspection-drone-v4",
      name: "Inspection drone v4",
      subjectId: r2.subject.id,
      objective: {
        title: "Inspection drone architecture",
        statement: "Keep the reviewed qualitative architecture traceable.",
      },
    },
    threadSnapshots: completed ? [reference(r2), reference(r3)] : [reference(r2)],
    phases: [{
      id: "architecture",
      name: "Architecture",
      order: 1,
      description: "Publish the bounded qualitative SysON architecture.",
      workItemIds: ["author-inspection-drone-architecture"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "author-inspection-drone-architecture",
      phaseId: "architecture",
      title: "Author drone architecture",
      description: "Run the registered qualitative architecture operation.",
      kind: "architect",
      operation: {
        ...INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
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
      id: "run:inspection-drone-architecture",
      workItemId: "author-inspection-drone-architecture",
      status,
      summary: "Author the reviewed qualitative inspection-drone architecture.",
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

function droneThreadSnapshot(
  revision: number,
  previous?: ThreadSnapshot,
): ThreadSnapshot {
  const at = "2026-08-08T05:00:00.000Z";
  const artifactId = `inspection-drone-architecture-r${revision}`;
  const changeId = `inspection-drone-architecture-change-r${revision}`;
  return {
    schemaVersion: "1.0",
    id: `inspection-drone-v4-thread-r${revision}`,
    revision,
    ...(previous
      ? { previous: { snapshotId: previous.id, revision: previous.revision } }
      : {}),
    generatedAt: at,
    subject: {
      id: "project:inspection-drone-v4",
      name: "Inspection drone v4",
      kind: "system",
      version: String(revision),
      modelArtifactId: artifactId,
    },
    freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: changeId,
      name: "Record inspection-drone architecture",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: `inspection-drone-architecture-artifact-r${revision}`,
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary: "Recorded one exact qualitative architecture artifact.",
        afterFingerprint: { algorithm: "sha256", digest: String(revision).repeat(64) },
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Inspection-drone qualitative architecture",
      kind: "sysml-model",
      version: String(revision),
      fingerprint: { algorithm: "sha256", digest: String(revision).repeat(64) },
      producer: {
        serverId: "mcp-syson",
        tool: "syson_element_insert_sysml",
        runId: `run:inspection-drone-architecture-r${revision}`,
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
      id: `inspection-drone-architecture-provenance-r${revision}`,
      relation: "changes",
      from: { kind: "change", id: changeId },
      to: { kind: "artifact", id: artifactId },
      rationale: "The exact snapshot records this qualitative architecture artifact.",
    }],
    proposedActions: [],
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

class MemoryReviewIntentStore implements ProjectReviewIntentStore {
  readonly #records: ProjectReviewIntentRecord[] = [];

  append(intent: ProjectReviewIntent): Promise<ProjectReviewIntentRecord> {
    const existing = this.#records.find((record) =>
      record.intent.intentId === intent.intentId
    );
    if (existing) return Promise.resolve(structuredClone(existing));
    const record = { intent: structuredClone(intent) };
    this.#records.push(record);
    return Promise.resolve(structuredClone(record));
  }

  list(projectId: string): Promise<ProjectReviewIntentRecord[]> {
    return Promise.resolve(structuredClone(
      this.#records.filter((record) => record.intent.projectId === projectId),
    ));
  }

  listAll(): Promise<ProjectReviewIntentRecord[]> {
    return Promise.resolve(structuredClone(this.#records));
  }

  acknowledge(
    acknowledgement: ProjectReviewIntentAcknowledgement,
  ): Promise<ProjectReviewIntentRecord> {
    const index = this.#records.findIndex((record) =>
      record.intent.intentId === acknowledgement.intentId &&
      record.intent.projectId === acknowledgement.projectId
    );
    if (index < 0) throw new Error("intent not found");
    const record = {
      intent: this.#records[index].intent,
      acknowledgement: structuredClone(acknowledgement),
    };
    this.#records[index] = record;
    return Promise.resolve(structuredClone(record));
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
