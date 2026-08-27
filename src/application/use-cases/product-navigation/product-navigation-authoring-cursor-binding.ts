/**
 * Application-owned inspect cursor binding.
 *
 * Derives a deterministic digest from the opened ProductNavigationBasis and
 * the exact inspect selection, including occurrence path. The workspace
 * adapter HMAC-seals this digest; it does not reconstruct Thread identity.
 */

import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type {
  ProductNavigationBasis,
  ProductStructureSelection,
} from "../../ports/in/product-navigation/product-navigation-read-model.ts";

export const PRODUCT_NAVIGATION_AUTHORING_CURSOR_BINDING_SCHEMA =
  "product-navigation-authoring-cursor-binding/1.0" as const;

export async function productNavigationAuthoringCursorBinding(
  basis: ProductNavigationBasis,
  selection: ProductStructureSelection,
): Promise<string> {
  const fingerprint = await sha256Fingerprint({
    schemaVersion: PRODUCT_NAVIGATION_AUTHORING_CURSOR_BINDING_SCHEMA,
    projectId: basis.projectId,
    threadSnapshotId: basis.threadSnapshotId,
    threadRevision: basis.threadRevision,
    threadSubjectId: basis.threadSubjectId,
    architectureArtifactId: basis.architectureArtifactId,
    architectureFingerprint: basis.architectureFingerprint,
    captureSchema: basis.captureSchema,
    selection: canonicalAuthoringCursorSelection(selection),
  });
  return `${fingerprint.algorithm}:${fingerprint.digest}`;
}

function canonicalAuthoringCursorSelection(
  selection: ProductStructureSelection,
): Record<string, unknown> {
  if (selection.kind === "occurrence") {
    return {
      kind: "occurrence",
      elementKind: selection.occurrence.element.elementKind,
      elementId: selection.occurrence.element.elementId,
      path: [...selection.occurrence.path],
    };
  }
  return {
    kind: "element",
    elementKind: selection.element.elementKind,
    elementId: selection.element.elementId,
  };
}
