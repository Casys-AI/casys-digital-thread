// deno-lint-ignore-file require-await -- promise-shaped in-memory ports mirror production interfaces.
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import {
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
  SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
} from "../../shared/cas/file-capture-store.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { FilePartDefinitionsPublicationStore } from "./file-part-definitions-publication-store.ts";
import { ARCHITECTURE_FEATURE_TYPING_AQL } from "../renderer/architecture-structure-extractor.ts";
import { findArchitectureArtifact } from "../renderer/model-write-architecture-run-executor.ts";
import { ModelCapturePartDefinitionsRunExecutor } from "./model-capture-part-definitions-run-executor.ts";
import { MODEL_CAPTURE_PART_DEFINITIONS_OPERATION } from "../../../domain/architecture/part-definitions/part-definitions-capture.ts";
import {
  recordingCapabilityRuntimeSession,
  successfulCapabilityRuntimeFor,
} from "../../../testing/capability-runtime-execution-session-test-support.ts";
import { ArchitectureArtifactRemovedError } from "../renderer/model-write-architecture-run-executor.ts";

const PROJECT_ID = "project:lamp";
const SUBJECT_ID = "subject:lamp";
const RUN_ID = "run:part-definitions";
const ARCH_RUN_ID = "run:architecture";
const SEED_RUN_ID = "run:seed";
const TIME = "2026-08-08T12:00:00.000Z";
const EDITING_CONTEXT_ID = "ctx-from-seed-cas";
const ROOT_PACKAGE_ID = "root-package-id";
const PACKAGE_ID = "package-lamp";
const PACKAGE_NAME = "LampPackage";
const SYSTEM_ID = "part-def-system";
const ARM_ID = "part-def-arm";
const USAGE_ID = "part-usage-arm";
const PART_USAGE_KIND = "siriusComponents://semantic?domain=sysml&entity=PartUsage";
const AGENT = { kind: "agent" as const, actorId: "agent-1" };
const HUMAN = { kind: "human" as const, actorId: "operator-1" };
const HISTORICAL_PART_DEFINITIONS_ID = `part-definitions-${"d".repeat(64)}`;

type DeepMutable<T> = T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer Item)[] ? DeepMutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
  : T;

function mutableClone<T>(value: T): DeepMutable<T> {
  return structuredClone(value) as DeepMutable<T>;
}

Deno.test("only an authenticated agent can capture generic PartDefinitions", async () => {
  const fixture = await productFixture();
  await assertRejects(
    () => fixture.executor().execute(HUMAN, fixture.command()),
    Error,
    "Only an authenticated agent",
  );
  assertEquals(fixture.syson.calls, []);
});

Deno.test("the run must bind the exact current generic architecture tip", async () => {
  const fixture = await productFixture({ wrongBinding: true });
  await assertRejects(
    () => fixture.executor().execute(AGENT, fixture.command()),
    Error,
    "exact current generic architecture tip",
  );
  assertEquals(fixture.syson.calls, []);
});

Deno.test(
  "editingContextId is taken from the CAS-reread seed named by the architecture capture",
  async () => {
    const fixture = await productFixture();
    await fixture.executor().execute(AGENT, fixture.command());
    assert(
      fixture.syson.calls.length > 0,
      "expected live SysON reads after input guards",
    );
    assertEquals(
      fixture.syson.calls.every((call) =>
        call.arguments?.editing_context_id === EDITING_CONTEXT_ID
      ),
      true,
    );
    assertEquals(
      fixture.syson.calls.some((call) =>
        call.arguments?.element_id === ROOT_PACKAGE_ID
      ),
      false,
    );
  },
);

Deno.test(
  "a missing architecture artifact in subject lineage is a monotony-ratchet refusal",
  async () => {
    const fixture = await productFixture({ missingArchitecture: true });
    await assertRejects(
      () => fixture.executor().execute(AGENT, fixture.command()),
      ArchitectureArtifactRemovedError,
      "architecture_artifact_removed",
    );
    assertEquals(fixture.syson.calls, []);
  },
);

Deno.test("a retired or ambiguous architecture tip is refused", async () => {
  for (const variant of ["retired", "ambiguous"] as const) {
    const fixture = await productFixture({ tip: variant });
    await assertRejects(
      () => fixture.executor().execute(AGENT, fixture.command()),
      Error,
    );
    assertEquals(fixture.syson.calls, []);
  }
});

Deno.test("the same architecture artifact cannot be captured twice", async () => {
  const fixture = await productFixture({ alreadyCaptured: true });
  await assertRejects(
    () => fixture.executor().execute(AGENT, fixture.command()),
    Error,
    "cannot be captured twice",
  );
  assertEquals(fixture.syson.calls, []);
});

Deno.test("a drone architecture URI is not a generic architecture tip", async () => {
  const fixture = await productFixture({ droneArchitecture: true });
  await assertRejects(
    () => fixture.executor().execute(AGENT, fixture.command()),
    Error,
    "no generic architecture capture tip",
  );
  assertEquals(fixture.syson.calls, []);
});

Deno.test("PartDefinitions capture keeps the run queued when JIT begin fails", async () => {
  const fixture = await productFixture();
  const session = recordingCapabilityRuntimeSession(() =>
    Promise.reject(new Error("exact SysON host group unavailable"))
  );
  await assertRejects(
    () =>
      fixture.executor(false, fixture.captures, fixture.publications, session)
        .execute(AGENT, fixture.command()),
    Error,
    "host group unavailable",
  );
  assertEquals(session.events, ["begin"]);
  assertEquals(session.releases, 0);
  assertEquals(session.retains, 0);
  assertEquals(fixture.syson.calls, []);
  assertEquals(fixture.project.agentRuns[0]!.status, "queued");
});

Deno.test("no FileArchitectureAttemptStore begin occurs before the SysON read", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "./model-capture-part-definitions-run-executor.ts",
      import.meta.url,
    ),
  );
  assertEquals(source.includes("FileArchitectureAttemptStore"), false);
  assertEquals(source.includes(".begin("), false);
  const fixture = await productFixture();
  await fixture.executor().execute(AGENT, fixture.command());
  assert(fixture.syson.calls.length > 0);
});

Deno.test(
  "a live PartDefinition rename refuses publication",
  async () => {
    const fixture = await productFixture({ renamedLabel: "LampSystemRenamed" });
    await assertRejects(
      () => fixture.executor().execute(AGENT, fixture.command()),
      Error,
      "does not match the sealed architecture PartDefinitions",
    );
    assertEquals(
      await fixture.publications.read(PROJECT_ID, RUN_ID),
      undefined,
    );
    assertEquals(fixture.project.agentRuns[0]!.status, "failed");
    assertEquals(
      fixture.syson.calls.some((call) => call.name === "syson_element_get"),
      true,
    );
  },
);

Deno.test("a live missing PartUsage refuses publication", async () => {
  const fixture = await productFixture({ missingUsage: true });
  await assertRejects(
    () => fixture.executor().execute(AGENT, fixture.command()),
    Error,
    "does not match the sealed architecture PartDefinitions",
  );
  assertEquals(await fixture.publications.read(PROJECT_ID, RUN_ID), undefined);
  assertEquals(fixture.project.agentRuns[0]!.status, "failed");
});

Deno.test(
  "a live extra PartUsage on a sealed PartDefinition refuses publication",
  async () => {
    const fixture = await productFixture({ extraUsage: true });
    await assertRejects(
      () => fixture.executor().execute(AGENT, fixture.command()),
      Error,
      "does not match the sealed architecture PartDefinitions",
    );
    assertEquals(
      await fixture.publications.read(PROJECT_ID, RUN_ID),
      undefined,
    );
    assertEquals(fixture.project.agentRuns[0]!.status, "failed");
  },
);

Deno.test("a live mistyped FeatureTyping refuses publication", async () => {
  const fixture = await productFixture({ mistyped: true });
  await assertRejects(
    () => fixture.executor().execute(AGENT, fixture.command()),
    Error,
    "does not match the sealed architecture PartDefinitions",
  );
  assertEquals(await fixture.publications.read(PROJECT_ID, RUN_ID), undefined);
  assertEquals(fixture.project.agentRuns[0]!.status, "failed");
});

Deno.test("CAS capture bytes read back exactly before the publication WAL", async () => {
  const fixture = await productFixture();
  const order: string[] = [];
  const captures = {
    save: async (fingerprint: ContentFingerprint, text: string) => {
      order.push("capture-save");
      return await fixture.captures.save(fingerprint, text);
    },
    read: async (fingerprint: ContentFingerprint) => {
      order.push("capture-read");
      return await fixture.captures.read(fingerprint);
    },
    uriFor: fixture.captures.uriFor.bind(fixture.captures),
  } as unknown as FileCaptureStore<"part-definitions-capture">;
  const publications = {
    save: async (
      value: Parameters<FilePartDefinitionsPublicationStore["save"]>[0],
    ) => {
      order.push("publication-save");
      await fixture.publications.save(value);
    },
    read: fixture.publications.read.bind(fixture.publications),
  } as unknown as FilePartDefinitionsPublicationStore;
  await fixture.executor(false, captures, publications).execute(
    AGENT,
    fixture.command(),
  );
  const saveIndex = order.indexOf("capture-save");
  const readIndex = order.indexOf("capture-read");
  const walIndex = order.indexOf("publication-save");
  assert(saveIndex >= 0 && readIndex > saveIndex && walIndex > readIndex);
});

Deno.test("the publication WAL is durable before the snapshot save", async () => {
  const fixture = await productFixture({ failSnapshotOnce: true });
  await assertRejects(() => fixture.executor().execute(AGENT, fixture.command()));
  assert(await fixture.publications.read(PROJECT_ID, RUN_ID));
  assertEquals(fixture.project.agentRuns[0]!.status, "running");
});

Deno.test("snapshot revision is exactly basis.revision + 1", async () => {
  const fixture = await productFixture();
  const completed = await fixture.executor().execute(AGENT, fixture.command());
  const snapshot = await fixture.snapshots.get(
    completed.agentRuns[0]!.resultSnapshot!.snapshotId,
  );
  assertEquals(snapshot?.revision, 4);
  assertEquals(snapshot?.previous?.revision, 3);
});

Deno.test(
  "the published artifact URI uses casys://part-definitions-capture/sha256/",
  async () => {
    const fixture = await productFixture();
    const completed = await fixture.executor().execute(
      AGENT,
      fixture.command(),
    );
    const snapshot = await fixture.snapshots.get(
      completed.agentRuns[0]!.resultSnapshot!.snapshotId,
    );
    const artifact = snapshot?.artifacts.find((item) =>
      item.id.startsWith("part-definitions-")
    );
    assert(
      artifact?.uri?.startsWith("casys://part-definitions-capture/sha256/"),
    );
  },
);

Deno.test(
  "findArchitectureArtifact still returns the architecture tip after publication",
  async () => {
    const fixture = await productFixture();
    const completed = await fixture.executor().execute(
      AGENT,
      fixture.command(),
    );
    const snapshot = await fixture.snapshots.get(
      completed.agentRuns[0]!.resultSnapshot!.snapshotId,
    );
    assert(snapshot);
    const tip = findArchitectureArtifact(snapshot);
    assertEquals(tip?.id, fixture.architecture.id);
  },
);

Deno.test(
  "a WAL saved before snapshot persistence resumes without a second SysON read",
  async () => {
    const fixture = await productFixture({ failSnapshotOnce: true });
    await assertRejects(() => fixture.executor().execute(AGENT, fixture.command()));
    const firstCalls = fixture.syson.calls.length;
    fixture.syson.failIfCalled = true;
    const completed = await fixture.executor().execute(
      AGENT,
      fixture.command(),
    );
    assertEquals(completed.agentRuns[0]!.status, "completed");
    assertEquals(fixture.syson.calls.length, firstCalls);
  },
);

Deno.test("a tampered publication WAL never re-queries SysON", async () => {
  const fixture = await productFixture({ failSnapshotOnce: true });
  await assertRejects(() => fixture.executor().execute(AGENT, fixture.command()));
  const firstCalls = fixture.syson.calls.length;
  fixture.syson.failIfCalled = true;
  const publications = new TamperedPublicationStore(
    fixture.publications,
    (value) => {
      const snapshot = mutableClone(value.snapshot);
      snapshot.artifacts.at(-1)!.kind = "document";
      return { ...value, snapshot };
    },
  );
  await assertRejects(() =>
    fixture.executor(false, fixture.captures, publications).execute(
      AGENT,
      fixture.command(),
    )
  );
  assertEquals(fixture.syson.calls.length, firstCalls);
});

Deno.test(
  "a completed run reconstructs the exact snapshot from the reread capture",
  async () => {
    const fixture = await productFixture();
    const first = await fixture.executor().execute(AGENT, fixture.command());
    const firstCalls = fixture.syson.calls.length;
    fixture.syson.failIfCalled = true;
    const second = await fixture.executor().execute(AGENT, fixture.command());
    assertEquals(second.agentRuns[0]!.status, "completed");
    assertEquals(
      deterministicJson(second.agentRuns[0]!.resultSnapshot),
      deterministicJson(first.agentRuns[0]!.resultSnapshot),
    );
    assertEquals(fixture.syson.calls.length, firstCalls);
  },
);

Deno.test(
  "a historical PartDefinitions artifact on the basis does not become the current evidenceRef",
  async () => {
    const fixture = await productFixture({ historicalPartDefinitions: true });
    const completed = await fixture.executor().execute(
      AGENT,
      fixture.command(),
    );
    await assertCurrentPartDefinitionsEvidence(fixture, completed);
    const firstCalls = fixture.syson.calls.length;
    fixture.syson.failIfCalled = true;
    const replayed = await fixture.executor().execute(AGENT, fixture.command());
    assertEquals(replayed.agentRuns[0]!.status, "completed");
    assertEquals(
      deterministicJson(replayed.agentRuns[0]!.evidenceRefs),
      deterministicJson(completed.agentRuns[0]!.evidenceRefs),
    );
    assertEquals(fixture.syson.calls.length, firstCalls);
  },
);

Deno.test(
  "a crash after snapshot save and before completeRun attaches the exact WAL snapshot",
  async () => {
    const fixture = await productFixture({ failPublishOnce: true });
    await assertRejects(
      () => fixture.executor().execute(AGENT, fixture.command()),
      Error,
      "simulated publish failure",
    );
    const firstCalls = fixture.syson.calls.length;
    fixture.syson.failIfCalled = true;
    const completed = await fixture.executor().execute(
      AGENT,
      fixture.command(),
    );
    assertEquals(completed.agentRuns[0]!.status, "completed");
    assertEquals(fixture.syson.calls.length, firstCalls);
    const durable = await fixture.publications.read(PROJECT_ID, RUN_ID);
    assertEquals(
      completed.agentRuns[0]!.resultSnapshot?.snapshotId,
      durable?.snapshot.id,
    );
  },
);

type FixtureOptions = {
  wrongBinding?: boolean;
  missingArchitecture?: boolean;
  tip?: "retired" | "ambiguous";
  alreadyCaptured?: boolean;
  droneArchitecture?: boolean;
  extraUsage?: boolean;
  mistyped?: boolean;
  renamedLabel?: string;
  missingUsage?: boolean;
  failSnapshotOnce?: boolean;
  failPublishOnce?: boolean;
  historicalPartDefinitions?: boolean;
};

async function productFixture(options: FixtureOptions = {}) {
  const directory = await Deno.makeTempDir({ prefix: "part-defs-exec-" });
  const seedCaptures = new FileCaptureStore({
    ...SYSON_MODEL_SEED_CAPTURE_DESCRIPTOR,
    directory: `${directory}/seed`,
  });
  const architectureCaptures = new FileCaptureStore({
    ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/architecture`,
  });
  const captures = new FileCaptureStore({
    ...PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
    directory: `${directory}/part-definitions`,
  });
  const seedRecord = seedCaptureRecord();
  const seedFingerprint = await sha256Fingerprint(seedRecord);
  await seedCaptures.save(seedFingerprint, deterministicJson(seedRecord));
  const seed = seedArtifact(seedFingerprint);
  const architectureRecord = architectureCaptureRecord(seed);
  const architectureFingerprint = await sha256Fingerprint(architectureRecord);
  await architectureCaptures.save(
    architectureFingerprint,
    deterministicJson(architectureRecord),
  );
  const architecture = architectureArtifact(architectureFingerprint, seed.id);
  const documentary = documentaryArtifact();
  const architectureLinks = {
    consumptions: [{
      id: "consume-seed-by-architecture",
      artifactId: seed.id,
      consumer: architecture.producer,
      observedFingerprint: seed.fingerprint,
      verifiedAt: TIME,
      status: "verified" as const,
    }],
    provenance: [{
      id: "architecture-derived-from-seed",
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: architecture.id },
      to: { kind: "artifact" as const, id: seed.id },
      rationale: "Architecture consumes the exact SysON seed.",
    }, {
      id: "architecture-uses-seed",
      relation: "uses" as const,
      from: {
        kind: "consumption" as const,
        id: "consume-seed-by-architecture",
      },
      to: { kind: "artifact" as const, id: seed.id },
      rationale: "The architecture author read the exact seed bytes.",
    }],
  };
  const r1 = snapshot(1, documentary.id, [documentary]);
  const r2 = snapshot(
    2,
    options.missingArchitecture ? architecture.id : seed.id,
    options.missingArchitecture ? [seed, architecture] : [seed],
    r1,
    options.missingArchitecture ? architectureLinks : {},
  );
  let r3Artifacts: ThreadArtifact[] = [seed, architecture];
  if (options.droneArchitecture) {
    r3Artifacts = [seed, {
      ...architecture,
      id: `inspection-drone-v4-architecture-${architectureFingerprint.digest}`,
      uri:
        `casys://inspection-drone-v4-architecture-capture/sha256/${architectureFingerprint.digest}`,
      inputArtifactIds: [],
    }];
  }
  const previousCapture = alreadyCapturedArtifact(architecture.id);
  if (options.alreadyCaptured) {
    r3Artifacts = [...r3Artifacts, previousCapture];
  }
  if (options.tip === "ambiguous") {
    const sibling = {
      ...architecture,
      id: `architecture-${"b".repeat(64)}`,
      fingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
      uri: `casys://architecture-capture/sha256/${"b".repeat(64)}`,
    };
    r3Artifacts = [seed, architecture, sibling];
    architectureLinks.provenance = [
      ...architectureLinks.provenance,
      {
        id: "sibling-architecture-derived-from-seed",
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: sibling.id },
        to: { kind: "artifact" as const, id: seed.id },
        rationale: "A second architecture tip also consumes the seed.",
      },
    ];
  }
  const historicalCapture = historicalPartDefinitionsArtifact(seed.id);
  if (options.historicalPartDefinitions) {
    r3Artifacts = [historicalCapture, ...r3Artifacts];
  }
  const r3 = snapshot(
    3,
    options.droneArchitecture || options.missingArchitecture
      ? seed.id
      : architecture.id,
    options.missingArchitecture ? [seed] : r3Artifacts,
    r2,
    r3Extras(),
  );

  function r3Extras() {
    if (options.missingArchitecture || options.droneArchitecture) return {};
    return {
      consumptions: [
        ...architectureLinks.consumptions,
        ...(options.alreadyCaptured
          ? [{
            id: "consume-architecture-by-part-definitions",
            artifactId: architecture.id,
            consumer: previousCapture.producer,
            observedFingerprint: architecture.fingerprint,
            verifiedAt: TIME,
            status: "verified" as const,
          }]
          : []),
        ...(options.historicalPartDefinitions
          ? [{
            id: "consume-seed-by-historical-part-definitions",
            artifactId: seed.id,
            consumer: historicalCapture.producer,
            observedFingerprint: seed.fingerprint,
            verifiedAt: TIME,
            status: "verified" as const,
          }]
          : []),
      ],
      provenance: [
        ...architectureLinks.provenance,
        ...(options.alreadyCaptured
          ? [{
            id: "part-definitions-derived-from-architecture",
            relation: "derived_from" as const,
            from: { kind: "artifact" as const, id: previousCapture.id },
            to: { kind: "artifact" as const, id: architecture.id },
            rationale: "A prior PartDefinitions capture already consumed this tip.",
          }, {
            id: "part-definitions-uses-architecture",
            relation: "uses" as const,
            from: {
              kind: "consumption" as const,
              id: "consume-architecture-by-part-definitions",
            },
            to: { kind: "artifact" as const, id: architecture.id },
            rationale: "The prior capture used the architecture artifact.",
          }]
          : []),
        ...(options.historicalPartDefinitions
          ? [{
            id: "historical-part-definitions-derived-from-seed",
            relation: "derived_from" as const,
            from: { kind: "artifact" as const, id: historicalCapture.id },
            to: { kind: "artifact" as const, id: seed.id },
            rationale:
              "An older PartDefinitions bundle consumed the seed, not this tip.",
          }, {
            id: "historical-part-definitions-uses-seed",
            relation: "uses" as const,
            from: {
              kind: "consumption" as const,
              id: "consume-seed-by-historical-part-definitions",
            },
            to: { kind: "artifact" as const, id: seed.id },
            rationale: "The older capture used the seed artifact.",
          }]
          : []),
        ...(options.tip === "retired"
          ? [{
            id: "archive-architecture-changes",
            relation: "changes" as const,
            from: { kind: "change" as const, id: "archive-architecture" },
            to: { kind: "artifact" as const, id: architecture.id },
            rationale: "The architecture tip was explicitly archived.",
          }]
          : []),
      ],
      archived: options.tip === "retired"
        ? [{
          id: "archive-architecture",
          kind: "archived" as const,
          target: { kind: "artifact" as const, id: architecture.id },
          summary: "Archived the architecture tip.",
        }]
        : [],
    };
  }
  const snapshots = new MemorySnapshots(
    [r1, r2, r3],
    options.failSnapshotOnce,
  );
  const boundArchitectureId = options.wrongBinding
    ? "architecture-" + "c".repeat(64)
    : options.droneArchitecture
    ? r3Artifacts[1]!.id
    : architecture.id;
  const project = projectState(r3, boundArchitectureId) as MutableProject;
  const commands = new ProductCommands(
    project,
    options.failPublishOnce === true,
  );
  const publications = new FilePartDefinitionsPublicationStore(
    `${directory}/publications`,
  );
  const syson = new LiveSyson({
    extraUsage: options.extraUsage === true,
    mistyped: options.mistyped === true,
    renamedLabel: options.renamedLabel,
    missingUsage: options.missingUsage === true,
  });
  return {
    project,
    snapshots,
    architecture,
    captures,
    publications,
    syson,
    command: () => ({
      commandId: "execute-capture-part-definitions",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: TIME,
      runId: RUN_ID,
    }),
    executor: (
      _unused = false,
      replacementCaptures = captures,
      replacementPublications: Pick<
        FilePartDefinitionsPublicationStore,
        "read" | "save"
      > = publications,
      session?: ReturnType<typeof recordingCapabilityRuntimeSession>,
    ) => {
      const capability = successfulCapabilityRuntimeFor(
        PROJECT_ID,
        MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
        "model.inspect-system",
      );
      return new ModelCapturePartDefinitionsRunExecutor({
        projects: { get: async () => project } as never,
        commands: commands as never,
        snapshots,
        architectureCaptures,
        seedCaptures,
        captures: replacementCaptures,
        syson: syson as unknown as McpToolClient,
        lease: immediateLease,
        publications: replacementPublications as FilePartDefinitionsPublicationStore,
        capabilityRuntime: capability.capabilityRuntime,
        capabilityRuntimeSession: session ?? capability.capabilityRuntimeSession,
      });
    },
  };
}

function seedCaptureRecord() {
  return {
    schemaVersion: "syson-model-seed-capture/2.0",
    kind: "syson-model-seed",
    scope: "sysml-container-identity",
    statement:
      "Immutable normalized identity record of a newly created SysON project, SysML document, and root package. It does not capture model semantics, requirements, CAD, simulation, measurements, or verification verdicts.",
    capturedAt: TIME,
    trustedRunId: SEED_RUN_ID,
    operation: { id: "architecture.seed-syson-model", version: "2" },
    lineage: {
      approvedBriefBasis: {
        kind: "approved-brief",
        projectId: PROJECT_ID,
        projectSnapshotId: `${SUBJECT_ID}:r1:baseline`,
        projectRevision: 1,
        briefId: "brief-001",
        briefSnapshotId: "brief-snap-001",
        briefRevision: 1,
        approvedBriefFingerprint: {
          algorithm: "sha256",
          digest: "a".repeat(64),
        },
      },
      plan: {
        publishedAt: TIME,
        publishedBy: { id: "agent:test", origin: "agent" },
      },
      projectChange: {
        id: "change-001",
        commandId: "cmd-001",
        publishedAt: TIME,
        publishedBy: { id: "agent:test", origin: "agent" },
      },
      workItemId: "work-001",
      baseSnapshot: {
        snapshotId: `${SUBJECT_ID}:r1:baseline`,
        revision: 1,
        subjectId: SUBJECT_ID,
      },
      documentaryArtifact: {
        id: "documentary-baseline",
        fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
        uri: `casys://approved-brief-capture/sha256/${"b".repeat(64)}`,
        producerRunId: "run-baseline",
      },
    },
    provider: {
      serverId: "syson",
      tools: {
        projectCreate: "syson_project_create",
        modelCreate: "syson_model_create",
        rootPackageGet: "syson_element_get",
      },
    },
    normalizedResults: {
      project: {
        id: "syson-proj",
        name: "Lamp project",
        editingContextId: EDITING_CONTEXT_ID,
      },
      document: { id: "syson-doc", name: "Lamp document", kind: "SysML" },
      rootPackage: { id: ROOT_PACKAGE_ID, kind: "Package", label: "Root" },
    },
  };
}

function architectureCaptureRecord(seed: ThreadArtifact) {
  return {
    schemaVersion: "architecture-capture/4.0",
    operation: { id: "model.write-architecture", version: "1" },
    trustedRunId: ARCH_RUN_ID,
    packageName: PACKAGE_NAME,
    systemName: "LampSystem",
    scopeRoot: { id: PACKAGE_ID, kind: "Package", label: PACKAGE_NAME },
    semanticRoot: {
      id: SYSTEM_ID,
      kind: "PartDefinition",
      label: "LampSystem",
    },
    seed: {
      artifactId: seed.id,
      fingerprint: seed.fingerprint,
      producerRunId: seed.producer.runId,
    },
    sourceAnalyses: [{
      sourceId: "sysml-source:lamp-package",
      selector: { kind: "full-package", packageName: PACKAGE_NAME },
      runId: ARCH_RUN_ID,
      operation: { id: "model.write-architecture", version: "1" },
      sourceFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      sourceCaptureFingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      analysisFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    }],
    partDefinitions: [{
      id: SYSTEM_ID,
      kind: "PartDefinition",
      label: "LampSystem",
      usages: [{
        id: USAGE_ID,
        kind: "PartUsage",
        label: "arm",
        targetId: ARM_ID,
        targetKind: "PartDefinition",
        targetLabel: "Arm",
      }],
    }, {
      id: ARM_ID,
      kind: "PartDefinition",
      label: "Arm",
      usages: [],
    }],
    insertedAt: TIME,
  };
}

function documentaryArtifact(): ThreadArtifact {
  return {
    id: "documentary-baseline",
    name: "Approved brief",
    kind: "document",
    version: "1",
    fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    uri: `casys://approved-brief-capture/sha256/${"b".repeat(64)}`,
    mediaType: "application/json",
    producer: { serverId: "casys", tool: "baseline", runId: "run-baseline" },
    inputArtifactIds: [],
    freshness: fresh(),
  };
}

function seedArtifact(fingerprint: ContentFingerprint): ThreadArtifact {
  return {
    id: `syson-model-seed-${fingerprint.digest}`,
    name: "SysON model seed",
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint,
    uri: `casys://syson-model-seed-capture/sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_model_create",
      runId: SEED_RUN_ID,
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
}

function architectureArtifact(
  fingerprint: ContentFingerprint,
  seedId: string,
): ThreadArtifact {
  return {
    id: `architecture-${fingerprint.digest}`,
    name: "Architecture",
    kind: "sysml-model",
    version: fingerprint.digest,
    fingerprint,
    uri: `casys://architecture-capture/sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: ARCH_RUN_ID,
    },
    inputArtifactIds: [seedId],
    freshness: fresh(),
  };
}

function alreadyCapturedArtifact(architectureId: string): ThreadArtifact {
  return {
    id: "part-definitions-" + "f".repeat(64),
    name: "PartDefinition product structure",
    kind: "sysml-model",
    version: "f".repeat(64),
    fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
    uri: `casys://part-definitions-capture/sha256/${"f".repeat(64)}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_children",
      runId: "run:previous-capture",
    },
    inputArtifactIds: [architectureId],
    freshness: fresh(),
  };
}

function historicalPartDefinitionsArtifact(seedId: string): ThreadArtifact {
  return {
    id: HISTORICAL_PART_DEFINITIONS_ID,
    name: "PartDefinition product structure",
    kind: "sysml-model",
    version: "d".repeat(64),
    fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
    uri: `casys://part-definitions-capture/sha256/${"d".repeat(64)}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_children",
      runId: "run:historical-part-definitions",
    },
    inputArtifactIds: [seedId],
    freshness: fresh(),
  };
}

async function assertCurrentPartDefinitionsEvidence(
  fixture: Awaited<ReturnType<typeof productFixture>>,
  completed: EngineeringProjectSnapshot,
): Promise<void> {
  const run = completed.agentRuns[0]!;
  assertEquals(run.status, "completed");
  const snapshot = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
  assert(snapshot);
  const durable = await fixture.publications.read(PROJECT_ID, RUN_ID);
  assert(durable);
  const digest = durable.fingerprint.digest;
  const expectedId = `part-definitions-${digest}`;
  assertEquals(run.evidenceRefs.length, 1);
  const evidence = run.evidenceRefs[0]!;
  assertEquals(evidence, {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact",
    id: expectedId,
  });
  assert(
    snapshot.artifacts.some((item) => item.id === HISTORICAL_PART_DEFINITIONS_ID),
    `expected historical distractor ${HISTORICAL_PART_DEFINITIONS_ID} to remain on the successor`,
  );
  assert(
    evidence.id !== HISTORICAL_PART_DEFINITIONS_ID,
    "current evidenceRef must not name a historical artifact",
  );
  const current = snapshot.artifacts.find((item) => item.id === expectedId);
  assert(current);
  assertEquals(
    deterministicJson(current),
    deterministicJson({
      id: expectedId,
      name: "PartDefinition product structure",
      kind: "sysml-model",
      version: digest,
      fingerprint: durable.fingerprint,
      uri: `casys://part-definitions-capture/sha256/${digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: "syson_element_children",
        runId: RUN_ID,
      },
      inputArtifactIds: [fixture.architecture.id],
      freshness: {
        status: "fresh",
        changedAt: TIME,
        invalidatedByChangeIds: [],
      },
    }),
  );
}

function snapshot(
  revision: number,
  modelArtifactId: string,
  artifacts: readonly ThreadArtifact[],
  previous?: ThreadSnapshot,
  extras: {
    consumptions?: ThreadSnapshot["consumptions"];
    provenance?: ThreadSnapshot["provenance"];
    archived?: ThreadSnapshot["changeSet"]["changes"];
  } = {},
): ThreadSnapshot {
  return {
    schemaVersion: "1.0",
    id: revision === 1 ? `${SUBJECT_ID}:r1:baseline` : `${SUBJECT_ID}:r${revision}:rev`,
    revision,
    ...(previous
      ? { previous: { snapshotId: previous.id, revision: previous.revision } }
      : {}),
    generatedAt: TIME,
    subject: {
      id: SUBJECT_ID,
      name: "Lamp",
      kind: "system",
      version: `r${revision}`,
      modelArtifactId,
    },
    freshness: fresh(),
    changeSet: {
      id: `cs-r${revision}`,
      name: `Revision ${revision}`,
      status: "applied",
      createdAt: TIME,
      appliedAt: TIME,
      changes: extras.archived ?? [],
    },
    artifacts: [...artifacts],
    consumptions: extras.consumptions ?? [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: extras.provenance ?? [],
    proposedActions: [],
  };
}

function fresh() {
  return {
    status: "fresh" as const,
    changedAt: TIME,
    invalidatedByChangeIds: [],
  };
}

type MutableProject = EngineeringProjectSnapshot & {
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  commandReceipts: Array<{ commandId: string }>;
  revision: number;
};

function projectState(
  basis: ThreadSnapshot,
  architectureId: string,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: PROJECT_ID,
    revision: 1,
    generatedAt: TIME,
    project: {
      id: PROJECT_ID,
      name: "Lamp",
      subjectId: basis.subject.id,
      objective: { title: "Lamp", statement: "Review structure." },
    },
    threadSnapshots: [{
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    }],
    phases: [],
    workItems: [{
      id: "capture-part-definitions",
      activityId: "activity:capture-part-definitions",
      phaseId: "structure",
      title: "Capture PartDefinitions",
      description: "Re-read sealed PartDefinitions.",
      kind: "define",
      status: "ready",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
      operation: {
        ...MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
        bindings: [{
          name: "architecture",
          source: {
            kind: "thread-entity",
            reference: {
              snapshotId: basis.id,
              snapshotRevision: basis.revision,
              kind: "artifact",
              id: architectureId,
            },
          },
        }],
      },
    }],
    agentRuns: [{
      id: RUN_ID,
      workItemId: "capture-part-definitions",
      status: "queued",
      summary: "Capture the exact product structure.",
      queuedAt: TIME,
      basis: {
        kind: "thread-snapshot",
        snapshotId: basis.id,
        revision: basis.revision,
        subjectId: basis.subject.id,
      },
      evidenceRefs: [],
    }],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [],
  } as unknown as EngineeringProjectSnapshot;
}

class ProductCommands {
  #failPublish = false;
  constructor(
    private readonly project: MutableProject,
    failPublishOnce = false,
  ) {
    this.#failPublish = failPublishOnce;
  }
  async claimRun(_origin: unknown, value: { runId: string }): Promise<void> {
    this.replace(value.runId, {
      status: "running",
      startedAt: TIME,
      claimedAt: TIME,
      claimedBy: { id: AGENT.actorId, origin: "agent" },
    });
  }
  async publishRun(_origin: unknown, value: { runId: string }): Promise<void> {
    if (this.#failPublish) {
      this.#failPublish = false;
      throw new Error("simulated publish failure");
    }
    this.replace(value.runId, { status: "publishing" });
  }
  async completeRun(
    _origin: unknown,
    value: {
      runId: string;
      resultSnapshot: {
        snapshotId: string;
        revision: number;
        subjectId: string;
      };
      evidenceRefs: readonly unknown[];
      commandId: string;
    },
  ): Promise<void> {
    this.replace(value.runId, {
      status: "completed",
      completedAt: TIME,
      resultSnapshot: value.resultSnapshot,
      evidenceRefs: value.evidenceRefs as never,
    });
    this.project.threadSnapshots.push(value.resultSnapshot);
    this.project.commandReceipts.push({ commandId: value.commandId });
  }
  async failRun(_origin: unknown, value: { runId: string }): Promise<void> {
    this.replace(value.runId, { status: "failed" });
  }
  private replace(runId: string, update: Record<string, unknown>): void {
    const index = this.project.agentRuns.findIndex((run) => run.id === runId);
    this.project.agentRuns[index] = {
      ...this.project.agentRuns[index]!,
      ...update,
    } as never;
    this.project.revision++;
  }
}

class MemorySnapshots implements ThreadSnapshotStore {
  #items = new Map<string, ThreadSnapshot>();
  #fail = false;
  constructor(items: readonly ThreadSnapshot[], failOnce = false) {
    for (const item of items) this.#items.set(item.id, structuredClone(item));
    this.#fail = failOnce;
  }
  async get(id: string): Promise<ThreadSnapshot | undefined> {
    const value = this.#items.get(id);
    return value && structuredClone(value);
  }
  async getFresh(id: string): Promise<ThreadSnapshot | undefined> {
    return await this.get(id);
  }
  async latest(subjectId: string): Promise<ThreadSnapshot | undefined> {
    return [...this.#items.values()].filter((item) => item.subject.id === subjectId)
      .sort((a, b) => b.revision - a.revision)[0];
  }
  async save(snapshot: ThreadSnapshot): Promise<void> {
    if (this.#fail) {
      this.#fail = false;
      throw new Error("simulated snapshot save failure");
    }
    this.#items.set(snapshot.id, structuredClone(snapshot));
  }
}

const immediateLease: EngineeringProjectRunLease = {
  withLease: async <T>(
    _projectId: string,
    _runId: string,
    operation: () => Promise<T>,
  ) => await operation(),
};

class TamperedPublicationStore {
  constructor(
    private readonly actual: FilePartDefinitionsPublicationStore,
    private readonly tamper: (
      value: NonNullable<
        Awaited<ReturnType<FilePartDefinitionsPublicationStore["read"]>>
      >,
    ) => NonNullable<
      Awaited<ReturnType<FilePartDefinitionsPublicationStore["read"]>>
    >,
  ) {}
  async save(
    value: Parameters<FilePartDefinitionsPublicationStore["save"]>[0],
  ): Promise<void> {
    await this.actual.save(value);
  }
  async read(projectId: string, runId: string) {
    const value = await this.actual.read(projectId, runId);
    return value && this.tamper(value);
  }
}

class LiveSyson {
  readonly calls: Array<McpToolCall & { arguments?: Record<string, unknown> }> = [];
  failIfCalled = false;
  constructor(
    private readonly options: {
      extraUsage: boolean;
      mistyped: boolean;
      renamedLabel?: string;
      missingUsage: boolean;
    },
  ) {}
  callTool(call: McpToolCall): Promise<McpToolResult> {
    const args = call.arguments as Record<string, unknown>;
    this.calls.push({ ...call, arguments: args });
    if (this.failIfCalled) {
      return Promise.reject(new Error("SysON must not be queried again."));
    }
    if (call.name === "syson_part_structure") {
      return Promise.reject(
        new Error("syson_part_structure is out of contract."),
      );
    }
    if (call.name === "syson_element_get") {
      const id = args.element_id as string;
      const label = this.options.renamedLabel && id === SYSTEM_ID
        ? this.options.renamedLabel
        : id === SYSTEM_ID
        ? "LampSystem"
        : id === ARM_ID
        ? "Arm"
        : id;
      return Promise.resolve({
        text: "element",
        structuredContent: {
          id,
          kind: "sysml::PartDefinition",
          label,
        },
      });
    }
    if (call.name === "syson_element_children") {
      const id = args.element_id as string;
      const children = id === SYSTEM_ID && !this.options.missingUsage
        ? [
          { id: USAGE_ID, kind: PART_USAGE_KIND, label: "arm" },
          ...(this.options.extraUsage
            ? [{
              id: "part-usage-extra",
              kind: PART_USAGE_KIND,
              label: "extra",
            }]
            : []),
        ]
        : [];
      return Promise.resolve({
        text: "children",
        structuredContent: { parentId: id, children, count: children.length },
      });
    }
    if (call.name === "syson_query_aql") {
      const objectId = args.object_id as string;
      const expression = args.expression as string;
      if (expression !== ARCHITECTURE_FEATURE_TYPING_AQL) {
        return Promise.reject(new Error(`Unexpected AQL: ${expression}`));
      }
      const label = this.options.mistyped && objectId === USAGE_ID ? "Other" : "Arm";
      const targetId = label === "Arm" ? ARM_ID : "part-def-other";
      return Promise.resolve({
        text: "aql",
        structuredContent: {
          objectId,
          expression,
          type: "objects",
          results: [{
            id: targetId,
            kind: "sysml::PartDefinition",
            label,
          }],
          count: 1,
        },
      });
    }
    return Promise.reject(new Error(`Unexpected tool call: ${call.name}`));
  }
}
