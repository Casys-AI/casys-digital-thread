import { assertEquals } from "@std/assert";
import { productStructureElementRef } from "../../../domain/architecture/product-structure-ref.ts";
import type { ProductNavigationBasis } from "../../ports/in/product-navigation/product-navigation-read-model.ts";
import { productNavigationAuthoringCursorBinding } from "./product-navigation-authoring-cursor-binding.ts";

const BASIS: ProductNavigationBasis = {
  projectId: "project.slider",
  threadSnapshotId: "thread:slider:r4",
  threadRevision: 4,
  threadSubjectId: "subject.slider",
  architectureArtifactId: "architecture-" + "1".repeat(64),
  architectureFingerprint: `sha256:${"1".repeat(64)}`,
  captureSchema: "architecture-capture/4.0",
};

const SYSTEM_ELEMENT = {
  kind: "element" as const,
  element: productStructureElementRef("PartDefinition", "def-system"),
};

const USAGE_OCCURRENCE = {
  kind: "occurrence" as const,
  occurrence: {
    element: productStructureElementRef("PartUsage", "usage-left"),
    path: ["usage-left"],
  },
};

Deno.test("authoring cursor binding changes when Thread revision, architecture, or selection path changes", async () => {
  const sameBasis = await productNavigationAuthoringCursorBinding(
    BASIS,
    SYSTEM_ELEMENT,
  );
  assertEquals(
    await productNavigationAuthoringCursorBinding(BASIS, SYSTEM_ELEMENT),
    sameBasis,
  );
  const laterThread = await productNavigationAuthoringCursorBinding({
    ...BASIS,
    threadSnapshotId: "thread:slider:r5",
    threadRevision: 5,
  }, SYSTEM_ELEMENT);
  const otherSubject = await productNavigationAuthoringCursorBinding({
    ...BASIS,
    threadSubjectId: "subject.other",
  }, SYSTEM_ELEMENT);
  const otherArchitecture = await productNavigationAuthoringCursorBinding({
    ...BASIS,
    architectureArtifactId: "architecture-" + "2".repeat(64),
    architectureFingerprint: `sha256:${"2".repeat(64)}`,
  }, SYSTEM_ELEMENT);
  const otherSelection = await productNavigationAuthoringCursorBinding(
    BASIS,
    USAGE_OCCURRENCE,
  );
  const otherPath = await productNavigationAuthoringCursorBinding(BASIS, {
    kind: "occurrence",
    occurrence: {
      element: productStructureElementRef("PartUsage", "usage-left"),
      path: ["parent", "usage-left"],
    },
  });
  assertEquals(laterThread === sameBasis, false);
  assertEquals(otherSubject === sameBasis, false);
  assertEquals(otherArchitecture === sameBasis, false);
  assertEquals(otherSelection === sameBasis, false);
  assertEquals(otherPath === otherSelection, false);
});
