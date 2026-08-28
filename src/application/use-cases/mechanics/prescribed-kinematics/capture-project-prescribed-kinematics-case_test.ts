import { assertEquals } from "@std/assert";
import { sampleAgentResourceReference } from "../../../../testing/agent-resource-test-support.ts";
import { sha256Hex } from "../../../../domain/kernel/deterministic-json.ts";
import {
  applyProjectSourceWorkspaceCommand,
  emptyProjectSourceWorkspace,
} from "../../../../domain/project-source-workspace/transitions.ts";
import type { ProjectSourceWorkspaceState } from "../../../../domain/project-source-workspace/types.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import type { ReopenAgentResource } from "../../resource/reopen-agent-resource.ts";
import {
  canonicalizePrescribedKinematicsCaseSource,
} from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import {
  PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE,
} from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import { CaptureProjectPrescribedKinematicsCase } from "./capture-project-prescribed-kinematics-case.ts";

const PROJECT = "project-mechanism";
const SUBJECT = "subject-mechanism";
const ARCHITECTURE = `architecture-${"a".repeat(64)}`;
const FP = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("prescribed-kinematics case review preserves the exact same-file assembly/body closure", async () => {
  const { text, state } = await workspace([
    "usage-assembly",
    "usage-base",
    "usage-head",
  ]);
  const review = await capture(text, state, ["usage-base", "usage-head"]).capture({
    projectId: PROJECT,
    workspaceRevision: state.workspaceRevision,
    attachmentId: "attachment-assembly",
    attachmentRevision: 1,
  });
  assertEquals(review.status, "resolved");
  if (review.status !== "resolved") return;
  assertEquals(review.grants, "none");
  assertEquals(
    review.sealedCase.sourceClosure.workspace.attachments.map((item) =>
      item.partUsageElementId
    ),
    ["usage-assembly", "usage-base", "usage-head"],
  );
});

Deno.test("prescribed-kinematics case review leaves a missing same-file body attachment unresolved", async () => {
  const { text, state } = await workspace(["usage-assembly", "usage-base"]);
  const review = await capture(text, state, ["usage-base", "usage-head"]).capture({
    projectId: PROJECT,
    workspaceRevision: state.workspaceRevision,
    attachmentId: "attachment-assembly",
    attachmentRevision: 1,
  });
  assertEquals(review.status, "unresolved");
  if (review.status !== "unresolved") return;
  assertEquals(review.diagnostic.code, "closure_mismatch");
  assertEquals(review.grants, "none");
});

Deno.test("prescribed-kinematics case review refuses a declared-against immediate-body mismatch", async () => {
  const { text, state } = await workspace([
    "usage-assembly",
    "usage-base",
    "usage-head",
  ]);
  const review = await capture(text, state, ["usage-base"]).capture({
    projectId: PROJECT,
    workspaceRevision: state.workspaceRevision,
    attachmentId: "attachment-assembly",
    attachmentRevision: 1,
  });
  assertEquals(review.status, "unresolved");
  if (review.status !== "unresolved") return;
  assertEquals(review.diagnostic.code, "immediate_body_set_mismatch");
  assertEquals(review.grants, "none");
});

function capture(
  text: string,
  state: ProjectSourceWorkspaceState,
  immediateBodyUsages: readonly string[],
): CaptureProjectPrescribedKinematicsCase {
  return new CaptureProjectPrescribedKinematicsCase({
    workspace: {
      loadAtFresh: async (projectId: string, revision: number) => {
        if (projectId !== PROJECT || revision !== state.workspaceRevision) {
          throw new Error("foreign exact workspace request");
        }
        return state;
      },
    } as unknown as ProjectSourceWorkspaceEventStore,
    resources: {
      reopenUtf8Text: async () => ({ text }),
    } as unknown as ReopenAgentResource,
    architecture: {
      open: async () => ({
        typedDefinitionId: (usageId: string) =>
          usageId === "usage-assembly" ? "definition-assembly" : undefined,
        immediateUsageIds: (definitionId: string) =>
          definitionId === "definition-assembly" ? immediateBodyUsages : [],
      }),
    },
  });
}

async function workspace(targets: readonly string[]): Promise<{
  readonly text: string;
  readonly state: ProjectSourceWorkspaceState;
}> {
  const { text } = canonicalizePrescribedKinematicsCaseSource(source());
  const digest = await sha256Hex(new TextEncoder().encode(text));
  let state = emptyProjectSourceWorkspace(PROJECT);
  state = (await applyProjectSourceWorkspaceCommand(state, {
    projectId: PROJECT,
    mutationId: "module",
    expectedWorkspaceRevision: state.workspaceRevision,
    mutation: {
      kind: "module_put",
      moduleId: "module-mechanism",
      slug: "mechanism",
      displayName: "Mechanism",
    },
  })).state;
  state = (await applyProjectSourceWorkspaceCommand(state, {
    projectId: PROJECT,
    mutationId: "file",
    expectedWorkspaceRevision: state.workspaceRevision,
    mutation: {
      kind: "file_put",
      fileId: "file-mechanism",
      moduleId: "module-mechanism",
      logicalName: "mechanism.json",
      role: "mechanism-source",
      dependencies: [],
      resourceRef: sampleAgentResourceReference({
        name: "mechanism.json",
        mimeType: "application/json",
        byteCount: new TextEncoder().encode(text).byteLength,
        fingerprint: { algorithm: "sha256", digest },
        uri: `casys://agent-resource-capture/sha256/${digest}`,
      }),
    },
  })).state;
  for (const target of targets) {
    state = (await applyProjectSourceWorkspaceCommand(state, {
      projectId: PROJECT,
      mutationId: `attachment-${target}`,
      expectedWorkspaceRevision: state.workspaceRevision,
      mutation: {
        kind: "attachment_put",
        attachmentId: `attachment-${target.slice("usage-".length)}`,
        fileId: "file-mechanism",
        role: PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE,
        target: { elementId: target, elementKind: "PartUsage" },
        declaredAgainst: {
          thread: { snapshotId: "thread-mechanism", revision: 1, subjectId: SUBJECT },
          architecture: {
            artifactId: ARCHITECTURE,
            fingerprint: FP,
            captureSchema: "architecture-capture/4.0",
          },
        },
      },
    })).state;
  }
  return { text, state };
}

function source() {
  const pose = {
    positionM: [0, 0, 0] as const,
    orientationWxyz: [1, 0, 0, 0] as const,
  };
  return {
    schemaVersion: "prescribed-kinematics-case-source/1.0",
    id: "case-arm",
    revision: 1,
    scope: "One immediate two-body articulated arm subassembly.",
    evidenceBoundary:
      "Only prescribed kinematic poses, angles, residuals, and convergence are observable.",
    project: { id: PROJECT, subjectId: SUBJECT },
    assembly: { partUsageElementId: "usage-assembly" },
    units: { length: "m", angle: "rad", time: "s" },
    durationS: 1,
    groundBodyId: "body-base",
    bodies: [
      { bodyId: "body-base", partUsageElementId: "usage-base", zeroPose: pose },
      { bodyId: "body-head", partUsageElementId: "usage-head", zeroPose: pose },
    ],
    joints: [{
      jointId: "joint-arm",
      kind: "revolute",
      parentBodyId: "body-base",
      childBodyId: "body-head",
      parentFrame: { ...pose, axis: [0, 0, 1] as const },
      childFrame: { ...pose, axis: [0, 0, 1] as const },
      limitRad: { minimum: -1, maximum: 1 },
      ramp: {
        kind: "linear",
        startTimeS: 0,
        endTimeS: 1,
        initialAngleRad: 0,
        finalAngleRad: 0.5,
      },
    }],
    sampling: { timeStepS: 0.5 },
  } as const;
}
