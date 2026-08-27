import { CARD_SURFACE, SECTION_LABEL } from "../ui/cockpit.tsx";
import type { JSX } from "react";
import type {
  CockpitFleetProjection,
} from "../../../presentation/workbench/fleet/projection.ts";
import { recordStatusVariant } from "./record-status.ts";
import type {
  EngineeringAgentRun,
  EngineeringDecision,
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import { cn } from "../lib/utils.ts";
import {
  buildRunTimeline,
  type RunTimelineRow,
  waitShare,
} from "./run-timeline-model.ts";
import { Badge, type BadgeProps } from "../ui/badge.tsx";
import { Card, CardContent, CardHeader } from "../ui/card.tsx";
import {
  agentPreparationDecisions,
  agentRunRecordedAt,
  agentRunSummary,
  buildAgentNowPresentation,
  buildProjectBrief,
  pendingHumanConfirmationDecisions,
  projectPulseStatus,
  selectCurrentProjectFocus,
  workOwnerLabel,
} from "./model.ts";
import {
  buildOperationsFleetView,
  type FleetCardView,
} from "./operations-fleet-model.ts";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

// ---------------------------------------------------------------------------
// Work ribbon
// ---------------------------------------------------------------------------

export function ProjectWorkRibbon({
  project,
}: {
  project: EngineeringProjectSnapshot;
}): JSX.Element {
  const brief = buildProjectBrief(project);
  const agentNow = buildAgentNowPresentation(project);
  const currentFocus = selectCurrentProjectFocus(project);
  const decisionToReview = currentFocus.proposedDecision;
  const decisionBeingPrepared = currentFocus.work?.decisionIds
    .map((id) => project.decisions.find((d) => d.id === id))
    .find((d) => d?.status === "required" || d?.status === "rejected");
  const blocker = brief.openBlockers[0];
  const decisionBadge = decisionToReview
    ? { variant: "warning" as const, label: "Needs review" }
    : decisionBeingPrepared
    ? { variant: "secondary" as const, label: "Agent preparing" }
    : { variant: "success" as const, label: "Clear" };
  const blockerBadge = blocker
    ? {
      variant: "destructive" as const,
      label: sentenceLabel(blocker.kind),
    }
    : { variant: "success" as const, label: "Clear" };
  return (
    <section
      className="grid grid-cols-1 gap-3 md:grid-cols-3"
      aria-label="Shared work plan"
    >
      <Card className="p-3">
        <AgentNowRibbon project={project} presentation={agentNow} />
      </Card>
      <Card className="p-3">
        <RibbonFacts
          label="AGENT QUESTION"
          value={decisionToReview?.title ??
            (decisionBeingPrepared
              ? "Agent proposal in preparation"
              : "Nothing needs discussion")}
          detail={decisionToReview?.question ??
            (decisionBeingPrepared
              ? `The agent still owes you a concrete proposal for ${decisionBeingPrepared.title}.`
              : "Discuss any change of intent with the agent; " +
                "this cockpit follows the recorded plan.")}
          badge={decisionBadge.label}
          badgeVariant={decisionBadge.variant}
        />
      </Card>
      <Card className="p-3">
        <RibbonFacts
          label="OPEN BLOCKER"
          value={blocker?.title ?? "Clear"}
          detail={blocker?.description ?? "No open blocker is recorded."}
          badge={blockerBadge.label}
          badgeVariant={blockerBadge.variant}
        />
      </Card>
    </section>
  );
}

function AgentNowRibbon({
  project,
  presentation,
}: {
  project: EngineeringProjectSnapshot;
  presentation: ReturnType<typeof buildAgentNowPresentation>;
}): JSX.Element {
  const pulse = projectPulseStatus(presentation);
  if (presentation.kind === "active-run") {
    return (
      <RibbonFacts
        label="AGENT NOW"
        value={workTitle(project, presentation.run)}
        detail={agentRunSummary(project, presentation.run)}
        badge={pulse.label}
        badgeVariant={recordStatusVariant(pulse.status)}
      />
    );
  }
  if (presentation.kind === "current-work") {
    return (
      <RibbonFacts
        label="AGENT NOW"
        value={presentation.work.title}
        detail={`Current work · ${workOwnerLabel(presentation.work.owner)}`}
        badge={pulse.label}
        badgeVariant={recordStatusVariant(pulse.status)}
      />
    );
  }
  if (presentation.kind === "last-settled-run") {
    return (
      <RibbonFacts
        label="AGENT NOW"
        value={workTitle(project, presentation.run)}
        detail={`${presentation.run.status.replaceAll("-", " ")} · ${
          formatDateTime(agentRunRecordedAt(presentation.run))
        }`}
        badge={pulse.label}
        badgeVariant={recordStatusVariant(pulse.status)}
      />
    );
  }
  return (
    <RibbonFacts
      label="AGENT NOW"
      value="No active run"
      detail="The project records no current agent execution."
      badge={pulse.label}
      badgeVariant={recordStatusVariant(pulse.status)}
    />
  );
}

function RibbonFacts({
  label,
  value,
  detail,
  badge,
  badgeVariant,
}: {
  label: string;
  value: string;
  detail: string;
  badge: string;
  badgeVariant: BadgeVariant;
}): JSX.Element {
  return (
    <>
      <p className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-sm font-medium">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      <Badge className="mt-2" variant={badgeVariant}>{badge}</Badge>
    </>
  );
}

// ---------------------------------------------------------------------------
// Exported helpers (used in other components and tests)
// ---------------------------------------------------------------------------

export function agentRunJournalItemName(
  title: string,
  status: EngineeringAgentRun["status"],
): string {
  return `${title} · ${sentenceLabel(status)}`;
}

function sentenceLabel(value: string): string {
  const label = value.replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

// ---------------------------------------------------------------------------
// Operations view
// ---------------------------------------------------------------------------

export function ProjectOperations({
  project,
  thread,
  fleet,
  onOpenWork,
}: {
  project: EngineeringProjectSnapshot;
  thread: ThreadWorkbenchSnapshot;
  /** Declared fleet topology; absent when the BFF serves no manifest. */
  fleet?: CockpitFleetProjection;
  /** Opens the Work space (run journal cross-link). */
  onOpenWork?: () => void;
}): JSX.Element {
  const view = buildOperationsFleetView(fleet, thread, project);
  const pendingDecisions = pendingHumanConfirmationDecisions(project);
  const preparationDecisions = agentPreparationDecisions(project);
  const activeRuns = project.agentRuns.filter(
    (r) => r.status === "queued" || r.status === "running",
  );
  const runningCount = activeRuns.filter(
    (r) => r.status === "running",
  ).length;
  const queuedCount = activeRuns.filter(
    (r) => r.status === "queued",
  ).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Recorded execution and human attention come before implementation surfaces. */}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <QueueCard
          runs={activeRuns}
          runningCount={runningCount}
          queuedCount={queuedCount}
          onOpenWork={onOpenWork}
          project={project}
        />
        <div className="flex flex-col gap-3">
          <MrtrCard decisions={pendingDecisions} />
          <AgentPreparationCard decisions={preparationDecisions} />
        </div>
      </div>

      {thread.evaluationCloseouts && (
        <EvaluationCloseoutCard index={thread.evaluationCloseouts} />
      )}

      {thread.assemblyIntegrity && (
        <AssemblyIntegrityCard index={thread.assemblyIntegrity} />
      )}

      <ContributingSystemsCard view={view} />

      <RunTimelineCard project={project} />

      {/* Full run journal — collapsed by default */}
      <details className={cn("overflow-hidden", CARD_SURFACE)}>
        <summary className="cursor-pointer px-4 py-3 font-mono text-[10px] text-muted-foreground select-none">
          {"Full run journal · "}
          <span className="tabular-nums">{project.agentRuns.length}</span>
          {" recorded"}
        </summary>
        <div className="px-4 pb-4">
          {project.agentRuns.length
            ? (
              <ol className="divide-y divide-border">
                {[...project.agentRuns].reverse().map((run) => {
                  const title = workTitle(project, run);
                  return (
                    <li
                      key={run.id}
                      data-state={run.status}
                      aria-label={agentRunJournalItemName(
                        title,
                        run.status,
                      )}
                      className="py-4 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="flex items-start gap-2 text-sm font-semibold">
                          <Badge
                            aria-hidden="true"
                            variant={recordStatusVariant(
                              run.status,
                            )}
                          >
                            {sentenceLabel(run.status)}
                          </Badge>
                          <span className="min-w-0">{title}</span>
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {agentRunSummary(project, run)}
                        </p>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Queued{" "}
                          <span className="font-mono">
                            {formatDateTime(run.queuedAt)}
                          </span>
                          {" · "}
                          <span className="font-mono tabular-nums">
                            {run.evidenceRefs.length}
                          </span>{" "}
                          published evidence ref
                          {run.evidenceRefs.length === 1 ? "" : "s"}
                        </p>
                        <AgentRunLifecycle run={run} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )
            : (
              <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
                No agent run is recorded.
              </p>
            )}
        </div>
      </details>

      <details className={cn("overflow-hidden", CARD_SURFACE)}>
        <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-muted-foreground select-none">
          Technical provenance
        </summary>
        <div className="space-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <p className="font-mono text-[10px]">
            declared fleet · config/mcp-fleet.json · no LLM inside any tool
          </p>
          <p>
            Surface states are derived from recorded Thread stages and evidence
            timestamps. They are not runtime health checks.
          </p>
        </div>
      </details>
    </div>
  );
}

/** Read-only L5 evidence card. The paired conversation owns every command. */
function EvaluationCloseoutCard({
  index,
}: {
  index: NonNullable<ThreadWorkbenchSnapshot["evaluationCloseouts"]>;
}): JSX.Element {
  const current = index.cards.find((card) => card.status === "current");
  const card = current ?? index.cards[0];
  const variant: BadgeVariant = index.status === "current"
    ? "success"
    : index.status === "historical" || index.status === "unresolved"
    ? "warning"
    : "secondary";
  const passingCriteria =
    card?.criteria.filter((criterion) => criterion.status === "pass").length ??
      0;
  return (
    <Card
      className="overflow-hidden"
      data-closeout-family="static-mechanical"
      aria-labelledby="operations-closeout-title"
    >
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h4
          id="operations-closeout-title"
          className="font-mono text-[9.5px] tracking-[.1em] text-muted-foreground"
        >
          STATIC-MECHANICAL L5 CLOSEOUT
        </h4>
        <Badge variant={variant}>{sentenceLabel(index.status)}</Badge>
      </CardHeader>
      <CardContent className="px-3 py-3">
        {!card
          ? (
            <p className="text-sm text-muted-foreground">
              No human static-mechanical closeout is recorded on this Thread. L4
              evidence, including a pass, is not L5.
            </p>
          )
          : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={card.humanDisposition === "accept"
                    ? "success"
                    : "warning"}
                >
                  Human {card.humanDisposition}
                </Badge>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {card.acceptanceEligibility
                    ? "all declared L4 criteria pass"
                    : "accept not eligible"}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {passingCriteria}/{card.criteria.length}{" "}
                  declared L4 criteria pass
                </span>
                {card.humanDisposition === "reject" && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    disposition · {card.rejectionDisposition}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Read-only record: no engine, SysON, CAD, correction, or MCP
                command is available here.
              </p>
              <details className="rounded-md border border-border bg-muted/20">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground select-none">
                  Review criteria, proof boundaries and evidence identifiers
                </summary>
                <div className="space-y-2.5 border-t border-border px-3 py-3">
                  <ul className="space-y-1.5">
                    {card.criteria.map((criterion) => (
                      <li
                        key={criterion.evaluationId}
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                      >
                        <Badge
                          variant={criterion.status === "pass"
                            ? "success"
                            : criterion.status === "fail"
                            ? "destructive"
                            : "warning"}
                        >
                          {criterion.status}
                        </Badge>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {criterion.proofCriterionId} →{" "}
                          {criterion.evaluationId}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Proof boundary ·{" "}
                    {card.proofLimitations.proofScope}. Evidence boundary ·{" "}
                    {card.proofLimitations.evidenceBoundary}.
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground break-all">
                    basis {card.basis.snapshotId}@{card.basis.revision} · STEP
                    {" "}
                    {card.evidence.canonicalStep.id} · proof{" "}
                    {card.evidence.sealedProof.id} · execution{" "}
                    {card.evidence.executionEvidence.id} · L4{" "}
                    {card.evidence.evaluationCapture.id}
                  </p>
                </div>
              </details>
            </div>
          )}
      </CardContent>
    </Card>
  );
}

/**
 * Read-only L3 → L4 → L5 assembly-integrity lineage. L4 is the only
 * engineering verdict shown here; L5 is an independently signed disposition.
 */
function AssemblyIntegrityCard({
  index,
}: {
  index: NonNullable<ThreadWorkbenchSnapshot["assemblyIntegrity"]>;
}): JSX.Element {
  const current = index.chains.find((chain) => chain.status === "current");
  const chain = current ?? index.chains[0];
  const l4 = chain?.evaluation;
  const l5 = chain?.closeout;
  const variant: BadgeVariant = index.status === "current"
    ? "success"
    : index.status === "historical" || index.status === "unresolved"
    ? "warning"
    : "secondary";
  return (
    <Card
      className="overflow-hidden"
      data-closeout-family="assembly-integrity"
      aria-labelledby="operations-assembly-integrity-title"
    >
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <h4
            id="operations-assembly-integrity-title"
            className="font-mono text-[9.5px] tracking-[.1em] text-muted-foreground"
          >
            ASSEMBLY INTEGRITY · L3 → L4 → L5
          </h4>
          <p className="m-0 mt-0.5 text-[10px] text-muted-foreground">
            Versioned evidence chain · read only
          </p>
        </div>
        <Badge variant={variant}>{sentenceLabel(index.status)}</Badge>
      </CardHeader>
      <CardContent className="space-y-3 px-3 py-3">
        {!chain
          ? (
            <p className="text-sm text-muted-foreground">
              No assembly-integrity record is available on this Thread.
            </p>
          )
          : (
            <>
              <section className="rounded-md border border-border bg-muted/15 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="m-0 text-xs font-medium">L3 · observed facts</p>
                  <Badge variant="secondary">No verdict</Badge>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                  Import{" "}
                  {assemblyFactLabel(chain.observation.facts.importability)} ·
                  {" "}
                  solid count {assemblyFactLabel(
                    chain.observation.facts.importFacts.solidCount,
                  )} · {chain.observation.facts.occurrences.length}{" "}
                  occurrence facts · {chain.observation.facts.pairs.length}{" "}
                  pair facts.
                </p>
                <p className="m-0 text-[10px] text-muted-foreground">
                  Limits · no fitness, safety, motion or strength conclusion.
                </p>
              </section>

              <section className="rounded-md border border-border px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="m-0 text-xs font-medium">
                    L4 · recorded evaluation
                  </p>
                  {l4
                    ? (
                      <Badge
                        variant={assemblyVerdictVariant(l4.aggregateVerdict)}
                      >
                        {l4.aggregateVerdict}
                      </Badge>
                    )
                    : <Badge variant="secondary">Not recorded</Badge>}
                </div>
                {l4
                  ? (
                    <>
                      <ul className="mt-2 grid gap-1 sm:grid-cols-2 xl:grid-cols-5">
                        {l4.criteria.map((criterion) => (
                          <li
                            key={criterion.id}
                            className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground"
                          >
                            <span>{sentenceLabel(criterion.id)}</span>
                            <Badge
                              variant={assemblyVerdictVariant(
                                criterion.verdict,
                              )}
                            >
                              {criterion.verdict}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                      <p className="mb-0 mt-2 text-[10px] leading-snug text-muted-foreground">
                        Scope only: import, occurrence coverage, placement
                        recross, BRep validity and pairwise intersection. Not
                        safety, joints, clearance, motion, load or fabrication.
                      </p>
                    </>
                  )
                  : (
                    <p className="mb-0 mt-1.5 text-[11px] text-muted-foreground">
                      No L4 evaluation is recorded for this L3 observation.
                    </p>
                  )}
              </section>

              <section className="rounded-md border border-border px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="m-0 text-xs font-medium">
                    L5 · human disposition
                  </p>
                  {l5
                    ? (
                      <Badge
                        variant={l5.humanDisposition === "accept"
                          ? "success"
                          : "warning"}
                      >
                        Human {l5.humanDisposition}
                      </Badge>
                    )
                    : <Badge variant="secondary">Not recorded</Badge>}
                </div>
                {l5
                  ? (
                    <>
                      <p className="mb-0 mt-1.5 text-[11px] text-muted-foreground">
                        Authority · {l5.verificationAuthority.id}@
                        {l5.verificationAuthority.version}. A recorded L4 pass
                        is not the human L5 decision.
                      </p>
                      <div
                        className="mt-2 rounded border border-border bg-muted/20 px-2.5 py-2"
                        data-formal-gate="assembly-integrity"
                      >
                        <p className="m-0 text-[10px] font-medium text-muted-foreground">
                          Formal gate claims · separate from the activity stage
                          band
                        </p>
                        {l5.gateClaims.length
                          ? (
                            <ul className="mt-1 space-y-1">
                              {l5.gateClaims.map((claim) => (
                                <li
                                  key={claim.gateItemId}
                                  className="font-mono text-[10px] text-muted-foreground"
                                >
                                  {claim.gateItemId} · {claim.role} ·{" "}
                                  {claim.status}
                                </li>
                              ))}
                            </ul>
                          )
                          : (
                            <p className="mb-0 mt-1 text-[10px] text-muted-foreground">
                              No signed gate claim is recorded.
                            </p>
                          )}
                      </div>
                      <p className="mb-0 mt-2 text-[10px] leading-snug text-muted-foreground">
                        Limits · no certification; no generic SysML requirement
                        evaluation; L4 scope remains unchanged.
                      </p>
                    </>
                  )
                  : (
                    <p className="mb-0 mt-1.5 text-[11px] text-muted-foreground">
                      No human L5 disposition is recorded. L4 remains a separate
                      engineering result.
                    </p>
                  )}
              </section>

              <details className="rounded-md border border-border bg-muted/10">
                <summary className="cursor-pointer px-3 py-2 text-[10px] text-muted-foreground select-none">
                  Exact lineage and evidence identities
                </summary>
                <div className="space-y-1 border-t border-border px-3 py-2 font-mono text-[9.5px] text-muted-foreground break-all">
                  <p className="m-0">L3 · {chain.observation.record.id}</p>
                  {l4 && <p className="m-0">L4 · {l4.record.id}</p>}
                  {l5 && <p className="m-0">L5 · {l5.record.id}</p>}
                  <p className="m-0">
                    chain state · {chain.status} · basis{" "}
                    {chain.observation.basis.snapshotId}@
                    {chain.observation.basis.revision}
                  </p>
                </div>
              </details>
            </>
          )}
      </CardContent>
    </Card>
  );
}

function assemblyFactLabel(
  fact:
    | { readonly status: "observed"; readonly value: unknown }
    | { readonly status: "unresolved"; readonly reason: string }
    | { readonly status: "unavailable"; readonly reason: string },
): string {
  return fact.status === "observed" ? String(fact.value) : fact.status;
}

function assemblyVerdictVariant(
  verdict: "pass" | "fail" | "unresolved",
): BadgeVariant {
  return verdict === "pass"
    ? "success"
    : verdict === "fail"
    ? "destructive"
    : "warning";
}

// ---------------------------------------------------------------------------
// Contributing systems
// ---------------------------------------------------------------------------

function ContributingSystemsCard({
  view,
}: {
  view: ReturnType<typeof buildOperationsFleetView>;
}): JSX.Element {
  const summary = view.source === "declared-fleet"
    ? `${view.summary.declared} declared · ${view.summary.observed} with recorded evidence`
    : `${view.summary.observed} observed · declared manifest unavailable`;
  return (
    <Card
      className="overflow-hidden"
      aria-labelledby="operations-systems-title"
    >
      <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border px-4 py-3">
        <h4
          id="operations-systems-title"
          className={SECTION_LABEL}
        >
          Contributing engineering systems
        </h4>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {summary}
        </span>
      </CardHeader>
      {view.cards.length > 0
        ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <caption className="sr-only">
                Declared or observed engineering systems and their recorded
                project state
              </caption>
              <thead className="bg-muted/30">
                <tr className="border-b border-border">
                  {[
                    "Surface",
                    "Role",
                    "Requirement",
                    "Recorded state",
                    "Last evidence",
                    "Stages",
                  ].map((label) => (
                    <th
                      key={label}
                      scope="col"
                      className="px-4 py-2 font-mono text-[9.5px] font-medium uppercase tracking-[.08em] text-muted-foreground"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {view.cards.map((card) => (
                  <tr key={card.id} data-state={card.state}>
                    <td className="px-4 py-3 align-top">
                      <p className="text-sm font-semibold text-foreground">
                        {card.displayName}
                      </p>
                      {card.id !== card.displayName && (
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {card.id}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground align-top">
                      {card.role || "Recorded system"}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge variant="secondary">
                        {fleetRequirementLabel(card)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge variant={fleetStateVariant(card)}>
                        {fleetStateLabel(card)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground tabular-nums align-top">
                      {card.lastEvidenceAt
                        ? formatDateTime(card.lastEvidenceAt)
                        : "Not recorded"}
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground tabular-nums align-top">
                      {card.stageCount}{" "}
                      {card.stageCount === 1 ? "stage" : "stages"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        : (
          <CardContent className="px-4 py-5">
            <p className="text-sm text-muted-foreground">
              No contributing engineering system is recorded.
            </p>
          </CardContent>
        )}
      <div className="border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        {view.source === "declared-fleet"
          ? "Declared surfaces with no project record remain visible. Recorded state is not runtime health."
          : "Declared fleet manifest unavailable. Showing only systems observed in recorded Thread stages."}
      </div>
    </Card>
  );
}

function fleetRequirementLabel(card: FleetCardView): string {
  if (card.required === undefined) return "Not declared";
  return card.required ? "Required" : "Optional";
}

function fleetStateLabel(card: FleetCardView): string {
  if (card.freshness === undefined) return "No project record";
  if (card.freshness === "fresh") return "Fresh";
  if (card.freshness === "running") return "Running";
  if (card.freshness === "failed") return "Failed";
  return "Stale";
}

function fleetStateVariant(card: FleetCardView): BadgeVariant {
  if (card.freshness === "fresh") return "success";
  if (card.freshness === "running") return "info";
  if (card.freshness === "failed") return "destructive";
  if (card.freshness === "stale") return "warning";
  return "secondary";
}

// ---------------------------------------------------------------------------
// Agent preparation (not an MRTR decision)
// ---------------------------------------------------------------------------

function AgentPreparationCard({
  decisions,
}: {
  decisions: readonly EngineeringDecision[];
}): JSX.Element {
  return (
    <Card
      className="overflow-hidden"
      aria-labelledby="operations-preparation-title"
    >
      <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border px-3 py-2">
        <h4
          id="operations-preparation-title"
          className="font-mono text-[9.5px] tracking-[.1em] text-muted-foreground"
        >
          AGENT PROPOSAL PREPARATION
        </h4>
        {decisions.length > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {decisions.length} {decisions.length === 1 ? "RECORD" : "RECORDS"}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-2 px-3 py-2.5">
        {decisions.length > 0
          ? decisions.map((decision) => (
            <PreparationRow key={decision.id} decision={decision} />
          ))
          : (
            <p className="text-sm text-muted-foreground">
              No proposal preparation is recorded.
            </p>
          )}
        <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
          Required and rejected records are not concrete decisions for human
          confirmation. Only a later <strong>proposed</strong>{" "}
          decision enters the MRTR card above.
        </p>
      </CardContent>
      <div className="border-t border-border bg-muted/30 px-3 py-1.5 font-mono text-[9.5px] text-muted-foreground">
        Agent preparation · paired conversation
      </div>
    </Card>
  );
}

function PreparationRow({
  decision,
}: {
  decision: EngineeringDecision;
}): JSX.Element {
  const label = decision.status === "rejected"
    ? "Revision requested"
    : "Agent preparing";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">{label}</Badge>
      <span className="min-w-0 text-sm font-medium text-foreground">
        {decision.title}
      </span>
      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
        {formatDateTime(decision.requestedAt)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MRTR card
// ---------------------------------------------------------------------------

function MrtrCard({
  decisions,
}: {
  decisions: readonly EngineeringDecision[];
}): JSX.Element {
  return (
    <Card
      className="overflow-hidden"
      aria-labelledby="operations-confirmations-title"
    >
      <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border px-3 py-2">
        <h4
          id="operations-confirmations-title"
          className="font-mono text-[9.5px] tracking-[.1em] text-muted-foreground"
        >
          HUMAN CONFIRMATIONS · MRTR
        </h4>
        {decisions.length > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-warning">
            {decisions.length} {decisions.length === 1 ? "WAITING" : "WAITING"}
          </span>
        )}
      </CardHeader>
      <CardContent className="px-3 py-2.5 space-y-2">
        {decisions.length > 0
          ? decisions.map((d) => <DecisionRow key={d.id} decision={d} />)
          : (
            <p className="text-sm text-muted-foreground">
              No proposed decision is waiting for human confirmation.
            </p>
          )}
        <p className="text-[11px] text-muted-foreground leading-snug pt-1">
          Only concrete proposed decisions appear here. Confirmation stays in
          the paired conversation; this read-only cockpit only projects the
          recorded pending state.
        </p>
      </CardContent>
      <div className="border-t border-border bg-muted/30 px-3 py-1.5 font-mono text-[9.5px] text-muted-foreground">
        MRTR · human approval or rejection in the paired conversation
      </div>
    </Card>
  );
}

function DecisionRow({
  decision,
}: {
  decision: EngineeringDecision;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant="warning">Needs review</Badge>
      <span className="text-sm font-medium text-foreground min-w-0">
        {decision.title}
      </span>
      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
        {formatDateTime(decision.requestedAt)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue card
// ---------------------------------------------------------------------------

function QueueCard({
  runs,
  runningCount,
  queuedCount,
  onOpenWork,
  project,
}: {
  runs: readonly EngineeringAgentRun[];
  runningCount: number;
  queuedCount: number;
  onOpenWork?: () => void;
  project: EngineeringProjectSnapshot;
}): JSX.Element {
  return (
    <Card
      className="overflow-hidden flex flex-col"
      aria-labelledby="operations-queue-title"
    >
      <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border px-3 py-2">
        <h4
          id="operations-queue-title"
          className="font-mono text-[9.5px] tracking-[.1em] text-muted-foreground"
        >
          EXECUTION NOW · QUEUE
        </h4>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {runningCount} {runningCount === 1 ? "RUNNING" : "RUNNING"}·
          {queuedCount} {queuedCount === 1 ? "QUEUED" : "QUEUED"}
        </span>
      </CardHeader>
      <CardContent className="flex-1 px-0 py-1">
        {runs.length > 0
          ? (
            <ul>
              {runs.map((run) => (
                <QueueRow key={run.id} run={run} project={project} />
              ))}
            </ul>
          )
          : (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No run is queued or running.
            </p>
          )}
      </CardContent>
      <div className="border-t border-border bg-muted/30 px-3 py-1.5">
        <button
          type="button"
          onClick={() => onOpenWork?.()}
          className="font-medium text-sm text-brand hover:underline cursor-pointer bg-transparent border-0 p-0"
        >
          Open recorded activity in Work →
        </button>
      </div>
    </Card>
  );
}

function QueueRow({
  run,
  project,
}: {
  run: EngineeringAgentRun;
  project: EngineeringProjectSnapshot;
}): JSX.Element {
  const isRunning = run.status === "running";
  const title = workTitle(project, run);
  const timeLabel = isRunning
    ? `running since ${formatDateTime(runningStartTime(run))}`
    : `queued ${formatDateTime(run.queuedAt)}`;
  return (
    <li className="grid grid-cols-[14px_1fr_auto] gap-x-2 px-3 py-1.5">
      <span
        className={cn(
          "font-mono text-[10px] leading-5",
          isRunning ? "text-brand" : "text-muted-foreground",
        )}
      >
        {isRunning ? "▸" : "⧗"}
      </span>
      <span className="text-[11.5px] text-foreground leading-5 truncate">
        {title}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground tabular-nums leading-5 shrink-0">
        {timeLabel}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Run lifecycle (used in journal)
// ---------------------------------------------------------------------------

function AgentRunLifecycle({ run }: { run: EngineeringAgentRun }): JSX.Element {
  const history = run.statusHistory?.length ? run.statusHistory : [{
    commandId: run.id,
    status: "queued" as const,
    at: run.queuedAt,
    actor: { id: "recorded operator", origin: "human" as const },
    summary: "Run entered the agent queue.",
  }];
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        {history.length} lifecycle transition
        {history.length === 1 ? "" : "s"}
      </summary>
      <ol className="mt-2 space-y-2">
        {history.map((transition) => (
          <li
            key={`${transition.commandId}:${transition.status}`}
            data-state={transition.status}
          >
            <p className="text-xs font-medium">
              {sentenceLabel(transition.status)}
            </p>
            <p className="text-xs text-muted-foreground">
              {transition.actor.origin}·
              <span className="font-mono">{transition.actor.id}</span>
              {" · "}
              <span className="font-mono">
                {formatDateTime(transition.at)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {transition.summary}
            </p>
          </li>
        ))}
      </ol>
      {run.claimedBy && (
        <p className="mt-2 text-xs text-muted-foreground">
          Claimed by <code className="font-mono">{run.claimedBy.id}</code>
          {run.claimedAt ? ` at ${formatDateTime(run.claimedAt)}` : ""}
        </p>
      )}
      {run.waitingForDecisionIds?.length
        ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Waiting for{" "}
            <span className="font-mono">
              {run.waitingForDecisionIds.join(", ")}
            </span>
          </p>
        )
        : null}
      {run.resultSnapshot && (
        <p className="mt-2 text-xs text-muted-foreground">
          Result{" "}
          <code className="font-mono">
            {run.resultSnapshot.snapshotId}@{run.resultSnapshot.revision}
          </code>
        </p>
      )}
      {run.failure && (
        <p
          className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          <strong>{run.failure.code}</strong> {run.failure.message}
        </p>
      )}
    </details>
  );
}

// ---------------------------------------------------------------------------
// Private utilities
// ---------------------------------------------------------------------------

/**
 * Le déroulé des runs : une barre par run, coupée entre l'attente en file et
 * l'exécution.
 *
 * Les barres se mesurent contre le run le plus long, pas contre l'horloge :
 * sur une session d'une demi-heure, un axe absolu écraserait des durées de
 * quelques secondes contre le bord gauche et ne montrerait rien.
 */
function RunTimelineCard(
  { project }: { project: EngineeringProjectSnapshot },
): JSX.Element | null {
  const view = buildRunTimeline(project, (run) => workTitle(project, run));
  if (view.scaleSeconds === 0) return null;
  const share = waitShare(view);
  const percent = (seconds: number) =>
    `${(seconds / view.scaleSeconds) * 100}%`;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <span className={SECTION_LABEL}>Run timeline · queued vs running</span>
        {share !== undefined && (
          <span className="font-mono text-[9.5px] text-muted-foreground">
            {Math.round(share * 100)}% waiting ·{" "}
            {view.totalRunSeconds.toFixed(1)}s computed
          </span>
        )}
      </div>
      <ol className="m-0 flex list-none flex-col gap-2 p-3">
        {view.rows.map((row) => (
          <RunTimelineActivityRow
            key={row.id}
            row={row}
            percent={percent}
          />
        ))}
      </ol>
    </Card>
  );
}

function RunTimelineActivityRow({
  row,
  percent,
}: {
  row: RunTimelineRow;
  percent: (seconds: number) => string;
}): JSX.Element {
  const wait = row.waitSeconds ?? 0;
  const ran = row.runSeconds ?? 0;
  const historical = row.attempts.filter((attempt) =>
    attempt.id !== row.currentAttemptId
  );
  const showCounts = row.revisionCount > 1 || row.attemptCount > 1;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <Badge
              aria-hidden="true"
              variant={recordStatusVariant(row.status)}
            >
              {sentenceLabel(row.status)}
            </Badge>
            <span className="truncate text-[11.5px]" title={row.label}>
              {row.label}
            </span>
          </span>
          {showCounts && (
            <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
              {row.revisionCount > 1 ? `${row.revisionCount} revisions` : null}
              {row.revisionCount > 1 && row.attemptCount > 1 ? " · " : null}
              {row.attemptCount > 1 ? `${row.attemptCount} attempts` : null}
            </span>
          )}
        </span>
        <span
          className="flex h-2 items-stretch overflow-hidden rounded-full bg-muted"
          aria-hidden="true"
        >
          <i
            className="bg-muted-foreground/35"
            style={{ width: percent(wait) }}
          />
          <i className="bg-brand" style={{ width: percent(ran) }} />
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {row.waitSeconds === undefined
            // Jamais démarré : pas de durée, et surtout pas un zéro qui
            // se lirait « instantané ».
            ? "not started"
            : `${wait.toFixed(1)}s + ${
              row.runSeconds === undefined ? "…" : `${ran.toFixed(1)}s`
            }`}
        </span>
      </div>
      {historical.length > 0 && (
        <details className="pl-0.5">
          <summary className="cursor-pointer font-mono text-[10px] text-muted-foreground select-none">
            {historical.length} earlier{" "}
            {historical.length === 1 ? "attempt" : "attempts"}
          </summary>
          <ol className="mt-1 space-y-1">
            {historical.map((attempt) => (
              <li
                key={attempt.id}
                data-state={attempt.status}
                className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground"
              >
                <Badge
                  aria-hidden="true"
                  variant={recordStatusVariant(attempt.status)}
                >
                  {sentenceLabel(attempt.status)}
                </Badge>
                <span>
                  {attempt.waitSeconds === undefined
                    ? "not started"
                    : `${attempt.waitSeconds.toFixed(1)}s + ${
                      attempt.runSeconds === undefined
                        ? "…"
                        : `${attempt.runSeconds.toFixed(1)}s`
                    }`}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function workTitle(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): string {
  return project.workItems.find((item) => item.id === run.workItemId)
    ?.title ?? run.workItemId;
}

function runningStartTime(run: EngineeringAgentRun): string {
  const transition = run.statusHistory?.find(
    (t) => t.status === "running",
  );
  return transition?.at ?? run.startedAt ?? run.queuedAt;
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
