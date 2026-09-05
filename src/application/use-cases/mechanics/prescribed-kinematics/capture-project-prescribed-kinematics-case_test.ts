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

Deno.test("prescribed-kinematics case review recrosses a nested PartUsage assembly through typed_by", async () => {
  const { text, state } = await workspace(PART_USAGE_TARGETS);
  const review = await capture(text, state, {
    typedDefinitionId: (usageId) =>
      usageId === "usage-assembly" ? "definition-assembly" : undefined,
    immediateUsageIds: (definitionId) =>
      definitionId === "definition-assembly" ? ["usage-base", "usage-head"] : [],
  }).capture({
    projectId: PROJECT,
    workspaceRevision: state.workspaceRevision,
    attachmentId: "attachment-assembly",
    attachmentRevision: 1,
  });
  assertEquals(review.status, "resolved");
  if (review.status !== "resolved") return;
  assertEquals(review.grants, "none");
  assertEquals(
    review.sealedCase.sourceClosure.workspace.attachments.map((item) => ({
      elementKind: item.elementKind,
      elementId: item.elementId,
    })),
    [
      { elementKind: "PartUsage", elementId: "usage-assembly" },
      { elementKind: "PartUsage", elementId: "usage-base" },
      { elementKind: "PartUsage", elementId: "usage-head" },
    ],
  );
});

Deno.test("prescribed-kinematics case review recrosses a root PartDefinition assembly directly", async () => {
  const { text, state } = await workspace(PART_DEFINITION_TARGETS, {
    elementId: "definition-assembly",
    elementKind: "PartDefinition",
  });
  const review = await capture(text, state, {
    typedDefinitionId: () => undefined,
    immediateUsageIds: (definitionId) =>
      definitionId === "definition-assembly" ? ["usage-base", "usage-head"] : [],
  }).capture({
    projectId: PROJECT,
    workspaceRevision: state.workspaceRevision,
    attachmentId: "attachment-assembly",
    attachmentRevision: 1,
  });
  assertEquals(review.status, "resolved");
  if (review.status !== "resolved") return;
  assertEquals(
    review.sealedCase.sourceClosure.workspace.attachments.map((item) => ({
      elementKind: item.elementKind,
      elementId: item.elementId,
    })),
    [
      { elementKind: "PartDefinition", elementId: "definition-assembly" },
      { elementKind: "PartUsage", elementId: "usage-base" },
      { elementKind: "PartUsage", elementId: "usage-head" },
    ],
  );
});

Deno.test("prescribed-kinematics case review leaves a missing same-file body attachment unresolved", async () => {
  const { text, state } = await workspace([
    { elementId: "usage-assembly", elementKind: "PartUsage" },
    { elementId: "usage-base", elementKind: "PartUsage" },
  ]);
  const review = await capture(text, state, {
    typedDefinitionId: (usageId) =>
      usageId === "usage-assembly" ? "definition-assembly" : undefined,
    immediateUsageIds: () => ["usage-base", "usage-head"],
  }).capture({
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
  const { text, state } = await workspace(PART_USAGE_TARGETS);
  const review = await capture(text, state, {
    typedDefinitionId: (usageId) =>
      usageId === "usage-assembly" ? "definition-assembly" : undefined,
    immediateUsageIds: () => ["usage-base"],
  }).capture({
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

Deno.test("prescribed-kinematics case review refuses a nested PartUsage without typed_by", async () => {
  const { text, state } = await workspace(PART_USAGE_TARGETS);
  const review = await capture(text, state, {
    typedDefinitionId: () => undefined,
    immediateUsageIds: () => ["usage-base", "usage-head"],
  }).capture({
    projectId: PROJECT,
    workspaceRevision: state.workspaceRevision,
    attachmentId: "attachment-assembly",
    attachmentRevision: 1,
  });
  assertEquals(review.status, "unresolved");
  if (review.status !== "unresolved") return;
  assertEquals(review.diagnostic.code, "assembly_typed_by_missing");
});

const PART_USAGE_TARGETS = [
  { elementId: "usage-assembly", elementKind: "PartUsage" as const },
  { elementId: "usage-base", elementKind: "PartUsage" as const },
  { elementId: "usage-head", elementKind: "PartUsage" as const },
];

const PART_DEFINITION_TARGETS = [
  { elementId: "definition-assembly", elementKind: "PartDefinition" as const },
  { elementId: "usage-base", elementKind: "PartUsage" as const },
  { elementId: "usage-head", elementKind: "PartUsage" as const },
];

function capture(
  text: string,
  state: ProjectSourceWorkspaceState,
  facts: {
    typedDefinitionId: (usageId: string) => string | undefined;
    immediateUsageIds: (definitionId: string) => readonly string[];
  },
): CaptureProjectPrescribedKinematicsCase {
  return new CaptureProjectPrescribedKinematicsCase({
    workspace: {
      loadAtFresh: (projectId: string, revision: number) => {
        if (projectId !== PROJECT || revision !== state.workspaceRevision) {
          return Promise.reject(new Error("foreign exact workspace request"));
        }
        return Promise.resolve(state);
      },
    } as unknown as ProjectSourceWorkspaceEventStore,
    resources: {
      reopenUtf8Text: () => Promise.resolve({ text }),
    } as unknown as ReopenAgentResource,
    architecture: {
      open: () => Promise.resolve(facts),
    },
  });
}

async function workspace(
  targets: readonly {
    readonly elementId: string;
    readonly elementKind: "PartDefinition" | "PartUsage";
  }[],
  assembly: {
    readonly elementId: string;
    readonly elementKind: "PartDefinition" | "PartUsage";
  } = { elementId: "usage-assembly", elementKind: "PartUsage" },
): Promise<{
  readonly text: string;
  readonly state: ProjectSourceWorkspaceState;
}> {
  const { text } = canonicalizePrescribedKinematicsCaseSource(source(assembly));
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
    const attachmentId = `attachment-${
      target.elementId.replace(/^(usage|definition)-/, "")
    }`;
    state = (await applyProjectSourceWorkspaceCommand(state, {
      projectId: PROJECT,
      mutationId: attachmentId,
      expectedWorkspaceRevision: state.workspaceRevision,
      mutation: {
        kind: "attachment_put",
        attachmentId,
        fileId: "file-mechanism",
        role: PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE,
        target,
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

function source(
  assembly: {
    readonly elementId: string;
    readonly elementKind: "PartDefinition" | "PartUsage";
  },
) {
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
    assembly,
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
