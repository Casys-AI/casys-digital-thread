import { assertEquals, assertRejects } from "@std/assert";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import { FileThreadViewerAppRegistrar } from "./thread-viewer-app-registrar.ts";
import { FileThreadViewerAppRegistry } from "./file-thread-viewer-app-registry.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { ExactInitialBaselineEvidenceValidator } from "../project/engineering-project-initial-baseline-evidence-validator.ts";
import { ApprovedBriefBaselineRunExecutor } from "../project/approved-brief-baseline-run-executor.ts";
import { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../orchestration/operations/registry.ts";
import { approvedBriefSourceAnalysisFixture } from "../../testing/approved-brief-source-analysis-fixture.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { buildProjectRecordsAppHtml } from "../../apps/project-records/project-records-app.ts";
import {
  PROJECT_RECORDS_APP_ID,
  PROJECT_RECORDS_APP_VERSION,
  PROJECT_RECORDS_MANIFEST_URI,
  PROJECT_RECORDS_SESSION_KIND,
  PROJECT_RECORDS_SESSION_SCHEMA,
  PROJECT_RECORDS_WHOLE_VIEW_URI,
} from "../../apps/project-records/identity.ts";
import {
  ApprovedBriefViewerBindingError,
  buildApprovedBriefViewerBinding,
} from "./approved-brief-viewer-binding.ts";

const MANIFEST = await Deno.readTextFile(
  new URL("../../apps/project-records/manifest.json", import.meta.url),
);

Deno.test("approved-brief viewer binding admits a historic brief against a newer current project", async () => {
  const root = await Deno.makeTempDir({ prefix: "approved-brief-viewer-" });
  try {
    const fixture = await createCompletedBaseline(root);
    const later = await proposeAndApproveSuccessorBrief(fixture);
    const beforeProject = structuredClone(later.project);
    const beforeThread = structuredClone(fixture.thread);
    const binding = await buildApprovedBriefViewerBinding({
      project: later.project,
      thread: fixture.thread,
      artifactId: fixture.artifactId,
      captures: fixture.captures,
      sources: fixture.sources,
    });

    assertEquals(binding.app, {
      id: PROJECT_RECORDS_APP_ID,
      version: PROJECT_RECORDS_APP_VERSION,
    });
    assertEquals(binding.manifest.uri, PROJECT_RECORDS_MANIFEST_URI);
    assertEquals(binding.resource.uri, PROJECT_RECORDS_WHOLE_VIEW_URI);
    assertEquals("launchUri" in binding, false);
    assertEquals(binding.basis.projectId, later.project.project.id);
    assertEquals(binding.basis.projectRevision, later.project.revision);
    assertEquals(binding.basis.thread?.id, fixture.thread.id);
    assertEquals(binding.anchor, { kind: "artifact", id: fixture.artifactId });
    assertEquals(binding.session.schema, PROJECT_RECORDS_SESSION_SCHEMA);
    assertEquals(binding.session.payload.kind, PROJECT_RECORDS_SESSION_KIND);
    assertEquals(
      binding.session.payload.briefRevision,
      fixture.historicBriefRevision,
    );
    assertEquals(
      later.project.framing?.currentBrief?.revision ===
        fixture.historicBriefRevision,
      false,
    );
    assertEquals(
      binding.basis.projectRevision > fixture.approvedProjectRevision,
      true,
    );
    assertEquals(JSON.stringify(later.project), JSON.stringify(beforeProject));
    assertEquals(JSON.stringify(fixture.thread), JSON.stringify(beforeThread));
    assertEquals(
      await Deno.readTextFile(fixture.sources.capturePath),
      fixture.captureText,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("approved-brief viewer binding rejects missing, tampered, mismatched and unanchored captures", async () => {
  const root = await Deno.makeTempDir({ prefix: "approved-brief-viewer-neg-" });
  try {
    const fixture = await createCompletedBaseline(root);
    const request = {
      project: fixture.project,
      thread: fixture.thread,
      artifactId: fixture.artifactId,
      captures: fixture.captures,
      sources: fixture.sources,
    };

    await assertCode(
      () =>
        buildApprovedBriefViewerBinding({
          ...request,
          captures: { read: () => Promise.resolve(undefined) },
        }),
      "absent_capture",
    );
    await assertCode(
      () =>
        buildApprovedBriefViewerBinding({
          ...request,
          captures: {
            read: () => Promise.resolve(`${fixture.captureText} `),
          },
        }),
      "corrupt_capture",
    );
    await assertCode(
      () =>
        buildApprovedBriefViewerBinding({
          ...request,
          artifactId: "approved-brief-document-missing",
        }),
      "absent_anchor",
    );

    const wrongSubjectProject = {
      ...fixture.project,
      project: { ...fixture.project.project, subjectId: "other-subject" },
      threadSnapshots: fixture.project.threadSnapshots.map((reference) => ({
        ...reference,
        subjectId: "other-subject",
      })),
    };
    const wrongSubjectThread = {
      ...fixture.thread,
      subject: { ...fixture.thread.subject, id: "other-subject" },
    };
    await assertCode(
      () =>
        buildApprovedBriefViewerBinding({
          ...request,
          project: wrongSubjectProject,
          thread: wrongSubjectThread,
        }),
      "provenance_mismatch",
    );

    const wrongRunThread = {
      ...fixture.thread,
      artifacts: [{
        ...fixture.thread.artifacts[0]!,
        producer: {
          ...fixture.thread.artifacts[0]!.producer,
          runId: "run:other",
        },
      }],
    };
    await assertCode(
      () =>
        buildApprovedBriefViewerBinding({
          ...request,
          thread: wrongRunThread,
        }),
      "provenance_mismatch",
    );

    const wrongOperationProject = {
      ...fixture.project,
      workItems: fixture.project.workItems.map((item) =>
        item.id === fixture.project.agentRuns[0]?.workItemId
          ? {
            ...item,
            operation: item.operation
              ? { ...item.operation, id: "model.write-architecture" }
              : item.operation,
          }
          : item
      ),
    };
    const operationError = await assertRejects(
      () =>
        buildApprovedBriefViewerBinding({
          ...request,
          project: wrongOperationProject,
        }),
      ApprovedBriefViewerBindingError,
    );
    assertEquals(
      operationError.code === "provenance_mismatch" ||
        operationError.code === "invalid_input",
      true,
    );

    const wrongBasisProject = {
      ...fixture.project,
      agentRuns: fixture.project.agentRuns.map((run) =>
        run.status === "completed" && run.basis?.kind === "approved-brief"
          ? { ...run, basis: { ...run.basis, briefId: "other-brief" } }
          : run
      ),
    };
    const basisError = await assertRejects(
      () =>
        buildApprovedBriefViewerBinding({
          ...request,
          project: wrongBasisProject,
        }),
      ApprovedBriefViewerBindingError,
    );
    assertEquals(
      basisError.code === "provenance_mismatch" ||
        basisError.code === "invalid_input",
      true,
    );

    const altered = JSON.parse(fixture.captureText) as Record<string, unknown>;
    altered.schemaVersion = "approved-brief-baseline-capture/1.0";
    const alteredText = deterministicJson(altered);
    const digest = await sha256Hex(alteredText);
    const original = fixture.thread.artifacts[0]!;
    const nextId = `approved-brief-document-${digest}`;
    const schemaThread = {
      ...fixture.thread,
      artifacts: [{
        ...original,
        id: nextId,
        version: digest,
        fingerprint: { algorithm: "sha256" as const, digest },
        uri: `casys://approved-brief-capture/sha256/${digest}`,
      }],
      subject: {
        ...fixture.thread.subject,
        version: digest,
        modelArtifactId: nextId,
      },
      changeSet: {
        ...fixture.thread.changeSet,
        changes: fixture.thread.changeSet.changes.map((change) => ({
          ...change,
          target: change.target.kind === "artifact"
            ? { ...change.target, id: nextId }
            : change.target,
          afterFingerprint: { algorithm: "sha256" as const, digest },
        })),
      },
      provenance: fixture.thread.provenance.map((link) => ({
        ...link,
        to: link.to.kind === "artifact" ? { ...link.to, id: nextId } : link.to,
      })),
    };
    const schemaProject = {
      ...fixture.project,
      agentRuns: fixture.project.agentRuns.map((run) => ({
        ...run,
        evidenceRefs: run.evidenceRefs.map((reference) =>
          reference.kind === "artifact" && reference.id === fixture.artifactId
            ? { ...reference, id: nextId }
            : reference
        ),
      })),
      workItems: fixture.project.workItems.map((item) => ({
        ...item,
        evidenceRefs: item.evidenceRefs.map((reference) =>
          reference.kind === "artifact" && reference.id === fixture.artifactId
            ? { ...reference, id: nextId }
            : reference
        ),
      })),
    };
    const schemaError = await assertRejects(
      () =>
        buildApprovedBriefViewerBinding({
          ...request,
          project: schemaProject,
          thread: schemaThread,
          artifactId: nextId,
          captures: { read: () => Promise.resolve(alteredText) },
        }),
      ApprovedBriefViewerBindingError,
    );
    assertEquals(
      schemaError.code === "schema_mismatch" ||
        schemaError.code === "invalid_input" ||
        schemaError.code === "provenance_mismatch",
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function assertCode(
  operation: () => Promise<unknown>,
  code: ApprovedBriefViewerBindingError["code"],
): Promise<void> {
  const error = await assertRejects(operation, ApprovedBriefViewerBindingError);
  assertEquals(error.code, code);
}

async function createCompletedBaseline(root: string, runtimeLayout = false) {
  const projects = new FileEngineeringProjectRevisionStore(
    runtimeLayout ? `${root}/state/local/engineering-projects` : `${root}/projects`,
  );
  const snapshots = new FileThreadSnapshotStore(
    runtimeLayout ? `${root}/state/local/thread-snapshots` : `${root}/snapshots`,
  );
  const captures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: runtimeLayout
      ? `${root}/${APPROVED_BRIEF_CAPTURE_DESCRIPTOR.directory}`
      : `${root}/captures`,
  });
  const sourceAnalysis = approvedBriefSourceAnalysisFixture(root);
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-03T09:00:00.000Z") + ++tick * 1_000)
      .toISOString();
  const briefs = new ProjectBriefCommandService(projects, now);
  const commands = new EngineeringProjectCommandService(
    projects,
    undefined,
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      captures,
      sourceAnalysis,
    ),
  );
  const agent = { kind: "agent" as const, actorId: "agent:test" };
  const human = { kind: "human" as const, actorId: "human:test" };
  let project = await briefs.startProject(agent, {
    commandId: "start",
    projectId: "generic-product-v1",
    projectName: "Generic Industrial Product",
    issuedAt: "2026-08-03T08:59:00.000Z",
    intent: "Build a reviewable industrial product.",
    intentSource: { kind: "human", reference: "conversation:turn-1" },
  });
  project = await briefs.proposeBrief(agent, {
    ...context("propose-brief", project.revision),
    items: briefItems("Prepare a reviewable industrial product design."),
  });
  project = await briefs.approveBrief(human, {
    ...context("approve-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Approved for initial engineering.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  const approvedProjectRevision = project.revision;
  const historicBriefRevision = project.framing!.currentBrief!.revision;
  project = await commands.publishPlan(agent, {
    ...context("publish-plan", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Baseline",
      description: "Record approved project intent.",
    }],
    workItems: [{
      id: "record-brief",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  });
  project = await commands.queueRun(agent, {
    ...context("queue-baseline", project.revision),
    runId: "run:baseline",
    workItemId: "record-brief",
    summary: "Record the canonical project brief.",
    basis: project.plan!.basis,
  });
  project = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures,
    ...sourceAnalysis,
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${root}/leases`),
    now,
  }).execute(agent, {
    ...context("execute-baseline", project.revision),
    runId: "run:baseline",
  });
  const thread = await snapshots.get(project.threadSnapshots[0]!.snapshotId);
  if (!thread) throw new Error("baseline Thread snapshot is missing in test");
  const artifact = thread.artifacts[0];
  if (!artifact) throw new Error("baseline artifact is missing in test");
  const captureText = await captures.read(artifact.fingerprint);
  if (captureText === undefined) {
    throw new Error("baseline capture is missing in test");
  }
  const sources = {
    manifestPath: `${root}/app/manifest.json`,
    htmlPath: `${root}/app/project-records.html`,
    capturePath: `${root}/app/approved-brief.json`,
  };
  await Deno.mkdir(`${root}/app`, { recursive: true });
  await Deno.writeTextFile(sources.manifestPath, MANIFEST);
  await Deno.writeTextFile(sources.htmlPath, buildProjectRecordsAppHtml());
  await Deno.writeTextFile(sources.capturePath, captureText);
  return {
    project,
    thread,
    captures,
    artifactId: artifact.id,
    captureText,
    sources,
    briefs,
    approvedProjectRevision,
    historicBriefRevision,
  };
}

async function proposeAndApproveSuccessorBrief(
  fixture: Awaited<ReturnType<typeof createCompletedBaseline>>,
): Promise<{ readonly project: EngineeringProjectSnapshot }> {
  const agent = { kind: "agent" as const, actorId: "agent:test" };
  const human = { kind: "human" as const, actorId: "human:test" };
  let project = await fixture.briefs.proposeBrief(agent, {
    ...context("propose-brief-2", fixture.project.revision),
    items: briefItems("Prepare a later living brief that must not relabel r1."),
  });
  project = await fixture.briefs.approveBrief(human, {
    ...context("approve-brief-2", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Approved a later living brief.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  return { project };
}

function briefItems(objective: string) {
  return [{
    id: "objective",
    kind: "objective" as const,
    statement: objective,
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:turn-1" }],
  }, {
    id: "mission",
    kind: "mission-scenario" as const,
    statement: "Operate safely under the intended operating conditions.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:turn-1" }],
  }, {
    id: "success",
    kind: "success-criterion" as const,
    statement: "Demonstrate the approved baseline before technical evidence is added.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:turn-1" }],
    dependsOnItemIds: ["objective"],
  }, {
    id: "constraint",
    kind: "constraint" as const,
    statement: "Keep the documentary record free of invented verification.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:turn-1" }],
  }];
}

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: "generic-product-v1",
    expectedRevision,
    issuedAt: "2026-08-03T08:59:30.000Z",
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("approved-brief viewer binding does not mutate the supplied snapshots", async () => {
  const root = await Deno.makeTempDir({
    prefix: "approved-brief-viewer-nowrite-",
  });
  try {
    const fixture = await createCompletedBaseline(root);
    const projectSeal = JSON.stringify(fixture.project);
    const threadSeal = JSON.stringify(fixture.thread);
    await buildApprovedBriefViewerBinding({
      project: fixture.project,
      thread: fixture.thread,
      artifactId: fixture.artifactId,
      captures: fixture.captures,
      sources: fixture.sources,
    });
    assertEquals(JSON.stringify(fixture.project), projectSeal);
    assertEquals(JSON.stringify(fixture.thread), threadSeal);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("automatic registrar renews the display basis, preserves the historical brief, and is idempotent across restarts", async () => {
  const root = await Deno.makeTempDir({
    prefix: "viewer-registrar-integration-",
  });
  try {
    const fixture = await createCompletedBaseline(root, true);
    const directory = `${root}/state/local/thread-viewer-apps`;
    const objects = new FileByteStore({
      kind: "thread-viewer-app-object",
      directory: `${directory}/objects`,
      uriNamespace: "thread-viewer-apps",
      label: "test viewer bytes",
    });
    const manifestDigest = await sha256Hex(MANIFEST);
    const html = buildProjectRecordsAppHtml();
    const htmlDigest = await sha256Hex(html);
    await objects.save(
      { algorithm: "sha256", digest: manifestDigest },
      new TextEncoder().encode(MANIFEST),
    );
    await objects.save(
      { algorithm: "sha256", digest: htmlDigest },
      new TextEncoder().encode(html),
    );
    const catalog = {
      schemaVersion: "thread-viewer-app-packages/1.0",
      packages: [{
        app: {
          id: PROJECT_RECORDS_APP_ID,
          version: PROJECT_RECORDS_APP_VERSION,
        },
        manifest: {
          uri: PROJECT_RECORDS_MANIFEST_URI,
          fingerprint: `sha256:${manifestDigest}`,
        },
        resources: [{
          uri: PROJECT_RECORDS_WHOLE_VIEW_URI,
          fingerprint: `sha256:${htmlDigest}`,
        }],
      }],
    };
    await Deno.writeTextFile(
      `${directory}/packages.json`,
      JSON.stringify(catalog),
    );
    const registrar = new FileThreadViewerAppRegistrar({ root });
    assertEquals(await registrar.reconcile(), {
      status: "updated",
      projectCount: 1,
      bindingCount: 1,
      diagnostics: [],
    });
    const registry = new FileThreadViewerAppRegistry({
      registryPath: `${directory}/registry.json`,
      objectDirectory: `${directory}/objects`,
    });
    const first = (await registry.read())!;
    assertEquals(
      first.bindings[0]?.basis.projectRevision,
      fixture.project.revision,
    );
    const bytes = await Deno.readFile(`${directory}/registry.json`);
    assertEquals((await registrar.reconcile()).status, "unchanged");
    assertEquals(
      (await new FileThreadViewerAppRegistrar({ root }).reconcile()).status,
      "unchanged",
    );
    assertEquals(await Deno.readFile(`${directory}/registry.json`), bytes);
    const later = await proposeAndApproveSuccessorBrief(fixture);
    assertEquals((await registrar.reconcile()).status, "updated");
    const updated = (await registry.read())!;
    assertEquals(updated.bindings.length, 1);
    assertEquals(
      updated.bindings[0]?.basis.projectRevision,
      later.project.revision,
    );
    assertEquals(updated.bindings[0]?.anchor.id, fixture.artifactId);
    assertEquals(
      updated.bindings[0]?.session.payload,
      first.bindings[0]?.session.payload,
    );
    assertEquals(
      await fixture.captures.read(fixture.thread.artifacts[0]!.fingerprint),
      fixture.captureText,
    );
    // Corrupt derived installation data cannot overwrite the last valid registry.
    const goodRegistry = await Deno.readFile(`${directory}/registry.json`);
    const exactCapturePath = fixture.captures.pathFor(
      fixture.thread.artifacts[0]!.fingerprint,
    );
    await Deno.writeTextFile(exactCapturePath, "{}");
    const failedRead = await new FileThreadViewerAppRegistrar({ root })
      .reconcile();
    assertEquals(failedRead.diagnostics[0]?.code, "registration-error");
    assertEquals(
      await Deno.readFile(`${directory}/registry.json`),
      goodRegistry,
    );
    await Deno.writeTextFile(exactCapturePath, fixture.captureText);
    await Deno.writeTextFile(`${directory}/packages.json`, "{}");
    await assertRejects(() => registrar.reconcile(), TypeError);
    assertEquals(
      await Deno.readFile(`${directory}/registry.json`),
      goodRegistry,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
