/** @jsxImportSource preact */

import type { JSX } from "preact";
import type {
  ProjectDiscoveryBrief,
  ProjectDiscoveryQuestion,
  ProjectDiscoverySnapshot,
} from "../../../domain/project-discovery.ts";
import type { ContentFingerprint } from "../../../domain/thread-snapshot.ts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  StateMessage,
} from "../mcp-view-primitives.ts";
import {
  buildProjectDiscoveryView,
  discoveryConfidenceLabel,
  discoveryConfidenceTone,
  discoveryRiskLabel,
  discoveryRiskTone,
} from "./discovery-model.ts";

export interface DiscoveryAnswerSelection {
  readonly questionId: string;
  readonly kind: "provided" | "unknown";
  readonly value?: string;
}

export interface DiscoveryBriefReviewSelection {
  readonly briefId: string;
  readonly inputFingerprint: ContentFingerprint;
  readonly action: "approve" | "request-revision";
}

export interface DiscoveryWorkbenchProps {
  readonly discovery: ProjectDiscoverySnapshot;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly onAnswer?: (
    selection: DiscoveryAnswerSelection,
  ) => void | Promise<void>;
  readonly onReviewBrief?: (
    selection: DiscoveryBriefReviewSelection,
  ) => void | Promise<void>;
}

/**
 * A pre-engineering workspace for a human reviewing an agent-led discovery.
 * Transport and persistence deliberately stay outside this component.
 */
export function DiscoveryWorkbench({
  discovery,
  disabled = false,
  busy = false,
  onAnswer,
  onReviewBrief,
}: DiscoveryWorkbenchProps): JSX.Element {
  const view = buildProjectDiscoveryView(discovery);
  const interactionDisabled = disabled || busy;

  const answer = (selection: DiscoveryAnswerSelection): void => {
    if (interactionDisabled || !onAnswer) return;
    void onAnswer(selection);
  };

  const review = (
    action: DiscoveryBriefReviewSelection["action"],
  ): void => {
    if (
      interactionDisabled || !onReviewBrief || !discovery.brief ||
      !discovery.review || !view.canReviewBrief
    ) return;
    void onReviewBrief({
      briefId: discovery.brief.id,
      inputFingerprint: discovery.review.inputFingerprint,
      action,
    });
  };

  return (
    <main
      class="discovery-workbench mcp-view-surface"
      aria-busy={busy}
      aria-labelledby="discovery-title"
    >
      <header class="discovery-header">
        <div class="discovery-header-copy">
          <p class="discovery-kicker">PROJECT DISCOVERY · SHARED RECORD</p>
          <h1 id="discovery-title">Keep the project conversation grounded</h1>
          <p class="discovery-introduction">
            Work with the agent in your paired conversation. This page follows
            what you agree, keeps one useful question in view, and preserves
            your final review before engineering begins.
          </p>
        </div>
        <Badge tone={view.statusTone} className="discovery-status-badge">
          {view.statusLabel}
        </Badge>
      </header>

      <section
        class="discovery-intent"
        aria-labelledby="discovery-intent-title"
      >
        <div class="discovery-intent-mark" aria-hidden="true">01</div>
        <div>
          <p>
            {discovery.intent.capturedBy.origin === "human"
              ? "YOUR INTENT"
              : "REPORTED INTENT"}
          </p>
          <blockquote id="discovery-intent-title">
            {discovery.intent.statement}
          </blockquote>
        </div>
      </section>

      <section
        class="discovery-conversation-record"
        aria-labelledby="discovery-conversation-record-title"
      >
        <span aria-hidden="true">↳</span>
        <p id="discovery-conversation-record-title">
          <strong>Talk with the agent; review the shared record here.</strong>
          {" "}
          The agent asks the next question in your paired conversation and
          records the answer you agree together. This page updates as that
          shared project record.
        </p>
      </section>

      <section class="discovery-progress" aria-label="Discovery progress">
        <div class="discovery-progress-copy">
          <span>{view.progress.phaseLabel}</span>
          <strong>{view.progress.label}</strong>
          <small>
            One question stays open at a time. “I don&rsquo;t know yet” is
            valid: discuss it with the agent and it remains an open point
            instead of a guess.
          </small>
        </div>
        <div class="discovery-progress-line" aria-hidden="true">
          <i />
        </div>
      </section>

      <section class="discovery-focus" aria-live="polite">
        {view.activeQuestion
          ? (
            <ActiveDiscoveryQuestion
              question={view.activeQuestion}
              disabled={interactionDisabled || !onAnswer}
              busy={busy}
              onSelect={answer}
            />
          )
          : (
            <StateMessage
              title={view.statusLabel}
              tone={view.statusTone}
              className="discovery-state"
            >
              <p>{view.statusMessage}</p>
            </StateMessage>
          )}
      </section>

      <DiscoveryBriefDisclosure
        brief={discovery.brief}
        canReview={view.canReviewBrief}
        disabled={interactionDisabled || !onReviewBrief}
        busy={busy}
        reviewStatus={discovery.review?.status}
        onReview={review}
      />
    </main>
  );
}

function ActiveDiscoveryQuestion({
  question,
  disabled,
  busy,
  onSelect,
}: {
  question: ProjectDiscoveryQuestion;
  disabled: boolean;
  busy: boolean;
  onSelect: (selection: DiscoveryAnswerSelection) => void;
}): JSX.Element {
  const recommendedOption = question.options.find((option) =>
    option.value === question.recommendation.value
  );

  return (
    <Card
      eyebrow="PAIRED CONVERSATION · NEXT QUESTION"
      title={question.prompt}
      actions={
        <Badge tone={discoveryRiskTone(question.risk)}>
          {discoveryRiskLabel(question.risk)}
        </Badge>
      }
      className="discovery-question-card"
    >
      <section class="discovery-conversation-prompt">
        <span>ANSWER WITH YOUR AGENT</span>
        <p>
          Reply in your paired conversation. Once you agree an answer, the agent
          saves it to this shared record and the next question appears here.
        </p>
      </section>

      <div class="discovery-why">
        <span aria-hidden="true">WHY</span>
        <div>
          <strong>Why this matters</strong>
          <p>{question.whyItMatters}</p>
        </div>
      </div>

      <aside class="discovery-recommendation">
        <div class="discovery-recommendation-heading">
          <span>AGENT RECOMMENDATION</span>
          <Badge
            tone={discoveryConfidenceTone(question.recommendation.confidence)}
          >
            {discoveryConfidenceLabel(question.recommendation.confidence)}
          </Badge>
        </div>
        <strong>
          {recommendedOption?.label ?? question.recommendation.value}
        </strong>
        <p>{question.recommendation.rationale}</p>
      </aside>

      <section
        class="discovery-option-context"
        aria-labelledby={`discovery-directions-${question.id}`}
      >
        <h2 id={`discovery-directions-${question.id}`}>
          Possible directions to discuss
        </h2>
        <ul>
          {question.options.map((option) => (
            <li key={option.value}>
              <strong>{option.label}</strong>
              <span>{option.consequences}</span>
            </li>
          ))}
          {question.allowUnknown && (
            <li class="discovery-option-unknown">
              <strong>I don&rsquo;t know yet</strong>
              <span>
                Keep moving without guessing. The agent will preserve this as an
                open question.
              </span>
            </li>
          )}
        </ul>
      </section>

      <details class="discovery-cockpit-correction">
        <summary>
          <span>
            <small>EXCEPTIONAL PATH</small>
            <strong>Correct from cockpit</strong>
          </span>
          <em>Only if conversation is unavailable or the record needs help</em>
        </summary>
        <div>
          <p>
            The normal path is to answer the agent in your paired conversation.
            Use this recovery path only when that is not possible, or when you
            need to correct what the shared record should say.
          </p>
          <fieldset class="discovery-options" disabled={disabled}>
            <legend>Record an answer directly</legend>
            <div class="discovery-option-grid">
              {question.options.map((option) => (
                <Button
                  key={option.value}
                  className="discovery-option"
                  disabled={disabled}
                  onClick={() =>
                    onSelect({
                      questionId: question.id,
                      kind: "provided",
                      value: option.value,
                    })}
                >
                  <span>{option.label}</span>
                  <small>{option.consequences}</small>
                </Button>
              ))}
            </div>
            {question.allowUnknown && (
              <Button
                className="discovery-unknown"
                disabled={disabled}
                onClick={() =>
                  onSelect({ questionId: question.id, kind: "unknown" })}
              >
                <span>I don&rsquo;t know yet</span>
                <small>
                  Keep moving without guessing. The agent will preserve this as
                  an open question.
                </small>
              </Button>
            )}
          </fieldset>
        </div>
      </details>

      {question.evidenceNeeded.length > 0 && (
        <details class="discovery-evidence-plan">
          <summary>What the agent may verify later</summary>
          <ul>
            {question.evidenceNeeded.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </details>
      )}

      {busy && (
        <p class="discovery-busy">Saving the cockpit correction&hellip;</p>
      )}
    </Card>
  );
}

function DiscoveryBriefDisclosure({
  brief,
  canReview,
  disabled,
  busy,
  reviewStatus,
  onReview,
}: {
  brief?: ProjectDiscoveryBrief;
  canReview: boolean;
  disabled: boolean;
  busy: boolean;
  reviewStatus?: "pending" | "approved" | "rejected";
  onReview: (action: DiscoveryBriefReviewSelection["action"]) => void;
}): JSX.Element {
  return (
    <details class="discovery-brief">
      <summary>
        <span>
          <small>WORKING DOCUMENT</small>
          <strong>Draft engineering brief</strong>
        </span>
        <em>{brief ? "Available to inspect" : "Built as you answer"}</em>
      </summary>
      <div class="discovery-brief-body">
        {brief
          ? (
            <>
              <section class="discovery-brief-objective">
                <p>PROPOSED OBJECTIVE</p>
                <h2>{brief.objective}</h2>
              </section>
              <div class="discovery-brief-grid">
                <BriefList
                  title="How it will be used"
                  items={brief.missionScenarios}
                />
                <BriefList
                  title="What success means"
                  items={brief.successCriteria}
                />
                <BriefList title="Constraints" items={brief.constraints} />
                <BriefList
                  title="Explicitly out of scope"
                  items={brief.exclusions}
                />
                <BriefList
                  title="Assumptions to verify"
                  items={brief.assumptions}
                />
                <BriefList
                  title="Questions still open"
                  items={brief.openQuestions}
                />
              </div>
              <section class="discovery-brief-group">
                <header>
                  <p>WHERE IT MUST WORK</p>
                  <h3>Markets, manufacturing and operation</h3>
                </header>
                <div class="discovery-brief-grid is-compact">
                  <BriefList
                    title="Intended markets"
                    items={brief.intendedMarkets}
                  />
                  <BriefList
                    title="Manufacturing jurisdictions"
                    items={brief.manufacturingJurisdictions}
                  />
                  <BriefList
                    title="Operating jurisdictions"
                    items={brief.operatingJurisdictions}
                  />
                </div>
              </section>
              <section class="discovery-brief-group">
                <header>
                  <p>COMPLIANCE &amp; EVIDENCE</p>
                  <h3>A candidate path for specialist review</h3>
                </header>
                <div class="discovery-brief-grid is-compact">
                  <BriefList
                    title="Candidate compliance outcomes"
                    items={brief.complianceTargets}
                  />
                  <BriefList
                    title="Planned verification"
                    items={brief.verificationPlan}
                  />
                </div>
                <p class="discovery-compliance-note">
                  These are agent-proposed starting points, not legal advice or
                  proof of conformity.
                </p>
              </section>
              <p class="discovery-brief-boundary">
                Technical evidence and any applicable compliance path begin only
                after you approve this framing.
              </p>
              {canReview && (
                <div class="discovery-review-actions">
                  <div>
                    <strong>Your review is the gate</strong>
                    <span>
                      Approve the intent, or ask the agent to revise the brief.
                    </span>
                  </div>
                  <Button
                    className="discovery-revise"
                    disabled={disabled}
                    onClick={() => onReview("request-revision")}
                  >
                    Request revision
                  </Button>
                  <Button
                    className="discovery-approve"
                    disabled={disabled}
                    onClick={() => onReview("approve")}
                  >
                    Approve brief
                  </Button>
                </div>
              )}
              {reviewStatus === "approved" && (
                <StateMessage
                  title="Approved by a human reviewer"
                  tone="success"
                >
                  <p>This brief can now anchor technical planning.</p>
                </StateMessage>
              )}
              {reviewStatus === "rejected" && (
                <StateMessage title="Revision requested" tone="info">
                  <p>The agent is preparing a replacement proposal.</p>
                </StateMessage>
              )}
              {busy && (
                <p class="discovery-busy">Recording your review&hellip;</p>
              )}
            </>
          )
          : (
            <EmptyState className="discovery-brief-empty">
              The brief will appear here once the agent has enough reviewed
              context. No technical scope is assumed in the meantime.
            </EmptyState>
          )}
      </div>
    </details>
  );
}

function BriefList({ title, items }: {
  title: string;
  items: readonly string[];
}): JSX.Element {
  return (
    <section>
      <h3>{title}</h3>
      {items.length
        ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
        : <p>Nothing recorded yet.</p>}
    </section>
  );
}
