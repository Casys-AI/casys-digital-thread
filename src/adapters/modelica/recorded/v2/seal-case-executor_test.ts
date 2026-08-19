import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import {
  canonicalSimulationCaseV2Text,
  validateSimulationCaseV2,
} from "../../../../domain/modelica/recorded/simulation-case-v2.ts";
import { validateSimulationCase } from "../../../../domain/modelica/recorded/simulation-case.ts";
import {
  fingerprintModelicaResumableProviderJson,
} from "../../../../domain/modelica/recorded/resumable-capabilities.ts";
import {
  encodeSimulationCaseV2DecisionParameters,
} from "../../../../domain/modelica/recorded/simulation-case-v2-proposal.ts";
import {
  encodeSimulationCaseDecisionParameters,
} from "../../../../domain/modelica/recorded/simulation-case-proposal.ts";
import {
  type SimulationCaseV2Catalog,
  simulationCaseV2CatalogKey,
} from "../../../../domain/modelica/recorded/simulation-case-v2-catalog.ts";
import {
  createProviderResourceRead,
  fingerprintResourceBytes,
  type ProviderResourceReader,
} from "../../../../domain/compile/source/provider-resource-reader.ts";
import type {
  EngineeringProjectPlanOperationRegistry,
} from "../../../../application/use-cases/project/engineering-project-command-service.ts";
import type { EngineeringProjectCommandOrigin } from "../../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../../application/ports/out/engineering-project-revision-store.ts";
import { EngineeringProjectCommandService } from "../../../../application/use-cases/project/engineering-project-command-service.ts";
import { validateEngineeringProjectSnapshot } from "../../../../domain/project/engineering-project-validation.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../../../domain/project/engineering-project.ts";
import type { RegisteredRunPlanSealInput } from "../../../../domain/project/resolved-run-plan-sealer.ts";
import { ProjectBriefCommandService } from "../../../../application/use-cases/project/project-brief-command-service.ts";
import {
  FEA_ISOLATED_STATIC_PROOF_OPERATION_DESCRIPTORS,
} from "../../../../orchestration/operations/fea-isolated-static-proof.ts";
import {
  SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
} from "../../../../domain/modelica/recorded/simulation-case-v2-proposal.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../../../../orchestration/operations/registry.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import { approvedBriefSourceAnalysisFixture } from "../../../../testing/approved-brief-source-analysis-fixture.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../../../shared/cas/file-capture-store.ts";
import { FileByteStore } from "../../../shared/cas/file-byte-store.ts";
import {
  canonicalModelicaSimulationCaseQualificationCaptureText,
  decodeExactUtf8,
  validateModelicaSimulationCaseQualificationCapture,
} from "./simulation-case-qualification-capture.ts";
import { ModelicaQualifiedSourceCaptureService } from "./qualified-source-capture.ts";
import { FileEngineeringProjectRevisionStore } from "../../../shared/stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../../../shared/stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../../../shared/stores/file-thread-snapshot-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "../../../project/engineering-project-initial-baseline-evidence-validator.ts";
import { ExactThreadCompletionEvidenceValidator } from "../../../validators/engineering-project-completion-evidence-validator.ts";
import { FileModelicaQualifiedSealAttemptStore } from "./qualified-seal-attempt-store.ts";
import { ResolvedOperationPlanResolver } from "../../../compile/plans/resolved-operation-plan-resolver.ts";
import { ApprovedBriefBaselineRunExecutor } from "../../../project/approved-brief-baseline-run-executor.ts";
import { SimulateSealSimulationCaseV2RunExecutor } from "./seal-case-executor.ts";

const AGENT: EngineeringProjectCommandOrigin = {
  kind: "agent",
  actorId: "agent:engineering",
};
const HUMAN: EngineeringProjectCommandOrigin = {
  kind: "human",
  actorId: "human:reviewer",
};
const PROJECT_ID = "qualified-seal-project";
const SUBJECT_ID = `project:${PROJECT_ID}`;

Deno.test(
  "qualified Modelica seal persists distinct exact artifacts and resumes a running post-snapshot publication offline",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-qualified-modelica-seal-",
    });
    try {
      const fixture = await fixtureProject(directory);
      let manifestCalls = 0;
      let resourceCalls = 0;
      let online = true;
      const manifest = await fixtureManifest();
      const bytesByUri = await fixtureBytes(manifest);
      const reader: ProviderResourceReader = {
        async read(expected) {
          resourceCalls += 1;
          if (!online) throw new Error("provider must not be read during recovery");
          const bytes = bytesByUri.get(expected.uri);
          if (!bytes) throw new Error("unexpected provider resource");
          return await createProviderResourceRead(expected, bytes);
        },
      };
      const sourceCapture = new ModelicaQualifiedSourceCaptureService({
        reader,
        artifacts: byteStore(
          "modelica-qualified-source",
          `${directory}/source-bytes`,
          "modelica-qualified-source",
        ),
        captures: byteStore(
          "modelica-qualified-source-capture",
          `${directory}/source-captures`,
          "modelica-qualified-source-capture",
        ),
      });
      const commands = failFirstPublish(fixture.commands);
      const executor = createExecutor({
        directory,
        fixture,
        commands,
        sourceCapture,
        manifestReader: {
          getManifest() {
            manifestCalls += 1;
            return online
              ? Promise.resolve(manifest)
              : Promise.reject(new Error("manifest_get must not run during recovery"));
          },
        },
      });

      await assertRejects(
        () => executor.execute(AGENT, command(fixture.queued.revision, fixture.runId)),
        Error,
        "simulated publish failure",
      );
      const afterFault = await fixture.projects.get(PROJECT_ID);
      assertEquals(
        afterFault?.agentRuns.find((run) => run.id === fixture.runId)?.status,
        "running",
      );
      const attempt = await new FileModelicaQualifiedSealAttemptStore(
        `${directory}/attempts`,
      ).read(PROJECT_ID, fixture.runId);
      assert(attempt && attempt.status === "snapshot-persisted");
      const persisted = attempt.snapshot;
      const snapshot = await fixture.snapshots.get(persisted.snapshotId);
      assert(snapshot, "saved snapshot must be readable");
      const ownArtifacts = snapshot.artifacts.filter((artifact) =>
        artifact.producer.runId === fixture.runId
      );
      assertEquals(
        ownArtifacts.length,
        6,
        "case, three sources, manifest, source capture and authority are distinct",
      );
      const caseArtifact = ownArtifacts.find((artifact) =>
        artifact.id.startsWith("simulation-case-v2-")
      );
      assert(caseArtifact);
      assertEquals(caseArtifact.fingerprint.digest, fixture.caseDigest);
      assertEquals(
        caseArtifact.uri,
        `casys://simulation-case-v2/sha256/${fixture.caseDigest}`,
      );
      const authority = ownArtifacts.find((artifact) =>
        artifact.id.startsWith("simulation-case-qualification-")
      );
      assert(authority);
      assertEquals(
        [...authority.inputArtifactIds].sort(),
        ownArtifacts.filter((artifact) => artifact.id !== authority.id).map((
          artifact,
        ) => artifact.id).sort(),
      );
      assert(snapshot.consumptions.some((item) => item.artifactId === caseArtifact.id));
      assert(
        snapshot.provenance.some((link) =>
          link.relation === "derived_from" && link.from.id === authority.id
        ),
      );
      assert(
        snapshot.analysisGraph?.relations.every((relation) =>
          relation.assertion.evidence[0]?.id === caseArtifact.id
        ),
      );
      const authorityBytes = await byteStore(
        "simulation-case-qualification",
        `${directory}/qualification`,
        "simulation-case-qualification",
      ).read(authority.fingerprint);
      assert(authorityBytes);
      const authorityDocument = validateModelicaSimulationCaseQualificationCapture(
        JSON.parse(decodeExactUtf8(authorityBytes.copy(), "authority fixture")),
      );
      assertEquals(
        canonicalModelicaSimulationCaseQualificationCaptureText(authorityDocument),
        decodeExactUtf8(authorityBytes.copy(), "authority fixture"),
      );
      assertEquals(authorityDocument.trustedRunId, fixture.runId);
      assertEquals(authorityDocument.caseDigest, caseArtifact.fingerprint.digest);
      assertEquals(
        authorityDocument.manifest.sha256,
        ownArtifacts.find((artifact) =>
          artifact.id.startsWith("modelica-provider-manifest-")
        )?.fingerprint.digest,
      );
      assertEquals(
        authorityDocument.sources.map((source) => source.role),
        ["model", "scenario"],
      );

      const revisionBeforeRecovery = afterFault!.revision;
      const snapshotIdBeforeRecovery = persisted.snapshotId;
      online = false;
      const completed = await executor.execute(
        AGENT,
        command(revisionBeforeRecovery, fixture.runId),
      );
      assertEquals(
        completed.agentRuns.find((run) => run.id === fixture.runId)?.status,
        "completed",
      );
      assertEquals(manifestCalls, 1, "recovery must not re-read manifest_get");
      assertEquals(resourceCalls, 2, "recovery must not re-read provider resources");
      assertEquals(
        completed.threadSnapshots.at(-1)?.snapshotId,
        snapshotIdBeforeRecovery,
      );
      const resolvedPlan = await resolveActualSealThroughModelicaPlanResolver({
        directory,
        fixture,
        completed,
        snapshot,
      });
      assertEquals(resolvedPlan.basis.snapshotId, snapshot.id);
      assertEquals(
        resolvedPlan.sources.map((source) => source.threadRef.id),
        [
          caseArtifact.id,
          ownArtifacts.find((artifact) =>
            artifact.id.startsWith("modelica-provider-manifest-")
          )!.id,
          authority.id,
          ...ownArtifacts.filter((artifact) =>
            artifact.id.startsWith("modelica-source-")
          ).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
            .map((artifact) => artifact.id),
        ],
      );

      const replay = await executor.execute(
        AGENT,
        command(completed.revision, fixture.runId),
      );
      assertEquals(
        replay.revision,
        completed.revision,
        "completed replay is exact no-op",
      );
      assertEquals(manifestCalls, 1);
      assertEquals(resourceCalls, 2);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "qualified Modelica seal rejects a manifest mismatch before claim or publication",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-qualified-modelica-mismatch-",
    });
    try {
      const fixture = await fixtureProject(directory);
      const mismatch = await fixtureManifest({
        modelId: "other-qualified-model",
        modelVersion: "1.0.0",
        scenarioId: "nominal-heatup",
      });
      let resourcesRead = 0;
      const executor = createExecutor({
        directory,
        fixture,
        sourceCapture: new ModelicaQualifiedSourceCaptureService({
          reader: {
            read() {
              resourcesRead += 1;
              return Promise.reject(
                new Error("must not read sources after manifest mismatch"),
              );
            },
          },
          artifacts: byteStore(
            "modelica-qualified-source",
            `${directory}/source-bytes`,
            "modelica-qualified-source",
          ),
          captures: byteStore(
            "modelica-qualified-source-capture",
            `${directory}/source-captures`,
            "modelica-qualified-source-capture",
          ),
        }),
        manifestReader: { getManifest: () => Promise.resolve(mismatch) },
      });
      await assertRejects(
        () => executor.execute(AGENT, command(fixture.queued.revision, fixture.runId)),
        Error,
        "model or scenario identity",
      );
      assertEquals(resourcesRead, 0);
      const project = await fixture.projects.get(PROJECT_ID);
      assertEquals(
        project?.agentRuns.find((run) => run.id === fixture.runId)?.status,
        "queued",
      );
      assertEquals(project?.threadSnapshots.length, 1);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "qualified Modelica seal rejects an uncatalogued V2 case before source or provider reads",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-qualified-modelica-uncatalogued-",
    });
    try {
      const fixture = await fixtureProject(directory);
      let sourceReads = 0;
      let manifestCalls = 0;
      let providerReads = 0;
      const executor = createExecutor({
        directory,
        fixture,
        sourceCapture: new ModelicaQualifiedSourceCaptureService({
          reader: {
            read() {
              providerReads += 1;
              return Promise.reject(
                new Error("uncatalogued case must not read provider bytes"),
              );
            },
          },
          artifacts: byteStore(
            "modelica-qualified-source",
            `${directory}/source-bytes`,
            "modelica-qualified-source",
          ),
          captures: byteStore(
            "modelica-qualified-source-capture",
            `${directory}/source-captures`,
            "modelica-qualified-source-capture",
          ),
        }),
        manifestReader: {
          getManifest() {
            manifestCalls += 1;
            return Promise.reject(
              new Error("uncatalogued case must not read manifest"),
            );
          },
        },
        simulationCaseCatalog: new Map(),
        readTextFile: () => {
          sourceReads += 1;
          return Promise.reject(
            new Error("uncatalogued case must not read its source"),
          );
        },
      });

      await assertRejects(
        () => executor.execute(AGENT, command(fixture.queued.revision, fixture.runId)),
        Error,
        "server-side catalog",
      );
      assertEquals(sourceReads, 0);
      assertEquals(manifestCalls, 0);
      assertEquals(providerReads, 0);
      const project = await fixture.projects.get(PROJECT_ID);
      assertEquals(
        project?.agentRuns.find((run) => run.id === fixture.runId)?.status,
        "queued",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "qualified Modelica seal @2 rejects an actually approved V1 proposal before manifest, source, claim, or collection",
  async () => {
    const directory = await Deno.makeTempDir({
      prefix: "casys-qualified-modelica-v1-proposal-",
    });
    try {
      const fixture = await fixtureProject(directory);
      const v1Case = fixtureV1Case(fixture.simulationCase);
      const originalDecision = fixture.queued.decisions.find((decision) =>
        decision.id === "qualified-seal-decision"
      )!;
      const v1Proposal = {
        ...originalDecision.proposal!,
        parameters: encodeSimulationCaseDecisionParameters(
          "a".repeat(64),
          v1Case,
        ),
      };
      const v1InputFingerprint = await sha256Fingerprint({
        baseSnapshot: originalDecision.baseSnapshot,
        inputEvidenceRefs: originalDecision.inputEvidenceRefs,
        proposal: {
          summary: v1Proposal.summary,
          parameters: v1Proposal.parameters,
        },
      });
      const v1Decision = {
        ...originalDecision,
        inputFingerprint: v1InputFingerprint,
        proposal: v1Proposal,
      };
      const v1Project = validateEngineeringProjectSnapshot({
        ...fixture.queued,
        decisions: fixture.queued.decisions.map((decision) =>
          decision.id === v1Decision.id ? v1Decision : decision
        ),
        approvals: fixture.queued.approvals.map((approval) =>
          approval.decisionId === v1Decision.id
            ? { ...approval, inputFingerprint: v1InputFingerprint }
            : approval
        ),
      });
      const projects = new Proxy(fixture.projects, {
        get(target, property, receiver) {
          if (property === "get") {
            return async (projectId: string) =>
              projectId === PROJECT_ID
                ? structuredClone(v1Project)
                : await target.get(projectId);
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as EngineeringProjectRevisionStore;
      let sourceCalls = 0;
      let manifestCalls = 0;
      let resourceCalls = 0;
      const executor = createExecutor({
        directory,
        fixture,
        projects,
        sourceCapture: new ModelicaQualifiedSourceCaptureService({
          reader: {
            read() {
              resourceCalls += 1;
              return Promise.reject(
                new Error("V1 proposal must stop before source read"),
              );
            },
          },
          artifacts: byteStore(
            "modelica-qualified-source",
            `${directory}/source-bytes`,
            "modelica-qualified-source",
          ),
          captures: byteStore(
            "modelica-qualified-source-capture",
            `${directory}/source-captures`,
            "modelica-qualified-source-capture",
          ),
        }),
        manifestReader: {
          getManifest() {
            manifestCalls += 1;
            return Promise.reject(
              new Error("V1 proposal must stop before manifest_get"),
            );
          },
        },
        readTextFile: () => {
          sourceCalls += 1;
          return Promise.reject(
            new Error("V1 proposal must stop before case source read"),
          );
        },
      });

      await assertRejects(
        () => executor.execute(AGENT, command(v1Project.revision, fixture.runId)),
        Error,
      );
      assertEquals(sourceCalls, 0);
      assertEquals(manifestCalls, 0);
      assertEquals(resourceCalls, 0);
      assertEquals(
        await new FileModelicaQualifiedSealAttemptStore(`${directory}/attempts`).read(
          PROJECT_ID,
          fixture.runId,
        ),
        undefined,
      );
      assertEquals(
        (await fixture.projects.get(PROJECT_ID))?.agentRuns.find((run) =>
          run.id === fixture.runId
        )?.status,
        "queued",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "qualified Modelica seal rejects a native source or public projection mismatch before provider reads",
  async () => {
    for (
      const mismatch of [
        { scenarioSourceText: '{"id":"nominal-heatup","changed":true}' },
        {
          scenarioPublic: {
            ...fixtureScenarioPublic(),
            description: "Different reviewed projection",
          },
        },
      ]
    ) {
      const directory = await Deno.makeTempDir({
        prefix: "casys-qualified-modelica-scenario-identity-",
      });
      try {
        const fixture = await fixtureProject(directory);
        const manifest = await fixtureManifest(undefined, mismatch);
        let resourcesRead = 0;
        const executor = createExecutor({
          directory,
          fixture,
          sourceCapture: new ModelicaQualifiedSourceCaptureService({
            reader: {
              read() {
                resourcesRead += 1;
                return Promise.reject(
                  new Error("source reads must remain unreachable"),
                );
              },
            },
            artifacts: byteStore(
              "modelica-qualified-source",
              `${directory}/source-bytes`,
              "modelica-qualified-source",
            ),
            captures: byteStore(
              "modelica-qualified-source-capture",
              `${directory}/source-captures`,
              "modelica-qualified-source-capture",
            ),
          }),
          manifestReader: { getManifest: () => Promise.resolve(manifest) },
        });
        await assertRejects(
          () =>
            executor.execute(AGENT, command(fixture.queued.revision, fixture.runId)),
          Error,
          "model or scenario identity",
        );
        assertEquals(resourcesRead, 0);
        const project = await fixture.projects.get(PROJECT_ID);
        assertEquals(
          project?.agentRuns.find((run) => run.id === fixture.runId)?.status,
          "queued",
        );
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
);

async function fixtureProject(directory: string) {
  const projects = new FileEngineeringProjectRevisionStore(`${directory}/projects`);
  const snapshots = new FileThreadSnapshotStore(`${directory}/snapshots`);
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-08-12T00:00:00.000Z") + ++tick * 1_000).toISOString();
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${directory}/baseline-captures`,
  });
  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(AGENT, {
    commandId: "start",
    projectId: PROJECT_ID,
    projectName: "Qualified seal test",
    issuedAt: "2026-08-12T00:00:00.000Z",
    intent: "Test exact qualified Modelica sealing.",
    intentSource: { kind: "human", reference: "conversation:test" },
  });
  project = await briefs.proposeBrief(AGENT, {
    ...context("brief-propose", project.revision),
    items: [{
      id: "objective",
      kind: "objective",
      statement: "Seal an exact simulation case.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "mission",
      kind: "mission-scenario",
      statement: "Qualify a Modelica method.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
    }, {
      id: "success",
      kind: "success-criterion",
      statement: "Publish exact source provenance.",
      sourceRefs: [{ kind: "intent", reference: "conversation:test" }],
      dependsOnItemIds: [],
    }],
  });
  project = await briefs.approveBrief(HUMAN, {
    ...context("brief-approve", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Approved.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });
  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: modelicaSealTestOperationRegistry() },
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      baselineCaptures,
      approvedBriefSourceAnalysisFixture(directory),
    ),
  );
  project = await commands.publishPlan(AGENT, {
    ...context("plan", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{ id: "baseline", name: "Baseline", description: "Record the brief." }],
    workItems: [{
      id: "brief-baseline",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [],
  });
  project = await commands.queueRun(AGENT, {
    ...context("queue-baseline", project.revision),
    runId: "run:baseline",
    workItemId: "brief-baseline",
    summary: "Baseline.",
    basis: project.plan!.basis,
  });
  const baselined = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    ...approvedBriefSourceAnalysisFixture(directory),
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${directory}/baseline-leases`),
    now: () => "2026-08-12T00:01:00.000Z",
  }).execute(AGENT, {
    ...context("run-baseline", project.revision),
    runId: "run:baseline",
  });
  const basis = baselined.threadSnapshots[0]!;
  const simulationCase = await fixtureCase(basis.snapshotId);
  const caseDigest = await fingerprintResourceBytes(
    new TextEncoder().encode(canonicalSimulationCaseV2Text(simulationCase)),
  );
  project = await commands.appendChange(AGENT, {
    ...context("append", baselined.revision),
    baseSnapshot: basis,
    phases: [{
      id: "seal",
      name: "Qualified seal",
      description: "Freeze exact Modelica evidence.",
    }],
    workItems: [{
      id: "qualified-seal",
      phaseId: "seal",
      owner: "agent",
      dependsOnWorkItemIds: ["brief-baseline"],
      decisionIds: ["qualified-seal-decision"],
      operation: {
        id: SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.id,
        version: SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION.version,
        bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
      },
    }],
    requiredDecisions: [{
      id: "qualified-seal-decision",
      phaseId: "seal",
      title: "Seal",
      question: "Seal this Modelica case?",
    }],
  });
  project = await commands.proposeDecision(AGENT, {
    ...context("propose", project.revision),
    decisionId: "qualified-seal-decision",
    baseSnapshot: basis,
    proposal: {
      summary: "Seal qualified Modelica input evidence.",
      parameters: encodeSimulationCaseV2DecisionParameters(caseDigest, simulationCase),
    },
  });
  const decision = project.decisions.find((item) =>
    item.id === "qualified-seal-decision"
  )!;
  project = await commands.approveDecision(HUMAN, {
    ...context("approve", project.revision),
    decisionId: decision.id,
    rationale: "Approved exact case.",
    inputFingerprint: decision.inputFingerprint!,
  });
  const runId = "run:qualified-seal";
  const queued = await commands.queueRun(AGENT, {
    ...context("queue", project.revision),
    runId,
    workItemId: "qualified-seal",
    summary: "Seal qualified Modelica case.",
    basis: { kind: "thread-snapshot", ...basis },
  });
  return { projects, snapshots, commands, queued, runId, caseDigest, simulationCase };
}

/**
 * The production registry deliberately stays inert until server wiring is
 * reviewed.  This fixture opts into exactly the recorded-analysis descriptors
 * it exercises, while retaining the ordinary baseline descriptor for setup.
 */
function modelicaSealTestOperationRegistry(): EngineeringProjectPlanOperationRegistry {
  return {
    validate(input) {
      const descriptor = FEA_ISOLATED_STATIC_PROOF_OPERATION_DESCRIPTORS.find((item) =>
        item.id === input.operation.id && item.version === input.operation.version
      );
      if (!descriptor) return REGISTERED_ENGINEERING_OPERATION_REGISTRY.validate(input);
      if (
        input.stage === "queue" &&
        !(descriptor.allowedBasisKinds as readonly string[]).includes(input.basisKind)
      ) {
        throw new TypeError(
          `${descriptor.id}@${descriptor.version} does not accept ${input.basisKind}.`,
        );
      }
      if (
        input.operation.bindings.length !== descriptor.bindings.length ||
        descriptor.bindings.some((declared) => {
          const supplied = input.operation.bindings.filter((binding) =>
            binding.name === declared.name
          );
          return supplied.length !== 1 ||
            !(declared.allowedSourceKinds as readonly string[]).includes(
              supplied[0]!.source.kind,
            ) ||
            ("allowedThreadEntityKinds" in declared &&
              declared.allowedThreadEntityKinds !== undefined &&
              supplied[0]!.source.kind === "thread-entity" &&
              !(declared.allowedThreadEntityKinds as readonly string[]).includes(
                supplied[0]!.source.reference.kind,
              ));
        })
      ) {
        throw new TypeError(
          `${descriptor.id}@${descriptor.version} bindings do not match the test descriptor.`,
        );
      }
      return {
        operation: descriptor,
        bindings: structuredClone(input.operation.bindings),
      };
    },
  };
}

function createExecutor(input: {
  readonly directory: string;
  readonly fixture: Awaited<ReturnType<typeof fixtureProject>>;
  readonly projects?: EngineeringProjectRevisionStore;
  readonly commands?: EngineeringProjectCommandService;
  readonly sourceCapture: ModelicaQualifiedSourceCaptureService;
  readonly manifestReader: {
    getManifest: () => Promise<Awaited<ReturnType<typeof fixtureManifest>>>;
  };
  readonly simulationCaseCatalog?: SimulationCaseV2Catalog;
  readonly readTextFile?: (path: string) => Promise<string>;
}) {
  return new SimulateSealSimulationCaseV2RunExecutor({
    projects: input.projects ?? input.fixture.projects,
    commands: input.commands ?? input.fixture.commands,
    snapshots: input.fixture.snapshots,
    lease: new FileEngineeringProjectRunLease(`${input.directory}/leases`),
    attempts: new FileModelicaQualifiedSealAttemptStore(`${input.directory}/attempts`),
    manifestReader: input.manifestReader,
    providerResources: input.sourceCapture,
    simulationCases: byteStore(
      "simulation-case-v2",
      `${input.directory}/cases`,
      "simulation-case-v2",
    ),
    providerManifests: byteStore(
      "modelica-qualified-provider-manifest",
      `${input.directory}/manifests`,
      "modelica-qualified-provider-manifest",
    ),
    qualificationCaptures: byteStore(
      "simulation-case-qualification",
      `${input.directory}/qualification`,
      "simulation-case-qualification",
    ),
    simulationCaseCatalog: input.simulationCaseCatalog ?? new Map([[
      simulationCaseV2CatalogKey(input.fixture.simulationCase),
      {
        sourcePath: "fixture-case.json",
        canonicalDigest: input.fixture.caseDigest,
      },
    ]]),
    readTextFile: input.readTextFile ??
      (() => Promise.resolve(deterministicJson(input.fixture.simulationCase))),
  });
}

/**
 * Build a genuine pre-commit @2 candidate around the real completed seal.
 * The candidate itself is deliberately not persisted: this test proves the
 * resolver's read-only boundary consumes the exact artifacts just published by
 * the seal, rather than a second synthetic artifact fixture.
 */
async function resolveActualSealThroughModelicaPlanResolver(input: {
  readonly directory: string;
  readonly fixture: Awaited<ReturnType<typeof fixtureProject>>;
  readonly completed: EngineeringProjectSnapshot;
  readonly snapshot: ThreadSnapshot;
}) {
  const caseArtifact = requiredArtifact(
    input.snapshot,
    "simulation-case-v2-",
  );
  const manifestArtifact = requiredArtifact(
    input.snapshot,
    "modelica-provider-manifest-",
  );
  const basis = {
    snapshotId: input.snapshot.id,
    revision: input.snapshot.revision,
    subjectId: input.snapshot.subject.id,
  };
  const evidence: readonly EngineeringThreadEntityRef[] = [
    {
      snapshotId: basis.snapshotId,
      snapshotRevision: basis.revision,
      kind: "artifact",
      id: caseArtifact.id,
    },
    {
      snapshotId: basis.snapshotId,
      snapshotRevision: basis.revision,
      kind: "artifact",
      id: manifestArtifact.id,
    },
  ];
  const operation = {
    id: "simulate.run-modelica-scenario",
    version: "2",
    bindings: [
      {
        name: "simulationCase",
        source: { kind: "thread-entity" as const, reference: evidence[0]! },
      },
      {
        name: "methodManifest",
        source: { kind: "thread-entity" as const, reference: evidence[1]! },
      },
    ],
  };
  const workItem: EngineeringWorkItem = {
    id: "recorded-modelica-run",
    phaseId: "recorded-modelica",
    title: "Run sealed Modelica case",
    description: "Resolve only the exact qualified seal artifacts.",
    kind: "simulate",
    operation,
    status: "ready",
    owner: "agent",
    dependsOnWorkItemIds: ["qualified-seal"],
    evidenceRefs: [],
    decisionIds: ["recorded-modelica-decision"],
    blockerIds: [],
  };
  const proposal = {
    summary: "Run the exact sealed Modelica case.",
    parameters: [],
  };
  const decisionInputFingerprint = await sha256Fingerprint({
    baseSnapshot: basis,
    inputEvidenceRefs: evidence,
    proposal,
  });
  const decision: EngineeringDecision = {
    id: "recorded-modelica-decision",
    phaseId: "recorded-modelica",
    title: "Approve recorded Modelica run",
    question: "Run this exact qualified Modelica case?",
    status: "approved",
    requestedAt: "2026-08-12T00:20:00.000Z",
    baseSnapshot: basis,
    inputFingerprint: decisionInputFingerprint,
    inputEvidenceRefs: evidence,
    approvalIds: ["recorded-modelica-approval"],
    proposal: {
      ...proposal,
      proposedAt: "2026-08-12T00:20:00.000Z",
      proposedBy: { id: AGENT.actorId, origin: AGENT.kind },
    },
  };
  const approval: EngineeringApproval = {
    id: "recorded-modelica-approval",
    decisionId: decision.id,
    status: "approved",
    requestedAt: "2026-08-12T00:20:00.000Z",
    decidedAt: "2026-08-12T00:20:01.000Z",
    decidedBy: HUMAN.actorId,
    decidedByOrigin: HUMAN.kind,
    rationale: "Approved exact recorded inputs.",
    baseSnapshot: basis,
    inputFingerprint: decisionInputFingerprint,
    inputEvidenceRefs: evidence,
  };
  const project: EngineeringProjectSnapshot = {
    ...input.completed,
    phases: [
      ...input.completed.phases,
      {
        id: "recorded-modelica",
        name: "Recorded Modelica run",
        order: input.completed.phases.length,
        description: "Read-only plan resolution fixture.",
        workItemIds: [workItem.id],
        requiredDecisionIds: [decision.id],
        evidenceRefs: [],
      },
    ],
    workItems: [...input.completed.workItems, workItem],
    decisions: [...input.completed.decisions, decision],
    approvals: [...input.completed.approvals, approval],
  };
  const runBasis = { kind: "thread-snapshot" as const, ...basis };
  const runInputFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    basis: runBasis,
    operation,
    approvedDecisions: [{
      id: decision.id,
      inputFingerprint: decisionInputFingerprint,
    }],
  });
  const run: EngineeringAgentRun = {
    id: "run:recorded-modelica",
    workItemId: workItem.id,
    status: "queued",
    summary: "Resolve exact recorded Modelica plan.",
    queuedAt: "2026-08-12T00:20:02.000Z",
    basis: runBasis,
    inputFingerprint: runInputFingerprint,
    evidenceRefs: [],
  };
  const resolverInput: RegisteredRunPlanSealInput = {
    project,
    workItem,
    run,
    queueBasisProject: {
      snapshotId: project.id,
      revision: project.revision,
      fingerprint: await sha256Fingerprint(project),
    },
  };
  return await new ResolvedOperationPlanResolver({
    snapshots: input.fixture.snapshots,
    artifacts: realQualifiedSealArtifactReader(input.directory),
    stepAssets: {
      read: () => Promise.reject(new Error("Modelica plan must not read STEP assets.")),
    },
  }).resolve(resolverInput);
}

function requiredArtifact(snapshot: ThreadSnapshot, idPrefix: string) {
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.id.startsWith(idPrefix)
  );
  assertEquals(matches.length, 1, `expected one ${idPrefix} artifact`);
  return matches[0]!;
}

function realQualifiedSealArtifactReader(directory: string) {
  const stores = new Map<string, {
    read(fingerprint: {
      readonly algorithm: "sha256";
      readonly digest: string;
    }): Promise<{ copy(): Uint8Array } | undefined>;
  }>([
    [
      "simulation-case-v2",
      byteStore("simulation-case-v2", `${directory}/cases`, "simulation-case-v2"),
    ],
    [
      "modelica-qualified-provider-manifest",
      byteStore(
        "modelica-qualified-provider-manifest",
        `${directory}/manifests`,
        "modelica-qualified-provider-manifest",
      ),
    ],
    [
      "modelica-qualified-source",
      byteStore(
        "modelica-qualified-source",
        `${directory}/source-bytes`,
        "modelica-qualified-source",
      ),
    ],
    [
      "modelica-qualified-source-capture",
      byteStore(
        "modelica-qualified-source-capture",
        `${directory}/source-captures`,
        "modelica-qualified-source-capture",
      ),
    ],
    [
      "simulation-case-qualification",
      byteStore(
        "simulation-case-qualification",
        `${directory}/qualification`,
        "simulation-case-qualification",
      ),
    ],
  ]);
  return {
    async read(
      artifact: {
        readonly uri?: string;
        readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
      },
    ) {
      const namespace = artifact.uri?.match(/^casys:\/\/([^/]+)\/sha256\//)?.[1];
      const store = namespace ? stores.get(namespace) : undefined;
      const bytes = store ? await store.read(artifact.fingerprint) : undefined;
      return bytes?.copy();
    },
  };
}

function byteStore<K extends string>(
  kind: K,
  directory: string,
  uriNamespace: string,
): FileByteStore<K> {
  return new FileByteStore({ kind, directory, uriNamespace, label: kind });
}

function failFirstPublish(
  commands: EngineeringProjectCommandService,
): EngineeringProjectCommandService {
  let failed = false;
  return new Proxy(commands, {
    get(target, property, receiver) {
      if (property === "publishRun") {
        return async (
          ...args: Parameters<EngineeringProjectCommandService["publishRun"]>
        ) => {
          if (!failed) {
            failed = true;
            throw new Error("simulated publish failure");
          }
          return await target.publishRun(...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function fixtureCase(basisSnapshotId: string) {
  const model = new TextEncoder().encode("model ThermalKit end ThermalKit;");
  const scenario = new TextEncoder().encode('{"id":"nominal-heatup"}');
  return validateSimulationCaseV2({
    schemaVersion: "simulation-case/2.0",
    id: "fixture-modelica-case-v2",
    revision: 1,
    scope: "qualification-test",
    evidenceBoundary: "test",
    project: {
      id: PROJECT_ID,
      subjectId: SUBJECT_ID,
      baseThreadSnapshot: { id: basisSnapshotId, revision: 1, subjectId: SUBJECT_ID },
    },
    kit: {
      modelId: "thermal-system-model",
      modelVersion: "1.0.0",
      modelSha256: await fingerprintResourceBytes(model),
    },
    scenario: {
      id: "nominal-heatup",
      sourceSha256: await fingerprintResourceBytes(scenario),
      projectionSha256: await fingerprintModelicaResumableProviderJson(
        fixtureScenarioPublic(),
      ),
    },
    parameters: [],
    expectedMetrics: [{ id: "T_max", unit: "K" }],
    parameterMode: "explicit-overrides",
    timeoutMs: 60000,
  });
}

function fixtureV1Case(
  v2Case: Awaited<ReturnType<typeof fixtureCase>>,
) {
  return validateSimulationCase({
    schemaVersion: "simulation-case/1.0",
    id: "fixture-modelica-case-v1",
    revision: 1,
    scope: v2Case.scope,
    evidenceBoundary: v2Case.evidenceBoundary,
    project: v2Case.project,
    kit: v2Case.kit,
    scenario: {
      id: v2Case.scenario.id,
      sha256: v2Case.scenario.sourceSha256,
    },
    parameters: v2Case.parameters,
    expectedMetrics: v2Case.expectedMetrics,
    parameterMode: v2Case.parameterMode,
    timeoutMs: v2Case.timeoutMs,
  });
}

async function fixtureManifest(
  selection: {
    modelId: string;
    modelVersion: string;
    scenarioId: string;
  } = {
    modelId: "thermal-system-model",
    modelVersion: "1.0.0",
    scenarioId: "nominal-heatup",
  },
  options: {
    readonly scenarioSourceText?: string;
    readonly scenarioPublic?: ReturnType<typeof fixtureScenarioPublic>;
  } = {},
) {
  const model = new TextEncoder().encode("model ThermalKit end ThermalKit;");
  const scenario = new TextEncoder().encode(
    options.scenarioSourceText ?? '{"id":"nominal-heatup"}',
  );
  const publicScenario = options.scenarioPublic ?? fixtureScenarioPublic();
  const unsigned = {
    schemaVersion: "2.1",
    model: {
      id: selection.modelId,
      version: selection.modelVersion,
      name: "ThermalKit",
      source: {
        uri:
          `casys://modelica/kits/${selection.modelId}/${selection.modelVersion}/model.mo`,
        mediaType: "text/x-modelica",
        bytes: model.byteLength,
        sha256: await fingerprintResourceBytes(model),
        qualification: "qualified-kit",
      },
    },
    scenario: {
      id: selection.scenarioId,
      source: {
        uri:
          `casys://modelica/kits/${selection.modelId}/${selection.modelVersion}/scenarios/${selection.scenarioId}.json`,
        mediaType: "application/json",
        bytes: scenario.byteLength,
        sha256: await fingerprintResourceBytes(scenario),
        qualification: "qualified-kit",
      },
      public: publicScenario,
      projection_sha256: await fingerprintModelicaResumableProviderJson(
        publicScenario,
      ),
    },
    parameters: [],
    produced_metrics: [{
      id: "T_max",
      unit: "K",
      description: "Maximum temperature",
      required: true,
    }],
    result_normalizer: { id: "csv", version: "1.0" },
    lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
    engine: { name: "OpenModelica", version: "1.23", msl_version: "4.0" },
  };
  const fingerprint = await fingerprintModelicaResumableProviderJson(unsigned);
  const { parseManifestEnvelope } = await import(
    "./resumable-adapter.ts"
  );
  return await parseManifestEnvelope({
    schemaVersion: "2.1",
    kind: "simulation-manifest",
    manifest: { ...unsigned, fingerprint, manifest_sha256: fingerprint },
  }, {
    modelId: selection.modelId,
    modelVersion: selection.modelVersion,
    scenarioId: selection.scenarioId,
  });
}

function fixtureBytes(manifest: Awaited<ReturnType<typeof fixtureManifest>>) {
  const model = new TextEncoder().encode("model ThermalKit end ThermalKit;");
  const scenario = new TextEncoder().encode('{"id":"nominal-heatup"}');
  return new Map([
    [manifest.model.uri, model],
    [manifest.scenario.uri, scenario],
  ]);
}

function fixtureScenarioPublic() {
  return {
    id: "nominal-heatup",
    description: "Nominal heat-up",
    start_time_s: 0,
    stop_time_s: 60,
    number_of_intervals: 60,
    solver: "dassl",
    target_temperature: { value: 90, unit: "degC" },
  };
}

function command(expectedRevision: number, runId: string) {
  return {
    commandId: "qualified-seal-command",
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-12T00:10:00.000Z",
    runId,
  };
}

function context(commandId: string, expectedRevision: number) {
  return {
    commandId,
    projectId: PROJECT_ID,
    expectedRevision,
    issuedAt: "2026-08-12T00:00:00.000Z",
  };
}
