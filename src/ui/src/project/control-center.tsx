import { CARD_SURFACE } from "../ui/cockpit.tsx";
import type { JSX } from "react";
import { useState } from "react";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import { McpAppFrame } from "../thread/mcp-app-frame.tsx";
import type {
  ThreadViewerSession,
  ThreadViewerSessionsProjection,
} from "../thread/viewer-sessions-client.ts";
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
              ? "Open the exact whole MCP App in Activity."
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
        "Open the exact whole MCP App. Sign the decision in the paired conversation.",
      action: "Open exact App",
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
  project,
  viewerSessions,
  onOpenEvidence,
  initiallyOpen = false,
}: {
  record: ProjectReviewRecord;
  project?: EngineeringProjectSnapshot;
  viewerSessions?: ThreadViewerSessionsProjection;
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
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      aria-label={`Review record: ${record.title}`}
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={activityReviewBadgeVariant(status)}>
              {activityReviewStatusLabel(status)}
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
          {open ? "Hide record" : "Open record"}
        </span>
      </summary>
      <div className="space-y-4 border-t border-border p-4">
        <p className="text-sm text-muted-foreground">{record.summary}</p>
        <ReviewRecordSummary record={record} />
        {project && (
          <ProjectReviewAppHandoff
            project={project}
            record={record}
            projection={viewerSessions}
          />
        )}
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
            : record.resultEvidence
            ? "Validated review attached to this exact published feed fact."
            : "Validated review. No exact published result is recorded yet."}
        </p>
      </div>
    </details>
  );
}

export type ProjectReviewAppResolution =
  | { readonly status: "unavailable" }
  | { readonly status: "ambiguous"; readonly count: number }
  | { readonly status: "available"; readonly session: ThreadViewerSession };

/** Resolve only the exact registered whole App for one pending Project review. */
export function resolveProjectReviewApp(
  project: EngineeringProjectSnapshot,
  record: ProjectReviewRecord,
  projection: ThreadViewerSessionsProjection | undefined,
): ProjectReviewAppResolution {
  if (record.state !== "needs-review") return { status: "unavailable" };
  const anchor = exactProjectReviewAnchor(project, record);
  if (!anchor || !projection) return { status: "unavailable" };
  if (
    projection.basis.projectId !== project.project.id ||
    projection.basis.projectRevision !== project.revision ||
    projection.basis.subjectId !== project.project.subjectId
  ) return { status: "unavailable" };

  const sessions = projection.sessions.filter((session) =>
    session.anchor.kind === "project-review" &&
    session.anchor.id === anchor.id &&
    session.anchor.revision === anchor.revision &&
    session.anchor.fingerprint === anchor.fingerprint
  );
  if (sessions.length === 1 && sessions[0]) {
    return { status: "available", session: sessions[0] };
  }
  if (sessions.length > 1) {
    return { status: "ambiguous", count: sessions.length };
  }
  return { status: "unavailable" };
}

/** Read-only handoff; all review presentation remains inside the exact App. */
export function ProjectReviewAppHandoff({
  project,
  record,
  projection,
}: {
  project: EngineeringProjectSnapshot;
  record: ProjectReviewRecord;
  projection?: ThreadViewerSessionsProjection;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (record.state !== "needs-review") return null;
  const resolution = resolveProjectReviewApp(project, record, projection);
  return (
    <section
      className="space-y-3 rounded-md border border-border bg-background/60 p-3"
      data-surface="project-review-mcp-app"
      data-app-resolution={resolution.status}
      aria-label={`Exact ${reviewKindLabel(record.id)} review App`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block text-sm font-medium">
            Exact review App
          </strong>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Documentary and read only. Decisions remain in the paired
            conversation.
          </p>
        </div>
        {resolution.status === "available"
          ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen((current) => !current)}
            >
              {open ? "Close exact App" : "Open exact App"}
            </Button>
          )
          : (
            <Badge variant="secondary">
              {resolution.status === "ambiguous"
                ? `ambiguous · ${resolution.count}`
                : "unavailable"}
            </Badge>
          )}
      </div>
      {resolution.status === "available" && open && (
        <McpAppFrame
          className="min-h-[28rem] w-full rounded-md border border-border bg-background"
          session={resolution.session}
        />
      )}
      {resolution.status !== "available" && (
        <p className="text-xs text-muted-foreground" role="status">
          {resolution.status === "ambiguous"
            ? "Multiple exact bindings match this review; Digital Thread will not choose one."
            : "No exact whole-App binding is registered for this review revision and fingerprint."}
        </p>
      )}
    </section>
  );
}

export function ProjectReviewAppHandoffs({
  project,
  records,
  projection,
}: {
  project: EngineeringProjectSnapshot;
  records: readonly ProjectReviewRecord[];
  projection?: ThreadViewerSessionsProjection;
}): JSX.Element | null {
  const pending = records.filter((record) => record.state === "needs-review");
  if (pending.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Pending exact review Apps">
      {pending.map((record) => (
        <ProjectReviewAppHandoff
          key={`${record.id}:${record.decision?.id ?? record.anchorId}`}
          project={project}
          record={record}
          projection={projection}
        />
      ))}
    </section>
  );
}

function exactProjectReviewAnchor(
  project: EngineeringProjectSnapshot,
  record: ProjectReviewRecord,
):
  | {
    readonly id: string;
    readonly revision: number;
    readonly fingerprint: string;
  }
  | undefined {
  if (record.id === "brief") {
    const review = project.framing?.proposalReview;
    if (review?.status !== "pending") return undefined;
    return {
      id: review.briefSnapshotId,
      revision: project.revision,
      fingerprint:
        `${review.inputFingerprint.algorithm}:${review.inputFingerprint.digest}`,
    };
  }
  const decision = record.decision;
  if (decision?.status !== "proposed" || !decision.inputFingerprint) {
    return undefined;
  }
  return {
    id: decision.id,
    revision: project.revision,
    fingerprint:
      `${decision.inputFingerprint.algorithm}:${decision.inputFingerprint.digest}`,
  };
}

/**
 * Generic Activity inspector only.
 *
 * Domain representations belong to their exact whole MCP App. Activity keeps
 * the durable record and its evidence link, but never reconstructs CAD, SysML,
 * requirements, simulation or provider UI from Thread fields.
 */
export function ReviewRecordSummary(
  { record }: { record: ProjectReviewRecord },
): JSX.Element {
  return (
    <section
      className="rounded-md border border-border bg-muted/30 px-3 py-3"
      aria-label="Generic review record"
    >
      <strong className="block text-sm font-medium">
        {reviewKindLabel(record.id)} record
      </strong>
      <p className="mt-1 text-xs text-muted-foreground">
        Domain presentation is owned by the exact whole MCP App registered for
        this exact Project-review basis. Open it from the App handoff in
        Activity; this generic record stays read-only and does not recreate the
        provider view.
      </p>
    </section>
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
