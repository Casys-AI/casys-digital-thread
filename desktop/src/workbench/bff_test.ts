import { assertEquals } from "jsr:@std/assert@1.0.14";
import { FileCockpitFocusStore } from "../../../src/adapters/project/file-cockpit-focus-store.ts";
import { FileEngineeringProjectRevisionStore } from "../../../src/adapters/shared/stores/engineering-project-store.ts";
import { validateEngineeringProjectSnapshot } from "../../../src/domain/project/engineering-project-validation.ts";
import { COCKPIT_FOCUS_SCHEMA_VERSION } from "../../../src/domain/project/cockpit-focus.ts";
import {
  createPackagedWorkbenchBff,
  PACKAGED_VIEWER_APP_OBJECT_DIRECTORY,
  PACKAGED_VIEWER_APP_REGISTRY_PATH,
} from "./bff.ts";
import { WORKBENCH_ACCESS_HEADER, WORKBENCH_WORKSPACE_ID } from "./contracts.ts";

Deno.test("packaged Workbench wires the explicit viewer registry and fails closed when absent", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-packaged-viewer-apps-" });
  try {
    const projectStore = new FileEngineeringProjectRevisionStore(
      `${root}/state/local/engineering-projects`,
    );
    await projectStore.createInitial(projectFixture());
    const focus = new FileCockpitFocusStore(
      `${root}/state/local/cockpit-focus`,
    );
    await focus.select({
      schemaVersion: COCKPIT_FOCUS_SCHEMA_VERSION,
      workspaceId: WORKBENCH_WORKSPACE_ID,
      revision: 1,
      commandId: "select-packaged-viewer-test",
      selectedAt: AT,
      selectedBy: { kind: "agent", actorId: "desktop-test" },
      target: { kind: "project", projectId: PROJECT_ID },
    }, 0);

    const token = "a".repeat(64);
    const handler = createPackagedWorkbenchBff(token, root);
    const response = await handler(
      new Request("http://127.0.0.1/api/thread/viewer-sessions", {
        headers: { [WORKBENCH_ACCESS_HEADER]: token },
      }),
    );
    assertEquals(response.status, 200);
    assertEquals((await response.json()).sessions, []);
    assertEquals(
      PACKAGED_VIEWER_APP_REGISTRY_PATH,
      "state/local/thread-viewer-apps/registry.json",
    );
    assertEquals(
      PACKAGED_VIEWER_APP_OBJECT_DIRECTORY,
      "state/local/thread-viewer-apps/objects",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

const PROJECT_ID = "packaged-viewer-project";
const AT = "2026-08-31T00:00:00.000Z";

function projectFixture() {
  return validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Packaged viewer project",
      subjectId: "packaged-viewer-subject",
      objective: {
        title: "Verify packaged whole-App registration",
        statement: "Verify packaged whole-App registration.",
      },
    },
    framing: {
      intent: {
        statement: "Verify packaged whole-App registration.",
        source: { kind: "human", reference: "paired-conversation" },
        capturedAt: AT,
        capturedBy: { id: "human:owner", origin: "human" },
      },
      questions: [],
      answers: [],
    },
    threadSnapshots: [],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "start-packaged-viewer-project",
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    }],
  });
}
