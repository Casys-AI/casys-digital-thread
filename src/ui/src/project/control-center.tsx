/** @jsxImportSource preact */

import type { JSX } from "preact";
import type {
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../domain/engineering-project.ts";
import type {
  OperatorCommandCapabilities,
  ProjectOperatorCommand,
} from "./command-contract.ts";
import { canQueueWorkItem, unavailableCommandReason } from "./control-model.ts";

export interface ProjectCommandFeedback {
  readonly state: "idle" | "submitting" | "success" | "conflict" | "error";
  readonly commandKey?: string;
  readonly message?: string;
}

/**
 * Browser controls are deliberately narrow: the agent prepares technical
 * changes, while a human can authorize an exact, already-recorded scope.
 */
export interface ProjectControlProps {
  readonly project: EngineeringProjectSnapshot;
  readonly capability?: OperatorCommandCapabilities;
  readonly actorId: string;
  readonly onActorIdChange: (value: string) => void;
  readonly feedback: ProjectCommandFeedback;
  readonly onCommand: (
    commandKey: string,
    command: ProjectOperatorCommand,
  ) => Promise<void>;
  /** Opens the live activity feed, optionally focused on this decision. */
  readonly onOpenActivity?: (decisionId?: string) => void;
  /** Opens the specification/SysML surface for the affected decision. */
  readonly onOpenSpecification?: (decisionId: string) => void;
}

export type ReviewNotificationsSurface = "inbox" | "activity";

export interface ReviewNotificationsProps extends ProjectControlProps {
  /** Overview gets only a handoff; Activity owns contextual review. */
  readonly surface?: ReviewNotificationsSurface;
}

/**
 * Compatibility export for the Overview. It is intentionally only an inbox:
 * no technical fields, manual recovery, or duplicate review workspace.
 */
export function DecisionCenter(props: ProjectControlProps): JSX.Element {
  return <ReviewNotifications {...props} surface="inbox" />;
}

/**
 * The same lightweight notification language is used in two places:
 * - inbox: tells a reviewer that attention is needed and hands off to Activity;
 * - activity: supplies the recorded context and a bounded authorization action.
 */
export function ReviewNotifications({
  project,
  capability,
  actorId,
  onActorIdChange,
  feedback,
  onCommand,
  onOpenActivity,
  onOpenSpecification,
  surface = "inbox",
}: ReviewNotificationsProps): JSX.Element {
  const reviewable = project.decisions.filter((decision) =>
    decision.status === "proposed"
  );
  const agentPreparing = project.decisions.filter((decision) =>
    decision.status === "required" || decision.status === "rejected"
  );
  const isActivity = surface === "activity";

  return (
    <section
      class="decision-center"
      data-surface={surface}
      aria-labelledby={`review-notifications-title-${surface}`}
    >
      <header class="decision-center-header">
        <div class="decision-center-index" aria-hidden="true">RN</div>
        <div>
          <p>{isActivity ? "ACTIVITY REVIEW" : "REVIEW NOTIFICATIONS"}</p>
          <h3 id={`review-notifications-title-${surface}`}>
            {isActivity ? "Review what changed" : "Your attention, when needed"}
          </h3>
          <span>
            {isActivity
              ? "Read the engineering activity and inspect the affected specification. Authorization remains a single, bounded human action."
              : "The feed carries the engineering story. This inbox only alerts you when a recorded recommendation needs your judgment."}
          </span>
        </div>
        <dl class="decision-center-meter">
          <div data-tone={reviewable.length > 0 ? "attention" : "quiet"}>
            <dt>Needs review</dt>
            <dd>{reviewable.length}</dd>
          </div>
          <div data-tone={agentPreparing.length > 0 ? "preparing" : "quiet"}>
            <dt>Agent preparing</dt>
            <dd>{agentPreparing.length}</dd>
          </div>
        </dl>
      </header>

      {isActivity
        ? (
          <ActivityReviewQueue
            project={project}
            capability={capability}
            actorId={actorId}
            onActorIdChange={onActorIdChange}
            feedback={feedback}
            onCommand={onCommand}
            onOpenSpecification={onOpenSpecification}
            reviewable={reviewable}
            agentPreparing={agentPreparing}
          />
        )
        : (
          <ReviewInboxHandoff
            reviewable={reviewable}
            agentPreparing={agentPreparing}
            onOpenActivity={onOpenActivity}
          />
        )}
    </section>
  );
}

function ReviewInboxHandoff({
  reviewable,
  agentPreparing,
  onOpenActivity,
}: {
  reviewable: readonly EngineeringDecision[];
  agentPreparing: readonly EngineeringDecision[];
  onOpenActivity?: (decisionId?: string) => void;
}): JSX.Element {
  const nextReview = reviewable[0];
  const state = nextReview
    ? {
      tone: "proposed",
      marker: "REVIEW REQUEST",
      title: reviewable.length === 1
        ? "One engineering recommendation is ready"
        : `${reviewable.length} engineering recommendations are ready`,
      detail:
        "Open Activity to see the lineage and evidence before deciding. If the scope is wrong, inspect and change it from the dedicated specification surface with the agent.",
      action: "Open activity",
      icon: "!",
    }
    : agentPreparing.length > 0
    ? {
      tone: "required",
      marker: "AGENT PREPARING",
      title: "The agent is preparing the next recommendation",
      detail:
        "Nothing needs a decision yet. The activity feed will show the work as it arrives.",
      action: "See activity",
      icon: "···",
    }
    : {
      tone: "approved",
      marker: "NO REVIEW WAITING",
      title: "Nothing needs your judgment right now",
      detail:
        "Use Activity to follow the project. New review requests will appear here when a recommendation is recorded.",
      action: "See activity",
      icon: "✓",
    };

  return (
    <section
      class="decision-review-brief"
      data-state={state.tone}
      aria-label="Review notification"
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
        onClick={() => onOpenActivity?.(nextReview?.id)}
        disabled={!onOpenActivity}
      >
        {state.action}
      </button>
    </section>
  );
}

function ActivityReviewQueue({
  project,
  capability,
  actorId,
  onActorIdChange,
  feedback,
  onCommand,
  onOpenSpecification,
  reviewable,
  agentPreparing,
}:
  & Pick<
    ProjectControlProps,
    | "project"
    | "capability"
    | "actorId"
    | "onActorIdChange"
    | "feedback"
    | "onCommand"
    | "onOpenSpecification"
  >
  & {
    reviewable: readonly EngineeringDecision[];
    agentPreparing: readonly EngineeringDecision[];
  }): JSX.Element {
  const commandsEnabled = capability?.enabled === true;

  return (
    <>
      {feedback.state !== "idle" && feedback.message && (
        <div
          class="decision-command-feedback"
          data-state={feedback.state}
          role={feedback.state === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <i aria-hidden="true" />
          <span>{feedback.message}</span>
        </div>
      )}

      {reviewable.length > 0 && commandsEnabled && (
        <details class="decision-reviewer-session">
          <summary>
            <span>REVIEWER IDENTITY</span>
            <strong>
              {actorId.trim() || "Identify yourself to authorize a decision"}
            </strong>
          </summary>
          <OperatorIdentity
            actorId={actorId}
            onChange={onActorIdChange}
            enabled={commandsEnabled}
          />
        </details>
      )}

      {reviewable.length
        ? (
          <ol class="decision-notification-list" aria-label="Review requests">
            {reviewable.map((decision) => (
              <li key={decision.id}>
                <ReviewNotification
                  project={project}
                  decision={decision}
                  capability={capability}
                  actorId={actorId}
                  feedback={feedback}
                  onCommand={onCommand}
                  onOpenSpecification={onOpenSpecification}
                />
              </li>
            ))}
          </ol>
        )
        : (
          <section
            class="decision-review-brief"
            data-state={agentPreparing.length > 0 ? "required" : "approved"}
            aria-label="Review status"
          >
            <span aria-hidden="true">
              {agentPreparing.length ? "···" : "✓"}
            </span>
            <div>
              <p>
                {agentPreparing.length
                  ? "AGENT PREPARING"
                  : "NO REVIEW WAITING"}
              </p>
              <strong>
                {agentPreparing.length
                  ? "The agent has not recorded a reviewable recommendation yet"
                  : "There is no engineering decision awaiting review"}
              </strong>
              <small>
                {agentPreparing.length
                  ? "Follow the live feed; no technical record is required from you here."
                  : "Keep following Activity or inspect the product specification when you want to explore the current state."}
              </small>
            </div>
          </section>
        )}
    </>
  );
}

function ReviewNotification({
  project,
  decision,
  capability,
  actorId,
  feedback,
  onCommand,
  onOpenSpecification,
}:
  & Pick<
    ProjectControlProps,
    | "project"
    | "capability"
    | "actorId"
    | "feedback"
    | "onCommand"
    | "onOpenSpecification"
  >
  & { decision: EngineeringDecision }): JSX.Element {
  const phase = project.phases.find((candidate) =>
    candidate.id === decision.phaseId
  );
  const proposal = decision.proposal;
  const busy = feedback.state === "submitting" &&
    feedback.commandKey?.includes(decision.id);
  const authorizationUnavailable = decision.inputFingerprint
    ? unavailableCommandReason({
      enabled: capability?.enabled === true,
      intent: "decision.approve",
      allowedIntents: capability?.intents ?? [],
      actorId,
      busy: feedback.state === "submitting",
    })
    : "This recommendation is not bound to an exact input scope.";
  const revisionUnavailable = decision.inputFingerprint
    ? unavailableCommandReason({
      enabled: capability?.enabled === true,
      intent: "decision.reject",
      allowedIntents: capability?.intents ?? [],
      actorId,
      busy: feedback.state === "submitting",
    })
    : "This recommendation is not bound to an exact input scope.";

  const authorize = async () => {
    if (!decision.inputFingerprint || authorizationUnavailable) return;
    await onCommand(`decision.approve:${decision.id}`, {
      type: "decision.approve",
      decisionId: decision.id,
      rationale: "Authorized after review in Activity.",
      inputFingerprint: decision.inputFingerprint,
    });
  };

  const requestRevision = async () => {
    if (!decision.inputFingerprint || revisionUnavailable) return;
    await onCommand(`decision.reject:${decision.id}`, {
      type: "decision.reject",
      decisionId: decision.id,
      rationale: "Revision requested after Activity review.",
      inputFingerprint: decision.inputFingerprint,
    });
  };

  return (
    <article
      class="decision-review-notification"
      data-state={decision.status}
      aria-label={`Review request: ${decision.title}`}
    >
      <header>
        <div>
          <span>REVIEW REQUEST</span>
          <strong>{decision.title}</strong>
        </div>
        <small>{phase?.name ?? decision.phaseId}</small>
      </header>
      <blockquote>{decision.question}</blockquote>
      <p class="decision-notification-summary">
        {proposal?.summary ??
          "The recorded recommendation is available in the project activity."}
      </p>
      <dl class="decision-notification-scope">
        <div>
          <dt>Evidence</dt>
          <dd>{decision.inputEvidenceRefs.length} linked</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>
            {decision.inputFingerprint ? "Exact input bound" : "Not ready"}
          </dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>{formatDateTime(decision.requestedAt)}</dd>
        </div>
      </dl>
      <div class="decision-review-actions">
        <button
          type="button"
          class="decision-secondary-button"
          onClick={() => onOpenSpecification?.(decision.id)}
          disabled={!onOpenSpecification}
          title={!onOpenSpecification
            ? "The specification route is not available on this surface."
            : undefined}
        >
          Inspect specification
        </button>
        <button
          type="button"
          class="decision-reject-button"
          onClick={requestRevision}
          disabled={!!revisionUnavailable}
          title={revisionUnavailable}
        >
          {busy ? "Requesting…" : "Request revised recommendation"}
        </button>
        <button
          type="button"
          class="decision-approve-button"
          onClick={authorize}
          disabled={!!authorizationUnavailable}
          title={authorizationUnavailable}
        >
          {busy ? "Authorizing…" : "Authorize recorded scope"}
        </button>
      </div>
      <small class="decision-review-guidance">
        Need a correction? Inspect the specification and continue the project
        conversation. A changed recommendation returns here with a new exact
        scope.
      </small>
    </article>
  );
}

export function OperatorIdentity({ actorId, onChange, enabled }: {
  actorId: string;
  onChange: (value: string) => void;
  enabled: boolean;
}): JSX.Element {
  return (
    <div class="decision-operator">
      <label>
        <span>REVIEWING AS</span>
        <input
          type="text"
          value={actorId}
          onInput={(event) => onChange(event.currentTarget.value)}
          placeholder="Enter your name or operator ID"
          autocomplete="off"
          disabled={!enabled}
        />
      </label>
      <div>
        <strong>Self-declared · not authenticated</strong>
        <span>
          Written to the audit record; this prototype does not verify identity.
        </span>
      </div>
    </div>
  );
}

/**
 * Kept for the Execution surface. The work brief is agent-authored and can be
 * read here, but never silently overwritten by an operator form.
 */
export function QueueWorkItemControl(
  props: ProjectControlProps & { item: EngineeringWorkItem; compact?: boolean },
): JSX.Element {
  const { project, item, capability, actorId, feedback, onCommand, compact } =
    props;
  const agentBrief = item.description.trim() || item.title.trim();
  const busy = feedback.state === "submitting";
  const eligible = canQueueWorkItem(project, item);
  const unavailable = !agentBrief
    ? "The agent has not prepared a work brief yet."
    : unavailableCommandReason({
      enabled: capability?.enabled === true,
      intent: "agent-run.queue",
      allowedIntents: capability?.intents ?? [],
      actorId,
      busy,
    });

  const authorize = async () => {
    if (!eligible || unavailable) return;
    await onCommand(`queue:${item.id}`, {
      type: "agent-run.queue",
      workItemId: item.id,
      summary: agentBrief,
    });
  };

  return (
    <section class={`decision-queue-form${compact ? " is-compact" : ""}`}>
      <div>
        <span>READY TO AUTHORIZE</span>
        <strong>{item.title}</strong>
        <small>
          Agent-prepared scope · {item.id}
        </small>
      </div>
      <blockquote class="decision-agent-brief">{agentBrief}</blockquote>
      <small class="decision-form-hint">
        Need a different scope? Change the specification or ask the agent in the
        project conversation to prepare a new brief before authorizing it.
      </small>
      <button
        type="button"
        class="decision-primary-button"
        onClick={authorize}
        disabled={!eligible || !!unavailable}
        title={!eligible
          ? "This work item is not ready to queue."
          : unavailable}
      >
        {busy && feedback.commandKey === `queue:${item.id}`
          ? "Authorizing…"
          : "Authorize agent work"}
      </button>
    </section>
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
