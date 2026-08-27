import { CARD_SURFACE } from "../ui/cockpit.tsx";
import type { JSX, ReactNode } from "react";
import { cn } from "../lib/utils.ts";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { EmptyNotice, Notice } from "../ui/notice.tsx";
import type {
  ThreadAction,
  ThreadArtifact,
  ThreadGraphNode,
  ThreadObservation,
  ThreadRef,
  ThreadRequirement,
  ThreadViolation,
  ThreadWorkbenchSnapshot,
} from "./types.ts";
import {
  type ArchitectureSysmlSealInspectorView,
  architectureSysmlSealInspectorView,
  architectureSysmlSealSpanLabel,
  type InspectorContext,
  resolveToolFacetInventory,
  resolveToolInspectorContext,
  TOOL_FACETS,
  type WorkbenchToolId,
  type WorkbenchToolIdentity,
} from "./tool-inspector-model.ts";

export type {
  WorkbenchToolId,
  WorkbenchToolIdentity,
} from "./tool-inspector-model.ts";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;
type InspectorTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

interface InspectorMetric {
  id: string;
  label: string;
  value: number;
  unit: string;
  detail: string;
  tone: InspectorTone;
}

export interface ToolInspectorPanelProps {
  snapshot: ThreadWorkbenchSnapshot;
  /** Exact graph node; supports consumption/evaluation/action nodes too. */
  node?: ThreadGraphNode;
  /** Optional richer record for tabs and native full-view navigation. */
  selection?: ThreadRef;
  onSelect?: (selection: ThreadRef) => void;
  /** Selects an exact graph-only entity such as PartDefinition or PartUsage. */
  onSelectGraphNode?: (node: ThreadGraphNode) => void;
  /**
   * Navigation only. The panel never mounts a provider app or fetches data.
   * The Workbench shell decides whether a trusted native full view exists.
   */
  onOpenToolView?: (
    tool: WorkbenchToolIdentity,
    selection: ThreadRef,
  ) => void;
  availableFullViews?: readonly WorkbenchToolId[];
}

/**
 * Contextual inspector for the selected graph entity.
 *
 * Provider viewers are not embedded here. The selected provider is one facet of
 * the same use case and this component reads only the already-loaded snapshot.
 */
export function ToolInspectorPanel({
  snapshot,
  node,
  selection,
  onSelect,
  onSelectGraphNode,
  onOpenToolView,
  availableFullViews,
}: ToolInspectorPanelProps): JSX.Element {
  if (!node && !selection) {
    return (
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Tool context
            </p>
            <CardTitle className="text-base">
              Select an element in the thread
            </CardTitle>
          </div>
          <Badge variant="secondary">
            {TOOL_FACETS.length} facets · 1 subject
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Choose a node or an edge to inspect its engineering facet and the
            evidence it contributes to {snapshot.subject.label}.
          </p>
          <ToolFacetRail
            snapshot={snapshot}
            onSelect={onSelect}
            onSelectGraphNode={onSelectGraphNode}
          />
          <EmptyNotice>
            No engineering tool is selected. The Workbench will not execute a
            tool while you browse the graph.
          </EmptyNotice>
        </CardContent>
      </Card>
    );
  }

  const context = resolveToolInspectorContext(snapshot, {
    node,
    record: selection,
  });
  const metrics = contextMetrics(context);
  const target = context.target;
  const sealView = architectureSysmlSealInspectorView(snapshot, {
    node,
    record: selection,
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Engineering facet
          </p>
          <CardTitle className="text-base">{context.owner.label}</CardTitle>
        </div>
        <Badge variant={ownerTone(context)}>
          {context.connection === "connected"
            ? "linked facet"
            : context.connection === "independent"
            ? "independent branch"
            : "thread context"}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <header
          className="flex items-center gap-3 rounded-lg bg-muted/50 p-3"
          data-tool={context.owner.id}
        >
          <span
            className="grid size-11 shrink-0 place-items-center rounded-md border border-border font-mono text-xs font-semibold"
            aria-hidden="true"
          >
            {toolMonogram(context.owner)}
          </span>
          <div className="min-w-0">
            <small className="font-mono text-xs text-muted-foreground">
              {context.owner.id}
            </small>
            <strong className="block text-sm font-semibold">
              {context.owner.role}
            </strong>
            {node && (
              <span className="block text-xs text-muted-foreground">
                {node.summary}
              </span>
            )}
            {target && (
              <code className="font-mono text-xs text-muted-foreground">
                {target.kind}:{target.id}
              </code>
            )}
          </div>
        </header>

        <ToolFacetRail
          snapshot={snapshot}
          activeTool={context.owner.id}
          onSelect={onSelect}
          onSelectGraphNode={onSelectGraphNode}
        />

        <InspectorMetrics items={metrics} />

        {sealView && <ArchitectureSysmlSealSummary view={sealView} />}

        <BranchState context={context} snapshot={snapshot} />

        {context.owner.id !== "digital-thread" && (
          <>
            <div className="flex flex-col gap-4">
              <GraphOnlySummary
                nodes={context.graphOnlyNodes}
                onSelect={onSelectGraphNode}
              />
              <ArtifactSummary
                artifacts={context.artifacts}
                onSelect={onSelect}
              />
              <ObservationSummary
                observations={context.observations}
                onSelect={onSelect}
              />
              <RequirementSummary
                requirements={context.requirements}
                onSelect={onSelect}
              />
              <ViolationSummary
                violations={context.violations}
                onSelect={onSelect}
              />
            </div>

            <ProvenanceSummary
              artifacts={context.artifacts}
              snapshot={snapshot}
              onSelect={onSelect}
            />
          </>
        )}

        <ActionSummary actions={context.actions} />

        {selection && context.owner.fullViewLabel && onOpenToolView &&
          availableFullViews?.includes(context.owner.id) && (
          <div
            role="group"
            aria-label="Native tool detail"
            className="flex flex-wrap items-center gap-2"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenToolView(context.owner, selection)}
            >
              {context.owner.fullViewLabel}&nbsp;→
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ToolFacetRail({
  snapshot,
  activeTool,
  onSelect,
  onSelectGraphNode,
}: {
  snapshot: ThreadWorkbenchSnapshot;
  activeTool?: WorkbenchToolId;
  onSelect?: (selection: ThreadRef) => void;
  onSelectGraphNode?: (node: ThreadGraphNode) => void;
}): JSX.Element {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Engineering tool facets">
      {TOOL_FACETS.map((tool) => {
        const inventory = resolveToolFacetInventory(snapshot, tool.id);
        const recordTarget = inventory.records.find((record) =>
          record.kind !== "change"
        );
        const graphTarget = inventory.graphOnlyNodes[0];
        const canSelect = recordTarget ? Boolean(onSelect) : Boolean(
          graphTarget && onSelectGraphNode,
        );
        const active = activeTool === tool.id;
        return (
          <button
            type="button"
            key={tool.id}
            data-active={active}
            data-present={inventory.itemCount > 0}
            aria-pressed={active}
            disabled={!canSelect}
            onClick={() => {
              if (recordTarget) onSelect?.(recordTarget);
              else if (graphTarget) {
                onSelectGraphNode?.(graphTarget);
              }
            }}
            title={tool.role}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted/50",
              !canSelect && "opacity-40",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-xs" aria-hidden="true">
                {toolMonogram(tool)}
              </span>
              <strong className="truncate font-medium">{tool.label}</strong>
            </span>
            <small className="shrink-0 font-mono text-xs text-muted-foreground">
              {inventory.itemCount} item{inventory.itemCount === 1 ? "" : "s"}
            </small>
          </button>
        );
      })}
    </nav>
  );
}

function GraphOnlySummary({ nodes, onSelect }: {
  nodes: ThreadGraphNode[];
  onSelect?: (node: ThreadGraphNode) => void;
}): JSX.Element | null {
  if (!nodes.length) return null;
  return (
    <InspectorSection title="SysML structure" count={nodes.length}>
      {nodes.map((node) => (
        <GraphContextRow
          key={`${node.ref.kind}:${node.ref.id}`}
          node={node}
          onSelect={onSelect}
        />
      ))}
    </InspectorSection>
  );
}

function ArchitectureSysmlSealSummary({
  view,
}: {
  view: ArchitectureSysmlSealInspectorView;
}): JSX.Element {
  return (
    <section
      className="flex flex-col gap-3"
      data-authority={view.authority}
      data-artifact-kind={view.artifactKind}
      data-source-status={view.sourceStatus}
    >
      <header className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-medium text-muted-foreground">
          Architecture SysML seal
        </h4>
        <Badge variant="secondary">{view.authority}</Badge>
      </header>
      <Notice title="Thread document only" tone="info">
        Producer {view.producer}. This is not a SysON model, not{" "}
        model.write-architecture@1, and not compile.seal-admission@3. Bindings
        are symbol ids; labels are display only.
      </Notice>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-xs text-muted-foreground">producer</dt>
        <dd className="min-w-0 text-sm">
          <strong>{view.producer}</strong>
          <span className="ml-2 font-mono text-xs text-muted-foreground">
            kind {view.artifactKind}
          </span>
        </dd>
        <dt className="text-xs text-muted-foreground">source</dt>
        <dd className="min-w-0 text-sm">
          <strong>{view.sourceStatus}</strong>
          <span className="ml-2 text-xs text-muted-foreground">
            {view.sourceStatus === "observed"
              ? "reopened analysis"
              : "source analysis unavailable"}
          </span>
        </dd>
        {view.fingerprint && (
          <>
            <dt className="text-xs text-muted-foreground">fingerprint</dt>
            <dd className="min-w-0 text-sm">
              <strong className="font-mono text-xs">{view.fingerprint}</strong>
              <span className="ml-2 text-xs text-muted-foreground">
                content-addressed capture
              </span>
            </dd>
          </>
        )}
        {view.uri && (
          <>
            <dt className="text-xs text-muted-foreground">uri</dt>
            <dd className="min-w-0 text-sm">
              <strong className="font-mono text-xs">{view.uri}</strong>
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                architecture-sysml-seal-capture/1.0
              </span>
            </dd>
          </>
        )}
      </dl>
      <InspectorSection
        title={view.sourceStatus === "unavailable"
          ? "Source unavailable"
          : "Source"}
        count={view.sourceText === undefined ? 0 : 1}
      >
        {view.sourceText === undefined ? null : (
          <pre
            className="max-h-64 overflow-auto whitespace-pre font-mono text-xs"
            aria-readonly="true"
          >
            {view.sourceText}
          </pre>
        )}
      </InspectorSection>
      <InspectorSection
        title={view.symbolsStatus === "unavailable"
          ? "Symbols unavailable"
          : "Symbols"}
        count={view.symbols.length}
      >
        {view.symbols.map((symbol) => (
          <SealFactRow
            key={symbol.id}
            kind={symbol.kind}
            id={symbol.id}
            detail={symbol.label ?? "display label absent"}
            span={symbol.span}
          />
        ))}
      </InspectorSection>
      <InspectorSection title="Incidences" count={view.incidences.length}>
        {view.incidences.map((incidence) => {
          const fromLabel = view.symbols.find((symbol) =>
            symbol.id === incidence.fromSymbolId
          )?.label;
          const toLabel = view.symbols.find((symbol) =>
            symbol.id === incidence.toSymbolId
          )?.label;
          return (
            <SealFactRow
              key={incidence.id}
              kind={incidence.kind}
              id={`${incidence.fromSymbolId} → ${incidence.toSymbolId}`}
              detail={`${fromLabel ?? "display label absent"} → ${
                toLabel ?? "display label absent"
              }`}
              span={incidence.span}
            />
          );
        })}
      </InspectorSection>
      <InspectorSection
        title="Unresolved"
        count={view.unresolvedConstructs.length}
      >
        {view.unresolvedConstructs.map((construct) => (
          <SealFactRow
            key={construct.id}
            kind={construct.kind}
            id={construct.id}
            detail={construct.message ?? "display message absent"}
            span={construct.span}
          />
        ))}
      </InspectorSection>
    </section>
  );
}

function SealFactRow({
  kind,
  id,
  detail,
  span,
}: {
  kind: string;
  id: string;
  detail: string;
  span?: ArchitectureSysmlSealInspectorView["symbols"][number]["span"];
}): JSX.Element {
  const spanLabel = architectureSysmlSealSpanLabel(span);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2">
      <dt className="text-xs text-muted-foreground">{kind}</dt>
      <dd className="min-w-0">
        <strong className="block font-mono text-sm">{id}</strong>
        <span className="block font-mono text-xs text-muted-foreground">
          {detail}
        </span>
        {spanLabel && (
          <span className="block font-mono text-xs text-muted-foreground">
            {spanLabel}
          </span>
        )}
      </dd>
    </dl>
  );
}

function BranchState({ context, snapshot }: {
  context: InspectorContext;
  snapshot: ThreadWorkbenchSnapshot;
}): JSX.Element {
  if (context.connection === "thread") {
    return (
      <Notice title="One engineering subject" tone="info">
        These {TOOL_FACETS.length} engineering facets belong to{" "}
        {snapshot.subject.label}. Select a facet to inspect its evidence branch.
      </Notice>
    );
  }
  if (context.connection === "independent") {
    return (
      <Notice title="No causal edge recorded" tone="warning">
        This facet shares the declared subject identity, but the snapshot does
        not prove a dependency to another tool. Its evidence remains an
        independent branch.
      </Notice>
    );
  }
  return (
    <Notice title="Cross-tool link recorded" tone="success">
      At least one explicit Workbench dependency connects this facet to another
      tool. Inspect the provenance below before treating it as causal.
    </Notice>
  );
}

function ArtifactSummary({ artifacts, onSelect }: {
  artifacts: ThreadArtifact[];
  onSelect?: (selection: ThreadRef) => void;
}): JSX.Element | null {
  if (!artifacts.length) return null;
  return (
    <InspectorSection title="Artifacts" count={artifacts.length}>
      {artifacts.map((artifact) => (
        <ContextRow
          key={artifact.id}
          target={{ kind: "artifact", id: artifact.id }}
          eyebrow={`${artifact.system} · ${artifact.kind}`}
          title={artifact.label}
          detail={`${artifact.revision} · ${artifact.freshness}`}
          onSelect={onSelect}
        />
      ))}
    </InspectorSection>
  );
}

function ObservationSummary({ observations, onSelect }: {
  observations: ThreadObservation[];
  onSelect?: (selection: ThreadRef) => void;
}): JSX.Element | null {
  if (!observations.length) return null;
  return (
    <InspectorSection title="Observations" count={observations.length}>
      {observations.map((observation) => (
        <ContextRow
          key={observation.id}
          target={{ kind: "observation", id: observation.id }}
          eyebrow={observation.id}
          title={observation.label}
          detail={`${observation.display} · ${observation.freshness}`}
          onSelect={onSelect}
        />
      ))}
    </InspectorSection>
  );
}

function RequirementSummary({ requirements, onSelect }: {
  requirements: ThreadRequirement[];
  onSelect?: (selection: ThreadRef) => void;
}): JSX.Element | null {
  if (!requirements.length) return null;
  return (
    <InspectorSection title="Requirements" count={requirements.length}>
      {requirements.map((requirement) => (
        <ContextRow
          key={requirement.id}
          target={{ kind: "requirement", id: requirement.id }}
          eyebrow={`${requirement.source} · ${requirement.status}`}
          title={requirement.label}
          detail={requirement.expression}
          onSelect={onSelect}
        />
      ))}
    </InspectorSection>
  );
}

function ViolationSummary({ violations, onSelect }: {
  violations: ThreadViolation[];
  onSelect?: (selection: ThreadRef) => void;
}): JSX.Element | null {
  if (!violations.length) return null;
  return (
    <InspectorSection title="Violations" count={violations.length}>
      {violations.map((violation) => (
        <ContextRow
          key={violation.id}
          target={{ kind: "violation", id: violation.id }}
          eyebrow={`${violation.severity} · ${violation.status}`}
          title={violation.name}
          detail={violation.margin || violation.message}
          onSelect={onSelect}
        />
      ))}
    </InspectorSection>
  );
}

function InspectorSection({ title, count, children }: {
  title: string;
  count: number;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="font-mono text-xs text-muted-foreground">{count}</span>
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function ContextRow({ target, eyebrow, title, detail, onSelect }: {
  target: ThreadRef;
  eyebrow: string;
  title: string;
  detail: string;
  onSelect?: (selection: ThreadRef) => void;
}): JSX.Element {
  const content = (
    <>
      <span className="text-xs font-medium text-muted-foreground">
        {eyebrow}
      </span>
      <strong className="text-sm font-semibold">{title}</strong>
      <span className="font-mono text-xs text-muted-foreground">{detail}</span>
    </>
  );
  return onSelect
    ? (
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-muted/50"
        onClick={() => onSelect(target)}
      >
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          {content}
        </span>
        <span aria-hidden="true" className="text-sm font-medium text-brand">
          →
        </span>
      </button>
    )
    : <div className="flex flex-col items-start gap-0.5 py-2">{content}</div>;
}

function GraphContextRow({ node, onSelect }: {
  node: ThreadGraphNode;
  onSelect?: (node: ThreadGraphNode) => void;
}): JSX.Element {
  const entityLabel = node.ref.kind === "part-definition"
    ? "PartDefinition"
    : node.ref.kind === "attribute-usage"
    ? "AttributeUsage"
    : node.ref.kind === "cad-lever"
    ? "named lever"
    : node.ref.kind === "cad-unnamed-literal"
    ? "unnamed literal"
    : "PartUsage";
  const systemLabel =
    node.ref.kind === "cad-lever" || node.ref.kind === "cad-unnamed-literal"
      ? "build123d"
      : "SysON";
  const content = (
    <>
      <span className="text-xs font-medium text-muted-foreground">
        {systemLabel} · {entityLabel}
      </span>
      <strong className="text-sm font-semibold">{node.label}</strong>
      <span className="font-mono text-xs text-muted-foreground">
        {node.summary}
      </span>
    </>
  );
  return onSelect
    ? (
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-muted/50"
        onClick={() => onSelect(node)}
      >
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          {content}
        </span>
        <span aria-hidden="true" className="text-sm font-medium text-brand">
          →
        </span>
      </button>
    )
    : <div className="flex flex-col items-start gap-0.5 py-2">{content}</div>;
}

function ProvenanceSummary({ artifacts, snapshot, onSelect }: {
  artifacts: ThreadArtifact[];
  snapshot: ThreadWorkbenchSnapshot;
  onSelect?: (selection: ThreadRef) => void;
}): JSX.Element {
  const dependencies = artifacts.flatMap((artifact) =>
    artifact.dependsOn.map((sourceId) => ({ artifact, sourceId }))
  );
  const attestations = artifacts.flatMap((artifact) =>
    artifact.attestation
      ? [{ artifact, attestation: artifact.attestation }]
      : []
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">Provenance &amp; attestation</h4>
        <p className="text-xs font-medium text-muted-foreground">
          recorded links only
        </p>
      </div>
      {!dependencies.length && !attestations.length
        ? (
          <EmptyNotice>
            No dependency or producer/consumer attestation is available for this
            selection.
          </EmptyNotice>
        )
        : (
          <div className="flex flex-col gap-2">
            {dependencies.map(({ artifact, sourceId }) => {
              const source = snapshot.artifacts.find((item) =>
                item.id === sourceId
              );
              return (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  key={`${artifact.id}:${sourceId}`}
                  disabled={!onSelect}
                  className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal py-2"
                  onClick={() => onSelect?.({ kind: "artifact", id: sourceId })}
                >
                  <span className="text-xs text-muted-foreground">
                    Derived / uses
                  </span>
                  <strong className="text-sm font-semibold">
                    {source?.label ?? sourceId}
                  </strong>
                  <small className="font-mono text-xs text-muted-foreground">
                    feeds {artifact.label}
                  </small>
                </Button>
              );
            })}
            {attestations.map(({ artifact, attestation }) => (
              <div
                className="flex items-start gap-3 rounded-lg bg-muted/50 p-3"
                data-status={attestation.status}
                key={`${artifact.id}:attestation`}
              >
                <Badge
                  variant={attestation.status === "verified"
                    ? "success"
                    : "destructive"}
                >
                  {attestation.status === "verified" ? "Verified" : "Mismatch"}
                </Badge>
                <div className="min-w-0">
                  <strong className="block text-sm font-semibold">
                    {attestation.status === "verified"
                      ? "Consumed bytes verified"
                      : "Consumed bytes mismatch"}
                  </strong>
                  <small className="font-mono text-xs text-muted-foreground">
                    {shortFingerprint(attestation.producerFingerprint)} /{"  "}
                    {shortFingerprint(attestation.consumedFingerprint)}
                  </small>
                </div>
              </div>
            ))}
          </div>
        )}
    </section>
  );
}

function ActionSummary({ actions }: {
  actions: ThreadAction[];
}): JSX.Element | null {
  if (!actions.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">Recorded next actions</h4>
        <p className="text-xs font-medium text-muted-foreground">
          discuss with the agent
        </p>
      </div>
      <div className="divide-y divide-border">
        {actions.map((action) => (
          <div
            className="flex items-start justify-between gap-3 py-2"
            key={action.id}
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                {action.system} · {action.kind}
              </p>
              <strong className="block text-sm font-semibold">
                {action.label}
              </strong>
              <span className="text-xs text-muted-foreground">
                {action.description}
              </span>
            </div>
            <Badge
              variant={action.readiness === "blocked" ? "warning" : "secondary"}
            >
              {action.readiness === "blocked" ? "Blocked" : action.readiness}
            </Badge>
          </div>
        ))}
      </div>
    </section>
  );
}

function InspectorMetrics({
  items,
}: {
  items: readonly InspectorMetric[];
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((metric) => (
        <article
          key={metric.id}
          className={cn("p-3", CARD_SURFACE)}
          data-metric={metric.id}
          data-tone={metric.tone}
        >
          <p className="text-xs text-muted-foreground">{metric.label}</p>
          <strong
            className={cn(
              "block text-xl font-semibold tabular-nums",
              metricToneClass(metric.tone),
            )}
          >
            {metric.value}
          </strong>
          <p className="text-xs font-mono text-muted-foreground">
            {metric.unit}
          </p>
          <p className="text-xs text-muted-foreground">{metric.detail}</p>
        </article>
      ))}
    </div>
  );
}

function contextMetrics(context: InspectorContext): InspectorMetric[] {
  return [
    {
      id: "artifacts",
      label: "Artifacts",
      value: context.artifacts.length,
      unit: "linked",
      detail: `${
        context.artifacts.filter((item) => item.freshness === "fresh").length
      } current`,
      tone: context.artifacts.some((item) => item.freshness === "stale")
        ? "warning"
        : "neutral",
    },
    {
      id: "observations",
      label: "Observations",
      value: context.observations.length,
      unit: "values",
      detail: "unit-bearing evidence",
      tone: "info",
    },
    {
      id: "requirements",
      label: "Requirements",
      value: context.requirements.length,
      unit: "traced",
      detail: context.requirements.length
        ? `${
          context.requirements.filter((item) => item.status === "pass").length
        } passing`
        : "no criterion attached",
      tone: context.requirements.length ? "success" : "warning",
    },
    {
      id: "violations",
      label: "Violations",
      value: context.violations.length,
      unit: "named",
      detail: context.violations.length ? "review required" : "none linked",
      tone: context.violations.length ? "danger" : "neutral",
    },
  ];
}

function ownerTone(context: InspectorContext): BadgeVariant {
  if (context.violations.some((item) => item.status === "open")) {
    return "destructive";
  }
  if (context.artifacts.some((item) => item.freshness === "failed")) {
    return "destructive";
  }
  if (context.artifacts.some((item) => item.freshness === "stale")) {
    return "warning";
  }
  return context.connection === "connected" ? "success" : "secondary";
}

function metricToneClass(tone: InspectorTone): string {
  if (tone === "success") return "text-success";
  if (tone === "warning") return "text-warning";
  if (tone === "danger") return "text-destructive";
  if (tone === "info") return "text-brand";
  return "";
}

function toolMonogram(tool: WorkbenchToolIdentity): string {
  switch (tool.id) {
    case "syson":
      return "SY";
    case "build123d":
      return "B3";
    case "calculix":
      return "CX";
    case "modelica":
      return "MO";
    case "spice":
      return "SP";
    case "erpnext":
      return "ER";
    case "digital-thread":
      return "DT";
    case "other":
      return "••";
  }
}

function shortFingerprint(value: string): string {
  const normalized = value.startsWith("sha256:") ? value.slice(7) : value;
  return `sha256:${normalized.slice(0, 12)}${
    normalized.length > 12 ? "…" : ""
  }`;
}
