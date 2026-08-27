import { CARD_SURFACE } from "../ui/cockpit.tsx";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import { type GeometryDecisionValid } from "../cad/geometry-decision-model.ts";
import { GltfAssetCanvas } from "../thread/gltf-asset-canvas.tsx";
import { isDuplicateSealedGlbCopy } from "../thread/component-workspace-model.ts";
import { createThreeOrbitViewport } from "../cad/three-orbit-viewport.ts";
import { cn } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardHeader } from "../ui/card.tsx";
import {
  type ActivityReviewStatus,
  activityReviewStatus,
  activityReviewStatusLabel,
  buildProjectReviewRecords,
  currentProjectReview,
  type ProjectReviewKind,
  type ProjectReviewRecord,
} from "./review-decision-model.ts";
import { buildArchitectureBindingRows } from "./review-architecture-model.ts";

export interface ProjectReviewProps {
  readonly project: EngineeringProjectSnapshot;
  readonly thread?: ThreadWorkbenchSnapshot;
  /** Opens the live activity feed, optionally focused on this decision. */
  readonly onOpenActivity?: (decisionId?: string) => void;
  /** Opens one stable, read-only review deep link. */
  readonly onOpenReview?: (kind: ProjectReviewKind) => void;
  /** Opens a published result only when its exact capture is present. */
  readonly onOpenEvidence?: (reference: EngineeringThreadEntityRef) => void;
}

/** A compact overview handoff to the records that explain a decision. */
export function DecisionCenter(props: ProjectReviewProps): JSX.Element {
  return <ReviewNotifications {...props} />;
}

/**
 * The overview remains a compact handoff. Exact previews live in the
 * chronological Activity feed. Decisions stay in the paired conversation.
 */
export function ReviewNotifications({
  project,
  thread,
  onOpenActivity,
  onOpenReview,
}: ProjectReviewProps): JSX.Element {
  const records = buildProjectReviewRecords(project, thread);
  const nextReview = currentProjectReview(records);
  const needsReviewCount =
    records.filter((record) => record.state === "needs-review").length;
  const pendingResultCount =
    records.filter((record) => record.state === "approved-awaiting-result")
      .length;
  const revisionRequestedCount =
    records.filter((record) => record.state === "revision-requested").length;
  return (
    <Card
      data-surface="inbox"
      aria-labelledby="review-notifications-title-inbox"
    >
      <CardHeader className="flex-row items-start justify-between gap-6 px-5 pt-5 max-md:flex-col">
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-medium text-muted-foreground">
            <p>Review</p>
          </div>
          <h3
            id="review-notifications-title-inbox"
            className="text-base font-semibold"
            aria-live="polite"
          >
            {needsReviewCount > 0
              ? `${needsReviewCount} exact proposal${
                needsReviewCount === 1 ? " is" : "s are"
              } ready`
              : "No proposal is waiting for review"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {nextReview
              ? "Inspect the exact preview in Activity."
              : "Past reviews remain in Activity."}
          </p>
        </div>
        <dl className="grid shrink-0 grid-cols-3 divide-x divide-border">
          <div
            className="flex flex-col-reverse px-4 text-right first:pl-0 last:pr-0"
            data-tone={nextReview ? "attention" : "quiet"}
          >
            <dt className="text-xs text-muted-foreground">To review</dt>
            <dd className="m-0">
              <strong
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  needsReviewCount === 0
                    ? "text-muted-foreground/50"
                    : "text-warning",
                )}
              >
                {needsReviewCount}
              </strong>
            </dd>
          </div>
          <div
            className="flex flex-col-reverse px-4 text-right first:pl-0 last:pr-0"
            data-tone={pendingResultCount > 0 ? "preparing" : "quiet"}
          >
            <dt className="text-xs text-muted-foreground">Result pending</dt>
            <dd className="m-0">
              <strong
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  pendingResultCount === 0
                    ? "text-muted-foreground/50"
                    : "text-brand",
                )}
              >
                {pendingResultCount}
              </strong>
            </dd>
          </div>
          <div
            className="flex flex-col-reverse px-4 text-right first:pl-0 last:pr-0"
            data-tone={revisionRequestedCount > 0 ? "attention" : "quiet"}
          >
            <dt className="text-xs text-muted-foreground">
              Revision requested
            </dt>
            <dd className="m-0">
              <strong
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  revisionRequestedCount === 0
                    ? "text-muted-foreground/50"
                    : "text-warning",
                )}
              >
                {revisionRequestedCount}
              </strong>
            </dd>
          </div>
        </dl>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-5 pb-5">
        <ReviewInboxHandoff
          nextReview={nextReview}
          pendingResultCount={pendingResultCount}
          revisionRequestedCount={revisionRequestedCount}
          onOpenActivity={onOpenActivity}
          onOpenReview={onOpenReview}
        />
      </CardContent>
    </Card>
  );
}

function ReviewInboxHandoff({
  nextReview,
  pendingResultCount,
  revisionRequestedCount,
  onOpenActivity,
  onOpenReview,
}: {
  nextReview?: ProjectReviewRecord;
  pendingResultCount: number;
  revisionRequestedCount: number;
  onOpenActivity?: (decisionId?: string) => void;
  onOpenReview?: (kind: ProjectReviewKind) => void;
}): JSX.Element {
  // La teinte suit la branche, pas le tone : "revision requested" partage le
  // tone `required` avec "result pending" mais reste un signal warning,
  // aligné sur son compteur.
  const state = nextReview
    ? {
      tone: "proposed",
      marker: "Review in activity",
      title: nextReview.title,
      detail:
        "Inspect the exact preview. Sign the decision in the paired conversation.",
      action: "Inspect exact preview",
      icon: "!",
      iconTone: "bg-warning/15 text-warning",
    }
    : pendingResultCount > 0
    ? {
      tone: "required",
      marker: "Approved · result pending",
      title: "A reviewed operation has not published its result yet",
      detail: "Activity will show the result when it is published.",
      action: "See activity",
      icon: "···",
      iconTone: "bg-brand/10 text-brand",
    }
    : revisionRequestedCount > 0
    ? {
      tone: "required",
      marker: "Revision requested",
      title: "A proposal was returned for revision",
      detail: "The decision record does not prove that a run is active.",
      action: "See activity",
      icon: "↺",
      iconTone: "bg-warning/15 text-warning",
    }
    : {
      tone: "approved",
      marker: "No question waiting",
      title: "No project decision needs discussion right now",
      detail: "Use Activity to follow the project.",
      action: "See activity",
      icon: "✓",
      iconTone: "bg-success/10 text-success",
    };

  return (
    <section
      className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 p-4"
      data-state={state.tone}
      aria-label="Project signal"
    >
      <span
        aria-hidden="true"
        className={`grid size-8 shrink-0 place-items-center rounded-md ` +
          `text-sm font-medium ${state.iconTone}`}
      >
        {state.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">
          {state.marker}
        </p>
        <strong className="text-sm font-medium">{state.title}</strong>
        <small className="mt-0.5 block text-sm text-muted-foreground">
          {state.detail}
        </small>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() =>
          nextReview ? onOpenReview?.(nextReview.id) : onOpenActivity?.()}
        disabled={nextReview ? !onOpenReview : !onOpenActivity}
      >
        {state.action}
      </Button>
    </section>
  );
}

/** One human-review event rendered inside the chronological Activity rail. */
export function ActivityReviewFeedCard({
  record,
  onOpenEvidence,
  initiallyOpen = false,
}: {
  record: ProjectReviewRecord;
  onOpenEvidence?: (reference: EngineeringThreadEntityRef) => void;
  initiallyOpen?: boolean;
}): JSX.Element | null {
  const status = activityReviewStatus(record);
  const [open, setOpen] = useState(
    initiallyOpen || status === "to-review" ||
      status === "revision-requested",
  );
  if (!status) return null;
  return (
    <details
      className={cn("shadow-sm", CARD_SURFACE)}
      data-review-status={status}
      data-canonical-review-status={status}
      data-representation={record.representation}
      data-superseded={record.supersededBy ? "true" : "false"}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      aria-label={`Review record: ${record.title}`}
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={activityReviewBadgeVariant(status)}>
              {activityReviewStatusLabel(status)}
              {record.supersededBy ? " · Superseded" : ""}
            </Badge>
            <span className="text-xs font-medium text-muted-foreground">
              {reviewKindLabel(record.id)}
            </span>
          </span>
          <strong className="mt-1.5 block text-sm font-semibold">
            {record.title}
          </strong>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            {record.question}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {open ? "Hide preview" : "Open exact preview"}
        </span>
      </summary>
      <div className="space-y-4 border-t border-border p-4">
        {record.supersededBy && (
          <aside
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-4"
            role="note"
          >
            <div>
              <strong className="text-sm font-medium">
                Superseded by the current geometry review
              </strong>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                {record.supersededBy.title}
              </span>
            </div>
            <a
              className="text-sm font-medium text-brand hover:underline"
              href={record.supersededBy.href}
            >
              Open replacement&nbsp;→
            </a>
          </aside>
        )}
        <p className="text-sm text-muted-foreground">{record.summary}</p>
        <ReviewBusinessPreview record={record} />
        {record.outcome && (
          <dl
            className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5"
            aria-label="Recorded review outcome"
          >
            {record.outcome.rationale && (
              <>
                <dt className="text-xs text-muted-foreground">Rationale</dt>
                <dd className="text-sm">{record.outcome.rationale}</dd>
              </>
            )}
            {record.outcome.decidedBy && (
              <>
                <dt className="text-xs text-muted-foreground">Decided by</dt>
                <dd className="text-sm">{record.outcome.decidedBy}</dd>
              </>
            )}
            {record.outcome.decidedAt && (
              <>
                <dt className="text-xs text-muted-foreground">Decided</dt>
                <dd className="font-mono text-xs text-muted-foreground">
                  {formatDateTime(record.outcome.decidedAt)}
                </dd>
              </>
            )}
          </dl>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-xs text-muted-foreground">Review</dt>
          <dd className="text-sm">
            {activityReviewStatusLabel(status)}
          </dd>
          <dt className="text-xs text-muted-foreground">Scope</dt>
          <dd className="text-sm">
            {record.decision?.inputFingerprint
              ? "Exact input bound"
              : "Record only"}
          </dd>
          <dt className="text-xs text-muted-foreground">Recorded</dt>
          <dd className="font-mono text-xs text-muted-foreground">
            {record.recordedAt ? formatDateTime(record.recordedAt) : "—"}
          </dd>
        </dl>
        {record.resultEvidence && onOpenEvidence && (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenEvidence(record.resultEvidence!)}
            >
              Trace exact result
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {status === "to-review" || status === "revision-requested"
            ? "This record has no browser decision action; continue in the paired conversation."
            : record.supersededBy
            ? "Validated historical review. The signed successor above is the current geometry result."
            : record.resultEvidence
            ? "Validated review attached to this exact published feed fact."
            : "Validated review. No exact published result is recorded yet."}
        </p>
      </div>
    </details>
  );
}

export function ReviewBusinessPreview(
  { record }: { record: ProjectReviewRecord },
): JSX.Element {
  const preview = record.preview;
  if (preview.kind === "unavailable") {
    return (
      <div
        className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
        role="status"
      >
        <strong className="block text-sm font-medium">
          Preview unavailable
        </strong>
        <span>{preview.reason}</span>
      </div>
    );
  }
  if (preview.kind === "brief") {
    return (
      <section className="divide-y divide-border">
        <header className="pb-3">
          <p className="text-xs font-medium text-muted-foreground">
            Engineering brief · revision {preview.brief.revision}
          </p>
          <strong className="text-sm font-semibold">
            {preview.brief.items.length} explicit statements
          </strong>
        </header>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 pt-3">
          {preview.brief.items.map((item) => (
            <div key={item.id} className="contents">
              <dt className="text-xs text-muted-foreground">
                {item.kind.replaceAll("-", " ")}
              </dt>
              <dd className="text-sm">{item.statement}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  if (preview.kind === "architecture") {
    const bindingRows = buildArchitectureBindingRows(preview.value);
    return (
      <section className="divide-y divide-border">
        <header className="pb-3">
          <p className="text-xs font-medium text-muted-foreground">
            PartDefinition binding diagram · {preview.value.packageName}
          </p>
          <strong className="text-sm font-semibold">
            {preview.value.system.name}
          </strong>
        </header>
        <ol className="divide-y divide-border pt-1">
          {bindingRows.map(({ component, depth }, index) => (
            <li
              key={`${component.parentName}:${component.usageName}:${index}`}
              className="flex flex-wrap items-baseline gap-2 py-2"
              style={{ paddingInlineStart: `${12 + depth * 22}px` }}
              aria-label={`Nesting level ${
                depth + 1
              }: ${component.parentName} contains usage ${component.usageName} typed by ${component.name}`}
            >
              <code className="font-mono text-xs text-muted-foreground">
                {component.parentName}
              </code>
              <span aria-hidden="true">→</span>
              <strong className="text-sm font-medium">
                {component.usageName}
              </strong>
              <small className="text-xs text-muted-foreground">
                : {component.name}
              </small>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  if (preview.kind === "requirements") {
    return (
      <section className="divide-y divide-border">
        <header className="pb-3">
          <p className="text-xs font-medium text-muted-foreground">
            Requirements proposal · target
          </p>
          <strong className="text-sm font-semibold">
            {preview.value.containerComponent}
          </strong>
        </header>
        <dl className="divide-y divide-border">
          {preview.value.requirements.map((requirement) => (
            <div
              key={requirement.metric}
              className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2"
            >
              <dt className="text-xs text-muted-foreground">
                <span className="block text-sm text-foreground">
                  {requirement.name}
                </span>
                <code className="font-mono text-xs">
                  {requirement.metric}
                </code>
              </dt>
              <dd className="text-sm">
                <span className="font-mono text-xs text-muted-foreground">
                  {requirement.operator} {requirement.threshold.value}{" "}
                  {requirement.threshold.unit}
                </span>
                <small className="mt-0.5 block text-xs text-muted-foreground">
                  Target only · no measurement
                </small>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  return (
    <GeometryDraftPreview
      view={preview.value}
      assetPath={preview.assetPath}
      partAssets={preview.partAssets}
      mode={record.supersededBy
        ? "superseded"
        : record.state === "published" && preview.assetAuthority === "sealed"
        ? "sealed"
        : record.state === "approved-awaiting-result"
        ? "approved"
        : record.state === "published"
        ? "historical"
        : "draft"}
    />
  );
}

function reviewKindLabel(kind: ProjectReviewKind): string {
  if (kind === "brief") return "Brief";
  if (kind === "architecture") return "Architecture";
  if (kind === "requirements") return "Specification";
  return "Geometry";
}

function activityReviewBadgeVariant(
  status: ActivityReviewStatus,
): "warning" | "success" | "secondary" {
  if (status === "to-review" || status === "revision-requested") {
    return "warning";
  }
  if (status === "validated") return "success";
  return "secondary";
}

// ── Geometry draft viewer ─────────────────────────────────────────────────────

/**
 * WHY THIS COMPONENT EXISTS — the human must see the draft geometry before
 * signing the MRTR that authorises `design.write-geometry@1` to seal it.
 * "Signing what you have seen" is the contract. The same viewer also reopens
 * the exact sealed bytes after publication, with explicit vocabulary for each
 * state so a draft can never masquerade as canonical evidence.
 */
function GeometryDraftPreview(
  {
    view,
    assetPath,
    partAssets,
    mode,
  }: {
    view: GeometryDecisionValid;
    assetPath?: string;
    partAssets: Extract<
      ProjectReviewRecord["preview"],
      { kind: "geometry" }
    >["partAssets"];
    mode: "draft" | "approved" | "sealed" | "historical" | "superseded";
  },
): JSX.Element {
  const format = view.primaryAssetFormat;
  const path = assetPath;
  const targetPart = view.targetPart;
  if (!path || !format) {
    return (
      <div className="divide-y divide-border" data-geometry-review-mode={mode}>
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          No previewable {mode === "sealed" ? "sealed" : "reviewed"} {targetPart
            ? `${
              targetPartSealStatus(mode, targetPart.partDefinitionElementId)
            } No assembly preview is claimed.`
            : `assembly is available (${view.assemblyFiles.length} file${
              view.assemblyFiles.length === 1 ? "" : "s"
            } present).`}
        </p>
        <GeometryDecisionDetails
          view={view}
          partAssets={partAssets}
          mode={mode}
        />
      </div>
    );
  }

  if (format === "step") {
    return (
      <div className="divide-y divide-border" data-geometry-review-mode={mode}>
        <p className="pb-3 text-xs font-medium text-muted-foreground">
          {geometryPreviewLabel(mode, format)}
        </p>
        <p className="py-3 text-sm text-muted-foreground">
          {mode === "sealed"
            ? "Exact sealed STEP bytes are recorded; this format has no in-browser preview."
            : mode === "approved"
            ? "The STEP proposal was validated; its sealed result is still pending."
            : targetPart
            ? "STEP format — no in-browser preview. This is a target PartDefinition review, not an assembly preview."
            : "STEP format — no in-browser preview. Review the available assembly preview with the agent before approving."}
        </p>
        <code className="block py-3 font-mono text-xs text-muted-foreground">
          {view.draftDigest}
        </code>
        <GeometryDecisionDetails
          view={view}
          partAssets={partAssets}
          mode={mode}
        />
      </div>
    );
  }

  return (
    <div className="divide-y divide-border" data-geometry-review-mode={mode}>
      <p className="pb-3 text-xs font-medium text-muted-foreground">
        {geometryPreviewLabel(mode, format)}
      </p>
      {format === "gltf"
        ? (
          <GltfAssetCanvas
            url={path}
            ariaLabel={mode === "sealed"
              ? "Interactive sealed geometry"
              : mode === "superseded" || mode === "historical"
              ? "Interactive validated historical geometry proposal"
              : "Interactive proposed geometry"}
            loadingLabel={mode === "sealed"
              ? "Loading sealed model…"
              : mode === "superseded" || mode === "historical"
              ? "Loading historical reviewed model…"
              : "Loading proposed model…"}
            errorLabel={mode === "sealed"
              ? "Sealed model unavailable"
              : mode === "superseded" || mode === "historical"
              ? "Historical reviewed model unavailable"
              : "Proposed model unavailable"}
          />
        )
        : <StlDraftCanvas url={path} />}
      <footer className="flex flex-wrap items-baseline justify-between gap-2 py-3">
        <small className="text-xs text-muted-foreground">
          {targetPart
            ? targetPartSealStatus(mode, targetPart.partDefinitionElementId)
            : `Assembly files: ${view.assemblyFiles.length} · Components: ${view.components.length} · Unit: ${view.unitSystem}`}
        </small>
        <code className="font-mono text-xs text-muted-foreground">
          {view.draftDigest}
        </code>
      </footer>
      <GeometryDecisionDetails
        view={view}
        partAssets={partAssets}
        mode={mode}
      />
    </div>
  );
}

function geometryPreviewLabel(
  mode: "draft" | "approved" | "sealed" | "historical" | "superseded",
  format: string,
): string {
  if (mode === "sealed") {
    return `Sealed result · exact recorded bytes · ${format.toUpperCase()}`;
  }
  if (mode === "approved") {
    return `Validated proposal · result pending · ${format.toUpperCase()}`;
  }
  if (mode === "superseded") {
    return `Validated historical proposal · superseded · ${format.toUpperCase()}`;
  }
  if (mode === "historical") {
    return `Validated historical proposal · result not in current graph · ${format.toUpperCase()}`;
  }
  return `Draft · geometry proposal · ${format.toUpperCase()} · NOT CANONICAL`;
}

function targetPartSealStatus(
  mode: "draft" | "approved" | "sealed" | "historical" | "superseded",
  elementId: string,
): string {
  if (mode === "sealed") {
    return `Canonical PartDefinition STEP ${elementId}; no assembly/occurrence/placement claim.`;
  }
  if (mode === "approved") {
    return `Reviewed target PartDefinition STEP ${elementId}; canonical seal pending; no assembly/occurrence/placement claim.`;
  }
  if (mode === "draft") {
    return `Proposed target PartDefinition STEP ${elementId}; canonical seal pending; no assembly/occurrence/placement claim.`;
  }
  return `Reviewed target PartDefinition STEP ${elementId}; no assembly/occurrence/placement claim.`;
}

function GeometryDecisionDetails(
  { view, partAssets, mode }: {
    view: GeometryDecisionValid;
    partAssets: Extract<
      ProjectReviewRecord["preview"],
      { kind: "geometry" }
    >["partAssets"];
    mode: "draft" | "approved" | "sealed" | "historical" | "superseded";
  },
): JSX.Element {
  const usageById = new Map(
    view.components.map((component) => [component.elementId, component]),
  );
  const definitionById = new Map(
    view.partDefinitions.map((
      definition,
    ) => [definition.elementId, definition]),
  );
  const partDefinitionIds = new Set(definitionById.keys());
  const targetAssets = view.targetPart
    ? partAssets.filter((asset) =>
      asset.partDefinitionElementId ===
        view.targetPart?.partDefinitionElementId
    )
    : [];
  const previewablePartGlbs = partAssets.filter((asset) =>
    partDefinitionIds.has(asset.partDefinitionElementId) &&
    asset.format === "gltf" && asset.path !== undefined && asset.path.length > 0
  );
  const assemblyGlbDigest = view.assemblyFiles.find((file) =>
    file.format === "gltf"
  )
    ?.digest;
  const hasPreviewablePartGlb = previewablePartGlbs.length > 0 &&
    !isDuplicateSealedGlbCopy(
      assemblyGlbDigest,
      previewablePartGlbs.map((asset) => asset.digest),
    );
  return (
    <>
      {view.targetPart && (
        <section className="divide-y divide-border">
          <header className="pb-3">
            <p className="text-xs font-medium text-muted-foreground">
              Target PartDefinition CAD
            </p>
            <strong className="text-sm font-semibold">
              {targetPartSealStatus(
                mode,
                view.targetPart.partDefinitionElementId,
              )}
            </strong>
            <small className="mt-0.5 block text-xs text-muted-foreground">
              {view.targetPart.label}
            </small>
          </header>
          <dl className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[auto_1fr]">
            <dt className="text-xs text-muted-foreground">Target files</dt>
            <dd className="font-mono text-xs text-muted-foreground">
              {view.targetPart.files.map((file) =>
                `${file.format.toUpperCase()} ${file.name} ${
                  shortDigest(file.digest)
                }`
              ).join(" · ")}
            </dd>
          </dl>
          <div className="divide-y divide-border border-t border-border">
            {targetAssets.map((asset) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                key={`${asset.digest}:${asset.format}`}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {asset.format.toUpperCase()} · {shortDigest(asset.digest)}
                </span>
                {asset.path
                  ? (
                    <a
                      className="text-sm font-medium text-brand hover:underline"
                      href={asset.path}
                      download={`${asset.name}.${
                        asset.format === "gltf" ? "glb" : asset.format
                      }`}
                    >
                      {mode === "sealed"
                        ? "Download sealed file"
                        : mode === "draft"
                        ? "Download proposal file"
                        : "Download reviewed proposal"}
                    </a>
                  )
                  : (
                    <small className="text-xs text-muted-foreground">
                      Exact file unavailable in this projection
                    </small>
                  )}
              </div>
            ))}
          </div>
        </section>
      )}
      {view.schemaVersion === "geometry-manifest/2.0" && (
        <>
          <section className="divide-y divide-border">
            <header className="pb-3">
              <p className="text-xs font-medium text-muted-foreground">
                Independent PartDefinition CAD
              </p>
              <strong className="text-sm font-semibold">
                {view.partDefinitions.length}{" "}
                definition{view.partDefinitions.length === 1 ? "" : "s"}{" "}
                included in this review
              </strong>
            </header>
            {hasPreviewablePartGlb && (
              <PartDefinitionGlbReview
                view={view}
                partAssets={partAssets}
                mode={mode}
              />
            )}
            <div className="grid gap-3 py-3 sm:grid-cols-2">
              {view.partDefinitions.map((definition) => {
                const assets = partAssets.filter((asset) =>
                  asset.partDefinitionElementId === definition.elementId
                );
                return (
                  <article
                    key={definition.elementId}
                    className="divide-y divide-border"
                  >
                    <div className="pb-2">
                      <strong className="text-sm font-medium">
                        {definition.label}
                      </strong>
                      <small className="mt-0.5 block font-mono text-xs text-muted-foreground">
                        SysML PartDefinition · {definition.elementId}
                      </small>
                    </div>
                    {assets.map((asset) => (
                      <div
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                        key={`${asset.digest}:${asset.format}`}
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {asset.format.toUpperCase()} ·{" "}
                          {shortDigest(asset.digest)}
                        </span>
                        {asset.path
                          ? (
                            <a
                              className="text-sm font-medium text-brand hover:underline"
                              href={asset.path}
                              download={`${asset.name}.${
                                asset.format === "gltf" ? "glb" : asset.format
                              }`}
                            >
                              {mode === "sealed"
                                ? "Download sealed file"
                                : mode === "draft"
                                ? "Download proposal file"
                                : "Download reviewed proposal"}
                            </a>
                          )
                          : (
                            <small className="text-xs text-muted-foreground">
                              Exact file unavailable in this projection
                            </small>
                          )}
                      </div>
                    ))}
                  </article>
                );
              })}
            </div>
            {hasPreviewablePartGlb
              ? (
                <p className="pt-3 text-sm text-muted-foreground">
                  These files share the same bundle decision. STEP remains the
                  authoritative per-part CAD; the selected GLB is its visual
                  review derivative. Every exact file stays downloadable above.
                </p>
              )
              : (
                <p className="pt-3 text-sm text-muted-foreground">
                  These files are validated by the same bundle decision. STEP is
                  downloadable for downstream part work; no per-part browser
                  viewer is claimed.
                </p>
              )}
          </section>
          <section className="divide-y divide-border">
            <header className="pb-3">
              <p className="text-xs font-medium text-muted-foreground">
                PartUsage → PartDefinition
              </p>
              <strong className="text-sm font-semibold">
                {view.occurrences.length} placed occurrences
              </strong>
            </header>
            <dl
              className="divide-y divide-border"
              aria-label="Geometry occurrence placements"
            >
              {view.occurrences.map((occurrence) => {
                const usage = usageById.get(occurrence.usageElementId);
                const definition = definitionById.get(
                  occurrence.partDefinitionElementId,
                );
                return (
                  <div
                    key={occurrence.usageElementId}
                    className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2"
                  >
                    <dt>
                      <strong className="text-sm font-medium">
                        {usage?.usageName ?? occurrence.usageElementId}
                      </strong>
                      <small className="mt-0.5 block text-xs text-muted-foreground">
                        {usage?.label ?? "Recorded occurrence"}
                      </small>
                    </dt>
                    <dd>
                      <strong className="text-sm font-medium">
                        {definition?.label ??
                          occurrence.partDefinitionElementId}
                      </strong>
                      <small className="mt-0.5 block font-mono text-xs text-muted-foreground">
                        T [{occurrence.translationMm.join(", ")}] mm · R
                        [{occurrence
                          .rotationDeg.join(", ")}]°
                      </small>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        </>
      )}
      {view.schemaVersion === "geometry-manifest/1.0" && (
        <p className="text-sm text-muted-foreground">
          Legacy assembly-only review · no independent PartDefinition CAD was
          included in this decision.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          Formats, hashes and recorded source
        </summary>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-xs text-muted-foreground">Manifest</dt>
          <dd className="font-mono text-xs text-muted-foreground">
            {view.schemaVersion}
          </dd>
          <dt className="text-xs text-muted-foreground">Source</dt>
          <dd className="font-mono text-xs text-muted-foreground">
            {view.architecture.snapshotId} · r{view.architecture.revision}
          </dd>
          {view.predecessor && (
            <>
              <dt className="text-xs text-muted-foreground">Replaces</dt>
              <dd className="font-mono text-xs text-muted-foreground">
                {view.predecessor.artifactId} ·{" "}
                {shortDigest(view.predecessor.digest)}
              </dd>
            </>
          )}
          <dt className="text-xs text-muted-foreground">
            Architecture SHA-256
          </dt>
          <dd className="font-mono text-xs text-muted-foreground">
            {view.architecture.artifactDigest}
          </dd>
          <dt className="text-xs text-muted-foreground">Requested formats</dt>
          <dd className="text-sm">
            {view.targetPart
              ? `Target PartDefinition ${view.exportFormats.join(", ")}`
              : `Assembly ${view.exportFormats.join(", ")}`}
            {view.partExportFormats.length > 0
              ? ` · Parts ${view.partExportFormats.join(", ")}`
              : ""}
          </dd>
          <dt className="text-xs text-muted-foreground">
            {view.targetPart ? "Assembly claim" : "Assembly"}
          </dt>
          <dd className="font-mono text-xs text-muted-foreground">
            {view.targetPart
              ? "None — target-only PartDefinition capture"
              : view.assemblyFiles.map((file) =>
                `${file.format.toUpperCase()} ${file.name} ${
                  shortDigest(file.digest)
                }`
              ).join(" · ") || "None recorded"}
          </dd>
          {view.partDefinitions.length > 0 && (
            <>
              <dt className="text-xs text-muted-foreground">Parts</dt>
              <dd className="font-mono text-xs text-muted-foreground">
                {view.partDefinitions.map((definition) =>
                  `${definition.label} source ${
                    shortDigest(definition.scriptDigest)
                  }: ${
                    definition.files.map((file) =>
                      `${file.format.toUpperCase()} ${shortDigest(file.digest)}`
                    ).join(", ")
                  }`
                ).join(" · ")}
              </dd>
            </>
          )}
          <dt className="text-xs text-muted-foreground">Script SHA-256</dt>
          <dd className="font-mono text-xs text-muted-foreground">
            {view.scriptDigest}
          </dd>
        </dl>
      </details>
    </>
  );
}

function PartDefinitionGlbReview(
  { view, partAssets, mode }: {
    view: GeometryDecisionValid;
    partAssets: Extract<
      ProjectReviewRecord["preview"],
      { kind: "geometry" }
    >["partAssets"];
    mode: "draft" | "approved" | "sealed" | "historical" | "superseded";
  },
): JSX.Element | null {
  const previews = view.partDefinitions.flatMap((definition) => {
    const asset = partAssets.find((candidate) =>
      candidate.partDefinitionElementId === definition.elementId &&
      candidate.format === "gltf" && candidate.path !== undefined &&
      candidate.path.length > 0
    );
    return asset?.path
      ? [{ definition, asset: { ...asset, path: asset.path } }]
      : [];
  });
  const previewIdentity = previews.map(({ definition, asset }) =>
    `${definition.elementId}:${asset.digest}:${asset.path}`
  ).join("|");
  const [selectedDefinitionId, setSelectedDefinitionId] = useState(
    previews[0]?.definition.elementId,
  );
  useEffect(() => {
    setSelectedDefinitionId(previews[0]?.definition.elementId);
  }, [previewIdentity]);
  const selected =
    previews.find(({ definition }) =>
      definition.elementId === selectedDefinitionId
    ) ??
      previews[0];
  if (!selected) return null;
  const copy = partDefinitionPreviewCopy(mode);

  return (
    <section
      className="divide-y divide-border py-3"
      data-geometry-review-mode={mode}
      aria-label="PartDefinition visual review"
    >
      <header className="pb-3">
        <p className="text-xs font-medium text-muted-foreground">
          PartDefinition visual check
        </p>
        <strong className="text-sm font-semibold">
          {previews.length} preview{previews.length === 1 ? "" : "s"} available
        </strong>
      </header>
      <div className="grid gap-3 pt-3 md:grid-cols-[minmax(10.5rem,0.32fr)_minmax(0,1fr)]">
        <ul
          className="grid max-h-[25rem] gap-1 overflow-y-auto"
          aria-label="PartDefinition GLB previews"
        >
          {previews.map((preview) => {
            const isSelected = preview.definition.elementId ===
              selected.definition.elementId;
            return (
              <li key={preview.definition.elementId}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-auto w-full flex-col items-start py-2",
                    isSelected && "bg-muted",
                  )}
                  data-selected={isSelected ? "true" : "false"}
                  aria-pressed={isSelected}
                  onClick={() =>
                    setSelectedDefinitionId(preview.definition.elementId)}
                >
                  <strong className="text-sm font-medium">
                    {preview.definition.label}
                  </strong>
                  <small className="text-xs text-muted-foreground">
                    SysML PartDefinition
                  </small>
                  <code className="font-mono text-xs text-muted-foreground">
                    GLB · {shortDigest(preview.asset.digest)}
                  </code>
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="divide-y divide-border">
          <p className="pb-2 text-xs font-medium text-muted-foreground">
            {copy.label}
          </p>
          <header className="py-2">
            <strong className="text-sm font-semibold">
              {selected.definition.label}
            </strong>
            <small className="mt-0.5 block font-mono text-xs text-muted-foreground">
              SysML PartDefinition · {selected.definition.elementId}
            </small>
          </header>
          <GltfAssetCanvas
            url={selected.asset.path}
            ariaLabel={`${copy.ariaLabel}: ${selected.definition.label}`}
            loadingLabel={copy.loadingLabel}
            errorLabel={copy.errorLabel}
          />
          <footer className="flex flex-wrap items-baseline justify-between gap-2 pt-2">
            <span className="text-xs text-muted-foreground">
              GLB visual derivative · STEP remains authoritative
            </span>
            <code className="font-mono text-xs text-muted-foreground">
              {shortDigest(selected.asset.digest)}
            </code>
          </footer>
        </div>
      </div>
    </section>
  );
}

function partDefinitionPreviewCopy(
  mode: "draft" | "approved" | "sealed" | "historical" | "superseded",
): {
  label: string;
  ariaLabel: string;
  loadingLabel: string;
  errorLabel: string;
} {
  if (mode === "sealed") {
    return {
      label: "Sealed part presentation · exact recorded GLB",
      ariaLabel: "Interactive sealed PartDefinition presentation",
      loadingLabel: "Loading sealed part presentation…",
      errorLabel: "Sealed part presentation unavailable",
    };
  }
  if (mode === "approved") {
    return {
      label: "Validated part proposal · result pending · GLB",
      ariaLabel: "Interactive validated PartDefinition proposal",
      loadingLabel: "Loading validated part proposal…",
      errorLabel: "Validated part proposal unavailable",
    };
  }
  if (mode === "superseded") {
    return {
      label: "Validated historical part proposal · superseded · GLB",
      ariaLabel: "Interactive superseded PartDefinition proposal",
      loadingLabel: "Loading superseded part proposal…",
      errorLabel: "Superseded part proposal unavailable",
    };
  }
  if (mode === "historical") {
    return {
      label:
        "Validated historical part proposal · result not in current graph · GLB",
      ariaLabel: "Interactive historical PartDefinition proposal",
      loadingLabel: "Loading historical part proposal…",
      errorLabel: "Historical part proposal unavailable",
    };
  }
  return {
    label: "Draft part proposal · GLB · not canonical",
    ariaLabel: "Interactive proposed PartDefinition geometry",
    loadingLabel: "Loading proposed part geometry…",
    errorLabel: "Proposed part geometry unavailable",
  };
}

function shortDigest(digest: string): string {
  return `${digest.slice(0, 10)}…${digest.slice(-8)}`;
}

function StlDraftCanvas({ url }: { url: string }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const resetView = useRef<(() => void) | undefined>(undefined);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let geometry: THREE.BufferGeometry | undefined;
    let material: THREE.MeshStandardMaterial | undefined;
    setState("loading");

    const viewport = createThreeOrbitViewport(container);
    const { scene } = viewport;
    scene.background = new THREE.Color(0xf2f4f6);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9aa98, 2.4));
    const key = new THREE.DirectionalLight(0xfff8ed, 3.4);
    key.position.set(180, 220, 260);
    scene.add(key);

    new STLLoader().load(
      url,
      (loaded) => {
        if (viewport.isDisposed()) {
          loaded.dispose();
          return;
        }
        geometry = loaded;
        geometry.computeVertexNormals();
        geometry.center();
        geometry.computeBoundingSphere();
        material = new THREE.MeshStandardMaterial({
          color: 0x6f7f79,
          metalness: 0.08,
          roughness: 0.72,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        scene.add(mesh);
        const radius = Math.max(geometry.boundingSphere?.radius ?? 50, 1);
        resetView.current = () => viewport.fitRadius(radius);
        resetView.current();
        setState("ready");
      },
      undefined,
      () => !viewport.isDisposed() && setState("error"),
    );

    viewport.start();

    return () => {
      viewport.dispose(() => {
        geometry?.dispose();
        material?.dispose();
        resetView.current = undefined;
      });
    };
  }, [url]);

  return (
    <div className="geometry-draft-canvas-shell">
      <div className="geometry-draft-canvas" ref={host} />
      <div
        className={cn(
          "pointer-events-none absolute text-xs text-muted-foreground",
          state === "loading" || state === "error"
            ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            : "bottom-2 right-2.5",
          state === "error" && "text-destructive",
        )}
        data-state={state}
      >
        {state === "loading"
          ? "Loading draft mesh…"
          : state === "error"
          ? "Draft mesh unavailable"
          : "Drag to orbit · scroll to zoom"}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute right-2.5 top-2.5"
        disabled={state !== "ready"}
        onClick={() => resetView.current?.()}
      >
        Fit / reset
      </Button>
    </div>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
