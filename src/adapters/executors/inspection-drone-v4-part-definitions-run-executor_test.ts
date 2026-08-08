// deno-lint-ignore-file require-await -- promise-shaped in-memory ports mirror production interfaces.
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import {
  FileCaptureStore,
  INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
} from "../captures/file-capture-store.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../mcp/http-mcp-tool-client.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { FileInspectionDroneV4PartDefinitionsPublicationStore } from "../wal/file-inspection-drone-v4-part-definitions-publication-store.ts";
import {
  INSPECTION_DRONE_V4_PART_USAGE_CONTRACT,
  INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT,
} from "./inspection-drone-v4-architecture-run-executor.ts";
import {
  INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT,
  InspectionDroneV4PartDefinitionsRunExecutor,
  parseInspectionDroneV4ArchitectureCapture,
} from "./inspection-drone-v4-part-definitions-run-executor.ts";
import { INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION } from "../../orchestration/operations/inspection-drone-v4.ts";
import { resolveInspectionDroneV4ProductStructureCatalog } from "../projectors/inspection-drone-v4-product-structure-catalog.ts";

const DIGEST = "9535ba575e0dc79ae24b67a96b74802444930adee621af534bd79fc72fbe4862";
const KIND = "siriusComponents://semantic?domain=sysml&entity=";

/**
 * Frozen from the 2026-08-08 r3 SysON readback, but built locally so CI never
 * depends on a developer path, state/local, or a live provider.
 */
Deno.test("inspection-drone PartDefinitions parser accepts the local exact r3 fixture", () => {
  const parsed = parseInspectionDroneV4ArchitectureCapture(
    JSON.stringify(r3Capture()),
    architectureArtifact(),
  );
  assertEquals(
    parsed.recipeDigest,
    "eba0ccf48143a0f3ef8f8f0b985b373a97ead0ed57e7cbd6dff717c56693a530",
  );
  assertEquals(
    [...parsed.declarationByLabel.values()].map((item) => item.id),
    [...IDS, ...REQUIREMENT_IDS],
  );
  assertEquals(
    parsed.rootUsages.map((item) => [item.usage.id, item.type.id]),
    USAGE_IDS.map((usageId, index) => [usageId, IDS[index + 1]!]),
  );
});

Deno.test("inspection-drone PartDefinitions parser rejects a local r3 usage type substitution", () => {
  const capture = r3Capture() as {
    readback: { partUsages: Array<{ type: { id: string } }> };
  };
  capture.readback.partUsages[2]!.type.id = IDS[1]!;
  assertThrows(() =>
    parseInspectionDroneV4ArchitectureCapture(
      JSON.stringify(capture),
      architectureArtifact(),
    )
  );
});

Deno.test("inspection-drone PartDefinitions executes the real r3 basis to the exact r4 bundle with six read-only SysON calls", async () => {
  const fixture = await productFixture();
  const completed = await fixture.executor().execute(AGENT, fixture.command());
  const run = completed.agentRuns[0]!;
  const r4 = await fixture.snapshots.get(run.resultSnapshot!.snapshotId);
  assertEquals(run.status, "completed");
  assertEquals(
    fixture.syson.calls.map((call) => call.name),
    Array(6).fill("syson_part_structure"),
  );
  assertEquals(fixture.syson.calls.map((call) => call.arguments?.root_element_id), [
    ...IDS,
  ]);
  assertEquals(
    fixture.syson.calls.every((call) =>
      call.arguments?.editing_context_id === r3Capture().seed.editingContextId
    ),
    true,
  );
  assert(r4);
  const artifact = r4.artifacts.find((item) =>
    item.id.startsWith("inspection-drone-v4-part-definitions-")
  );
  assert(artifact);
  assertEquals(artifact.kind, "sysml-model");
  assertEquals(artifact.producer, {
    serverId: "syson",
    tool: "syson_part_structure",
    runId: RUN_ID,
  });
  assertEquals(artifact.inputArtifactIds, [fixture.architecture.id]);
  assertEquals(
    r4.consumptions.filter((item) => item.artifactId === fixture.architecture.id)
      .length,
    1,
  );
  assertEquals(
    r4.provenance.filter((item) => item.relation === "derived_from").at(-1)?.to.id,
    fixture.architecture.id,
  );
});

Deno.test("inspection-drone PartDefinitions recovers a WAL saved before snapshot persistence without a second SysON read", async () => {
  const fixture = await productFixture({ failSnapshotOnce: true });
  await assertRejects(
    () => fixture.executor().execute(AGENT, fixture.command()),
    Error,
    "simulated r4 save failure",
  );
  assertEquals(fixture.project.agentRuns[0]!.status, "running");
  assertEquals(fixture.syson.calls.length, 6);
  fixture.syson.failIfCalled = true;
  const completed = await fixture.executor().execute(AGENT, fixture.command());
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(fixture.syson.calls.length, 6);
});

Deno.test("inspection-drone PartDefinitions treats a WAL save outcome that throws after persistence as recoverable", async () => {
  const fixture = await productFixture({ publicationThrowsAfterSave: true });
  await assertRejects(
    () => fixture.executor().execute(AGENT, fixture.command()),
    Error,
    "simulated WAL directory sync failure",
  );
  assertEquals(fixture.project.agentRuns[0]!.status, "running");
  fixture.syson.failIfCalled = true;
  const completed = await fixture.executor(false).execute(AGENT, fixture.command());
  assertEquals(completed.agentRuns[0]!.status, "completed");
  assertEquals(fixture.syson.calls.length, 6);
});

Deno.test("inspection-drone PartDefinitions rejects tampered WAL capture and never re-queries SysON", async () => {
  const fixture = await productFixture({ failSnapshotOnce: true });
  await assertRejects(() => fixture.executor().execute(AGENT, fixture.command()));
  const durable = await fixture.publications.read(PROJECT_ID, RUN_ID);
  assert(durable);
  const tamperedCaptures = {
    save: fixture.captures.save.bind(fixture.captures),
    uriFor: fixture.captures.uriFor.bind(fixture.captures),
    read: async () => "{}",
  } as unknown as FileCaptureStore<"inspection-drone-v4-part-definitions">;
  fixture.syson.failIfCalled = true;
  await assertRejects(() =>
    fixture.executor(false, tamperedCaptures).execute(AGENT, fixture.command())
  );
  assertEquals(fixture.syson.calls.length, 6);
  assertEquals(fixture.project.agentRuns[0]!.status, "running");
});

Deno.test("inspection-drone PartDefinitions rejects a durable capture with a substituted statement", async () => {
  const fixture = await productFixture({ failSnapshotOnce: true });
  await assertRejects(() => fixture.executor().execute(AGENT, fixture.command()));
  const tamperedCaptures = {
    save: fixture.captures.save.bind(fixture.captures),
    uriFor: fixture.captures.uriFor.bind(fixture.captures),
    read: async (fingerprint: Parameters<typeof fixture.captures.read>[0]) => {
      const text = await fixture.captures.read(fingerprint);
      const record = JSON.parse(text!);
      record.statement = "A contradictory manufacturing assertion.";
      return deterministicJson(record);
    },
  } as unknown as FileCaptureStore<"inspection-drone-v4-part-definitions">;
  fixture.syson.failIfCalled = true;
  await assertRejects(() =>
    fixture.executor(false, tamperedCaptures).execute(AGENT, fixture.command())
  );
  assertEquals(fixture.syson.calls.length, 6);
});

Deno.test("inspection-drone PartDefinitions rejects tampered WAL artifact, producer, consumption and provenance", async () => {
  for (const tamper of ["artifact", "producer", "consumption", "provenance"] as const) {
    const fixture = await productFixture({ failSnapshotOnce: true });
    await assertRejects(() => fixture.executor().execute(AGENT, fixture.command()));
    fixture.syson.failIfCalled = true;
    const publications = new TamperedPublicationStore(fixture.publications, (value) => {
      const snapshot = structuredClone(value.snapshot);
      if (tamper === "artifact") snapshot.artifacts.at(-1)!.kind = "document";
      if (tamper === "producer") snapshot.artifacts.at(-1)!.producer.serverId = "evil";
      if (tamper === "consumption") snapshot.consumptions.at(-1)!.status = "mismatch";
      if (tamper === "provenance") snapshot.provenance.pop();
      return { ...value, snapshot };
    });
    await assertRejects(() =>
      fixture.executor(false, fixture.captures, publications).execute(
        AGENT,
        fixture.command(),
      )
    );
    assertEquals(fixture.syson.calls.length, 6);
    assertEquals(fixture.project.agentRuns[0]!.status, "running");
  }
});

Deno.test("inspection-drone PartDefinitions restores a completed run's missing r4 from its exact WAL", async () => {
  const fixture = await productFixture();
  const completed = await fixture.executor().execute(AGENT, fixture.command());
  const r4Id = completed.agentRuns[0]!.resultSnapshot!.snapshotId;
  fixture.snapshots.drop(r4Id);
  fixture.syson.failIfCalled = true;
  const replay = await fixture.executor().execute(AGENT, fixture.command());
  assertEquals(replay.agentRuns[0]!.status, "completed");
  assert(await fixture.snapshots.get(r4Id));
  assertEquals(fixture.syson.calls.length, 6);
});

Deno.test("inspection-drone PartDefinitions fails closed for completed evidence without a WAL", async () => {
  const fixture = await productFixture();
  fixture.project.agentRuns[0] = {
    ...fixture.project.agentRuns[0]!,
    status: "completed",
  };
  await assertRejects(
    () => fixture.executor().execute(AGENT, fixture.command()),
    Error,
    "no durable publication record",
  );
});

Deno.test("inspection-drone PartDefinitions refuses representative provider corruptions before publishing r4", async () => {
  for (const corruption of ["maxDepth", "quantity", "count", "root"] as const) {
    const fixture = await productFixture({ corruption });
    await assertRejects(() => fixture.executor().execute(AGENT, fixture.command()));
    assertEquals(fixture.project.agentRuns[0]!.status, "failed");
    assertEquals(
      fixture.syson.calls.length,
      corruption === "root" || corruption === "maxDepth" || corruption === "count"
        ? 1
        : 6,
    );
    assertEquals(await fixture.publications.read(PROJECT_ID, RUN_ID), undefined);
  }
});

Deno.test("inspection-drone product catalog accepts only the exact r3 identities and ordered usage-to-type pairs", async () => {
  const fixture = productCatalogFixture();
  const catalog = await resolveInspectionDroneV4ProductStructureCatalog(
    fixture.snapshot,
    fixture.readers,
  );
  assertEquals(catalog?.components.map((component) => component.label), [
    "InspectionDrone",
    "Airframe",
    "EnergySystem",
    "PropulsionSystem",
    "AvionicsAndFlightControl",
    "InspectionCameraPayload",
  ]);

  const permutation = await resolveInspectionDroneV4ProductStructureCatalog(
    fixture.snapshot,
    {
      ...fixture.readers,
      partDefinitions: { read: async () => fixture.productCapture(true) },
    },
  );
  assertEquals(permutation?.components, []);

  const substituted = await resolveInspectionDroneV4ProductStructureCatalog(
    fixture.snapshot,
    {
      ...fixture.readers,
      partDefinitions: { read: async () => fixture.productCapture(false, true) },
    },
  );
  assertEquals(substituted?.components, []);

  for (const field of ["operation", "statement"] as const) {
    const tampered = await resolveInspectionDroneV4ProductStructureCatalog(
      fixture.snapshot,
      {
        ...fixture.readers,
        partDefinitions: {
          read: async () => {
            const record = JSON.parse(fixture.productCapture());
            record[field] = field === "operation"
              ? { id: "foreign.operation", version: "1", bindings: [] }
              : "A contradictory assertion.";
            return deterministicJson(record);
          },
        },
      },
    );
    assertEquals(tampered?.components, []);
  }
  const producerSnapshot = structuredClone(fixture.snapshot) as typeof fixture.snapshot;
  const product = producerSnapshot.artifacts[1]!;
  product.producer = { ...product.producer, serverId: "evil" };
  producerSnapshot.consumptions[0]!.consumer = product.producer;
  const producerTamper = await resolveInspectionDroneV4ProductStructureCatalog(
    producerSnapshot,
    fixture.readers,
  );
  assertEquals(producerTamper?.components, []);
});

function productCatalogFixture() {
  const architectureDigest = "c".repeat(64);
  const productDigest = "d".repeat(64);
  const architectureArtifact = {
    id: `inspection-drone-v4-architecture-${architectureDigest}`,
    name: "Inspection-drone V4 architecture",
    kind: "sysml-model",
    version: architectureDigest,
    fingerprint: { algorithm: "sha256", digest: architectureDigest },
    uri:
      `casys://inspection-drone-v4-architecture-capture/sha256/${architectureDigest}`,
    producer: { serverId: "syson", tool: "insert", runId: "run:architecture" },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-08T05:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  } as unknown as ThreadArtifact;
  const productArtifact = {
    id: `inspection-drone-v4-part-definitions-${productDigest}`,
    name: "Inspection-drone V4 PartDefinitions product structure",
    kind: "sysml-model",
    version: productDigest,
    fingerprint: { algorithm: "sha256", digest: productDigest },
    uri: `casys://inspection-drone-v4-part-definitions-capture/sha256/${productDigest}`,
    producer: { serverId: "syson", tool: "syson_part_structure", runId: "run:product" },
    inputArtifactIds: [architectureArtifact.id],
    mediaType: "application/json",
    freshness: {
      status: "fresh",
      changedAt: "2026-08-08T05:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  } as unknown as ThreadArtifact;
  const snapshot = {
    generatedAt: "2026-08-08T05:00:00.000Z",
    subject: { id: "project:inspection-drone-v4" },
    changeSet: { changes: [], appliedAt: "2026-08-08T05:00:00.000Z" },
    artifacts: [architectureArtifact, productArtifact],
    consumptions: [{
      artifactId: architectureArtifact.id,
      status: "verified",
      observedFingerprint: architectureArtifact.fingerprint,
      consumer: productArtifact.producer,
      verifiedAt: "2026-08-08T05:00:00.000Z",
    }],
  } as unknown as import("../../domain/thread/thread-snapshot.ts").ThreadSnapshot;
  const productCapture = (permutation = false, substituted = false) => {
    const source = r3Capture() as ReturnType<typeof r3Capture>;
    const definitions = source.declarations.slice(0, 6).map((definition, index) => ({
      definition: substituted && index === 2
        ? { ...definition, id: "substituted-definition" }
        : definition,
      structure: {
        root: substituted && index === 2
          ? { ...definition, id: "substituted-definition" }
          : definition,
        tree: index === 0
          ? source.readback.partUsages.map((item) => ({
            id: item.usage.id,
            kind: item.usage.kind,
            label: item.usage.label,
            quantity: 1,
            quantitySource: "sysml-default",
            children: [],
          }))
          : [],
        partCount: index === 0 ? 5 : 0,
        maxDepthReached: false,
      },
    }));
    const pairs = source.readback.partUsages.map((item) => ({
      usage: item.usage,
      type: item.type,
    }));
    if (permutation) {
      [pairs[0]!.type, pairs[1]!.type] = [pairs[1]!.type, pairs[0]!.type];
    }
    return JSON.stringify({
      schemaVersion: "inspection-drone-v4-part-definitions/1.0",
      kind: "inspection-drone-v4-part-definitions",
      scope: "read-only-product-structure",
      statement:
        "Read-only PartDefinition structures from the exact qualitative architecture. No CAD, physics, quantity inference, manufacturing claim or verdict is recorded.",
      capturedAt: "2026-08-08T05:00:00.000Z",
      trustedRunId: "run:product",
      operation: INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
      architecture: {
        artifactId: architectureArtifact.id,
        fingerprint: architectureArtifact.fingerprint,
        uri: architectureArtifact.uri,
        editingContextId: source.seed.editingContextId,
        architecturePackage: source.architecturePackage,
        recipe: {
          textSha256:
            "eba0ccf48143a0f3ef8f8f0b985b373a97ead0ed57e7cbd6dff717c56693a530",
        },
        rootUsageTypes: pairs,
      },
      definitions,
    });
  };
  return {
    snapshot,
    productCapture,
    readers: {
      architecture: { read: async () => JSON.stringify(r3Capture()) },
      partDefinitions: { read: async () => productCapture() },
    },
  };
}

const IDS = [
  "b4bdb9a4-861e-407c-b615-48c27a5d9dad",
  "c044a2fc-f794-4ca6-8ed1-231107504058",
  "bb7d1902-35b7-41fe-bf4a-2d347ddf1136",
  "8e79d7e2-96c9-4b3c-b4af-1e1c106621c4",
  "6fa6a096-314a-4e11-9545-ea0e7b12d1e1",
  "86d46f77-b325-480e-80ab-7ff0a2a26ded",
] as const;
const REQUIREMENT_IDS = [
  "0fa3bf86-0e3e-4715-9dfa-cc43c8b2df7a",
  "85647e65-688a-4f68-a31e-7d723ccb0e19",
  "128b990e-6267-4580-8c0c-52fddf40c58c",
  "48c1218d-f9ce-4b6f-bdfe-88673d60c1b4",
] as const;
const USAGE_IDS = [
  "aba1d149-cb1a-41ca-a74d-c2488c36bbf7",
  "355f3a1a-5018-4e4a-844f-5d5724d4bb67",
  "9b6b358e-0f94-48a6-b29d-e84fa50d60fb",
  "c9d034e2-f946-4b31-8fdf-18fc20c5f3d3",
  "cc296141-982c-4aaf-bf32-2483a34b6509",
] as const;

function architectureArtifact(): ThreadArtifact {
  return {
    id: `inspection-drone-v4-architecture-${DIGEST}`,
    name: "r3 fixture",
    kind: "sysml-model",
    version: DIGEST,
    fingerprint: { algorithm: "sha256", digest: DIGEST },
    uri: `casys://inspection-drone-v4-architecture-capture/sha256/${DIGEST}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "fixture", runId: "run:r3" },
    inputArtifactIds: ["seed"],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-08T05:36:33.808Z",
      invalidatedByChangeIds: [],
    },
  };
}

function r3Capture() {
  const definitions = [
    "InspectionDrone",
    "Airframe",
    "EnergySystem",
    "PropulsionSystem",
    "AvionicsAndFlightControl",
    "InspectionCameraPayload",
  ];
  const declarations = [
    ...definitions.map((label, index) => ({
      id: IDS[index],
      kind: `${KIND}PartDefinition`,
      label,
    })),
    ...INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.map((requirement, index) => ({
      id: REQUIREMENT_IDS[index],
      kind: `${KIND}RequirementDefinition`,
      label: requirement.label,
    })),
  ];
  return {
    schemaVersion: "inspection-drone-v4-architecture-capture/1.0",
    kind: "inspection-drone-v4-architecture",
    scope: "bounded-qualitative-system-model",
    statement: "Local frozen r3 fixture.",
    capturedAt: "2026-08-08T05:36:33.808Z",
    trustedRunId: "run:r3",
    operation: { id: "architecture.author-inspection-drone", version: "3" },
    authorization: { projectId: "inspection-drone-v4", approvedBriefBasis: {} },
    seed: {
      artifactId:
        "syson-model-seed-bb159a7d77cea0e42b5a9ea3789915f6e6e0943b282afbe9c76e29e04192f98a",
      editingContextId: "095b793d-c502-4867-8c0f-ff07646aae99",
      fingerprint: {
        algorithm: "sha256",
        digest: "bb159a7d77cea0e42b5a9ea3789915f6e6e0943b282afbe9c76e29e04192f98a",
      },
      rootPackageId: "c7f43047-f4be-4521-bab5-010ed82eb5b2",
    },
    architecturePackage: {
      id: "76ac6d9e-4260-4848-ab9d-5c7e531a5fef",
      kind: `${KIND}Package`,
      label: "InspectionDroneArchitecture",
    },
    recipe: {
      textSha256: {
        algorithm: "sha256",
        digest: "eba0ccf48143a0f3ef8f8f0b985b373a97ead0ed57e7cbd6dff717c56693a530",
      },
    },
    insertion: {
      parentId: "c7f43047-f4be-4521-bab5-010ed82eb5b2",
      textSha256: "eba0ccf48143a0f3ef8f8f0b985b373a97ead0ed57e7cbd6dff717c56693a530",
    },
    declarations,
    explicitTbd: [
      "site-weather-and-separation",
      "camera-mass-power-dimensions-and-fixation",
      "autonomy-wind-and-battery-reserve",
    ],
    readback: {
      provider: {
        partStructureTool: "syson_part_structure",
        partUsageFeatureTypingQuery:
          "aql:self.ownedRelationship->select(r | r.oclIsKindOf(sysml::FeatureTyping)).type",
        requirementDocumentationQuery:
          "aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::Documentation))->first().body",
      },
      inspectionDrone: declarations[0],
      partUsages: INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.map((item, index) => ({
        usage: { id: USAGE_IDS[index], kind: `${KIND}PartUsage`, label: item.label },
        type: declarations[index + 1],
      })),
      requirements: INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT.map((item, index) => ({
        requirement: declarations[index + 6],
        documentation: item.documentation,
      })),
    },
  };
}

const PROJECT_ID = "inspection-drone-v4";
const RUN_ID = "run:inspection-drone-part-definitions";
const TIME = "2026-08-08T06:00:00.000Z";
const AGENT = { kind: "agent" as const, actorId: "agent:inspection-drone" };

type ProductCorruption = "maxDepth" | "quantity" | "count" | "root";

/**
 * This is deliberately a real r3 ThreadSnapshot plus content-addressed temp
 * captures: the executor's basis, binding, capture, WAL and r4 validation all
 * run unchanged.  Only the command state machine and SysON transport are
 * in-memory deterministic collaborators.
 */
async function productFixture(options: {
  failSnapshotOnce?: boolean;
  publicationThrowsAfterSave?: boolean;
  corruption?: ProductCorruption;
} = {}) {
  const directory = await Deno.makeTempDir({ prefix: "inspection-drone-v4-parts-" });
  const architectureCaptures = new FileCaptureStore({
    ...INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: `${directory}/architecture`,
  });
  const captures = new FileCaptureStore({
    ...INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
    directory: `${directory}/parts`,
  });
  const capture = r3Capture();
  const architectureText = deterministicJson(capture);
  const architectureFingerprint = await sha256Fingerprint(capture);
  await architectureCaptures.save(architectureFingerprint, architectureText);
  const seedFingerprint = {
    algorithm: "sha256" as const,
    digest: capture.seed.fingerprint.digest,
  };
  const seed = {
    id: capture.seed.artifactId,
    name: "Inspection-drone SysON seed",
    kind: "sysml-model" as const,
    version: capture.seed.fingerprint.digest,
    fingerprint: seedFingerprint,
    uri: `casys://syson-model-seed-capture/sha256/${seedFingerprint.digest}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "syson_model_create", runId: "run:seed" },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  const architecture = {
    id: `inspection-drone-v4-architecture-${architectureFingerprint.digest}`,
    name: "Inspection-drone V4 architecture",
    kind: "sysml-model" as const,
    version: architectureFingerprint.digest,
    fingerprint: architectureFingerprint,
    uri:
      `casys://inspection-drone-v4-architecture-capture/sha256/${architectureFingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:architecture",
    },
    inputArtifactIds: [seed.id],
    freshness: fresh(),
  };
  const r3: ThreadSnapshot = {
    schemaVersion: "1.0",
    id: "project:inspection-drone-v4:r3",
    revision: 3,
    previous: { snapshotId: "project:inspection-drone-v4:r2", revision: 2 },
    generatedAt: TIME,
    subject: {
      id: "project:inspection-drone-v4",
      name: "Inspection drone",
      kind: "system",
      version: "r3",
      modelArtifactId: architecture.id,
    },
    freshness: fresh(),
    changeSet: {
      id: "architecture-readback",
      name: "Architecture readback",
      status: "applied",
      createdAt: TIME,
      appliedAt: TIME,
      changes: [],
    },
    artifacts: [seed, architecture],
    consumptions: [{
      id: "consume-seed-by-architecture",
      artifactId: seed.id,
      consumer: architecture.producer,
      observedFingerprint: seed.fingerprint,
      verifiedAt: TIME,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "architecture-derived-from-seed",
      relation: "derived_from",
      from: { kind: "artifact", id: architecture.id },
      to: { kind: "artifact", id: seed.id },
      rationale: "Architecture consumes the exact SysON seed.",
    }, {
      id: "architecture-uses-seed",
      relation: "uses",
      from: { kind: "consumption", id: "consume-seed-by-architecture" },
      to: { kind: "artifact", id: seed.id },
      rationale: "The architecture author read the exact seed bytes.",
    }],
    proposedActions: [],
  };
  const snapshots = new MemorySnapshots([r3], options.failSnapshotOnce);
  const project = projectState(r3, architecture) as MutableProject;
  const commands = new ProductCommands(project);
  const publications = new FileInspectionDroneV4PartDefinitionsPublicationStore(
    `${directory}/publications`,
  );
  const syson = new ProductSyson(options.corruption);
  const throwingPublications = options.publicationThrowsAfterSave
    ? new SaveThenThrowPublicationStore(publications)
    : publications;
  return {
    project,
    snapshots,
    architecture,
    captures,
    publications,
    syson,
    command: () => ({
      commandId: "execute-inspection-drone-part-definitions",
      projectId: PROJECT_ID,
      expectedRevision: project.revision,
      issuedAt: TIME,
      runId: RUN_ID,
    }),
    executor: (
      useThrowingPublications = true,
      replacementCaptures = captures,
      replacementPublications: Pick<
        FileInspectionDroneV4PartDefinitionsPublicationStore,
        "read" | "save"
      > = useThrowingPublications ? throwingPublications : publications,
    ) =>
      new InspectionDroneV4PartDefinitionsRunExecutor({
        projects: { get: async () => project } as never,
        commands: commands as never,
        snapshots,
        architectureCaptures,
        captures: replacementCaptures,
        syson,
        lease: immediateLease,
        publications:
          replacementPublications as unknown as FileInspectionDroneV4PartDefinitionsPublicationStore,
      }),
  };
}

function fresh() {
  return { status: "fresh" as const, changedAt: TIME, invalidatedByChangeIds: [] };
}

type MutableProject = EngineeringProjectSnapshot & {
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  threadSnapshots: Array<EngineeringProjectSnapshot["threadSnapshots"][number]>;
  commandReceipts: Array<{ commandId: string }>;
  revision: number;
};

function projectState(
  r3: ThreadSnapshot,
  architecture: ThreadArtifact,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "3.0",
    id: PROJECT_ID,
    revision: 1,
    generatedAt: TIME,
    project: {
      id: PROJECT_ID,
      name: "Inspection drone v4",
      subjectId: r3.subject.id,
      objective: {
        title: "Inspection drone",
        statement: "Review qualitative structure.",
      },
    },
    threadSnapshots: [{
      snapshotId: r3.id,
      revision: r3.revision,
      subjectId: r3.subject.id,
    }],
    phases: [],
    workItems: [{
      id: "capture-inspection-drone-part-definitions",
      phaseId: "product-structure",
      title: "Capture PartDefinitions",
      description: "Read six reviewed PartDefinitions.",
      kind: "verify",
      status: "planned",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
      operation: {
        ...INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
        bindings: [{
          name: "architecture",
          source: {
            kind: "thread-entity",
            reference: {
              snapshotId: r3.id,
              snapshotRevision: r3.revision,
              kind: "artifact",
              id: architecture.id,
            },
          },
        }],
      },
    }],
    agentRuns: [{
      id: RUN_ID,
      workItemId: "capture-inspection-drone-part-definitions",
      status: "queued",
      summary: "Capture the exact product structure.",
      queuedAt: TIME,
      basis: {
        kind: "thread-snapshot",
        snapshotId: r3.id,
        revision: 3,
        subjectId: r3.subject.id,
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
  constructor(private readonly project: MutableProject) {}
  async claimRun(_origin: unknown, value: { runId: string }): Promise<void> {
    this.replace(value.runId, {
      status: "running",
      startedAt: TIME,
      claimedAt: TIME,
      claimedBy: { id: AGENT.actorId, origin: "agent" },
    });
  }
  async publishRun(_origin: unknown, value: { runId: string }): Promise<void> {
    this.replace(value.runId, { status: "publishing" });
  }
  async completeRun(
    _origin: unknown,
    value: {
      runId: string;
      resultSnapshot: { snapshotId: string; revision: number; subjectId: string };
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
    if (snapshot.revision === 4 && this.#fail) {
      this.#fail = false;
      throw new Error("simulated r4 save failure");
    }
    this.#items.set(snapshot.id, structuredClone(snapshot));
  }
  drop(id: string): void {
    this.#items.delete(id);
  }
}

const immediateLease: EngineeringProjectRunLease = {
  withLease: async <T>(
    _projectId: string,
    _runId: string,
    operation: () => Promise<T>,
  ) => await operation(),
};

class SaveThenThrowPublicationStore {
  #throw = true;
  constructor(
    private readonly actual: FileInspectionDroneV4PartDefinitionsPublicationStore,
  ) {}
  async save(
    value: Parameters<FileInspectionDroneV4PartDefinitionsPublicationStore["save"]>[0],
  ): Promise<void> {
    await this.actual.save(value);
    if (this.#throw) {
      this.#throw = false;
      throw new Error("simulated WAL directory sync failure");
    }
  }
  async read(projectId: string, runId: string) {
    return await this.actual.read(projectId, runId);
  }
}

class TamperedPublicationStore {
  constructor(
    private readonly actual: FileInspectionDroneV4PartDefinitionsPublicationStore,
    private readonly tamper: (
      value: NonNullable<
        Awaited<
          ReturnType<FileInspectionDroneV4PartDefinitionsPublicationStore["read"]>
        >
      >,
    ) => NonNullable<
      Awaited<ReturnType<FileInspectionDroneV4PartDefinitionsPublicationStore["read"]>>
    >,
  ) {}
  async save(
    value: Parameters<FileInspectionDroneV4PartDefinitionsPublicationStore["save"]>[0],
  ): Promise<void> {
    await this.actual.save(value);
  }
  async read(projectId: string, runId: string) {
    const value = await this.actual.read(projectId, runId);
    return value && this.tamper(value);
  }
}

class ProductSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  failIfCalled = false;
  constructor(private readonly corruption?: ProductCorruption) {}
  async callTool(call: McpToolCall): Promise<McpToolResult> {
    if (this.failIfCalled) {
      throw new Error("SysON must not be called during publication replay");
    }
    this.calls.push(structuredClone(call));
    if (call.name !== "syson_part_structure") {
      throw new Error(`Unexpected write/tool ${call.name}`);
    }
    const id = String(call.arguments?.root_element_id);
    const index = IDS.indexOf(id as typeof IDS[number]);
    if (index < 0) throw new Error(`Unexpected PartDefinition ${id}`);
    const definition = {
      id,
      kind: `${KIND}PartDefinition`,
      label: INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT[index]!,
    };
    const tree = index === 0
      ? INSPECTION_DRONE_V4_PART_USAGE_CONTRACT.map((usage, usageIndex) => ({
        id: USAGE_IDS[usageIndex]!,
        kind: `${KIND}PartUsage`,
        label: usage.label,
        quantity: this.corruption === "quantity" ? 2 : 1,
        quantitySource: "sysml-default",
        children: [],
      }))
      : [];
    return {
      structuredContent: {
        root: this.corruption === "root"
          ? { ...definition, id: "wrong-root" }
          : definition,
        tree,
        partCount: this.corruption === "count" ? tree.length + 1 : tree.length,
        maxDepthReached: this.corruption === "maxDepth",
      },
      text: "",
    };
  }
  async callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    throw new Error(`Unexpected text tool ${call.name}`);
  }
}
