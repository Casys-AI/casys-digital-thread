import { assertEquals } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type {
  ThreadSnapshot,
  TracedRequirement,
} from "../../../domain/thread/thread-snapshot.ts";
import { productStructureElementRef } from "../../../domain/architecture/product-structure-ref.ts";
import type { OpenedProductStructure } from "../../ports/out/product-navigation/product-structure-traversal.ts";
import type { ProductNavigationEvidenceAttachmentFacts } from "../../ports/out/product-navigation/product-navigation-evidence-attachment-reader.ts";
import {
  type ProductNavigationBasis,
  productNavigationElementNode,
  productNavigationOccurrenceNode,
} from "../../ports/in/product-navigation/product-navigation-read-model.ts";
import { ProjectProductNavigation } from "./project-product-navigation.ts";

const PROJECT = "project.tps03";
const SNAPSHOT = "thread:tps03:r15";
const BACKREST = "20e71742-390d-4c6d-a91c-120debab5aa8";
const BASE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const USAGE = "122501cd-54d6-4aa9-b6a6-50b361ee2168";
const BACKREST_USAGE = "stand-backrest-usage";
const DIGEST = "44c478" + "ab".repeat(29);
const ARTIFACT = `requirements-StandBackrest-${DIGEST}`;
const DISPLACEMENT = `requirement-${DIGEST}-maxDisplacement`;
const STRESS = `requirement-${DIGEST}-maxVonMises`;
const ARCHITECTURE_ID = "architecture-" + "1".repeat(64);
const BASIS: ProductNavigationBasis = {
  projectId: PROJECT,
  threadSnapshotId: SNAPSHOT,
  threadRevision: 15,
  threadSubjectId: "subject.tps03",
  architectureArtifactId: ARCHITECTURE_ID,
  architectureFingerprint: `sha256:${"1".repeat(64)}`,
  captureSchema: "architecture-capture/4.0",
};

Deno.test(
  "product inspect joins TPS03-shaped unresolved requirements to the selected PartDefinition",
  async () => {
    const result = await navigation().inspect({
      projectId: PROJECT,
      expectedBasis: BASIS,
      selection: {
        kind: "element",
        element: productStructureElementRef("PartDefinition", BACKREST),
      },
    });
    assertEquals(result.status, "observed");
    assertEquals(result.definitionScopedEvidence?.status, "observed");
    assertEquals(result.definitionScopedEvidence?.relation, "selected-element");
    assertEquals(result.definitionScopedEvidence?.definition.elementId, BACKREST);
    assertEquals(result.definitionScopedEvidence?.attachments.requirements, [
      {
        group: "requirements",
        kind: "requirement",
        id: DISPLACEMENT,
        label: "Maximum displacement",
      },
      {
        group: "requirements",
        kind: "requirement",
        id: STRESS,
        label: "Maximum von Mises",
      },
    ]);
    assertEquals(result.definitionScopedEvidence?.attachments.sources, []);
    assertEquals(result.selectedOccurrence, undefined);
  },
);

Deno.test(
  "product inspect scopes the same current requirements through a typed PartUsage occurrence",
  async () => {
    const result = await navigation().inspect({
      projectId: PROJECT,
      expectedBasis: BASIS,
      selection: {
        kind: "occurrence",
        occurrence: {
          element: productStructureElementRef("PartUsage", BACKREST_USAGE),
          path: [BACKREST_USAGE],
        },
      },
    });
    assertEquals(result.selectedElement, {
      elementKind: "PartUsage",
      elementId: BACKREST_USAGE,
    });
    assertEquals(result.definitionScopedEvidence?.relation, "typed_by");
    assertEquals(result.definitionScopedEvidence?.definition.elementId, BACKREST);
    assertEquals(
      result.definitionScopedEvidence?.attachments.requirements.map((item) => item.id),
      [DISPLACEMENT, STRESS],
    );
  },
);

Deno.test(
  "product inspect does not attach StandBackrest requirements to a sibling PartDefinition",
  async () => {
    const result = await navigation().inspect({
      projectId: PROJECT,
      expectedBasis: BASIS,
      selection: {
        kind: "element",
        element: productStructureElementRef("PartDefinition", BASE),
      },
    });
    assertEquals(result.status, "observed");
    assertEquals(result.definitionScopedEvidence?.attachments.requirements, []);
    assertEquals(result.definitionScopedEvidence?.status, "unattached");
  },
);

function navigation() {
  return new ProjectProductNavigation({
    projects: {
      get: (projectId: string) =>
        Promise.resolve(projectId === PROJECT ? project() : undefined),
    },
    snapshots: {
      get: (snapshotId: string) =>
        Promise.resolve(snapshotId === SNAPSHOT ? thread() : undefined),
    },
    traversal: { open: () => Promise.resolve(opened()) },
    evidenceAttachments: {
      read: (_snapshot, context) => {
        assertEquals(context.architectureArtifactId, ARCHITECTURE_ID);
        assertEquals(context.architectureFingerprint, BASIS.architectureFingerprint);
        return Promise.resolve(facts());
      },
    },
  });
}

function project(): EngineeringProjectSnapshot {
  return {
    project: { id: PROJECT, name: "TPS03", subjectId: "subject.tps03" },
    threadSnapshots: [{
      snapshotId: SNAPSHOT,
      revision: 15,
      subjectId: "subject.tps03",
    }],
  } as unknown as EngineeringProjectSnapshot;
}

function thread(): ThreadSnapshot {
  return {
    id: SNAPSHOT,
    revision: 15,
    subject: { id: "subject.tps03" },
    requirements: [
      requirement(DISPLACEMENT, "Maximum displacement"),
      requirement(STRESS, "Maximum von Mises"),
    ],
    evaluations: [],
    changeSet: { changes: [] },
  } as unknown as ThreadSnapshot;
}

function requirement(id: string, name: string): TracedRequirement {
  return {
    id,
    name,
    statement: name,
    version: DIGEST,
    criterion: {
      metric: id,
      operator: "<=",
      limit: { value: 1, unit: "mm" },
    },
    trace: {
      sourceArtifactId: ARTIFACT,
      elementId: USAGE,
      targetArtifactIds: [ARCHITECTURE_ID],
    },
    freshness: {
      status: "fresh",
      changedAt: "2026-08-26T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

function facts(): ProductNavigationEvidenceAttachmentFacts {
  return {
    nodes: [],
    edges: [],
    requirementScopes: [{
      artifactId: ARTIFACT,
      requirementUsageId: USAGE,
      targetElementId: BACKREST,
    }],
  };
}

function opened(): OpenedProductStructure {
  const root = productNavigationElementNode({
    element: productStructureElementRef("PartDefinition", "def-system"),
    label: "TabletStand",
    expandable: true,
  });
  const backrest = productStructureElementRef("PartDefinition", BACKREST);
  const base = productStructureElementRef("PartDefinition", BASE);
  const usage = productNavigationOccurrenceNode({
    element: productStructureElementRef("PartUsage", BACKREST_USAGE),
    path: [BACKREST_USAGE],
    label: "standBackrest",
    typedDefinition: backrest,
    expandable: false,
  });
  return {
    architectureArtifactId: ARCHITECTURE_ID,
    architectureFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    root: () => root,
    childrenOfRoot: () => [usage],
    childrenOf: () => [],
    path: (usageIds) => {
      if (usageIds.length === 1 && usageIds[0] === BACKREST_USAGE) {
        return [root, usage];
      }
      return undefined;
    },
    neighborhood: () => ({ siblings: [], children: [] }),
    element: (id) => {
      if (id === "def-system") {
        return { element: root.element, label: root.label, expandable: true };
      }
      if (id === BACKREST) {
        return { element: backrest, label: "StandBackrest", expandable: true };
      }
      if (id === BASE) {
        return { element: base, label: "StandBase", expandable: true };
      }
      if (id === BACKREST_USAGE) {
        return { element: usage.element, label: usage.label, expandable: false };
      }
      return undefined;
    },
    searchElements: () => [],
    pageOccurrences: (element, offset, limit) => {
      const all = element.elementId === BACKREST ? [usage] : [];
      const items = all.slice(offset, offset + limit);
      const next = offset + items.length;
      return { items, nextOffset: next < all.length ? next : null };
    },
    hasDefinition: (id) => id === BACKREST || id === BASE || id === "def-system",
    hasElement: (query) =>
      query.elementId === BACKREST ||
      query.elementId === BASE ||
      query.elementId === "def-system" ||
      query.elementId === BACKREST_USAGE,
    typedDefinition: (usageId) =>
      usageId === BACKREST_USAGE
        ? { element: backrest, label: "StandBackrest" }
        : undefined,
  };
}
