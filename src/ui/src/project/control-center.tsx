/** @jsxImportSource preact */

import type { JSX } from "preact";
import type {
  EngineeringDecision,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";

export interface ProjectReviewProps {
  readonly project: EngineeringProjectSnapshot;
  /** Opens the live activity feed, optionally focused on this decision. */
  readonly onOpenActivity?: (decisionId?: string) => void;
  /** Opens the specification/SysML projection for the affected decision. */
  readonly onOpenSpecification?: (decisionId: string) => void;
}

export type ReviewNotificationsSurface = "inbox" | "activity";

/** A compact overview handoff to the records that explain a decision. */
export function DecisionCenter(props: ProjectReviewProps): JSX.Element {
  return <ReviewNotifications {...props} surface="inbox" />;
}

/**
 * The cockpit never asks the person to authorize work. It projects the
 * decision record and points back to the paired conversation, where the agent
 * can ask for intent, explain a recommendation and persist the outcome.
 */
export function ReviewNotifications({
  project,
  onOpenActivity,
  onOpenSpecification,
  surface = "inbox",
}: ProjectReviewProps & {
  readonly surface?: ReviewNotificationsSurface;
}): JSX.Element {
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
          <p>{isActivity ? "DECISION RECORD" : "PROJECT SIGNALS"}</p>
          <h3 id={`review-notifications-title-${surface}`}>
            {isActivity
              ? "What the agent needs you to consider"
              : "Attention, in context"}
          </h3>
          <span>
            {isActivity
              ? "Read the recorded scope and evidence here; discuss the decision with the agent in your paired conversation."
              : "The feed carries the engineering story. This summary only points to the decision records worth discussing with the agent."}
          </span>
        </div>
        <dl class="decision-center-meter">
          <div data-tone={reviewable.length > 0 ? "attention" : "quiet"}>
            <dt>To discuss</dt>
            <dd>{reviewable.length}</dd>
          </div>
          <div data-tone={agentPreparing.length > 0 ? "preparing" : "quiet"}>
            <dt>Preparing</dt>
            <dd>{agentPreparing.length}</dd>
          </div>
        </dl>
      </header>

      {isActivity
        ? (
          <ActivityDecisionRecord
            project={project}
            reviewable={reviewable}
            agentPreparing={agentPreparing}
            onOpenSpecification={onOpenSpecification}
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
      marker: "AGENT QUESTION",
      title: reviewable.length === 1
        ? "One recorded recommendation needs discussion"
        : `${reviewable.length} recorded recommendations need discussion`,
      detail:
        "Open Activity to inspect the lineage and evidence, then continue with the agent in your paired conversation.",
      action: "Open activity",
      icon: "!",
    }
    : agentPreparing.length > 0
    ? {
      tone: "required",
      marker: "AGENT PREPARING",
      title: "The agent is preparing the next recommendation",
      detail:
        "Nothing is needed in the cockpit. The activity feed will show the record when it is ready to discuss.",
      action: "See activity",
      icon: "···",
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
        onClick={() => onOpenActivity?.(nextReview?.id)}
        disabled={!onOpenActivity}
      >
        {state.action}
      </button>
    </section>
  );
}

function ActivityDecisionRecord({
  project,
  reviewable,
  agentPreparing,
  onOpenSpecification,
}: {
  project: EngineeringProjectSnapshot;
  reviewable: readonly EngineeringDecision[];
  agentPreparing: readonly EngineeringDecision[];
  onOpenSpecification?: (decisionId: string) => void;
}): JSX.Element {
  if (!reviewable.length) {
    return (
      <section
        class="decision-review-brief"
        data-state={agentPreparing.length > 0 ? "required" : "approved"}
        aria-label="Decision status"
      >
        <span aria-hidden="true">{agentPreparing.length ? "···" : "✓"}</span>
        <div>
          <p>
            {agentPreparing.length ? "AGENT PREPARING" : "NO QUESTION WAITING"}
          </p>
          <strong>
            {agentPreparing.length
              ? "The agent has not recorded a recommendation yet"
              : "There is no recorded decision awaiting discussion"}
          </strong>
          <small>
            Follow the live feed, or ask the agent about the project context in
            your paired conversation.
          </small>
        </div>
      </section>
    );
  }

  return (
    <ol class="decision-notification-list" aria-label="Recorded decisions">
      {reviewable.map((decision) => (
        <li key={decision.id}>
          <DecisionRecord
            project={project}
            decision={decision}
            onOpenSpecification={onOpenSpecification}
          />
        </li>
      ))}
    </ol>
  );
}

function DecisionRecord({
  project,
  decision,
  onOpenSpecification,
}: {
  project: EngineeringProjectSnapshot;
  decision: EngineeringDecision;
  onOpenSpecification?: (decisionId: string) => void;
}): JSX.Element {
  const phase = project.phases.find((candidate) =>
    candidate.id === decision.phaseId
  );
  const proposal = decision.proposal;

  return (
    <article
      class="decision-review-notification"
      data-state={decision.status}
      aria-label={`Decision record: ${decision.title}`}
    >
      <header>
        <div>
          <span>AGENT RECOMMENDATION</span>
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
          <dt>Recorded</dt>
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
      </div>
      <small class="decision-review-guidance">
        Discuss this recommendation with the agent in your paired conversation.
        The cockpit will update when the shared project record changes.
      </small>
    </article>
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
