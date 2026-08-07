/** @jsxImportSource preact */

/**
 * "Par pièce" grid view — Evidence surface, mode par défaut.
 *
 * Renders the PartLaneLayout as an HTML/CSS grid:
 *   - Column headers: station names (Exigences | Modèle | Géométrie |
 *     Vérification | Observations | Industrialisation | Autres)
 *   - Row headers: component name + fact/proof counters
 *   - Cells: stacked fact chips (one per visible graph node)
 *   - Collapsed rows: thin summary bar with reason, clickable to expand
 *
 * Legend (INDEX DES PIÈCES) aside:
 *   - Lists every row (assembly first) with name + fact count
 *   - Clic → focus the row + set global selectedComponentId
 *   - Reuses the workbench selectedComponentId state (Product view uses the same)
 *
 * Navigation contract (identical to Exploration/Carte modes):
 *   - Click fact chip → onSelectionChange({kind:"node", ref}) + inspector
 *   - Click legend chip → onComponentFocus(componentId) → sets selectedComponentId
 *
 * Design choice: HTML/CSS grid, not sigma.
 * At ~45 facts in fixed (row, station) cells, a CSS grid table is cleaner than
 * sigma: no pan/zoom ambiguity, predictable layout, accessible markup, no
 * position:relative sigma piège. Sigma is retained for Exploration mode which
 * needs a force-directed layout over the full graph.
 */

import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { ThreadGraphNode, ThreadGraphRef } from "./types.ts";
import type { ThreadGraphSelection } from "./graph.tsx";
import type {
  PartLaneLayout,
  PartLaneRow,
  Station,
} from "./part-lane-model.ts";
import { STATION_COLUMNS } from "./part-lane-model.ts";

// ---------------------------------------------------------------------------
// Station display labels (vocabulary, not server-fixed ids)
// ---------------------------------------------------------------------------

const STATION_LABELS: Readonly<Record<Station, string>> = {
  requirements: "Exigences",
  model: "Modèle",
  geometry: "Géométrie",
  verification: "Vérification",
  observations: "Observations",
  industrialization: "Industrialisation",
  uncategorized: "Autres",
};

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface PartLaneViewProps {
  layout: PartLaneLayout;
  /** Map nodeKey → ThreadGraphNode; used to render fact chip labels. */
  nodeByKey: ReadonlyMap<string, ThreadGraphNode>;
  /** Controlled selection (same state as Product/Evidence canvas). */
  selection?: ThreadGraphSelection;
  /** Global selected component id (shared with Product workspace). */
  selectedComponentId?: string;
  /** Fires when the user clicks a fact chip (same contract as Exploration). */
  onSelectionChange?: (sel: ThreadGraphSelection | undefined) => void;
  /** Fires when the user clicks a row header or legend chip. */
  onComponentFocus?: (componentId: string) => void;
}

// ---------------------------------------------------------------------------
// PartLaneView
// ---------------------------------------------------------------------------

export function PartLaneView({
  layout,
  nodeByKey,
  selection,
  selectedComponentId,
  onSelectionChange,
  onComponentFocus,
}: PartLaneViewProps): JSX.Element {
  // Local state: which collapsed rows have been manually expanded.
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const toggleExpanded = (componentId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(componentId)) next.delete(componentId);
      else next.add(componentId);
      return next;
    });
  };

  const selectedNodeKey = selection?.kind === "node"
    ? `${selection.ref.kind}:${selection.ref.id}`
    : undefined;

  // Build cell lookup: cellKey `${componentId}:${station}` → ordered nodeKeys.
  // PartLaneFact.stackIndex gives the position; rebuild as sorted array.
  const cellNodes = new Map<string, string[]>();
  for (const [key, fact] of layout.facts) {
    const cellKey = `${fact.componentId}:${fact.station}`;
    let arr = cellNodes.get(cellKey);
    if (!arr) {
      arr = [];
      cellNodes.set(cellKey, arr);
    }
    // stackIndex is 0-based and contiguous; fill positionally.
    arr[fact.stackIndex] = key;
  }

  const handleFactClick = (ref: ThreadGraphRef) => {
    onSelectionChange?.({ kind: "node", ref });
  };

  return (
    <div class="part-lane-view">
      {/* ── Grid ──────────────────────────────────────────────────────── */}
      <div class="part-lane-grid-scroll">
        <div
          class="part-lane-grid"
          role="table"
          aria-label="Evidence par pièce"
        >
          {/* Column header row */}
          <div class="part-lane-header-row" role="row">
            <div
              class="part-lane-row-header-cell part-lane-row-header-cell--head"
              role="columnheader"
              aria-label="Pièce"
            >
              <span>PIÈCE</span>
            </div>
            {STATION_COLUMNS.map((station) => (
              <div
                key={station}
                class="part-lane-col-header"
                role="columnheader"
                data-station={station}
              >
                <span>{STATION_LABELS[station]}</span>
              </div>
            ))}
          </div>

          {/* Data rows */}
          {layout.rows.map((row) => {
            const isManuallyExpanded = expandedRows.has(row.componentId);
            const showCells = !row.collapsed || isManuallyExpanded;
            const isFocused = selectedComponentId !== undefined
              ? selectedComponentId === row.componentId
              : row.componentId === "assembly";

            return (
              <PartLaneRowEl
                key={row.componentId}
                row={row}
                showCells={showCells}
                isFocused={isFocused}
                selectedNodeKey={selectedNodeKey}
                cellNodes={cellNodes}
                nodeByKey={nodeByKey}
                onToggleExpand={() => {
                  toggleExpanded(row.componentId);
                  onComponentFocus?.(row.componentId);
                }}
                onRowHeaderClick={() => onComponentFocus?.(row.componentId)}
                onFactClick={handleFactClick}
              />
            );
          })}
        </div>
      </div>

      {/* ── Index des pièces (légende) ────────────────────────────────── */}
      <aside
        class="part-lane-index"
        aria-label="Index des pièces"
      >
        <p class="part-lane-index-title">INDEX DES PIÈCES</p>
        {layout.rows.map((row) => {
          const isFocused = selectedComponentId !== undefined
            ? selectedComponentId === row.componentId
            : row.componentId === "assembly";
          const counts = layout.counters.perRow.get(row.componentId);
          return (
            <button
              key={row.componentId}
              type="button"
              class="part-lane-index-chip"
              aria-pressed={isFocused}
              aria-label={`${row.label} — ${counts?.facts ?? 0} faits${
                (counts?.proofs ?? 0) > 0
                  ? `, ${counts!.proofs} vérifications`
                  : ""
              }`}
              onClick={() => onComponentFocus?.(row.componentId)}
            >
              <span
                class="part-lane-index-chip-dot"
                data-assembly={row.componentId === "assembly" ? "true" : undefined}
                aria-hidden="true"
              />
              <span class="part-lane-index-chip-name">{row.label}</span>
              <span class="part-lane-index-chip-count">
                {counts?.facts ?? 0}
                {(counts?.proofs ?? 0) > 0 && (
                  <span class="part-lane-index-chip-proofs">
                    &nbsp;·&nbsp;{counts!.proofs}v
                  </span>
                )}
              </span>
            </button>
          );
        })}
        <div class="part-lane-index-totals">
          <span>{layout.counters.totalFacts} faits</span>
          {layout.counters.totalProofs > 0 && (
            <span>{layout.counters.totalProofs} vérif.</span>
          )}
          {layout.counters.uncategorizedCount > 0 && (
            <span class="part-lane-index-uncat">
              {layout.counters.uncategorizedCount} non classés
            </span>
          )}
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PartLaneRowEl — one grid row (expanded or collapsed)
// ---------------------------------------------------------------------------

function PartLaneRowEl({
  row,
  showCells,
  isFocused,
  selectedNodeKey,
  cellNodes,
  nodeByKey,
  onToggleExpand,
  onRowHeaderClick,
  onFactClick,
}: {
  row: PartLaneRow;
  showCells: boolean;
  isFocused: boolean;
  selectedNodeKey?: string;
  cellNodes: ReadonlyMap<string, string[]>;
  nodeByKey: ReadonlyMap<string, ThreadGraphNode>;
  onToggleExpand: () => void;
  onRowHeaderClick: () => void;
  onFactClick: (ref: ThreadGraphRef) => void;
}): JSX.Element {
  if (row.collapsed && !showCells) {
    // Collapsed row: thin bar spanning all columns.
    return (
      <div
        class="part-lane-row part-lane-row--collapsed"
        role="row"
        data-focused={isFocused ? "true" : undefined}
      >
        <button
          type="button"
          class="part-lane-row-header-cell"
          aria-expanded="false"
          onClick={onToggleExpand}
        >
          <span class="part-lane-row-label">{row.label}</span>
          <span class="part-lane-row-counts">
            <span data-tone="facts">{row.factCount}f</span>
          </span>
          <span class="part-lane-expand-hint" aria-hidden="true">▸</span>
        </button>
        <div
          class="part-lane-collapsed-bar"
          role="cell"
          aria-colSpan={STATION_COLUMNS.length}
        >
          <span>{row.collapseReason}</span>
        </div>
      </div>
    );
  }

  // Expanded row: one cell per station.
  return (
    <div
      class={`part-lane-row${row.componentId === "assembly" ? " part-lane-row--assembly" : ""}`}
      role="row"
      data-focused={isFocused ? "true" : undefined}
    >
      <button
        type="button"
        class="part-lane-row-header-cell"
        onClick={() => {
          if (row.collapsed) onToggleExpand();
          else onRowHeaderClick();
        }}
        aria-expanded={row.collapsed ? "true" : undefined}
      >
        <span class="part-lane-row-label">{row.label}</span>
        <span class="part-lane-row-counts">
          <span data-tone="facts">{row.factCount}f</span>
          {row.proofCount > 0 && (
            <span data-tone="proofs">{row.proofCount}v</span>
          )}
        </span>
        {row.collapsed && (
          <span class="part-lane-expand-hint" aria-hidden="true">▾</span>
        )}
      </button>
      {STATION_COLUMNS.map((station) => {
        const cellKey = `${row.componentId}:${station}`;
        const keys = cellNodes.get(cellKey) ?? [];
        return (
          <div
            key={station}
            class="part-lane-cell"
            role="cell"
            data-station={station}
          >
            {keys.map((nodeKey) => {
              const graphNode = nodeByKey.get(nodeKey);
              if (!graphNode) return null;
              const isSelected = nodeKey === selectedNodeKey;
              return (
                <button
                  key={nodeKey}
                  type="button"
                  class="part-lane-fact"
                  data-kind={graphNode.entityKind}
                  data-freshness={graphNode.freshness}
                  data-selected={isSelected ? "true" : undefined}
                  title={`${graphNode.label}\n${graphNode.system} · ${graphNode.entityKind}`}
                  onClick={() => onFactClick(graphNode.ref)}
                >
                  <span
                    class="part-lane-fact-system"
                    data-system={systemKey(graphNode.system)}
                    aria-hidden="true"
                  >
                    {systemMark(graphNode.system)}
                  </span>
                  <span class="part-lane-fact-label">{graphNode.label}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers — structural, no label matching
// ---------------------------------------------------------------------------

/** Normalised system key for CSS data-attributes. */
function systemKey(system: string): string {
  const s = system.toLowerCase();
  if (s.includes("syson")) return "syson";
  if (s.includes("build123d")) return "build123d";
  if (s.includes("calculix")) return "calculix";
  if (s.includes("modelica")) return "modelica";
  if (s.includes("erpnext")) return "erpnext";
  return "other";
}

/** Short 3-char badge shown inside fact chips. */
function systemMark(system: string): string {
  const s = system.toLowerCase();
  if (s.includes("syson")) return "SYS";
  if (s.includes("build123d")) return "CAD";
  if (s.includes("calculix")) return "FEA";
  if (s.includes("modelica")) return "MDL";
  if (s.includes("erpnext")) return "ERP";
  if (s.includes("digital-thread")) return "DT";
  return system.slice(0, 3).toUpperCase();
}
