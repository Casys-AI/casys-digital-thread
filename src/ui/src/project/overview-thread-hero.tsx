import { LANE_LABEL, SECTION_LABEL } from "../ui/cockpit.tsx";
import { cn } from "../lib/utils.ts";
import type { JSX } from "react";
import { useState } from "react";
import type { EngineeringPhaseStatus } from "../../../domain/project/engineering-project.ts";
import {
  buildOverviewThreadHero,
  OVERVIEW_HERO_WIDTH,
  OVERVIEW_LANES,
  type OverviewActivityHeroNode,
  type OverviewHeroNode,
  type OverviewRecordedHeroNode,
} from "./overview-thread-hero-model.ts";
import type { ProjectPathActivityView } from "./model.ts";
import { recordStatusVariant } from "./record-status.ts";
import type {
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";

const OVERVIEW_SELECTION_ID = "overview-thread-selection";

export function OverviewThreadHero({
  thread,
  activities = [],
  onOpenEvidence,
  onOpenActivity,
}: {
  readonly thread: ThreadWorkbenchSnapshot;
  readonly activities?: readonly ProjectPathActivityView[];
  readonly onOpenEvidence: (reference: ThreadGraphRef) => void;
  readonly onOpenActivity: () => void;
}): JSX.Element {
  const view = buildOverviewThreadHero(thread, activities);
  const [selectedKey, setSelectedKey] = useState<string>();
  const selected = view.nodes.find((item) => item.key === selectedKey);
  const toggleSelection = (item: OverviewHeroNode) => {
    setSelectedKey((current) => nextOverviewHeroSelection(current, item.key));
  };
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
      <svg
        viewBox={`0 0 ${OVERVIEW_HERO_WIDTH} ${view.height}`}
        className="block h-auto w-full bg-card"
        role="group"
        aria-label="Recorded thread and project progress across requirements, model, geometry, physics and verdicts"
      >
        {view.lanes.slice(1).map((column, index) => (
          <path
            key={column.lane.id}
            d={`M ${(index + 1) * (OVERVIEW_HERO_WIDTH / 5)} 12 V ${
              view.height - 12
            }`}
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
            stroke={edge.emphasis ? "#0e7490" : "#c6cbd2"}
            strokeWidth={edge.emphasis ? 2 : 1.2}
            opacity={edge.emphasis ? 1 : 0.6}
          />
        ))}
        {view.nodes.map((item) => (
          <HeroNode
            key={item.key}
            item={item}
            selected={item.key === selectedKey}
            onToggle={() => toggleSelection(item)}
          />
        ))}
      </svg>
      {selected?.kind === "recorded" && (
        <OverviewRecordedNodePanel
          item={selected}
          onOpenEvidence={() => onOpenEvidence(selected.node.ref)}
        />
      )}
      {selected?.kind === "activity" && (
        <OverviewActivityNodePanel
          item={selected}
          onOpenActivity={onOpenActivity}
        />
      )}
    </div>
  );
}

function nextOverviewHeroSelection(
  current: string | undefined,
  requested: string,
): string | undefined {
  return current === requested ? undefined : requested;
}

function HeroNode({
  item,
  selected,
  onToggle,
}: {
  item: OverviewHeroNode;
  selected: boolean;
  onToggle: () => void;
}): JSX.Element {
  const title = item.kind === "activity"
    ? `Project activity · ${item.activity.title} · ${
      activityStatusCaption(item.activity.status)
    }`
    : `${item.node.label} · ${item.node.ref.id} · ${item.node.summary}`;
  const ariaLabel = item.kind === "activity"
    ? `Project activity ${item.activity.title}, ${
      activityStatusCaption(item.activity.status)
    }`
    : `Inspect ${item.node.label} locally`;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-controls={selected ? OVERVIEW_SELECTION_ID : undefined}
      aria-expanded={selected}
      className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onToggle();
      }}
    >
      <title>{title}</title>
      <circle
        cx={item.x}
        cy={item.y}
        r="20"
        fill="transparent"
      />
      {selected && (
        <circle
          cx={item.x}
          cy={item.y}
          r="13"
          fill="none"
          className="stroke-brand"
          strokeWidth="1.5"
        />
      )}
      {item.kind === "activity"
        ? <ActivityMarker item={item} />
        : <RecordedMarker item={item} />}
    </g>
  );
}

function RecordedMarker(
  { item }: { item: OverviewRecordedHeroNode },
): JSX.Element {
  const label = item.node.ref.id;
  const caption = item.node.summary;
  return (
    <>
      <circle
        cx={item.x}
        cy={item.y}
        r={item.emphasis ? 8 : 7}
        fill={item.color}
        stroke={item.emphasis ? "#0e7490" : "none"}
        strokeWidth={item.emphasis ? 2 : 0}
      />
      <text
        x={item.x}
        y={item.y - 16}
        textAnchor="middle"
        fontFamily="ui-monospace, Menlo, monospace"
        fontSize="9.5"
        fontWeight={item.emphasis ? 600 : 400}
        fill={item.emphasis ? "#0e7490" : "#52525c"}
      >
        {compactNodeText(label, 15)}
      </text>
      <text
        x={item.x}
        y={item.y + 22}
        textAnchor="middle"
        fontFamily="ui-monospace, Menlo, monospace"
        fontSize="8.5"
        fill="var(--thread-muted)"
      >
        {compactNodeText(caption, 17)}
      </text>
    </>
  );
}

function ActivityMarker(
  { item }: { item: OverviewActivityHeroNode },
): JSX.Element {
  const status = item.activity.status;
  const caption = activityStatusCaption(status);
  const planned = status === "planned";
  const blocked = status === "blocked";
  const active = status === "active";
  return (
    <>
      {active && (
        <circle
          cx={item.x}
          cy={item.y}
          r="11"
          fill="none"
          className="stroke-success/30"
          strokeWidth="3"
        />
      )}
      <circle
        cx={item.x}
        cy={item.y}
        r="7"
        className={cn(
          "fill-card",
          blocked
            ? "stroke-destructive"
            : planned
            ? "stroke-muted-foreground"
            : "stroke-success",
        )}
        strokeWidth={planned ? 1.5 : 2}
        strokeDasharray={planned ? "3 2" : undefined}
      />
      <text
        x={item.x}
        y={item.y - 16}
        textAnchor="middle"
        fontFamily="ui-monospace, Menlo, monospace"
        fontSize="9.5"
        fill="#52525c"
      >
        {compactNodeText(item.activity.title, 15)}
      </text>
      <text
        x={item.x}
        y={item.y + 22}
        textAnchor="middle"
        fontFamily="ui-monospace, Menlo, monospace"
        fontSize="8.5"
        className={blocked
          ? "fill-destructive"
          : planned
          ? undefined
          : "fill-success"}
        fill={planned ? "var(--thread-muted)" : undefined}
      >
        {caption}
      </text>
    </>
  );
}

function OverviewRecordedNodePanel({
  item,
  onOpenEvidence,
}: {
  item: OverviewRecordedHeroNode;
  onOpenEvidence: () => void;
}): JSX.Element {
  const node = item.node;
  const laneLabel =
    OVERVIEW_LANES.find((lane) => lane.id === item.lane)?.title ??
      item.lane;
  return (
    <section
      id={OVERVIEW_SELECTION_ID}
      aria-label={`Selected thread record: ${node.label}`}
      aria-live="polite"
      className="grid gap-3 border-t border-border bg-muted/20 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn("m-0", SECTION_LABEL)}>
            Local record · {laneLabel}
          </p>
          <Badge variant={freshnessBadgeVariant(node.freshness)}>
            {node.freshness}
          </Badge>
        </div>
        <h4 className="mt-1 text-[13px] font-semibold">{node.label}</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">{node.summary}</p>
        <p className="mt-1 font-mono text-[9.5px] text-muted-foreground">
          {node.ref.id} · {node.artifactKind ?? node.entityKind} ·{" "}
          {node.system ||
            "none recorded"}
          {node.recordedAt && (
            <>
              {" · "}
              <time dateTime={node.recordedAt}>{node.recordedAt}</time>
            </>
          )}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start md:justify-self-end"
        onClick={onOpenEvidence}
      >
        Open in Verification →
      </Button>
    </section>
  );
}

function OverviewActivityNodePanel({
  item,
  onOpenActivity,
}: {
  item: OverviewActivityHeroNode;
  onOpenActivity: () => void;
}): JSX.Element {
  const activity = item.activity;
  const laneLabel =
    OVERVIEW_LANES.find((lane) => lane.id === item.lane)?.title ??
      item.lane;
  return (
    <section
      id={OVERVIEW_SELECTION_ID}
      aria-label={`Selected project activity: ${activity.title}`}
      aria-live="polite"
      className="grid gap-3 border-t border-border bg-muted/20 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn("m-0", SECTION_LABEL)}>
            Project activity · {laneLabel}
          </p>
          <Badge variant={recordStatusVariant(activity.status)}>
            {activityStatusCaption(activity.status)}
          </Badge>
        </div>
        <h4 className="mt-1 text-[13px] font-semibold">{activity.title}</h4>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start md:justify-self-end"
        onClick={onOpenActivity}
      >
        Open in Activity →
      </Button>
    </section>
  );
}

function activityStatusCaption(status: EngineeringPhaseStatus): string {
  if (status === "blocked") return "BLOCKED";
  if (status === "active") return "IN PROGRESS";
  if (status === "planned") return "PENDING";
  return "COMPLETED";
}

function freshnessBadgeVariant(
  freshness: ThreadGraphNode["freshness"],
): "success" | "warning" | "info" | "destructive" {
  if (freshness === "failed") return "destructive";
  if (freshness === "stale") return "warning";
  if (freshness === "running") return "info";
  return "success";
}

function compactNodeText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
