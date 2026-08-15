/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
} from "../../../domain/project/engineering-project.ts";
import type { ProjectReviewIntentAction } from "../../../domain/project/project-review-intent.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import { type GeometryDecisionValid } from "../thread/geometry-decision-model.ts";
import { GltfAssetCanvas } from "../thread/gltf-asset-canvas.tsx";
import { createThreeOrbitViewport } from "../geometry/three-orbit-viewport.ts";
import {
  activityReviewStatus,
  buildProjectReviewRecords,
  currentProjectReview,
  type ProjectReviewKind,
  type ProjectReviewRecord,
} from "./review-decision-model.ts";
import { buildArchitectureBindingRows } from "./review-architecture-model.ts";
import {
  type ActivityReviewDisplayStatus,
  activityReviewDisplayStatusLabel,
  effectiveActivityReviewStatus,
  normalizeReviewIntentComment,
  REVIEW_INTENT_COMMENT_MAX_LENGTH,
  type ReviewIntentTransmissionState,
} from "./review-intent-model.ts";

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
 * The overview remains a compact handoff. Exact previews and the bounded
 * reviewer-intent composer live in the chronological Activity feed.
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
    <section
      class="decision-center"
      data-surface="inbox"
      aria-labelledby="review-notifications-title-inbox"
    >
      <header class="decision-center-header">
        <div class="decision-center-index" aria-hidden="true">RN</div>
        <div>
          <p>REVIEW NOW</p>
          <h3 id="review-notifications-title-inbox">
            {needsReviewCount > 0
              ? `${needsReviewCount} exact proposal${
                needsReviewCount === 1 ? " is" : "s are"
              } ready`
              : "No proposal is waiting for review"}
          </h3>
          <span>
            {nextReview
              ? "Open Activity to inspect and respond to each exact proposal."
              : "Published review records remain available in Activity."}
          </span>
        </div>
        <dl class="decision-center-meter">
          <div data-tone={nextReview ? "attention" : "quiet"}>
            <dt>To review</dt>
            <dd>{needsReviewCount}</dd>
          </div>
          <div data-tone={pendingResultCount > 0 ? "preparing" : "quiet"}>
            <dt>Result pending</dt>
            <dd>{pendingResultCount}</dd>
          </div>
          <div data-tone={revisionRequestedCount > 0 ? "attention" : "quiet"}>
            <dt>Revision requested</dt>
            <dd>{revisionRequestedCount}</dd>
          </div>
        </dl>
      </header>

      <ReviewInboxHandoff
        nextReview={nextReview}
        pendingResultCount={pendingResultCount}
        revisionRequestedCount={revisionRequestedCount}
        onOpenActivity={onOpenActivity}
        onOpenReview={onOpenReview}
      />
    </section>
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
  const state = nextReview
    ? {
      tone: "proposed",
      marker: "REVIEW IN ACTIVITY",
      title: nextReview.title,
      detail:
        "Inspect the exact preview, then validate it or request a revision from its feed card.",
      action: "Inspect exact preview",
      icon: "!",
    }
    : pendingResultCount > 0
    ? {
      tone: "required",
      marker: "APPROVED · RESULT PENDING",
      title: "A reviewed operation has not published its result yet",
      detail:
        "Nothing is needed in the cockpit. Activity will show the exact result if and when it is published.",
      action: "See activity",
      icon: "···",
    }
    : revisionRequestedCount > 0
    ? {
      tone: "required",
      marker: "REVISION REQUESTED",
      title: "A proposal was returned for revision",
      detail:
        "The durable decision record does not by itself prove that an agent run is active.",
      action: "See activity",
      icon: "↺",
    }
    : {
      tone: "approved",
      marker: "NO QUESTION WAITING",
      title: "No project decision needs discussion right now",
      detail:
        "Use Activity to follow the project. Your paired conversation remains the place to clarify or change intent.",
      action: "See activity",
      icon: "✓",
    };

  return (
    <section
      class="decision-review-brief"
      data-state={state.tone}
      aria-label="Project signal"
    >
      <span aria-hidden="true">{state.icon}</span>
      <div>
        <p>{state.marker}</p>
        <strong>{state.title}</strong>
        <small>{state.detail}</small>
      </div>
      <button
        type="button"
        class="decision-secondary-button"
        onClick={() =>
          nextReview ? onOpenReview?.(nextReview.id) : onOpenActivity?.()}
        disabled={nextReview ? !onOpenReview : !onOpenActivity}
      >
        {state.action}
      </button>
    </section>
  );
}

/** One human-review event rendered inside the chronological Activity rail. */
export function ActivityReviewFeedCard({
  record,
  onOpenEvidence,
  transmissionState = { kind: "idle" },
  onSubmitIntent,
  onRetryIntent,
  onRefreshIntent,
  initiallyOpen = false,
}: {
  record: ProjectReviewRecord;
  onOpenEvidence?: (reference: EngineeringThreadEntityRef) => void;
  transmissionState?: ReviewIntentTransmissionState;
  onSubmitIntent?: (
    action: ProjectReviewIntentAction,
    comment?: string,
  ) => void | Promise<void>;
  onRetryIntent?: () => void | Promise<void>;
  onRefreshIntent?: () => void | Promise<void>;
  initiallyOpen?: boolean;
}): JSX.Element | null {
  const status = activityReviewStatus(record);
  const [open, setOpen] = useState(
    initiallyOpen || status === "to-review" ||
      status === "revision-requested",
  );
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string>();
  const [composerMode, setComposerMode] = useState<"choice" | "revision">(
    "choice",
  );
  const decisionId = record.decision?.id;
  const digest = record.decision?.inputFingerprint?.digest;
  const approvalId = record.approvalId;
  useEffect(() => {
    setComment("");
    setCommentError(undefined);
    setComposerMode("choice");
  }, [decisionId, digest, approvalId]);
  if (!status) return null;
  const displayStatus = effectiveActivityReviewStatus(
    status,
    transmissionState,
  )!;
  const commentId = `${record.anchorId}-review-comment`;
  const commentHelpId = `${commentId}-help`;
  const commentErrorId = `${commentId}-error`;
  const canCompose = status === "to-review" && decisionId !== undefined &&
    digest !== undefined && approvalId !== undefined &&
    onSubmitIntent !== undefined;
  const isSending = transmissionState.kind === "sending";
  const commentLength = [...comment].length;
  const canSendRevision = comment.trim().length > 0 &&
    commentLength <= REVIEW_INTENT_COMMENT_MAX_LENGTH;
  const send = (
    action: ProjectReviewIntentAction,
    submittedComment?: string,
  ) => {
    let exactComment: string | undefined;
    try {
      exactComment = normalizeReviewIntentComment(action, submittedComment);
    } catch (error) {
      setCommentError(
        error instanceof Error ? error.message : "Check the review comment.",
      );
      return;
    }
    setCommentError(undefined);
    void Promise.resolve(onSubmitIntent?.(action, exactComment)).catch(
      (error: unknown) => {
        setCommentError(
          error instanceof Error
            ? error.message
            : "The review intent could not be sent.",
        );
      },
    );
  };
  return (
    <details
      class="thread-feed-review-card"
      data-review-status={displayStatus}
      data-canonical-review-status={status}
      data-representation={record.representation}
      data-superseded={record.supersededBy ? "true" : "false"}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      aria-label={`Review record: ${record.title}`}
    >
      <summary>
        <span class="thread-feed-review-mark" aria-hidden="true">
          {reviewStatusIcon(displayStatus)}
        </span>
        <span class="thread-feed-review-copy">
          <small>
            {activityReviewDisplayStatusLabel(displayStatus)}
            {record.supersededBy ? " · Superseded" : ""} ·{" "}
            {reviewKindLabel(record.id)}
          </small>
          <strong>{record.title}</strong>
          <span>{record.question}</span>
        </span>
        <span class="thread-feed-review-toggle">
          {open ? "Hide preview" : "Open exact preview"}
        </span>
      </summary>
      <div class="thread-feed-review-body">
        {record.supersededBy && (
          <aside class="decision-review-superseded" role="note">
            <div>
              <strong>Superseded by the current geometry review</strong>
              <span>{record.supersededBy.title}</span>
            </div>
            <a href={record.supersededBy.href}>Open replacement</a>
          </aside>
        )}
        <p class="decision-notification-summary">{record.summary}</p>
        <ReviewBusinessPreview record={record} />
        {canCompose && (
          <section
            class="decision-review-composer"
            aria-labelledby={`${commentId}-title`}
            aria-busy={isSending}
          >
            <header>
              <div>
                <small>REVIEW THIS EXACT PROPOSAL</small>
                <strong id={`${commentId}-title`}>
                  Send your intent to the paired agent
                </strong>
              </div>
              <ReviewIntentTransmissionBadge state={transmissionState} />
            </header>
            {transmissionState.kind === "idle" ||
                (transmissionState.kind === "error" &&
                  transmissionState.retryIntent !== undefined)
              ? (
                <div
                  class="decision-review-composer-fields"
                  data-composer-mode={composerMode}
                >
                  {transmissionState.kind === "error" && (
                    <div
                      class="decision-review-transmission"
                      data-transmission-state="error"
                      role="alert"
                    >
                      <strong>Send failed</strong>
                      <span>{transmissionState.message}</span>
                      {transmissionState.retryIntent && onRetryIntent && (
                        <button
                          type="button"
                          onClick={() => void onRetryIntent()}
                        >
                          Retry exact send
                        </button>
                      )}
                    </div>
                  )}
                  {commentError && (
                    <p
                      id={commentErrorId}
                      class="decision-review-comment-error"
                      role="alert"
                    >
                      {commentError}
                    </p>
                  )}
                  {composerMode === "choice"
                    ? (
                      <>
                        <p class="decision-review-choice-copy">
                          Validate this exact proposal, or describe what must
                          change.
                        </p>
                        <div
                          class="decision-review-submit-actions"
                          role="group"
                          aria-label="Review response"
                        >
                          <button
                            type="button"
                            class="decision-review-validate-button"
                            disabled={isSending}
                            onClick={() => send("validate", undefined)}
                          >
                            Validate
                          </button>
                          <button
                            type="button"
                            class="decision-review-revision-button"
                            disabled={isSending}
                            onClick={() => {
                              setCommentError(undefined);
                              setComposerMode("revision");
                            }}
                          >
                            Request revision
                          </button>
                        </div>
                      </>
                    )
                    : (
                      <>
                        <label for={commentId}>
                          What should change? <span>Required</span>
                        </label>
                        <textarea
                          id={commentId}
                          value={comment}
                          rows={3}
                          required
                          aria-required="true"
                          placeholder="Describe the exact revision needed."
                          aria-describedby={`${commentHelpId}${
                            commentError ? ` ${commentErrorId}` : ""
                          }`}
                          aria-invalid={commentError ? "true" : undefined}
                          onInput={(event) => {
                            setComment(event.currentTarget.value);
                            if (commentError) setCommentError(undefined);
                          }}
                        />
                        <div class="decision-review-comment-meta">
                          <small id={commentHelpId}>
                            This text is sent exactly as written.
                          </small>
                          <small>
                            {commentLength} / {REVIEW_INTENT_COMMENT_MAX_LENGTH}
                          </small>
                        </div>
                        <div
                          class="decision-review-submit-actions"
                          role="group"
                          aria-label="Revision request"
                        >
                          <button
                            type="button"
                            class="decision-review-revision-button"
                            disabled={isSending || !canSendRevision}
                            onClick={() => send("request-revision", comment)}
                          >
                            Send revision request
                          </button>
                          <button
                            type="button"
                            class="decision-review-back-button"
                            disabled={isSending}
                            onClick={() => {
                              setComment("");
                              setCommentError(undefined);
                              setComposerMode("choice");
                            }}
                          >
                            Back
                          </button>
                        </div>
                      </>
                    )}
                </div>
              )
              : (
                <ReviewIntentTransmissionNotice
                  state={transmissionState}
                  onRefresh={onRefreshIntent}
                />
              )}
          </section>
        )}
        {record.outcome && (
          <dl
            class="decision-review-outcome"
            aria-label="Recorded review outcome"
          >
            {record.outcome.rationale && (
              <div>
                <dt>Rationale</dt>
                <dd>{record.outcome.rationale}</dd>
              </div>
            )}
            {record.outcome.decidedBy && (
              <div>
                <dt>Decided by</dt>
                <dd>{record.outcome.decidedBy}</dd>
              </div>
            )}
            {record.outcome.decidedAt && (
              <div>
                <dt>Decided</dt>
                <dd>{formatDateTime(record.outcome.decidedAt)}</dd>
              </div>
            )}
          </dl>
        )}
        <dl class="decision-notification-scope">
          <div>
            <dt>Review</dt>
            <dd>{activityReviewDisplayStatusLabel(displayStatus)}</dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>
              {record.decision?.inputFingerprint
                ? "Exact input bound"
                : "Record only"}
            </dd>
          </div>
          <div>
            <dt>Recorded</dt>
            <dd>
              {record.recordedAt ? formatDateTime(record.recordedAt) : "—"}
            </dd>
          </div>
        </dl>
        {record.resultEvidence && onOpenEvidence && (
          <div class="decision-review-actions">
            <button
              type="button"
              class="decision-secondary-button"
              onClick={() => onOpenEvidence(record.resultEvidence!)}
            >
              Trace exact result
            </button>
          </div>
        )}
        <small class="decision-review-guidance">
          {status === "to-review" && canCompose
            ? "A sent intent is not a validation. This card changes only when the canonical project records the signed decision."
            : status === "to-review" || status === "revision-requested"
            ? "This record has no browser decision action for its scope; continue in the paired conversation."
            : record.supersededBy
            ? "Validated historical review. The signed successor above is the current geometry result."
            : record.resultEvidence
            ? "Validated review attached to this exact published feed fact."
            : "Validated review. No exact published result is recorded yet."}
        </small>
      </div>
    </details>
  );
}

function ReviewIntentTransmissionBadge(
  { state }: { state: ReviewIntentTransmissionState },
): JSX.Element | null {
  if (state.kind === "idle") return null;
  const label = state.kind === "sending"
    ? "Sending"
    : state.kind === "queued"
    ? "Sent"
    : state.kind === "acknowledged"
    ? "Received"
    : state.kind === "stale"
    ? "Stale"
    : "Send failed";
  return (
    <span
      class="decision-review-transmission-badge"
      data-transmission-state={state.kind}
      aria-label={state.kind === "queued"
        ? "Sent to review queue · agent receipt pending"
        : state.kind === "acknowledged"
        ? "Received by agent · signed decision pending"
        : label}
    >
      {label}
    </span>
  );
}

function ReviewIntentTransmissionNotice({
  state,
  onRefresh,
}: {
  state: ReviewIntentTransmissionState;
  onRefresh?: () => void | Promise<void>;
}): JSX.Element | null {
  if (state.kind === "idle") return null;
  if (state.kind === "sending") {
    return (
      <p class="decision-review-transmission" role="status" aria-live="polite">
        Sending review intent…
      </p>
    );
  }
  if (state.kind === "queued" || state.kind === "acknowledged") {
    return (
      <div
        class="decision-review-transmission"
        data-transmission-state={state.kind}
        role="status"
        aria-live="polite"
      >
        <strong>{state.kind === "queued" ? "Sent" : "Received"}</strong>
        <span>
          {state.kind === "queued"
            ? "Waiting for agent receipt."
            : "Waiting for signed decision."}
        </span>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div
        class="decision-review-transmission"
        data-transmission-state="error"
        role="alert"
      >
        <strong>Refresh required</strong>
        <span>{state.message}</span>
        {onRefresh && (
          <button type="button" onClick={() => void onRefresh()}>
            Refresh preview
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      class="decision-review-transmission"
      data-transmission-state="stale"
      role="alert"
    >
      <strong>Proposal changed</strong>
      <span>{state.message}</span>
      {onRefresh && (
        <button type="button" onClick={() => void onRefresh()}>
          Refresh preview
        </button>
      )}
    </div>
  );
}

export function ReviewBusinessPreview(
  { record }: { record: ProjectReviewRecord },
): JSX.Element {
  const preview = record.preview;
  if (preview.kind === "unavailable") {
    return (
      <div class="review-preview-unavailable" role="status">
        <strong>Preview unavailable</strong>
        <span>{preview.reason}</span>
      </div>
    );
  }
  if (preview.kind === "brief") {
    return (
      <section class="review-business-preview review-brief-preview">
        <header>
          <span>ENGINEERING BRIEF · REVISION {preview.brief.revision}</span>
          <strong>{preview.brief.items.length} explicit statements</strong>
        </header>
        <ul>
          {preview.brief.items.map((item) => (
            <li key={item.id}>
              <small>{item.kind.replaceAll("-", " ")}</small>
              <span>{item.statement}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (preview.kind === "architecture") {
    const bindingRows = buildArchitectureBindingRows(preview.value);
    return (
      <section class="review-business-preview review-architecture-preview">
        <header>
          <span>
            PARTDEFINITION BINDING DIAGRAM · {preview.value.packageName}
          </span>
          <strong>{preview.value.system.name}</strong>
        </header>
        <ol>
          {bindingRows.map(({ component, depth }, index) => (
            <li
              key={`${component.parentName}:${component.usageName}:${index}`}
              style={{ paddingInlineStart: `${12 + depth * 22}px` }}
              aria-label={`Nesting level ${
                depth + 1
              }: ${component.parentName} contains usage ${component.usageName} typed by ${component.name}`}
            >
              <code>{component.parentName}</code>
              <span aria-hidden="true">→</span>
              <strong>{component.usageName}</strong>
              <small>: {component.name}</small>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  if (preview.kind === "requirements") {
    return (
      <section class="review-business-preview review-requirements-preview">
        <header>
          <span>REQUIREMENTS PROPOSAL · TARGET</span>
          <strong>{preview.value.containerComponent}</strong>
        </header>
        <ul>
          {preview.value.requirements.map((requirement) => (
            <li key={requirement.metric}>
              <div>
                <strong>{requirement.name}</strong>
                <code>{requirement.metric}</code>
              </div>
              <span>
                {requirement.operator} {requirement.threshold.value}{" "}
                {requirement.threshold.unit}
              </span>
              <small>Target only · no measurement</small>
            </li>
          ))}
        </ul>
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

function reviewStatusIcon(status: ActivityReviewDisplayStatus): string {
  if (status === "to-review") return "!";
  if (status === "sending") return "···";
  if (status === "sent") return "↑";
  if (status === "received") return "↓";
  if (status === "validated") return "✓";
  return "↺";
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
  if (!path || !format) {
    return (
      <div class="geometry-review-preview" data-geometry-review-mode={mode}>
        <p class="geometry-draft-no-preview">
          No previewable {mode === "sealed" ? "sealed" : "reviewed"}{" "}
          assembly is available (
          {view.assemblyFiles.length} file
          {view.assemblyFiles.length === 1 ? "" : "s"} present).
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
      <div
        class="geometry-draft-viewer geometry-draft-viewer--text"
        data-geometry-review-mode={mode}
      >
        <p class="geometry-draft-label">{geometryPreviewLabel(mode, format)}</p>
        <p>
          {mode === "sealed"
            ? "Exact sealed STEP bytes are recorded; this format has no in-browser preview."
            : mode === "approved"
            ? "The STEP proposal was validated; its sealed result is still pending."
            : "STEP format — no in-browser preview. Review the available assembly preview with the agent before approving."}
        </p>
        <code class="geometry-draft-digest">{view.draftDigest}</code>
        <GeometryDecisionDetails
          view={view}
          partAssets={partAssets}
          mode={mode}
        />
      </div>
    );
  }

  return (
    <div class="geometry-draft-viewer" data-geometry-review-mode={mode}>
      <p class="geometry-draft-label">
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
      <footer class="geometry-draft-footer">
        <small>
          Assembly files: {view.assemblyFiles.length} · Components:{" "}
          {view.components.length} · Unit: {view.unitSystem}
        </small>
        <code class="geometry-draft-digest">{view.draftDigest}</code>
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
    return `SEALED RESULT · EXACT RECORDED BYTES · ${format.toUpperCase()}`;
  }
  if (mode === "approved") {
    return `VALIDATED PROPOSAL · RESULT PENDING · ${format.toUpperCase()}`;
  }
  if (mode === "superseded") {
    return `VALIDATED HISTORICAL PROPOSAL · SUPERSEDED · ${format.toUpperCase()}`;
  }
  if (mode === "historical") {
    return `VALIDATED HISTORICAL PROPOSAL · RESULT NOT IN CURRENT GRAPH · ${format.toUpperCase()}`;
  }
  return `DRAFT · GEOMETRY PROPOSAL · ${format.toUpperCase()} · NOT CANONICAL`;
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
  const hasPreviewablePartGlb = partAssets.some((asset) =>
    partDefinitionIds.has(asset.partDefinitionElementId) &&
    asset.format === "gltf" && asset.path !== undefined && asset.path.length > 0
  );
  return (
    <>
      {view.schemaVersion === "geometry-manifest/2.0" && (
        <>
          <section class="geometry-part-artifacts">
            <header>
              <span>INDEPENDENT PARTDEFINITION CAD</span>
              <strong>
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
            <div class="geometry-part-artifact-grid">
              {view.partDefinitions.map((definition) => {
                const assets = partAssets.filter((asset) =>
                  asset.partDefinitionElementId === definition.elementId
                );
                return (
                  <article key={definition.elementId}>
                    <div>
                      <strong>{definition.label}</strong>
                      <small>
                        SysML PartDefinition · {definition.elementId}
                      </small>
                    </div>
                    {assets.map((asset) => (
                      <div
                        class="geometry-part-artifact-file"
                        key={`${asset.digest}:${asset.format}`}
                      >
                        <span>
                          {asset.format.toUpperCase()} ·{" "}
                          {shortDigest(asset.digest)}
                        </span>
                        {asset.path
                          ? (
                            <a
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
                            <small>
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
                <p>
                  These files share the same bundle decision. STEP remains the
                  authoritative per-part CAD; the selected GLB is its visual
                  review derivative. Every exact file stays downloadable above.
                </p>
              )
              : (
                <p>
                  These files are validated by the same bundle decision. STEP is
                  downloadable for downstream part work; no per-part browser
                  viewer is claimed.
                </p>
              )}
          </section>
          <section class="geometry-occurrence-table">
            <header>
              <span>PARTUSAGE → PARTDEFINITION</span>
              <strong>{view.occurrences.length} placed occurrences</strong>
            </header>
            <div role="table" aria-label="Geometry occurrence placements">
              {view.occurrences.map((occurrence) => {
                const usage = usageById.get(occurrence.usageElementId);
                const definition = definitionById.get(
                  occurrence.partDefinitionElementId,
                );
                return (
                  <div
                    role="row"
                    key={occurrence.usageElementId}
                  >
                    <span role="cell">
                      <strong>
                        {usage?.usageName ?? occurrence.usageElementId}
                      </strong>
                      <small>{usage?.label ?? "Recorded occurrence"}</small>
                    </span>
                    <i aria-hidden="true">→</i>
                    <span role="cell">
                      <strong>
                        {definition?.label ??
                          occurrence.partDefinitionElementId}
                      </strong>
                      <small>
                        T [{occurrence.translationMm.join(", ")}] mm · R
                        [{occurrence
                          .rotationDeg.join(", ")}]°
                      </small>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
      {view.schemaVersion === "geometry-manifest/1.0" && (
        <p class="geometry-legacy-scope">
          Legacy assembly-only review · no independent PartDefinition CAD was
          included in this decision.
        </p>
      )}
      <details class="geometry-review-trace">
        <summary>Formats, hashes and recorded source</summary>
        <dl>
          <div>
            <dt>Manifest</dt>
            <dd>{view.schemaVersion}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {view.architecture.snapshotId} · r{view.architecture.revision}
            </dd>
          </div>
          {view.predecessor && (
            <div>
              <dt>Replaces</dt>
              <dd>
                {view.predecessor.artifactId} ·{" "}
                <code>{shortDigest(view.predecessor.digest)}</code>
              </dd>
            </div>
          )}
          <div>
            <dt>Architecture SHA-256</dt>
            <dd>
              <code>{view.architecture.artifactDigest}</code>
            </dd>
          </div>
          <div>
            <dt>Requested formats</dt>
            <dd>
              Assembly {view.exportFormats.join(", ")}
              {view.partExportFormats.length > 0
                ? ` · Parts ${view.partExportFormats.join(", ")}`
                : ""}
            </dd>
          </div>
          <div>
            <dt>Assembly</dt>
            <dd>
              {view.assemblyFiles.map((file) =>
                `${file.format.toUpperCase()} ${file.name} ${
                  shortDigest(file.digest)
                }`
              ).join(" · ") || "None recorded"}
            </dd>
          </div>
          {view.partDefinitions.length > 0 && (
            <div>
              <dt>Parts</dt>
              <dd>
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
            </div>
          )}
          <div>
            <dt>Script SHA-256</dt>
            <dd>
              <code>{view.scriptDigest}</code>
            </dd>
          </div>
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
      class="geometry-part-visual-review"
      data-geometry-review-mode={mode}
      aria-label="PartDefinition visual review"
    >
      <header>
        <span>PARTDEFINITION VISUAL CHECK</span>
        <strong>
          {previews.length} preview{previews.length === 1 ? "" : "s"} available
        </strong>
      </header>
      <div class="geometry-part-visual-layout">
        <ul
          class="geometry-part-visual-list"
          aria-label="PartDefinition GLB previews"
        >
          {previews.map((preview) => {
            const isSelected = preview.definition.elementId ===
              selected.definition.elementId;
            return (
              <li key={preview.definition.elementId}>
                <button
                  type="button"
                  data-selected={isSelected ? "true" : "false"}
                  aria-pressed={isSelected}
                  onClick={() =>
                    setSelectedDefinitionId(preview.definition.elementId)}
                >
                  <strong>{preview.definition.label}</strong>
                  <small>SysML PartDefinition</small>
                  <code>GLB · {shortDigest(preview.asset.digest)}</code>
                </button>
              </li>
            );
          })}
        </ul>
        <div class="geometry-part-visual-current">
          <p class="geometry-part-visual-label">{copy.label}</p>
          <header>
            <strong>{selected.definition.label}</strong>
            <small>
              SysML PartDefinition · {selected.definition.elementId}
            </small>
          </header>
          <GltfAssetCanvas
            url={selected.asset.path}
            ariaLabel={`${copy.ariaLabel}: ${selected.definition.label}`}
            loadingLabel={copy.loadingLabel}
            errorLabel={copy.errorLabel}
          />
          <footer>
            <span>GLB visual derivative · STEP remains authoritative</span>
            <code>{shortDigest(selected.asset.digest)}</code>
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
      label: "SEALED PART PRESENTATION · EXACT RECORDED GLB",
      ariaLabel: "Interactive sealed PartDefinition presentation",
      loadingLabel: "Loading sealed part presentation…",
      errorLabel: "Sealed part presentation unavailable",
    };
  }
  if (mode === "approved") {
    return {
      label: "VALIDATED PART PROPOSAL · RESULT PENDING · GLB",
      ariaLabel: "Interactive validated PartDefinition proposal",
      loadingLabel: "Loading validated part proposal…",
      errorLabel: "Validated part proposal unavailable",
    };
  }
  if (mode === "superseded") {
    return {
      label: "VALIDATED HISTORICAL PART PROPOSAL · SUPERSEDED · GLB",
      ariaLabel: "Interactive superseded PartDefinition proposal",
      loadingLabel: "Loading superseded part proposal…",
      errorLabel: "Superseded part proposal unavailable",
    };
  }
  if (mode === "historical") {
    return {
      label:
        "VALIDATED HISTORICAL PART PROPOSAL · RESULT NOT IN CURRENT GRAPH · GLB",
      ariaLabel: "Interactive historical PartDefinition proposal",
      loadingLabel: "Loading historical part proposal…",
      errorLabel: "Historical part proposal unavailable",
    };
  }
  return {
    label: "DRAFT PART PROPOSAL · GLB · NOT CANONICAL",
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
    scene.background = new THREE.Color(0xf4efe5);

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
          color: 0xb86635,
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
    <div class="geometry-draft-canvas-shell">
      <div class="geometry-draft-canvas" ref={host} />
      <div class="geometry-draft-canvas-state" data-state={state}>
        {state === "loading"
          ? "Loading draft mesh…"
          : state === "error"
          ? "Draft mesh unavailable"
          : "Drag to orbit · scroll to zoom"}
      </div>
      <button
        type="button"
        class="geometry-draft-reset"
        disabled={state !== "ready"}
        onClick={() => resetView.current?.()}
      >
        Fit / reset
      </button>
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
