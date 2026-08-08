/** @jsxImportSource preact */

import type { JSX } from "preact";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MetricGrid,
  type MetricItem,
  StateMessage,
  Toolbar,
} from "../mcp-view-primitives.ts";
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
  type InspectorContext,
  resolveToolInspectorContext,
  TOOL_FACETS,
  toolId,
  type WorkbenchToolId,
  type WorkbenchToolIdentity,
} from "./tool-inspector-model.ts";

export type {
  WorkbenchToolId,
  WorkbenchToolIdentity,
} from "./tool-inspector-model.ts";

export interface ToolInspectorPanelProps {
  snapshot: ThreadWorkbenchSnapshot;
  /** Exact graph node; supports consumption/evaluation/action nodes too. */
  node?: ThreadGraphNode;
  /** Optional richer record for tabs and native full-view navigation. */
  selection?: ThreadRef;
  onSelect?: (selection: ThreadRef) => void;
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
  onOpenToolView,
  availableFullViews,
}: ToolInspectorPanelProps): JSX.Element {
  if (!node && !selection) {
    return (
      <Card
        className="thread-card tool-inspector tool-inspector-empty"
        eyebrow="TOOL CONTEXT"
        title="Select an element in the thread"
        actions={<Badge tone="neutral">5 facets · 1 subject</Badge>}
      >
        <p class="tool-inspector-lead">
          Choose a node or an edge to inspect the owning tool and the evidence
          it contributes to {snapshot.subject.label}.
        </p>
        <ToolFacetRail snapshot={snapshot} onSelect={onSelect} />
        <EmptyState>
          No engineering tool is selected. The Workbench will not execute a tool
          while you browse the graph.
        </EmptyState>
      </Card>
    );
  }

  const context = resolveToolInspectorContext(snapshot, {
    node,
    record: selection,
  });
  const metrics = contextMetrics(context);
  const target = context.target;

  return (
    <Card
      className="thread-card tool-inspector"
      eyebrow="OWNING TOOL"
      title={context.owner.label}
      actions={
        <Badge tone={ownerTone(context)}>
          {context.connection === "connected"
            ? "linked facet"
            : context.connection === "independent"
            ? "independent branch"
            : "thread context"}
        </Badge>
      }
    >
      <header class="tool-inspector-identity" data-tool={context.owner.id}>
        <span class="tool-inspector-mark" aria-hidden="true">
          {toolMonogram(context.owner)}
        </span>
        <div>
          <small>{context.owner.id}</small>
          <strong>{context.owner.role}</strong>
          {node && <span>{node.summary}</span>}
          {target && <code>{target.kind}:{target.id}</code>}
        </div>
      </header>

      <ToolFacetRail
        snapshot={snapshot}
        activeTool={context.owner.id}
        onSelect={onSelect}
      />

      <MetricGrid className="tool-inspector-metrics" items={metrics} />

      <BranchState context={context} snapshot={snapshot} />

      {context.owner.id !== "digital-thread" && (
        <>
          <div class="tool-inspector-sections">
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

      <ActionSummary
        actions={context.actions}
      />

      {selection && context.owner.fullViewLabel && onOpenToolView &&
        availableFullViews?.includes(context.owner.id) && (
        <Toolbar label="Native tool detail">
          <Button onClick={() => onOpenToolView(context.owner, selection)}>
            {context.owner.fullViewLabel} →
          </Button>
        </Toolbar>
      )}
    </Card>
  );
}

function ToolFacetRail({ snapshot, activeTool, onSelect }: {
  snapshot: ThreadWorkbenchSnapshot;
  activeTool?: WorkbenchToolId;
  onSelect?: (selection: ThreadRef) => void;
}): JSX.Element {
  return (
    <nav class="tool-facet-rail" aria-label="Engineering tool facets">
      {TOOL_FACETS.map((tool) => {
        const stages = snapshot.flow.filter((stage) =>
          toolId(stage.system) === tool.id
        );
        const target = stages.find((stage) => stage.selection.kind !== "change")
          ?.selection;
        return (
          <button
            type="button"
            key={tool.id}
            data-active={activeTool === tool.id}
            data-present={stages.length > 0}
            aria-pressed={activeTool === tool.id}
            disabled={!target || !onSelect}
            onClick={() => target && onSelect?.(target)}
            title={tool.role}
          >
            <span>{toolMonogram(tool)}</span>
            <strong>{tool.label}</strong>
            <small>{stages.length} item{stages.length === 1 ? "" : "s"}</small>
          </button>
        );
      })}
    </nav>
  );
}

function BranchState({ context, snapshot }: {
  context: InspectorContext;
  snapshot: ThreadWorkbenchSnapshot;
}): JSX.Element {
  if (context.connection === "thread") {
    return (
      <StateMessage title="One engineering subject" tone="info">
        The five providers are facets of{" "}
        {snapshot.subject.label}. Select a provider node to inspect its evidence
        branch.
      </StateMessage>
    );
  }
  if (context.connection === "independent") {
    return (
      <StateMessage title="No causal edge recorded" tone="warning">
        This provider shares the declared subject identity, but the snapshot
        does not prove a dependency to another tool. Its evidence remains an
        independent branch.
      </StateMessage>
    );
  }
  return (
    <StateMessage title="Cross-tool link recorded" tone="success">
      At least one explicit Workbench dependency connects this provider to
      another tool. Inspect the provenance below before treating it as causal.
    </StateMessage>
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
  children: JSX.Element[];
}): JSX.Element {
  return (
    <section class="tool-inspector-section">
      <header>
        <h4>{title}</h4>
        <span>{count}</span>
      </header>
      <div class="tool-inspector-rows">{children}</div>
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
      <small>{eyebrow}</small>
      <strong>{title}</strong>
      <span>{detail}</span>
    </>
  );
  return onSelect
    ? (
      <button
        class="tool-inspector-row"
        type="button"
        onClick={() => onSelect(target)}
      >
        {content}
        <b aria-hidden="true">↗</b>
      </button>
    )
    : <div class="tool-inspector-row">{content}</div>;
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
    <section class="tool-inspector-provenance">
      <div class="tool-inspector-section-title">
        <h4>Provenance &amp; attestation</h4>
        <small>recorded links only</small>
      </div>
      {!dependencies.length && !attestations.length
        ? (
          <EmptyState>
            No dependency or producer/consumer attestation is available for this
            selection.
          </EmptyState>
        )
        : (
          <div class="tool-inspector-provenance-list">
            {dependencies.map(({ artifact, sourceId }) => {
              const source = snapshot.artifacts.find((item) =>
                item.id === sourceId
              );
              return (
                <button
                  type="button"
                  key={`${artifact.id}:${sourceId}`}
                  disabled={!onSelect}
                  onClick={() => onSelect?.({ kind: "artifact", id: sourceId })}
                >
                  <span>DERIVED / USES</span>
                  <strong>{source?.label ?? sourceId}</strong>
                  <small>feeds {artifact.label}</small>
                </button>
              );
            })}
            {attestations.map(({ artifact, attestation }) => (
              <div
                class="tool-inspector-attestation"
                data-status={attestation.status}
                key={`${artifact.id}:attestation`}
              >
                <span>{attestation.status === "verified" ? "✓" : "!"}</span>
                <div>
                  <strong>
                    {attestation.status === "verified"
                      ? "Consumed bytes verified"
                      : "Consumed bytes mismatch"}
                  </strong>
                  <small>
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
    <section class="tool-inspector-actions">
      <div class="tool-inspector-section-title">
        <h4>Recorded next actions</h4>
        <small>discuss with the agent</small>
      </div>
      {actions.map((action) => (
        <div class="tool-inspector-action" key={action.id}>
          <div>
            <small>{action.system} · {action.kind}</small>
            <strong>{action.label}</strong>
            <span>{action.description}</span>
          </div>
          <small>
            {action.readiness === "blocked" ? "Blocked" : action.readiness}
          </small>
        </div>
      ))}
    </section>
  );
}

function contextMetrics(context: InspectorContext): MetricItem[] {
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

function ownerTone(
  context: InspectorContext,
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (context.violations.some((item) => item.status === "open")) {
    return "danger";
  }
  if (context.artifacts.some((item) => item.freshness === "failed")) {
    return "danger";
  }
  if (context.artifacts.some((item) => item.freshness === "stale")) {
    return "warning";
  }
  return context.connection === "connected" ? "success" : "neutral";
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
