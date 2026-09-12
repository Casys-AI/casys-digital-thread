import { assertEquals, assertRejects } from "@std/assert";
import {
  getRegisteredEngineeringOperation,
  REGISTERED_ENGINEERING_OPERATION_REGISTRY,
} from "../../orchestration/operations/registry.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  EngineeringProjectCommandService,
  type EngineeringProjectPlanOperationRegistry,
  type FailRunCommand,
  type RunCommand,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import { DESIGN_WRITE_GEOMETRY_TOOL } from "../../domain/cad/canonical/canonical-write-geometry-step.ts";
import { COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY } from "../../domain/capability/engineering-capability.ts";
import { validateBuyConfiguration } from "../../domain/buy/buy-configuration.ts";
import {
  BUY_CAPTURE_CONFIGURATION_COST_OPERATION,
  BUY_CAPTURE_CONFIGURATION_COST_TOOL,
  BUY_SEAL_CONFIGURATION_COST_OPERATION,
  BUY_SEAL_CONFIGURATION_COST_TOOL,
  ERPNEXT_BUY_CAPTURE_TOOL,
} from "../../domain/buy/buy-operations.ts";
import {
  encodeBuyCaptureDecisionParameters,
  encodeBuySealDecisionParameters,
} from "../../domain/buy/buy-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  BUY_CANDIDATE_CAPTURE_DESCRIPTOR,
  BUY_SEAL_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../shared/cas/file-capture-store.ts";
import { BuyCaptureConfigurationCostRunExecutor } from "./buy-capture-configuration-cost-run-executor.ts";
import { BuySealConfigurationCostRunExecutor } from "./buy-seal-configuration-cost-run-executor.ts";
import { ErpnextBuyCaptureClient } from "./erpnext-buy-capture-client.ts";
import { UnavailableBuyQualifiedErpBindingResolver } from "./unavailable-buy-erp-binding.ts";
import {
  BUY_SOURCE_CAPTURE_SCHEMA,
  BUY_SOURCE_INSTANCE_KIND,
} from "../../domain/buy/buy-source-capture.ts";
import {
  BUY_FIXTURE_PARENT,
  BUY_FIXTURE_RESOURCE,
  BUY_FIXTURE_SITE,
  BUY_FIXTURE_STEP,
  buyCaptureBodyFixture,
  buyConfigurationFixture,
  buyPricingContext,
} from "../../domain/buy/buy-fixtures.ts";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import { FileEngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { buildBuyViewerBinding } from "../thread/buy-viewer-binding.ts";
import { BUY_CANDIDATE_CAPTURE_URI_PREFIX } from "../../domain/buy/buy-candidate-capture.ts";
import { BUY_SEAL_CAPTURE_URI_PREFIX } from "./buy-seal-capture.ts";
import {
  BUY_VIEWER_APP_ID,
  BUY_VIEWER_RESOURCE_URI,
  BUY_VIEWER_SESSION_SCHEMA,
} from "../thread/buy-viewer-binding.ts";
import { ProjectBriefCommandService } from "../../application/use-cases/project/project-brief-command-service.ts";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import { ApprovedBriefBaselineRunExecutor } from "../project/approved-brief-baseline-run-executor.ts";
import { ExactInitialBaselineEvidenceValidator } from "../project/engineering-project-initial-baseline-evidence-validator.ts";
import { ExactThreadCompletionEvidenceValidator } from "../validators/engineering-project-completion-evidence-validator.ts";
import { approvedBriefSourceAnalysisFixture } from "../../testing/approved-brief-source-analysis-fixture.ts";

const AT = "2026-08-15T00:00:00.000Z";
const BUY_COMMAND_AT = "2026-08-09T10:00:00.000Z";
const PROJECT_ID = "reviewed-project-v1";
const SUBJECT_ID = "project:reviewed-project-v1";
const AGENT = { kind: "agent" as const, actorId: "agent:test" };
const HUMAN = { kind: "human" as const, actorId: "human:test" };

function monotoneClock(start: string): () => string {
  let tick = 0;
  const base = Date.parse(start);
  return () => new Date(base + ++tick * 1_000).toISOString();
}

function buyCommandCtx(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: BUY_COMMAND_AT,
  };
}

function makeBuyTestPlanOperationRegistry(): EngineeringProjectPlanOperationRegistry {
  return {
    validate(input) {
      const op = input.operation;
      if (op.id === "fixture.artifacts-stub" && op.version === "1") {
        return {
          operation: {
            id: op.id,
            version: op.version,
            startingPoint: "idea-or-spec",
            title: "Fixture: register pre-built snapshot",
            description:
              "Test-only stub that registers a pre-built extended snapshot by completing a no-op run.",
            workItemKind: "design",
            execution: "trusted",
          },
          bindings: op.bindings,
        };
      }
      return REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(input);
    },
  };
}

function extendSnapshotWithGeometry(
  base: ThreadSnapshot,
  artifacts: ThreadArtifact[],
): ThreadSnapshot {
  const extension: ThreadSnapshotExtension = {
    id: `fixture-extension-${base.revision + 1}`,
    name: "Fixture: geometry + STEP artifacts",
    subjectId: base.subject.id,
    capturedAt: BUY_COMMAND_AT,
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
  const result = applyThreadSnapshotExtensionIfNew(base, extension, {
    appliedAt: BUY_COMMAND_AT,
  });
  if (!result.applied) {
    throw new Error("Geometry extension was already present.");
  }
  return result.snapshot;
}

Deno.test("Buy operations are registered before they are exposed", () => {
  assertEquals(
    getRegisteredEngineeringOperation(BUY_CAPTURE_CONFIGURATION_COST_OPERATION)
      ?.runtimeDemand.kind,
    "required",
  );
  assertEquals(
    getRegisteredEngineeringOperation(BUY_SEAL_CONFIGURATION_COST_OPERATION)
      ?.runtimeDemand.kind,
    "none",
  );
  const capture = getRegisteredEngineeringOperation(
    BUY_CAPTURE_CONFIGURATION_COST_OPERATION,
  );
  assertEquals(
    capture?.runtimeDemand.kind === "required" &&
      capture.runtimeDemand.capabilities[0]?.id ===
        COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY.id,
    true,
  );
});

Deno.test("missing qualified binding blocks before any ERP dispatch", async () => {
  const calls: string[] = [];
  const fixture = await createCaptureFixture({
    binding: new UnavailableBuyQualifiedErpBindingResolver(),
    mcp: {
      callTool(call) {
        calls.push(call.name);
        return Promise.reject(new Error("must not call"));
      },
      callToolTextResult() {
        return Promise.reject(new Error("must not call"));
      },
    },
  });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "No qualified binding is registered",
  );
  assertEquals(calls, []);
});

Deno.test("stale configuration basis is refused before ERP dispatch", async () => {
  const calls: string[] = [];
  const fixture = await createCaptureFixture({
    configuration: buyConfigurationFixture({
      basis: {
        snapshotId: "snapshot.buy.prior",
        revision: 1,
        subjectId: SUBJECT_ID,
      },
    }),
    mcp: {
      callTool(call) {
        calls.push(call.name);
        return Promise.reject(new Error("must not call"));
      },
      callToolTextResult() {
        return Promise.reject(new Error("must not call"));
      },
    },
  });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "Thread basis",
  );
  assertEquals(calls, []);
});

Deno.test(
  "foreign-subject human approval is refused before ERP dispatch",
  async () => {
    const calls: string[] = [];
    const fixture = await createCaptureFixture({
      mcp: {
        callTool(call) {
          calls.push(call.name);
          return Promise.reject(new Error("must not call"));
        },
        callToolTextResult() {
          return Promise.reject(new Error("must not call"));
        },
      },
    });
    const foreign = {
      snapshotId: "snapshot.buy.r1",
      revision: 1,
      subjectId: "project:foreign-subject",
    };
    const decision = fixture.project.decisions[0]!;
    (decision as { baseSnapshot: typeof foreign }).baseSnapshot = foreign;
    const approval = fixture.project.approvals[0]!;
    (approval as { baseSnapshot: typeof foreign }).baseSnapshot = foreign;
    await assertRejects(
      () => fixture.executor.execute(AGENT, fixture.command),
      EngineeringProjectCommandError,
      "human-approved",
    );
    assertEquals(calls, []);
  },
);

Deno.test(
  "capture then signed seal traverse registry, executor and CAS and build a viewer session",
  async () => {
    const root = await Deno.makeTempDir({ prefix: "buy-cas-" });
    try {
      const mcpCalls: string[] = [];
      const wrapper = await loadProducerWrapper();
      const captureFixture = await createCaptureFixture({
        mcp: {
          callTool(call) {
            mcpCalls.push(call.name);
            assertEquals(call.name, ERPNEXT_BUY_CAPTURE_TOOL);
            return Promise.resolve({
              structuredContent: wrapper,
              text: "",
            });
          },
          callToolTextResult() {
            return Promise.reject(new Error("unused"));
          },
        },
        candidateDirectory: `${root}/candidates`,
        snapshotDirectory: `${root}/snapshots`,
      });
      const captured = await captureFixture.executor.execute(
        AGENT,
        captureFixture.command,
      );
      assertEquals(captured.agentRuns[0]?.status, "completed");
      assertEquals(mcpCalls, [ERPNEXT_BUY_CAPTURE_TOOL]);
      const candidateSnapshot = await captureFixture.snapshots.getFresh(
        captured.agentRuns[0]!.resultSnapshot!.snapshotId,
      );
      const candidateArtifact = candidateSnapshot?.artifacts.find((item) =>
        item.producer.tool === BUY_CAPTURE_CONFIGURATION_COST_TOOL
      );
      assertEquals(candidateArtifact?.kind, "document");
      assertEquals(
        candidateArtifact?.uri?.startsWith(BUY_CANDIDATE_CAPTURE_URI_PREFIX),
        true,
      );
      const replayed = await captureFixture.executor.execute(
        AGENT,
        captureFixture.command,
      );
      assertEquals(replayed.agentRuns[0]?.status, "completed");
      assertEquals(mcpCalls, [ERPNEXT_BUY_CAPTURE_TOOL]);

      const sealFixture = await createSealFixture({
        project: captured,
        snapshots: captureFixture.snapshots,
        candidateDirectory: `${root}/candidates`,
        sealDirectory: `${root}/seals`,
        candidateArtifact: candidateArtifact!,
      });
      const sealed = await sealFixture.executor.execute(
        AGENT,
        sealFixture.command,
      );
      assertEquals(
        sealed.agentRuns.find((run) => run.id === "run.buy-seal")?.status,
        "completed",
      );
      const sealedSnapshot = await sealFixture.snapshots.getFresh(
        sealed.agentRuns.find((run) => run.id === "run.buy-seal")!
          .resultSnapshot!
          .snapshotId,
      );
      const sealedArtifact = sealedSnapshot?.artifacts.find((item) =>
        item.producer.tool === BUY_SEAL_CONFIGURATION_COST_TOOL
      );
      assertEquals(candidateSnapshot?.previous, {
        snapshotId: "snapshot.buy.r1",
        revision: 1,
      });
      assertEquals(sealedSnapshot?.previous, {
        snapshotId: candidateSnapshot!.id,
        revision: candidateSnapshot!.revision,
      });
      const sealedText = await sealFixture.sealStore.read(
        sealedArtifact!.fingerprint,
      );
      const sealedCapture = JSON.parse(sealedText ?? "{}") as {
        readonly configuration: {
          readonly basis: {
            readonly snapshotId: string;
            readonly revision: number;
            readonly subjectId: string;
          };
        };
      };
      assertEquals(sealedCapture.configuration.basis, {
        snapshotId: "snapshot.buy.r1",
        revision: 1,
        subjectId: SUBJECT_ID,
      });
      assertEquals(sealedArtifact?.kind, "document");
      assertEquals(
        sealedArtifact?.uri?.startsWith(BUY_SEAL_CAPTURE_URI_PREFIX),
        true,
      );

      const viewerProject = await viewerProjectFor(
        root,
        sealedSnapshot!,
        sealedArtifact!,
        sealFixture,
      );
      const session = await buildBuyViewerBinding({
        project: viewerProject,
        thread: sealedSnapshot!,
        artifactId: sealedArtifact!.id,
        packages: [installedBuyPackage()],
        seals: sealFixture.sealStore,
      });
      assertEquals(session?.session.schema, BUY_VIEWER_SESSION_SCHEMA);
      const payload = session!.session.payload as {
        readonly kind: string;
        readonly projection: {
          readonly status: string;
          readonly result?: {
            readonly coverage?: {
              readonly status?: string;
              readonly excludedLineIds?: readonly string[];
            };
            readonly gaps?: readonly unknown[];
            readonly totals?: readonly { readonly kind?: string }[];
          };
        };
        readonly anchor: {
          readonly kind: string;
          readonly id: string;
          readonly uri: string;
          readonly fingerprint: string;
        };
        readonly provenance: {
          readonly operation: string;
          readonly bundleRef: {
            readonly uri: string;
            readonly fingerprint: string;
          };
        };
      };
      assertEquals(payload.kind, "buy.configuration-cost");
      assertEquals(payload.projection.status, "available");
      assertEquals(payload.anchor.kind, "document");
      assertEquals(payload.anchor.id, sealedArtifact!.id);
      assertEquals(
        payload.anchor.uri.startsWith(BUY_SEAL_CAPTURE_URI_PREFIX),
        true,
      );
      assertEquals(payload.anchor.uri, payload.provenance.bundleRef.uri);
      assertEquals(
        payload.anchor.fingerprint,
        payload.provenance.bundleRef.fingerprint,
      );
      assertEquals(
        payload.provenance.operation,
        BUY_SEAL_CONFIGURATION_COST_TOOL,
      );
      const result = payload.projection.result;
      assertEquals(result?.coverage?.status, "complete");
      assertEquals(result?.coverage?.excludedLineIds, []);
      assertEquals(result?.gaps, []);
      assertEquals(
        result?.totals?.some((item) => item.kind === "complete-total"),
        true,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

async function loadProducerWrapper(): Promise<Record<string, unknown>> {
  const text = await Deno.readTextFile(
    new URL("./fixtures/buy-source-capture.wrapper.json", import.meta.url),
  );
  return JSON.parse(text.endsWith("\n") ? text.slice(0, -1) : text);
}

Deno.test("seal refuses a candidate configuration from another project", async () => {
  const root = await Deno.makeTempDir({ prefix: "buy-seal-foreign-" });
  try {
    const wrapper = await loadProducerWrapper();
    const captureFixture = await createCaptureFixture({
      mcp: {
        callTool() {
          return Promise.resolve({
            structuredContent: wrapper,
            text: "",
          });
        },
        callToolTextResult() {
          return Promise.reject(new Error("unused"));
        },
      },
      candidateDirectory: `${root}/candidates`,
      snapshotDirectory: `${root}/snapshots`,
    });
    const captured = await captureFixture.executor.execute(
      AGENT,
      captureFixture.command,
    );
    const candidateSnapshot = await captureFixture.snapshots.getFresh(
      captured.agentRuns[0]!.resultSnapshot!.snapshotId,
    );
    const candidateArtifact = candidateSnapshot?.artifacts.find((item) =>
      item.producer.tool === BUY_CAPTURE_CONFIGURATION_COST_TOOL
    );
    const sealFixture = await createSealFixture({
      project: captured,
      snapshots: captureFixture.snapshots,
      candidateDirectory: `${root}/candidates`,
      sealDirectory: `${root}/seals`,
      candidateArtifact: candidateArtifact!,
    });
    await assertRejects(
      () =>
        sealFixture.executor.execute(AGENT, {
          ...sealFixture.command,
          projectId: "other-project-v1",
        }),
      EngineeringProjectCommandError,
      "projectId",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("capture refuses a spoofed sourceInstance from the provider", async () => {
  const body = buyCaptureBodyFixture({
    sourceInstance: {
      kind: BUY_SOURCE_INSTANCE_KIND,
      siteId: `sha256:${"0".repeat(64)}`,
    },
  });
  const envelope = await sourceEnvelope(body);
  const fixture = await createCaptureFixture({
    mcp: {
      callTool() {
        return Promise.resolve({
          structuredContent: envelope as unknown as Record<string, unknown>,
          text: "",
        });
      },
      callToolTextResult() {
        return Promise.reject(new Error("unused"));
      },
    },
  });
  await assertRejects(
    () => fixture.executor.execute(AGENT, fixture.command),
    EngineeringProjectCommandError,
    "sourceInstance",
  );
});

Deno.test(
  "capture then signed seal traverse the real command service, CAS and published viewer session",
  async () => {
    const root = await Deno.makeTempDir({ prefix: "buy-real-command-" });
    const sessionDump = Deno.env.get("BUY_DT_REAL_COMMAND_SESSION_PATH");
    try {
      const mcpCalls: string[] = [];
      const wrapper = await loadProducerWrapper();
      const now = monotoneClock("2026-08-09T10:00:00.000Z");
      const projects = new FileEngineeringProjectRevisionStore(
        `${root}/projects`,
      );
      const snapshots = new FileThreadSnapshotStore(`${root}/snapshots`);
      const baselineCaptures = new FileCaptureStore({
        ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
        directory: `${root}/baseline-captures`,
      });
      const candidateCaptures = new FileCaptureStore({
        ...BUY_CANDIDATE_CAPTURE_DESCRIPTOR,
        directory: `${root}/candidates`,
      });
      const sealCaptures = new FileCaptureStore({
        ...BUY_SEAL_CAPTURE_DESCRIPTOR,
        directory: `${root}/seals`,
      });
      const lease = new FileEngineeringProjectRunLease(`${root}/leases`);
      const briefs = new ProjectBriefCommandService(projects, now);
      let project = await briefs.startProject(AGENT, {
        commandId: "start-proj",
        projectId: PROJECT_ID,
        projectName: "Buy real command path",
        issuedAt: "2026-08-09T09:59:00.000Z",
        intent: "Exercise the registered Buy command-service path.",
        intentSource: { kind: "human", reference: "conversation:buy-command" },
      });
      project = await briefs.proposeBrief(AGENT, {
        ...buyCommandCtx("propose-brief", project.revision),
        items: [{
          id: "objective",
          kind: "objective",
          statement: "Capture and seal dated Buy costs.",
          sourceRefs: [{
            kind: "intent",
            reference: "conversation:buy-command",
          }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement: "Keep capture documentary until a signed seal.",
          sourceRefs: [{
            kind: "intent",
            reference: "conversation:buy-command",
          }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement: "Persist completed capture and seal through the command service.",
          sourceRefs: [{
            kind: "intent",
            reference: "conversation:buy-command",
          }],
          dependsOnItemIds: [],
        }],
      });
      project = await briefs.approveBrief(HUMAN, {
        ...buyCommandCtx("approve-brief", project.revision),
        briefSnapshotId: project.framing!.proposedBrief!.id,
        briefRevision: project.framing!.proposedBrief!.revision,
        rationale: "Approved for Buy command-service fixture.",
        inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
      });
      const commands = new EngineeringProjectCommandService(
        projects,
        new ExactThreadCompletionEvidenceValidator(snapshots),
        now,
        { operations: makeBuyTestPlanOperationRegistry() },
        new ExactInitialBaselineEvidenceValidator(
          snapshots,
          baselineCaptures,
          approvedBriefSourceAnalysisFixture(root),
        ),
      );
      project = await commands.publishPlan(AGENT, {
        ...buyCommandCtx("publish-plan", project.revision),
        startingPoint: "idea-or-spec",
        phases: [{
          id: "baseline",
          name: "Baseline",
          description: "Brief baseline.",
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
      project = await commands.queueRun(AGENT, {
        ...buyCommandCtx("queue-brief", project.revision),
        runId: "run:brief-baseline",
        workItemId: "record-brief",
        summary: "Record the approved brief.",
        basis: project.plan!.basis,
      });
      const baselined = await new ApprovedBriefBaselineRunExecutor({
        projects,
        commands,
        captures: baselineCaptures,
        ...approvedBriefSourceAnalysisFixture(root),
        snapshots,
        lease: new FileEngineeringProjectRunLease(`${root}/baseline-leases`),
        now: () => "2026-08-09T10:01:00.000Z",
      }).execute(AGENT, {
        commandId: "execute-brief-baseline",
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: "2026-08-09T10:01:00.000Z",
        runId: "run:brief-baseline",
      });
      const r1Ref = baselined.threadSnapshots[0]!;
      const r1Snapshot = await snapshots.get(r1Ref.snapshotId);
      if (!r1Snapshot) {
        throw new Error("r1 snapshot missing in Buy command path");
      }
      const geometry = writeGeometryPrimary();
      const r2Snapshot = extendSnapshotWithGeometry(r1Snapshot, [
        geometry,
        cadAssetStep(),
      ]);
      await snapshots.save(r2Snapshot);
      const r2Ref = {
        snapshotId: r2Snapshot.id,
        revision: r2Snapshot.revision,
        subjectId: r2Snapshot.subject.id,
      };
      project = await commands.appendChange(AGENT, {
        ...buyCommandCtx("append-fixture", baselined.revision),
        baseSnapshot: r1Ref,
        phases: [{
          id: "fixture-phase",
          name: "Fixture: register extended snapshot",
          description:
            "Stub phase to promote geometry into the project's declared snapshots.",
        }],
        workItems: [{
          id: "fixture-item",
          phaseId: "fixture-phase",
          owner: "agent",
          dependsOnWorkItemIds: [],
          decisionIds: [],
          operation: {
            id: "fixture.artifacts-stub",
            version: "1",
            bindings: [],
          },
        }],
        requiredDecisions: [],
      });
      project = await commands.queueRun(AGENT, {
        ...buyCommandCtx("queue-fixture", project.revision),
        runId: "run:fixture-artifacts",
        workItemId: "fixture-item",
        summary: "Stub: register extended snapshot.",
        basis: {
          kind: "thread-snapshot",
          snapshotId: r1Ref.snapshotId,
          revision: r1Ref.revision,
          subjectId: r1Ref.subjectId,
        },
      });
      project = await commands.claimRun(AGENT, {
        ...buyCommandCtx("claim-fixture", project.revision),
        runId: "run:fixture-artifacts",
        summary: "Stub: claim fixture run.",
      });
      project = await commands.publishRun(AGENT, {
        ...buyCommandCtx("publish-fixture", project.revision),
        runId: "run:fixture-artifacts",
        summary: "Stub: publish fixture run.",
      });
      project = await commands.completeRun(AGENT, {
        ...buyCommandCtx("complete-fixture", project.revision),
        runId: "run:fixture-artifacts",
        summary: "Stub: complete fixture run.",
        resultSnapshot: r2Ref,
        evidenceRefs: [{
          kind: "artifact",
          id: geometry.id,
          snapshotId: r2Snapshot.id,
          snapshotRevision: r2Snapshot.revision,
        }],
      });

      const configuration = validateBuyConfiguration(buyConfigurationFixture({
        basis: r2Ref,
      }));
      const configurationDigest = (await sha256Fingerprint(configuration)).digest;
      const configurationText = deterministicJson(configuration);
      const qualifiedBinding = {
        resolve: () =>
          Promise.resolve({
            status: "qualified" as const,
            binding: {
              capability: COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY,
              qualification: "qualified" as const,
              sourceInstance: {
                kind: BUY_SOURCE_INSTANCE_KIND,
                siteId: BUY_FIXTURE_SITE,
              },
              adapter: {
                id: "erpnext-buy-capture-fixture",
                version: "0.0.0-fixture",
              },
            },
          }),
      };
      const captureExecutor = new BuyCaptureConfigurationCostRunExecutor({
        projects,
        commands,
        snapshots,
        captures: candidateCaptures,
        configurations: { read: () => Promise.resolve(configurationText) },
        bindings: qualifiedBinding,
        erpnext: new ErpnextBuyCaptureClient({
          callTool(call) {
            mcpCalls.push(call.name);
            assertEquals(call.name, ERPNEXT_BUY_CAPTURE_TOOL);
            return Promise.resolve({ structuredContent: wrapper, text: "" });
          },
          callToolTextResult() {
            return Promise.reject(new Error("unused"));
          },
        }),
        lease,
      });
      const sealExecutor = new BuySealConfigurationCostRunExecutor({
        projects,
        commands,
        snapshots,
        candidates: candidateCaptures,
        captures: sealCaptures,
        lease,
      });

      project = await commands.appendChange(AGENT, {
        ...buyCommandCtx("append-capture", project.revision),
        baseSnapshot: r2Ref,
        phases: [{
          id: "capture-phase",
          name: "Capture Buy costs",
          description: "Capture the reviewed configuration and dated costs.",
        }],
        workItems: [{
          id: "work.buy-capture",
          phaseId: "capture-phase",
          owner: "agent",
          dependsOnWorkItemIds: ["fixture-item"],
          decisionIds: ["decision.buy-capture"],
          operation: {
            id: BUY_CAPTURE_CONFIGURATION_COST_OPERATION.id,
            version: BUY_CAPTURE_CONFIGURATION_COST_OPERATION.version,
            bindings: [{
              name: "approvedBrief",
              source: { kind: "approved-brief" },
            }],
          },
        }],
        requiredDecisions: [{
          id: "decision.buy-capture",
          phaseId: "capture-phase",
          title: "Approve Buy capture",
          question: "Approve capture of the reviewed configuration and dated costs?",
        }],
      });
      project = await commands.proposeDecision(AGENT, {
        ...buyCommandCtx("propose-capture", project.revision),
        decisionId: "decision.buy-capture",
        baseSnapshot: r2Ref,
        proposal: {
          summary: "Capture the reviewed Buy configuration and dated costs.",
          parameters: encodeBuyCaptureDecisionParameters({
            configurationDigest,
            configurationResourceUri:
              `casys://agent-resource-capture/sha256/${BUY_FIXTURE_RESOURCE}`,
            configurationResourceDigest: BUY_FIXTURE_RESOURCE,
            schemaVersion: configuration.schemaVersion,
            projectId: PROJECT_ID,
            subjectId: SUBJECT_ID,
            configurationRevision: configuration.configurationRevision,
            basisSnapshotId: r2Snapshot.id,
            basisRevision: r2Snapshot.revision,
            geometry: configuration.geometry,
            documents: [{
              doctype: "Item Price",
              name: "ITEM-PRICE-SYNTHETIC-001",
            }],
            pricing: buyPricingContext(),
            authorizedSiteFingerprint: BUY_FIXTURE_SITE,
            providerTool: ERPNEXT_BUY_CAPTURE_TOOL,
          }),
        },
      });
      const captureDecision = project.decisions.find((item) =>
        item.id === "decision.buy-capture"
      )!;
      project = await commands.approveDecision(HUMAN, {
        ...buyCommandCtx("approve-capture", project.revision),
        decisionId: "decision.buy-capture",
        rationale:
          "Human test-fixture signature over candidate configuration STEP hashes.",
        inputFingerprint: captureDecision.inputFingerprint!,
      });
      project = await commands.queueRun(AGENT, {
        ...buyCommandCtx("queue-capture", project.revision),
        runId: "run.buy-capture",
        workItemId: "work.buy-capture",
        summary: "Capture Buy configuration-cost candidate.",
        basis: { kind: "thread-snapshot", ...r2Ref },
      });
      const captured = await captureExecutor.execute(AGENT, {
        commandId: "execute-buy-capture",
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: BUY_COMMAND_AT,
        runId: "run.buy-capture",
      });
      assertEquals(
        captured.agentRuns.find((run) => run.id === "run.buy-capture")?.status,
        "completed",
      );
      assertEquals(mcpCalls, [ERPNEXT_BUY_CAPTURE_TOOL]);
      const replayedCapture = await captureExecutor.execute(AGENT, {
        commandId: "execute-buy-capture-replay",
        projectId: PROJECT_ID,
        expectedRevision: captured.revision,
        issuedAt: BUY_COMMAND_AT,
        runId: "run.buy-capture",
      });
      assertEquals(replayedCapture.revision, captured.revision);
      assertEquals(mcpCalls, [ERPNEXT_BUY_CAPTURE_TOOL]);

      const captureRun = captured.agentRuns.find((run) =>
        run.id === "run.buy-capture"
      )!;
      const candidateSnapshot = await snapshots.getFresh(
        captureRun.resultSnapshot!.snapshotId,
      );
      if (!candidateSnapshot) {
        throw new Error(
          "capture result snapshot missing after real command path",
        );
      }
      validateThreadSnapshot(candidateSnapshot);
      const candidateArtifact = candidateSnapshot.artifacts.find((item) =>
        item.producer.tool === BUY_CAPTURE_CONFIGURATION_COST_TOOL
      );
      if (!candidateArtifact) {
        throw new Error(
          "Buy candidate artifact missing after real command path",
        );
      }
      const candidateText = await candidateCaptures.read(
        candidateArtifact.fingerprint,
      );
      if (candidateText === undefined) {
        throw new Error(
          "Buy candidate capture bytes missing after real command path",
        );
      }
      const candidate = JSON.parse(candidateText) as {
        readonly bundleDigest: string;
        readonly configurationDigest: string;
        readonly configuration: {
          readonly geometry: { readonly stepFingerprint: string };
        };
        readonly bundle: {
          readonly coverage: {
            readonly status: "complete" | "partial" | "unresolved";
          };
        };
        readonly sourceCaptures: ReadonlyArray<
          { readonly fingerprint: string }
        >;
      };
      const candidateRef = {
        snapshotId: candidateSnapshot.id,
        revision: candidateSnapshot.revision,
        subjectId: candidateSnapshot.subject.id,
      };

      project = await commands.appendChange(AGENT, {
        ...buyCommandCtx("append-seal", replayedCapture.revision),
        baseSnapshot: candidateRef,
        phases: [{
          id: "seal-phase",
          name: "Seal Buy costs",
          description: "Seal the reviewed configuration-cost bundle.",
        }],
        workItems: [{
          id: "work.buy-seal",
          phaseId: "seal-phase",
          owner: "agent",
          dependsOnWorkItemIds: ["work.buy-capture"],
          decisionIds: ["decision.buy-seal"],
          operation: {
            id: BUY_SEAL_CONFIGURATION_COST_OPERATION.id,
            version: BUY_SEAL_CONFIGURATION_COST_OPERATION.version,
            bindings: [{
              name: "approvedBrief",
              source: { kind: "approved-brief" },
            }],
          },
        }],
        requiredDecisions: [{
          id: "decision.buy-seal",
          phaseId: "seal-phase",
          title: "Approve Buy seal",
          question: "Approve sealing the reviewed Buy candidate?",
        }],
      });
      project = await commands.proposeDecision(AGENT, {
        ...buyCommandCtx("propose-seal", project.revision),
        decisionId: "decision.buy-seal",
        baseSnapshot: candidateRef,
        proposal: {
          summary: "Seal the reviewed Buy configuration-cost candidate.",
          parameters: encodeBuySealDecisionParameters({
            candidateDigest: candidateArtifact.fingerprint.digest,
            bundleDigest: candidate.bundleDigest,
            configurationDigest: candidate.configurationDigest,
            stepFingerprint: candidate.configuration.geometry.stepFingerprint,
            coverageStatus: candidate.bundle.coverage.status,
            sourceCaptureCount: candidate.sourceCaptures.length,
            sourceCaptureDigests: candidate.sourceCaptures.map((item) =>
              item.fingerprint.replace(/^sha256:/, "")
            ),
          }),
        },
      });
      const sealDecision = project.decisions.find((item) =>
        item.id === "decision.buy-seal"
      )!;
      project = await commands.approveDecision(HUMAN, {
        ...buyCommandCtx("approve-seal", project.revision),
        decisionId: "decision.buy-seal",
        rationale: "Human test-fixture signature over candidate bundle STEP hashes.",
        inputFingerprint: sealDecision.inputFingerprint!,
      });
      project = await commands.queueRun(AGENT, {
        ...buyCommandCtx("queue-seal", project.revision),
        runId: "run.buy-seal",
        workItemId: "work.buy-seal",
        summary: "Seal Buy configuration-cost bundle.",
        basis: { kind: "thread-snapshot", ...candidateRef },
      });
      const sealed = await sealExecutor.execute(AGENT, {
        commandId: "execute-buy-seal",
        projectId: PROJECT_ID,
        expectedRevision: project.revision,
        issuedAt: BUY_COMMAND_AT,
        runId: "run.buy-seal",
      });
      assertEquals(
        sealed.agentRuns.find((run) => run.id === "run.buy-seal")?.status,
        "completed",
      );
      const replayedSeal = await sealExecutor.execute(AGENT, {
        commandId: "execute-buy-seal-replay",
        projectId: PROJECT_ID,
        expectedRevision: sealed.revision,
        issuedAt: BUY_COMMAND_AT,
        runId: "run.buy-seal",
      });
      assertEquals(replayedSeal.revision, sealed.revision);
      assertEquals(mcpCalls, [ERPNEXT_BUY_CAPTURE_TOOL]);

      const reopened = validateEngineeringProjectSnapshot(
        (await projects.get(PROJECT_ID))!,
      );
      const reopenedRevision = await projects.getRevision(
        PROJECT_ID,
        reopened.revision,
      );
      assertEquals(reopenedRevision?.id, reopened.id);
      const captureCompleted = reopened.agentRuns.find((run) =>
        run.id === "run.buy-capture"
      );
      const sealCompleted = reopened.agentRuns.find((run) => run.id === "run.buy-seal");
      assertEquals(captureCompleted?.status, "completed");
      assertEquals(sealCompleted?.status, "completed");
      assertEquals(
        captureCompleted?.resultSnapshot?.snapshotId,
        candidateSnapshot.id,
      );
      assertEquals(
        captureCompleted?.evidenceRefs[0]?.id,
        candidateArtifact.id,
      );
      const sealedSnapshot = await snapshots.getFresh(
        sealCompleted!.resultSnapshot!.snapshotId,
      );
      if (!sealedSnapshot) {
        throw new Error("seal result snapshot missing after real command path");
      }
      validateThreadSnapshot(sealedSnapshot);
      const sealedArtifact = sealedSnapshot.artifacts.find((item) =>
        item.producer.tool === BUY_SEAL_CONFIGURATION_COST_TOOL
      );
      if (!sealedArtifact) {
        throw new Error("Buy seal artifact missing after real command path");
      }
      assertEquals(sealCompleted?.evidenceRefs[0]?.id, sealedArtifact.id);
      assertEquals(
        sealedSnapshot.artifacts.filter((item) =>
          item.producer.tool === BUY_CAPTURE_CONFIGURATION_COST_TOOL
        ).length,
        1,
      );
      assertEquals(
        sealedSnapshot.artifacts.filter((item) =>
          item.producer.tool === BUY_SEAL_CONFIGURATION_COST_TOOL
        ).length,
        1,
      );
      const receiptTypes = new Set<string>(
        (reopened.commandReceipts ?? []).map((item) => item.type),
      );
      for (
        const type of [
          "project.plan-publish",
          "project.change-append",
          "decision.propose",
          "decision.approve",
          "agent-run.queue",
          "agent-run.claim",
          "agent-run.publish",
          "agent-run.complete",
        ]
      ) {
        assertEquals(receiptTypes.has(type), true);
      }

      const session = await buildBuyViewerBinding({
        project: reopened,
        thread: sealedSnapshot,
        artifactId: sealedArtifact.id,
        packages: [installedBuyPackage()],
        seals: sealCaptures,
      });
      assertEquals(session?.session.schema, BUY_VIEWER_SESSION_SCHEMA);
      const payload = session!.session.payload as {
        readonly kind: string;
        readonly projection: { readonly status: string };
        readonly anchor: {
          readonly kind: string;
          readonly id: string;
          readonly uri: string;
          readonly fingerprint: string;
        };
        readonly provenance: {
          readonly bundleRef: {
            readonly uri: string;
            readonly fingerprint: string;
          };
        };
      };
      assertEquals(payload.kind, "buy.configuration-cost");
      assertEquals(payload.projection.status, "available");
      assertEquals(payload.anchor.kind, "document");
      assertEquals(payload.anchor.id, sealedArtifact.id);
      assertEquals(payload.anchor.uri, sealedArtifact.uri);
      assertEquals(payload.anchor.uri, payload.provenance.bundleRef.uri);
      assertEquals(
        payload.anchor.fingerprint,
        payload.provenance.bundleRef.fingerprint,
      );
      if (sessionDump) {
        await Deno.writeTextFile(sessionDump, `${JSON.stringify(payload)}\n`);
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

async function sourceEnvelope(body = buyCaptureBodyFixture()) {
  const canonicalText = deterministicJson(body);
  const digest = await sha256Hex(new TextEncoder().encode(canonicalText));
  return {
    schemaVersion: BUY_SOURCE_CAPTURE_SCHEMA,
    capture: body,
    canonicalText,
    fingerprint: `sha256:${digest}`,
    byteCount: new TextEncoder().encode(canonicalText).byteLength,
  };
}

async function createCaptureFixture(options: {
  readonly binding?: ConstructorParameters<
    typeof BuyCaptureConfigurationCostRunExecutor
  >[0]["bindings"];
  readonly mcp: ConstructorParameters<typeof ErpnextBuyCaptureClient>[0];
  readonly candidateDirectory?: string;
  readonly snapshotDirectory?: string;
  readonly configuration?: ReturnType<typeof buyConfigurationFixture>;
}) {
  const configuration = validateBuyConfiguration(
    options.configuration ?? buyConfigurationFixture(),
  );
  const configurationDigest = (await sha256Fingerprint(configuration)).digest;
  const configurationText = deterministicJson(configuration);
  const parameters = encodeBuyCaptureDecisionParameters({
    configurationDigest,
    configurationResourceUri:
      `casys://agent-resource-capture/sha256/${BUY_FIXTURE_RESOURCE}`,
    configurationResourceDigest: BUY_FIXTURE_RESOURCE,
    schemaVersion: configuration.schemaVersion,
    projectId: PROJECT_ID,
    subjectId: SUBJECT_ID,
    configurationRevision: 1,
    basisSnapshotId: "snapshot.buy.r1",
    basisRevision: 1,
    geometry: configuration.geometry,
    documents: [{ doctype: "Item Price", name: "ITEM-PRICE-SYNTHETIC-001" }],
    pricing: buyPricingContext(),
    authorizedSiteFingerprint: BUY_FIXTURE_SITE,
    providerTool: ERPNEXT_BUY_CAPTURE_TOOL,
  });
  const { project, snapshots } = await projectFixture({
    runId: "run.buy-capture",
    workId: "work.buy-capture",
    decisionId: "decision.buy-capture",
    approvalId: "approval.buy-capture",
    operationId: BUY_CAPTURE_CONFIGURATION_COST_OPERATION.id,
    parameters,
    summary: "Capture Buy costs.",
    snapshotDirectory: options.snapshotDirectory,
  });
  const captures = options.candidateDirectory
    ? new FileCaptureStore({
      ...BUY_CANDIDATE_CAPTURE_DESCRIPTOR,
      directory: options.candidateDirectory,
    })
    : new MemoryCaptures(BUY_CANDIDATE_CAPTURE_URI_PREFIX);
  const commands = new MemoryCommands(project);
  const executor = new BuyCaptureConfigurationCostRunExecutor({
    projects: storeFor(project),
    commands,
    snapshots,
    captures: captures as never,
    configurations: {
      read: () => Promise.resolve(configurationText),
    },
    bindings: options.binding ?? {
      resolve: () =>
        Promise.resolve({
          status: "qualified",
          binding: {
            capability: COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY,
            qualification: "qualified",
            sourceInstance: {
              kind: BUY_SOURCE_INSTANCE_KIND,
              siteId: BUY_FIXTURE_SITE,
            },
            adapter: {
              id: "erpnext-buy-capture-fixture",
              version: "0.0.0-fixture",
            },
          },
        }),
    },
    erpnext: new ErpnextBuyCaptureClient(options.mcp),
    lease: { withLease: (_projectId, _scope, operation) => operation() },
  });
  return {
    command: {
      commandId: "command.buy-capture",
      projectId: PROJECT_ID,
      expectedRevision: 1,
      issuedAt: AT,
      runId: "run.buy-capture",
    },
    snapshots,
    executor,
    project,
  };
}

async function createSealFixture(options: {
  readonly project: EngineeringProjectSnapshot;
  readonly snapshots: {
    get(id: string): Promise<ThreadSnapshot | undefined>;
    getFresh(id: string): Promise<ThreadSnapshot | undefined>;
    save(snapshot: ThreadSnapshot): Promise<void>;
    latest(subjectId: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly candidateDirectory: string;
  readonly sealDirectory: string;
  readonly candidateArtifact: ThreadArtifact;
}) {
  const candidateText = await Deno.readTextFile(
    `${options.candidateDirectory}/${options.candidateArtifact.fingerprint.digest}.json`,
  );
  const candidate = JSON.parse(candidateText) as {
    readonly bundleDigest: string;
    readonly configurationDigest: string;
    readonly configuration: {
      readonly geometry: { readonly stepFingerprint: string };
    };
    readonly bundle: {
      readonly coverage: {
        readonly status: "complete" | "partial" | "unresolved";
      };
    };
    readonly sourceCaptures: ReadonlyArray<{ readonly fingerprint: string }>;
  };
  const parameters = encodeBuySealDecisionParameters({
    candidateDigest: options.candidateArtifact.fingerprint.digest,
    bundleDigest: candidate.bundleDigest,
    configurationDigest: candidate.configurationDigest,
    stepFingerprint: candidate.configuration.geometry.stepFingerprint,
    coverageStatus: candidate.bundle.coverage.status,
    sourceCaptureCount: candidate.sourceCaptures.length,
    sourceCaptureDigests: candidate.sourceCaptures.map((item) =>
      item.fingerprint.replace(/^sha256:/, "")
    ),
  });
  const { project } = await projectFixture({
    runId: "run.buy-seal",
    workId: "work.buy-seal",
    decisionId: "decision.buy-seal",
    approvalId: "approval.buy-seal",
    operationId: BUY_SEAL_CONFIGURATION_COST_OPERATION.id,
    parameters,
    summary: "Seal Buy costs.",
    extraRuns: options.project.agentRuns,
    extraDecisions: options.project.decisions,
    extraApprovals: options.project.approvals,
    extraWorkItems: options.project.workItems,
    snapshotId: options.candidateArtifact
      ? options.project.agentRuns[0]?.resultSnapshot?.snapshotId ??
        "snapshot.buy.r1"
      : "snapshot.buy.r1",
    snapshotRevision: options.project.agentRuns[0]?.resultSnapshot?.revision ??
      1,
  });
  const sealStore = new FileCaptureStore({
    ...BUY_SEAL_CAPTURE_DESCRIPTOR,
    directory: options.sealDirectory,
  });
  const candidateStore = new FileCaptureStore({
    ...BUY_CANDIDATE_CAPTURE_DESCRIPTOR,
    directory: options.candidateDirectory,
  });
  const commands = new MemoryCommands(project);
  const executor = new BuySealConfigurationCostRunExecutor({
    projects: storeFor(project),
    commands,
    snapshots: options.snapshots,
    candidates: candidateStore,
    captures: sealStore,
    lease: { withLease: (_projectId, _scope, operation) => operation() },
  });
  return {
    command: {
      commandId: "command.buy-seal",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: AT,
      runId: "run.buy-seal",
    },
    snapshots: options.snapshots,
    executor,
    sealStore,
    parameters,
  };
}

async function viewerProjectFor(
  root: string,
  thread: ThreadSnapshot,
  artifact: ThreadArtifact,
  sealFixture: {
    readonly parameters: ReturnType<typeof encodeBuySealDecisionParameters>;
  },
) {
  const briefs = new ProjectBriefCommandService(
    new FileEngineeringProjectRevisionStore(`${root}/viewer-project`),
    () => AT,
  );
  const seeded = await startApprovedBrief(briefs);
  const threadRef = {
    snapshotId: thread.id,
    revision: thread.revision,
    subjectId: SUBJECT_ID,
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: threadRef,
    inputEvidenceRefs: [],
    proposal: {
      summary: "Seal Buy costs.",
      parameters: sealFixture.parameters,
    },
  });
  return validateEngineeringProjectSnapshot({
    ...seeded,
    threadSnapshots: [threadRef],
    phases: [{
      id: "phase.industrialize",
      name: "Industrialize",
      order: 1,
      description: "Buy evidence.",
      workItemIds: ["work.buy-seal"],
      requiredDecisionIds: ["decision.buy-seal"],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work.buy-seal",
      activityId: "activity:work.buy-seal",
      phaseId: "phase.industrialize",
      title: "Seal Buy costs",
      description: "Seal Buy costs.",
      kind: "industrialize",
      operation: {
        id: BUY_SEAL_CONFIGURATION_COST_OPERATION.id,
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
      status: "completed",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [{
        snapshotId: thread.id,
        snapshotRevision: thread.revision,
        kind: "artifact",
        id: artifact.id,
      }],
      decisionIds: ["decision.buy-seal"],
      blockerIds: [],
    }],
    decisions: [{
      id: "decision.buy-seal",
      phaseId: "phase.industrialize",
      title: "Seal Buy costs",
      question: "Seal Buy costs?",
      status: "approved",
      requestedAt: AT,
      baseSnapshot: threadRef,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
      approvalIds: ["approval.buy-seal"],
      proposal: {
        summary: "Seal Buy costs.",
        parameters: sealFixture.parameters,
        proposedAt: AT,
        proposedBy: { id: AGENT.actorId, origin: "agent" },
      },
    }],
    approvals: [{
      id: "approval.buy-seal",
      decisionId: "decision.buy-seal",
      status: "approved",
      requestedAt: AT,
      decidedAt: AT,
      decidedBy: HUMAN.actorId,
      decidedByOrigin: "human",
      rationale: "Reviewed.",
      baseSnapshot: threadRef,
      inputFingerprint: decisionFingerprint,
      inputEvidenceRefs: [],
    }],
    agentRuns: [{
      id: artifact.producer.runId,
      workItemId: "work.buy-seal",
      status: "completed",
      summary: "Sealed Buy costs.",
      queuedAt: AT,
      startedAt: AT,
      completedAt: AT,
      basis: { kind: "thread-snapshot", ...threadRef },
      inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      evidenceRefs: [{
        snapshotId: thread.id,
        snapshotRevision: thread.revision,
        kind: "artifact",
        id: artifact.id,
      }],
      resultSnapshot: threadRef,
    }],
  });
}

async function startApprovedBrief(briefs: ProjectBriefCommandService) {
  let project = await briefs.startProject(AGENT, {
    commandId: "start",
    projectId: PROJECT_ID,
    projectName: "Buy composition fixture",
    issuedAt: AT,
    intent: "Exercise Buy evidence.",
    intentSource: { kind: "human", reference: "conversation:test" },
  });
  project = await briefs.proposeBrief(AGENT, {
    commandId: "brief",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: AT,
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Exercise Buy evidence.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "scenario",
      kind: "mission-scenario",
      statement: "Reopen sealed Buy evidence.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Preserve the exact dated costs.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      dependsOnItemIds: [],
    }],
  });
  return await briefs.approveBrief(HUMAN, {
    commandId: "approve",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: AT,
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "fixture",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
}

async function projectFixture(options: {
  readonly runId: string;
  readonly workId: string;
  readonly decisionId: string;
  readonly approvalId: string;
  readonly operationId: string;
  readonly parameters: ReturnType<typeof encodeBuyCaptureDecisionParameters>;
  readonly summary: string;
  readonly extraRuns?: EngineeringProjectSnapshot["agentRuns"];
  readonly extraDecisions?: EngineeringProjectSnapshot["decisions"];
  readonly extraApprovals?: EngineeringProjectSnapshot["approvals"];
  readonly extraWorkItems?: EngineeringProjectSnapshot["workItems"];
  readonly snapshotId?: string;
  readonly snapshotRevision?: number;
  readonly snapshotDirectory?: string;
}) {
  const artifacts = [briefArtifact(), writeGeometryPrimary(), cadAssetStep()];
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: options.snapshotId ?? "snapshot.buy.r1",
    revision: options.snapshotRevision ?? 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Buy fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.brief",
      name: "Brief",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.brief",
        kind: "created",
        target: { kind: "artifact", id: "artifact.brief" },
        summary: "Created the brief.",
        afterFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      }],
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.brief",
      relation: "changes",
      from: { kind: "change", id: "change.brief" },
      to: { kind: "artifact", id: "artifact.brief" },
      rationale: "The applied change introduced the brief.",
    }],
    proposedActions: [],
  });
  const reviewBasis = {
    snapshotId: basisSnapshot.id,
    revision: basisSnapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const runBasis = { kind: "thread-snapshot" as const, ...reviewBasis };
  const operation = {
    id: options.operationId,
    version: "1",
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" as const },
    }],
  };
  const decisionFingerprint = await sha256Fingerprint({
    baseSnapshot: reviewBasis,
    inputEvidenceRefs: [],
    proposal: { summary: options.summary, parameters: options.parameters },
  });
  const runFingerprint = await sha256Fingerprint({
    workItemId: options.workId,
    basis: runBasis,
    operation,
    approvedDecisions: [{
      id: options.decisionId,
      inputFingerprint: decisionFingerprint,
    }],
  });
  const project = {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Buy fixture",
      subjectId: SUBJECT_ID,
      objective: { title: "Buy", statement: "Capture costs." },
    },
    threadSnapshots: [reviewBasis],
    phases: [{
      id: "phase.industrialize",
      name: "Industrialize",
      order: 1,
      description: "Buy evidence.",
      workItemIds: [
        options.workId,
        ...(options.extraWorkItems ?? []).map((item) => item.id),
      ],
      requiredDecisionIds: [
        options.decisionId,
        ...(options.extraDecisions ?? []).map((item) => item.id),
      ],
      evidenceRefs: [],
    }],
    workItems: [
      ...(options.extraWorkItems ?? []),
      {
        id: options.workId,
        activityId: `activity:${options.workId}`,
        phaseId: "phase.industrialize",
        title: options.summary,
        description: options.summary,
        kind: "industrialize",
        operation,
        status: "in-progress",
        owner: "agent",
        dependsOnWorkItemIds: [],
        evidenceRefs: [],
        decisionIds: [options.decisionId],
        blockerIds: [],
      },
    ],
    agentRuns: [
      ...(options.extraRuns ?? []),
      {
        id: options.runId,
        workItemId: options.workId,
        status: "queued",
        summary: options.summary,
        queuedAt: AT,
        basis: runBasis,
        inputFingerprint: runFingerprint,
        evidenceRefs: [],
      },
    ],
    decisions: [
      ...(options.extraDecisions ?? []),
      {
        id: options.decisionId,
        phaseId: "phase.industrialize",
        title: options.summary,
        question: options.summary,
        status: "approved",
        requestedAt: AT,
        baseSnapshot: reviewBasis,
        inputFingerprint: decisionFingerprint,
        inputEvidenceRefs: [],
        approvalIds: [options.approvalId],
        proposal: {
          summary: options.summary,
          parameters: options.parameters,
          proposedAt: AT,
          proposedBy: { id: AGENT.actorId, origin: "agent" },
        },
      },
    ],
    approvals: [
      ...(options.extraApprovals ?? []),
      {
        id: options.approvalId,
        decisionId: options.decisionId,
        status: "approved",
        requestedAt: AT,
        decidedAt: AT,
        decidedBy: HUMAN.actorId,
        decidedByOrigin: "human",
        rationale: "Reviewed.",
        baseSnapshot: reviewBasis,
        inputFingerprint: decisionFingerprint,
        inputEvidenceRefs: [],
      },
    ],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
  if (options.snapshotDirectory) {
    const snapshots = new FileThreadSnapshotStore(options.snapshotDirectory);
    await snapshots.save(basisSnapshot);
    return { project, snapshots };
  }
  return { project, snapshots: new MemorySnapshots(basisSnapshot) };
}

function storeFor(project: MutableProject): EngineeringProjectRevisionStore {
  return {
    get: () => Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    getRevision: () =>
      Promise.resolve(project as unknown as EngineeringProjectSnapshot),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
}

function installedBuyPackage() {
  return {
    app: { id: BUY_VIEWER_APP_ID, version: "0.0.0-fixture" },
    manifest: {
      uri: "casys://thread-viewer-apps/sha256/1",
      path: "/tmp/buy-manifest.json",
      fingerprint: "1".repeat(64),
    },
    resources: [{
      uri: BUY_VIEWER_RESOURCE_URI,
      path: "/tmp/buy-viewer.html",
      fingerprint: "2".repeat(64),
      sessionSchemas: [BUY_VIEWER_SESSION_SCHEMA],
      resultSchemas: ["io.casys.mcp-erpnext.buy-recorded-result/1.0"],
      acceptedActions: ["viewer.session.apply"],
    }],
  };
}

function briefArtifact(): ThreadArtifact {
  return {
    id: "artifact.brief",
    name: "Brief",
    kind: "document",
    version: "1",
    fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    producer: {
      serverId: "digital-thread",
      tool: "baseline.from-approved-brief@1",
      runId: "run.brief",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
}

function writeGeometryPrimary(): ThreadArtifact {
  return {
    id: `geometry-${BUY_FIXTURE_PARENT}`,
    name: "Geometry",
    kind: "cad-model",
    version: BUY_FIXTURE_PARENT,
    fingerprint: { algorithm: "sha256", digest: BUY_FIXTURE_PARENT },
    uri: `casys://geometry-capture/sha256/${BUY_FIXTURE_PARENT}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: DESIGN_WRITE_GEOMETRY_TOOL,
      runId: "run.geometry",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
}

function cadAssetStep(): ThreadArtifact {
  return {
    id: `cad-asset-${BUY_FIXTURE_PARENT}-target-0-${BUY_FIXTURE_STEP}`,
    name: "STEP",
    kind: "step",
    version: BUY_FIXTURE_STEP,
    fingerprint: { algorithm: "sha256", digest: BUY_FIXTURE_STEP },
    uri: `/api/thread/assets/${BUY_FIXTURE_STEP}.step`,
    mediaType: "model/step",
    producer: {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: "run.geometry",
    },
    inputArtifactIds: [],
    freshness: fresh(AT),
  };
}

function fresh(changedAt: string) {
  return { status: "fresh" as const, changedAt, invalidatedByChangeIds: [] };
}

class MemorySnapshots {
  readonly #byId = new Map<string, ThreadSnapshot>();
  constructor(initial: ThreadSnapshot) {
    this.#byId.set(initial.id, initial);
  }
  get(snapshotId: string) {
    return Promise.resolve(this.#byId.get(snapshotId));
  }
  getFresh(snapshotId: string) {
    return this.get(snapshotId);
  }
  latest(_subjectId?: string) {
    return Promise.resolve([...this.#byId.values()].at(-1));
  }
  save(snapshot: ThreadSnapshot) {
    this.#byId.set(snapshot.id, snapshot);
    return Promise.resolve();
  }
}

class MemoryCaptures {
  readonly #byDigest = new Map<string, string>();
  constructor(private readonly prefix: string) {}
  save(fingerprint: ContentFingerprint, text: string) {
    this.#byDigest.set(fingerprint.digest, text);
    return Promise.resolve({
      uri: this.uriFor(fingerprint),
      path: `${fingerprint.digest}.json`,
    });
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#byDigest.get(fingerprint.digest));
  }
  uriFor(fingerprint: ContentFingerprint) {
    return `${this.prefix}${fingerprint.digest}`;
  }
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  commandReceipts: unknown[];
};

class MemoryCommands {
  constructor(readonly project: MutableProject) {}
  claimRun(origin: typeof AGENT, _command: RunCommand) {
    const run = this.project.agentRuns.find((item) => item.status === "queued") ??
      this.project.agentRuns.at(-1)!;
    if (run.status === "queued") {
      (run as { status: string }).status = "running";
      (run as { startedAt?: string }).startedAt = AT;
      (run as { claimedAt?: string }).claimedAt = AT;
      (run as { claimedBy?: { id: string; origin: "agent" } }).claimedBy = {
        id: origin.actorId,
        origin: "agent",
      };
      this.project.revision += 1;
    }
    return Promise.resolve(this.project);
  }
  publishRun() {
    const run = this.project.agentRuns.find((item) => item.status === "running") ??
      this.project.agentRuns.at(-1)!;
    (run as { status: string }).status = "publishing";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  completeRun(_origin: typeof AGENT, command: CompleteRunCommand) {
    const run = this.project.agentRuns.find((item) => item.id === command.runId) ??
      this.project.agentRuns.at(-1)!;
    (run as { status: string }).status = "completed";
    (run as { completedAt?: string }).completedAt = AT;
    (run as { resultSnapshot?: unknown }).resultSnapshot = command.resultSnapshot;
    (run as { evidenceRefs?: unknown }).evidenceRefs = command.evidenceRefs;
    if (command.resultSnapshot) {
      (this.project as { threadSnapshots: unknown }).threadSnapshots = [
        command.resultSnapshot,
      ];
    }
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
  failRun(_origin: typeof AGENT, command: FailRunCommand) {
    const run = this.project.agentRuns.find((item) => item.id === command.runId) ??
      this.project.agentRuns.at(-1)!;
    (run as { status: string }).status = "failed";
    this.project.revision += 1;
    return Promise.resolve(this.project);
  }
}
