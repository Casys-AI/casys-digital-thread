import type { ThreadArtifact, ThreadSnapshot } from "./thread-snapshot.ts";
import { archivedRefKeys } from "./thread-snapshot.ts";

export const REQUIREMENTS_CAPTURE_URI_PREFIX = "casys://requirements-capture/" as const;

/**
 * Select the unique, non-archived tip for one exact requirements component.
 *
 * This pure selector is shared by the SysON writer, proof-seal executor and
 * read-only review so those surfaces cannot disagree about active history.
 */
export function selectRequirementsTip(
  snapshot: ThreadSnapshot,
  containerComponent: string,
):
  | { readonly kind: "absent" }
  | { readonly kind: "retired" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "one"; readonly artifact: ThreadArtifact } {
  const uriPrefix = `${REQUIREMENTS_CAPTURE_URI_PREFIX}${containerComponent}/`;
  const all = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "sysml-model" && artifact.uri?.startsWith(uriPrefix)
  );
  if (all.length === 0) return { kind: "absent" };
  const consumed = new Set(all.flatMap((artifact) => artifact.inputArtifactIds));
  const tips = all.filter((artifact) => !consumed.has(artifact.id));
  if (tips.length === 0) return { kind: "ambiguous" };
  const archived = archivedRefKeys(snapshot);
  const activeTips = tips.filter((artifact) =>
    !archived.has(`artifact:${artifact.id}`)
  );
  if (activeTips.length === 0) return { kind: "retired" };
  return activeTips.length === 1
    ? { kind: "one", artifact: activeTips[0]! }
    : { kind: "ambiguous" };
}
