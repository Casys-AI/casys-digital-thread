// deno-lint-ignore-file require-await -- promise-shaped in-memory ports mirror production interfaces.
import { assertEquals, assertThrows } from "@std/assert";
import type { ThreadArtifact } from "../../domain/thread/thread-snapshot.ts";
import {
  INSPECTION_DRONE_V4_PART_USAGE_CONTRACT,
  INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT,
} from "./inspection-drone-v4-architecture-run-executor.ts";
import {
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
});

function productCatalogFixture() {
  const architectureDigest = "c".repeat(64);
  const productDigest = "d".repeat(64);
  const architectureArtifact = {
    id: `inspection-drone-v4-architecture-${architectureDigest}`,
    kind: "sysml-model",
    version: architectureDigest,
    fingerprint: { algorithm: "sha256", digest: architectureDigest },
    uri:
      `casys://inspection-drone-v4-architecture-capture/sha256/${architectureDigest}`,
    producer: { serverId: "syson", tool: "insert", runId: "run:architecture" },
    inputArtifactIds: [],
  } as unknown as ThreadArtifact;
  const productArtifact = {
    id: `inspection-drone-v4-part-definitions-${productDigest}`,
    kind: "sysml-model",
    version: productDigest,
    fingerprint: { algorithm: "sha256", digest: productDigest },
    uri: `casys://inspection-drone-v4-part-definitions-capture/sha256/${productDigest}`,
    producer: { serverId: "syson", tool: "syson_part_structure", runId: "run:product" },
    inputArtifactIds: [architectureArtifact.id],
  } as unknown as ThreadArtifact;
  const snapshot = {
    subject: { id: "project:inspection-drone-v4" },
    changeSet: { changes: [] },
    artifacts: [architectureArtifact, productArtifact],
    consumptions: [{
      artifactId: architectureArtifact.id,
      status: "verified",
      observedFingerprint: architectureArtifact.fingerprint,
      consumer: productArtifact.producer,
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
      statement: "fixture",
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
