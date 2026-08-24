/**
 * Exact current SysON architecture artifact from the Workbench structure graph.
 *
 * The sole join is the unique artifact --contains--> PartDefinition edge
 * already projected from architecture-capture/4.0. Labels are not used.
 */

import type { ThreadWorkbenchSnapshot } from "../../presentation/workbench/thread/snapshot.ts";

export function currentArchitectureArtifact(
  snapshot: ThreadWorkbenchSnapshot,
): { readonly artifactId: string; readonly fingerprint: string } | undefined {
  const roots = snapshot.graph.edges.filter((edge) =>
    edge.relation === "contains" &&
    edge.from.kind === "artifact" &&
    edge.to.kind === "part-definition"
  );
  if (roots.length !== 1) return undefined;
  const artifact = snapshot.artifacts.find((item) => item.id === roots[0]!.from.id);
  if (!artifact?.fingerprint) return undefined;
  return { artifactId: artifact.id, fingerprint: artifact.fingerprint };
}
