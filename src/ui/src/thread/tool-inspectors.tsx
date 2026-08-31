import type { JSX, ReactNode } from "react";
import { Badge } from "../ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { EmptyNotice, Notice } from "../ui/notice.tsx";
import type {
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadRef,
  ThreadWorkbenchSnapshot,
} from "./types.ts";
import {
  type InspectorRecord,
  type InspectorRelation,
  resolveRecordInspectorContext,
} from "./tool-inspector-model.ts";

export interface RecordInspectorPanelProps {
  snapshot: ThreadWorkbenchSnapshot;
  /** Exact graph node, including graph-only entities. */
  node?: ThreadGraphNode;
  /** Optional richer record explicitly associated with the selection. */
  selection?: ThreadRef;
  /** Navigation only. This callback never executes an operation. */
  onSelect?: (selection: ThreadRef) => void;
  /** Navigation only. This callback selects another exact graph identity. */
  onSelectGraphNode?: (node: ThreadGraphNode) => void;
}

/**
 * Generic read-only inspector for one exact graph identity.
 *
 * Domain viewers are MCP-owned Apps. This native surface does not classify a
 * producer or recreate a domain-specific presentation; it only displays the
 * record fields and graph relations already present in the loaded snapshot.
 */
export function RecordInspectorPanel({
  snapshot,
  node,
  selection,
  onSelect,
  onSelectGraphNode,
}: RecordInspectorPanelProps): JSX.Element {
  if (!node && !selection) {
    return (
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Record inspector
            </p>
            <CardTitle className="text-base">
              Select a recorded graph element
            </CardTitle>
          </div>
          <Badge variant="secondary">Read only</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Choose a node to inspect its exact identity, stored fields, and
            recorded relations.
          </p>
          <EmptyNotice>
            No record is selected. Browsing this inspector never executes an
            operation.
          </EmptyNotice>
        </CardContent>
      </Card>
    );
  }

  const context = resolveRecordInspectorContext(snapshot, {
    node,
    record: selection,
  });
  const title = node?.label ?? recordTitle(context.record) ??
    "Recorded selection";

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Recorded selection
          </p>
          <CardTitle className="text-base">{title}</CardTitle>
          {context.target && (
            <code className="block break-all font-mono text-xs text-muted-foreground">
              {context.target.kind}:{context.target.id}
            </code>
          )}
        </div>
        <Badge variant="secondary">
          {context.record ? "Exact record" : "Graph record"}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {context.node && (
          <InspectorSection title="Graph fields">
            <FieldTable value={context.node} />
          </InspectorSection>
        )}

        {context.record && (
          <InspectorSection title="Record fields">
            <FieldTable value={context.record.value} />
          </InspectorSection>
        )}

        {!context.node && !context.record && (
          <EmptyNotice>
            The selected identity has no loaded graph node or record fields.
          </EmptyNotice>
        )}

        <RelationSummary
          relations={context.relations}
          onSelect={onSelect}
          onSelectGraphNode={onSelectGraphNode}
        />

        <RelatedRecordSummary
          records={context.relatedRecords}
          snapshot={snapshot}
          onSelect={onSelect}
          onSelectGraphNode={onSelectGraphNode}
        />

        <Notice title="Read-only projection" tone="info">
          All values and relations shown here were already loaded with this
          Workbench snapshot. This inspector cannot call a tool or mutate a
          record.
        </Notice>
      </CardContent>
    </Card>
  );
}

function InspectorSection({ title, children }: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </section>
  );
}

function FieldTable({ value }: { value: object }): JSX.Element {
  return (
    <dl className="divide-y divide-border rounded-lg border border-border">
      {Object.entries(value).map(([name, fieldValue]) => (
        <div
          key={name}
          className="grid grid-cols-[minmax(6rem,0.38fr)_minmax(0,1fr)] gap-3 px-3 py-2"
        >
          <dt className="break-all font-mono text-xs text-muted-foreground">
            {name}
          </dt>
          <dd className="min-w-0 break-words font-mono text-xs text-foreground">
            {formatFieldValue(fieldValue)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RelationSummary({
  relations,
  onSelect,
  onSelectGraphNode,
}: {
  relations: InspectorRelation[];
  onSelect?: (selection: ThreadRef) => void;
  onSelectGraphNode?: (node: ThreadGraphNode) => void;
}): JSX.Element {
  return (
    <InspectorSection title="Recorded relations">
      {!relations.length
        ? (
          <EmptyNotice>
            No incident relation is recorded for this exact graph identity.
          </EmptyNotice>
        )
        : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {relations.map((relation, index) => (
              <RelationRow
                key={`${relation.edge.id}:${relation.direction}:${index}`}
                relation={relation}
                onSelect={onSelect}
                onSelectGraphNode={onSelectGraphNode}
              />
            ))}
          </div>
        )}
    </InspectorSection>
  );
}

function RelationRow({ relation, onSelect, onSelectGraphNode }: {
  relation: InspectorRelation;
  onSelect?: (selection: ThreadRef) => void;
  onSelectGraphNode?: (node: ThreadGraphNode) => void;
}): JSX.Element {
  const threadRef = toThreadRef(relation.peerRef);
  const activate = relation.peerNode && onSelectGraphNode
    ? () => onSelectGraphNode(relation.peerNode!)
    : threadRef && onSelect
    ? () => onSelect(threadRef)
    : undefined;
  const content = (
    <>
      <span className="text-xs font-medium text-muted-foreground">
        {relation.direction} · {relation.edge.relation} · {relation.edge.origin}
      </span>
      <strong className="text-sm font-semibold">
        {relation.peerNode?.label ??
          `${relation.peerRef.kind}:${relation.peerRef.id}`}
      </strong>
      <code className="break-all font-mono text-xs text-muted-foreground">
        {relation.peerRef.kind}:{relation.peerRef.id}
      </code>
      <span className="text-xs text-muted-foreground">
        {relation.edge.rationale}
      </span>
      {relation.edge.attestation && (
        <code className="break-all font-mono text-xs text-muted-foreground">
          attestation {formatFieldValue(relation.edge.attestation)}
        </code>
      )}
    </>
  );

  return activate
    ? (
      <button
        type="button"
        className="flex w-full flex-col items-start gap-1 px-3 py-2 text-left hover:bg-muted/50"
        onClick={activate}
        aria-label={`Select ${relation.peerRef.kind}:${relation.peerRef.id}`}
      >
        {content}
      </button>
    )
    : <div className="flex flex-col items-start gap-1 px-3 py-2">{content}
    </div>;
}

function RelatedRecordSummary({
  records,
  snapshot,
  onSelect,
  onSelectGraphNode,
}: {
  records: InspectorRecord[];
  snapshot: ThreadWorkbenchSnapshot;
  onSelect?: (selection: ThreadRef) => void;
  onSelectGraphNode?: (node: ThreadGraphNode) => void;
}): JSX.Element | null {
  if (!records.length) return null;
  return (
    <InspectorSection title="Related records">
      <div className="divide-y divide-border rounded-lg border border-border">
        {records.map((record) => {
          const node = snapshot.graph.nodes.find((candidate) =>
            sameGraphRef(candidate.ref, record.ref)
          );
          const threadRef = toThreadRef(record.ref);
          const activate = node && onSelectGraphNode
            ? () => onSelectGraphNode(node)
            : threadRef && onSelect
            ? () => onSelect(threadRef)
            : undefined;
          const content = (
            <>
              <span className="font-mono text-xs text-muted-foreground">
                {record.ref.kind}:{record.ref.id}
              </span>
              <strong className="text-sm font-semibold">
                {recordTitle(record)}
              </strong>
            </>
          );
          return activate
            ? (
              <button
                type="button"
                key={`${record.ref.kind}:${record.ref.id}`}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted/50"
                onClick={activate}
              >
                {content}
              </button>
            )
            : (
              <div
                key={`${record.ref.kind}:${record.ref.id}`}
                className="flex flex-col items-start gap-0.5 px-3 py-2"
              >
                {content}
              </div>
            );
        })}
      </div>
    </InspectorSection>
  );
}

function recordTitle(record: InspectorRecord | undefined): string | undefined {
  if (!record) return undefined;
  const value = record.value as unknown as Record<string, unknown>;
  for (const key of ["label", "title", "name", "id"]) {
    if (typeof value[key] === "string" && value[key].length > 0) {
      return value[key];
    }
  }
  return `${record.ref.kind}:${record.ref.id}`;
}

function formatFieldValue(value: unknown): string {
  if (value === undefined) return "unavailable";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "unavailable";
  }
}

function toThreadRef(ref: ThreadGraphRef): ThreadRef | undefined {
  switch (ref.kind) {
    case "change":
    case "artifact":
    case "observation":
    case "requirement":
    case "violation":
      return { kind: ref.kind, id: ref.id };
    case "consumption":
    case "evaluation":
    case "action":
    case "analysis-node":
    case "part-definition":
    case "part-usage":
    case "attribute-usage":
      return undefined;
  }
}

function sameGraphRef(left: ThreadGraphRef, right: ThreadGraphRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}
