/**
 * Literal recorded-kind labels and colours shared by the Evidence canvases.
 *
 * The Workbench never interprets provider ids, artifact kinds or record-id
 * prefixes here. A display kind is exactly the projected `entityKind`.
 */

import type { ThreadGraphNode } from "./types.ts";

export type DisplayKind =
  | "artifact"
  | "consumption"
  | "observation"
  | "requirement"
  | "evaluation"
  | "violation"
  | "change"
  | "action"
  | "analysis-node"
  | "part-definition"
  | "part-usage"
  | "attribute-usage";

export const DISPLAY_KIND_LABELS: Record<DisplayKind, string> = {
  "artifact": "Artifacts",
  "consumption": "Consumptions",
  "observation": "Observations",
  "requirement": "Requirements",
  "evaluation": "Evaluations",
  "violation": "Violations",
  "change": "Changes",
  "action": "Actions",
  "analysis-node": "Analysis records",
  "part-definition": "Part definitions",
  "part-usage": "Part usages",
  "attribute-usage": "Attribute usages",
};

export const DISPLAY_KIND_COLOR_TOKEN: Record<
  DisplayKind,
  "green" | "amber" | "red" | "cyan" | "blue" | "violet" | "muted"
> = {
  "requirement": "violet",
  "analysis-node": "blue",
  "part-definition": "blue",
  "part-usage": "blue",
  "attribute-usage": "blue",
  "artifact": "cyan",
  "observation": "amber",
  "change": "amber",
  "evaluation": "green",
  "violation": "red",
  "consumption": "muted",
  "action": "muted",
};

export function displayKindOf(node: ThreadGraphNode): DisplayKind {
  return node.entityKind;
}

/** A missing kind key stays visible; only an explicit false hides it. */
export function isDisplayKindVisible(
  visibleKinds: Record<DisplayKind, boolean>,
  node: ThreadGraphNode,
): boolean {
  return visibleKinds[displayKindOf(node)] !== false;
}

/**
 * Default Evidence map scope: head-snapshot entity kinds only. Revision
 * history (`change`), attestation records (`consumption`) and derived
 * analysis records (`analysis-node`) stay one gesture away instead of
 * painted by default. Literal kinds only; nothing here interprets a record.
 */
export const CURRENT_EVIDENCE_KIND_PRESET: Record<DisplayKind, boolean> = {
  "artifact": true,
  "observation": true,
  "requirement": true,
  "evaluation": true,
  "violation": true,
  "change": false,
  "consumption": false,
  "action": true,
  "analysis-node": false,
  "part-definition": true,
  "part-usage": true,
  "attribute-usage": true,
};

export function isCurrentEvidenceKindPreset(
  visibleKinds: Record<DisplayKind, boolean>,
): boolean {
  return (Object.keys(CURRENT_EVIDENCE_KIND_PRESET) as DisplayKind[]).every(
    (kind) => visibleKinds[kind] === CURRENT_EVIDENCE_KIND_PRESET[kind],
  );
}

export function isFullEvidenceKindScope(
  visibleKinds: Record<DisplayKind, boolean>,
): boolean {
  return (Object.keys(CURRENT_EVIDENCE_KIND_PRESET) as DisplayKind[]).every(
    (kind) => visibleKinds[kind] === true,
  );
}

export function allEvidenceKindsVisible(): Record<DisplayKind, boolean> {
  return Object.fromEntries(
    (Object.keys(CURRENT_EVIDENCE_KIND_PRESET) as DisplayKind[]).map(
      (kind) => [kind, true] as const,
    ),
  ) as Record<DisplayKind, boolean>;
}
