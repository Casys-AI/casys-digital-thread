import type { JSX } from "react";
import {
  buildOverviewThreadHero,
  OVERVIEW_HERO_HEIGHT,
  OVERVIEW_HERO_WIDTH,
  type OverviewHeroNode,
} from "./overview-thread-hero-model.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";

export function OverviewThreadHero({
  thread,
  onOpenEvidence,
}: {
  readonly thread: ThreadWorkbenchSnapshot;
  readonly onOpenEvidence: () => void;
}): JSX.Element {
  const view = buildOverviewThreadHero(thread);
  return (
    <div>
      <div
        className="grid border-t border-border"
        style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
      >
        {view.lanes.map((column, index) => (
          <div
            key={column.lane.id}
            className={index > 0
              ? "border-l border-dashed border-border px-4 py-2"
              : "px-4 py-2"}
          >
            <p
              className="m-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em]"
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
      <svg
        viewBox={`0 0 ${OVERVIEW_HERO_WIDTH} ${OVERVIEW_HERO_HEIGHT}`}
        className="block h-auto w-full bg-card"
        role="img"
        aria-label="Recorded thread across requirements, model, geometry, physics and verdicts"
        onClick={onOpenEvidence}
      >
        {view.lanes.slice(1).map((column, index) => (
          <path
            key={column.lane.id}
            d={`M ${(index + 1) * (OVERVIEW_HERO_WIDTH / 5)} 12 V 288`}
            fill="none"
            stroke="#ebedf0"
            strokeWidth="1"
            strokeDasharray="2 4"
          />
        ))}
        {view.edges.map((edge) => (
          <path
            key={edge.key}
            d={edge.d}
            fill="none"
            stroke={edge.emphasis ? "#5e6ad2" : "#c6cbd2"}
            strokeWidth={edge.emphasis ? 2 : 1.2}
            opacity={edge.emphasis ? 1 : 0.6}
          />
        ))}
        {view.nodes.map((item) => <HeroNode key={item.key} item={item} />)}
      </svg>
    </div>
  );
}

function HeroNode({ item }: { item: OverviewHeroNode }): JSX.Element {
  const label = item.node.ref.id;
  const caption = item.node.summary;
  return (
    <g>
      <circle
        cx={item.x}
        cy={item.y}
        r={item.emphasis ? 8 : 7}
        fill={item.color}
        stroke={item.emphasis ? "#5e6ad2" : "none"}
        strokeWidth={item.emphasis ? 2 : 0}
      />
      <text
        x={item.x - 24}
        y={item.y - 16}
        fontFamily="ui-monospace, Menlo, monospace"
        fontSize="9.5"
        fontWeight={item.emphasis ? 600 : 400}
        fill={item.emphasis ? "#5e6ad2" : "#52525c"}
      >
        {label.length > 22 ? `${label.slice(0, 20)}…` : label}
      </text>
      <text
        x={item.x - 24}
        y={item.y + 22}
        fontFamily="ui-monospace, Menlo, monospace"
        fontSize="8.5"
        fill="#a1a1aa"
      >
        {caption.length > 28 ? `${caption.slice(0, 26)}…` : caption}
      </text>
    </g>
  );
}
