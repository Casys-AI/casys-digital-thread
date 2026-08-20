/**
 * Le fil exécutable d'Overview, rendu avec xyflow.
 *
 * Le dessin précédent était un SVG à part : ses nœuds étaient des cercles, et
 * rien du vocabulaire du cockpit ne pouvait y entrer. Ici chaque nœud est un
 * composant — même surface de carte, même pastille d'état, même compaction
 * d'empreinte qu'ailleurs. Le fil cesse d'être un dialecte visuel.
 *
 * Les positions viennent du modèle (`buildOverviewThreadHero`), qui range les
 * nœuds par voie : la lecture reste gauche→droite, de l'exigence au verdict.
 * Rien n'est déplaçable — c'est une lecture, pas un éditeur de diagramme.
 */

import {
  Background,
  type Edge,
  Handle,
  type Node,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { Popover } from "@ark-ui/react/popover";
import { Portal } from "@ark-ui/react/portal";
import { useMemo } from "react";
import type { JSX } from "react";
import { cn } from "../lib/utils.ts";
import {
  CARD_SURFACE,
  Chip,
  LANE_LABEL,
  SECTION_LABEL,
} from "../ui/cockpit.tsx";
import {
  compactEmbeddedFingerprints,
  compactTechnicalSummary,
} from "../thread/compact-identifier-model.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import {
  buildOverviewThreadHero,
  type OverviewHeroNode,
} from "./overview-thread-hero-model.ts";

/** Largeur d'une carte de nœud. Fixe : les voies doivent rester alignées. */
const NODE_WIDTH = 178;
const NODE_HEIGHT = 46;

interface FlowNodeData extends Record<string, unknown> {
  readonly hero: OverviewHeroNode;
  readonly onOpenEvidence: () => void;
}

function ThreadFlowNode({ data }: { data: FlowNodeData }): JSX.Element {
  const { hero, onOpenEvidence } = data;
  const node = hero.node;
  return (
    <Popover.Root positioning={{ placement: "bottom", gutter: 6 }}>
      <Popover.Trigger
        className={cn(
          // xyflow coupe les événements sur un nœud ni déplaçable ni
          // sélectionnable ; la carte, elle, doit rester cliquable.
          "pointer-events-auto flex h-full w-full flex-col justify-center gap-0.5 px-2.5 py-1.5 text-left",
          CARD_SURFACE,
          "hover:border-brand/40",
          hero.emphasis && "ring-2 ring-brand/25",
        )}
        style={{ borderLeft: `3px solid ${hero.color}` }}
      >
        <span className={cn("truncate", SECTION_LABEL)}>{node.entityKind}</span>
        <span className="truncate text-[11.5px] font-medium">
          {compactEmbeddedFingerprints(node.label)}
        </span>
      </Popover.Trigger>
      {
        /* Points d'ancrage des liens. Invisibles : le fil se lit par ses
          traits, pas par des poignées — rien ne se connecte à la main. */
      }
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!h-px !w-px !border-0 !bg-transparent"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!h-px !w-px !border-0 !bg-transparent"
      />
      <Portal>
        <Popover.Positioner>
          <Popover.Content
            className={cn(
              "z-50 flex w-72 flex-col gap-1.5 p-3 outline-none",
              CARD_SURFACE,
            )}
          >
            <Popover.Title className={cn("m-0", SECTION_LABEL)}>
              {node.entityKind}
              {node.artifactKind ? ` · ${node.artifactKind}` : ""}
            </Popover.Title>
            <Popover.Description className="m-0 text-[12.5px] font-medium leading-snug">
              {node.label}
            </Popover.Description>
            <p className="m-0 break-words font-mono text-[10px] text-muted-foreground">
              {node.system} · {compactTechnicalSummary(node.summary)}
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <Chip
                tone={node.freshness === "fresh"
                  ? "pass"
                  : node.freshness === "failed"
                  ? "fail"
                  : node.freshness === "running"
                  ? "run"
                  : "warn"}
              >
                {node.freshness}
              </Chip>
              <button
                type="button"
                className="text-[11.5px] font-medium text-brand hover:underline"
                onClick={() => onOpenEvidence()}
              >
                Open in Verification →
              </button>
            </div>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

const NODE_TYPES = { thread: ThreadFlowNode };

export function OverviewThreadFlow({
  thread,
  onOpenEvidence,
}: {
  readonly thread: ThreadWorkbenchSnapshot;
  readonly onOpenEvidence: () => void;
}): JSX.Element {
  const view = useMemo(() => buildOverviewThreadHero(thread), [thread]);

  const nodes = useMemo<Node[]>(
    () =>
      view.nodes.map((hero) => ({
        id: hero.key,
        type: "thread",
        // Le modèle donne le CENTRE du nœud ; xyflow attend son coin.
        position: { x: hero.x - NODE_WIDTH / 2, y: hero.y - NODE_HEIGHT / 2 },
        data: { hero, onOpenEvidence } satisfies FlowNodeData,
        draggable: false,
        connectable: false,
        selectable: false,
        style: { width: NODE_WIDTH, height: NODE_HEIGHT },
      })),
    [view, onOpenEvidence],
  );

  const edges = useMemo<Edge[]>(
    () =>
      view.edges.map((edge) => ({
        id: edge.key,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        animated: false,
        style: {
          // Le trait doit se suivre du regard d'une voie à l'autre : le
          // jeton de bordure, prévu pour des filets, disparaît à cette échelle.
          stroke: edge.emphasis
            ? "var(--color-brand)"
            : "var(--color-muted-foreground)",
          strokeOpacity: edge.emphasis ? 0.9 : 0.45,
          strokeWidth: edge.emphasis ? 1.8 : 1.2,
        },
      })),
    [view],
  );

  return (
    <div>
      {
        /* Les voies restent nommées au-dessus du fil : elles disent dans quel
          ordre il se lit, de l'exigence au verdict. */
      }
      <div
        className="grid border-t border-border"
        style={{
          gridTemplateColumns: `repeat(${view.lanes.length}, minmax(0, 1fr))`,
        }}
      >
        {view.lanes.map((column, index) => (
          <div
            key={column.lane.id}
            className={index > 0
              ? "border-l border-dashed border-border px-4 py-2"
              : "px-4 py-2"}
          >
            <p
              className={cn("m-0", LANE_LABEL)}
              style={{ color: column.lane.color }}
            >
              {column.lane.title}
            </p>
            <p className="m-0 font-mono text-[9.5px] text-muted-foreground">
              {column.systems.join(" · ") || "none recorded"}
            </p>
          </div>
        ))}
      </div>
      <div className="h-[320px] w-full" aria-label="Executable thread">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          // Une lecture, pas un éditeur : rien ne se déplace ni ne se connecte.
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          // Tout tient dans le cadre : déplacer le plan n'apporte rien et
          // surprend dans une carte fixe. Le détail s'ouvre sur le nœud.
          panOnDrag={false}
          panOnScroll={false}
          preventScrolling={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1} color="var(--color-border)" />
        </ReactFlow>
      </div>
    </div>
  );
}
