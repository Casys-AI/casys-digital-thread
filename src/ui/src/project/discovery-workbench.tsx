/** @jsxImportSource preact */

import type { JSX } from "preact";
import type {
  ProjectDiscoveryBrief,
  ProjectDiscoveryQuestion,
  ProjectDiscoverySnapshot,
} from "../../../domain/project-discovery.ts";
import {
  Badge,
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

export interface DiscoveryWorkbenchProps {
  readonly discovery: ProjectDiscoverySnapshot;
}

/**
 * A pre-engineering workspace for a human reviewing an agent-led discovery.
 * Transport and persistence deliberately stay outside this component.
 */
export function DiscoveryWorkbench({
  discovery,
}: DiscoveryWorkbenchProps): JSX.Element {
  const view = buildProjectDiscoveryView(discovery);

  return (
    <main
      class="discovery-workbench mcp-view-surface"
      aria-labelledby="discovery-title"
    >
      <header class="discovery-header">
        <div class="discovery-header-copy">
          <p class="discovery-kicker">PROJECT DISCOVERY · SHARED RECORD</p>
          <h1 id="discovery-title">Keep the project conversation grounded</h1>
          <p class="discovery-introduction">
            Work with the agent in your paired conversation. This page follows
            what you agree, keeps one useful question in view, and preserves the
            organized project record as the work develops.
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
        reviewStatus={discovery.review?.status}
      />
    </main>
  );
}

function ActiveDiscoveryQuestion({
  question,
}: {
  question: ProjectDiscoveryQuestion;
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
        <section
          class="discovery-agent-starter"
          aria-label={`Suggested reply for: ${question.prompt}`}
        >
          <span>START WITH THIS REPLY</span>
          <p>
            “I&rsquo;m leaning toward{" "}
            <strong>
              {recommendedOption?.label ?? question.recommendation.value}
            </strong>{" "}
            for this question. Can you explain the trade-offs before we record
            it?”
          </p>
          <small>
            Send it to the paired agent, or ask it to explain first.
          </small>
        </section>
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

      {question.evidenceNeeded.length > 0 && (
        <details class="discovery-evidence-plan">
          <summary>What the agent may verify later</summary>
          <ul>
            {question.evidenceNeeded.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </details>
      )}
    </Card>
  );
}

function DiscoveryBriefDisclosure({
  brief,
  reviewStatus,
}: {
  brief?: ProjectDiscoveryBrief;
  reviewStatus?: "pending" | "approved" | "rejected";
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
                Discuss corrections, priorities and confirmation with the agent.
                Once it records an updated brief or project step, this dossier
                follows the shared record.
              </p>
              {reviewStatus === "approved" && (
                <StateMessage
                  title="Confirmed in the paired conversation"
                  tone="success"
                >
                  <p>
                    This confirmed brief anchors the project record. Follow the
                    activity feed as the agent records technical work.
                  </p>
                </StateMessage>
              )}
              {reviewStatus === "rejected" && (
                <StateMessage title="Revision requested" tone="info">
                  <p>
                    Continue in the paired conversation. This version stays
                    visible until the agent records a replacement brief.
                  </p>
                </StateMessage>
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
