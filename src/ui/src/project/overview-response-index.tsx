/**
 * Read-only exhaustive index of every approved brief item.
 *
 * Server joins, React renders: input is only the already computed
 * `project-response/2.0` read model, or a historical `project-response/1.0`
 * payload (or `undefined` on an older host, in
 * which case the old view is preserved untouched). No MCP calls, no
 * mutations, no aggregate verdict — `available` means the index was read,
 * never that the response is ready.
 */

import { type JSX, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { CARD_SURFACE, DATA_LINE, SECTION_LABEL } from "../ui/cockpit.tsx";
import type { ThreadGraphRef } from "../thread/types.ts";
import {
  applicabilityLabel,
  clauseResponsesOn,
  correspondenceLabel,
  DEFAULT_RESPONSE_FILTER,
  freshnessLabel,
  hasResponseGap,
  isResponseBasisMatch,
  parseProjectResponse,
  type ProjectResponseBasis,
  type ProjectResponseClauseResponse,
  type ProjectResponseCorrespondence,
  type ProjectResponseDocument,
  type ProjectResponseEvaluation,
  type ProjectResponseItem,
  type ProjectResponseReadModel,
  type ProjectResponseRequirementEvidence,
  type ProjectResponseV1Item,
  responseIndexSummary,
  sourceStateLabel,
} from "./overview-response-index-model.ts";

type ResponseFilter = "gaps" | "all";

export function OverviewResponseIndex({
  response,
  expectedBasis,
  onOpenEvidence,
}: {
  /** Server-owned `project-response/2.0` or historical `/1.0` payload. */
  readonly response?: unknown;
  /**
   * Basis of the containing Project/Thread view. A payload must name the
   * same exact basis before an evidence link can target this Thread.
   */
  readonly expectedBasis?: ProjectResponseBasis;
  /** Opens the exact recorded artifact/requirement/evaluation/observation. */
  readonly onOpenEvidence?: (reference: ThreadGraphRef) => void;
}): JSX.Element | null {
  const [filter, setFilter] = useState<ResponseFilter>(DEFAULT_RESPONSE_FILTER);
  if (response === undefined) return null;
  const parsed = parseProjectResponse(response);
  if (!parsed.ok) {
    return (
      <section
        className="overview-response-index overview-response-index--dock rounded-lg border border-destructive/40 bg-card px-3.5 py-2.5"
        aria-label="Réponse au brief illisible"
      >
        <p className="m-0 text-[13px] font-semibold">
          Réponse au brief illisible
        </p>
        <p className="m-0 mt-0.5 text-xs text-muted-foreground">
          Le serveur a renvoyé un index inexploitable ; aucune couverture
          n&apos;est déduite.
        </p>
        <ul className="m-0 mt-1.5 list-none space-y-0.5 p-0">
          {parsed.issues.map((issue) => (
            <li
              key={issue.code + issue.message}
              className={cn(
                "font-mono text-[11px] text-destructive",
                DATA_LINE,
              )}
            >
              {issue.code} · {issue.message}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const model = parsed.model;
  if (model.status !== "available") {
    return <UnavailableResponseIndex model={model} />;
  }
  if (!isResponseBasisMatch(expectedBasis, model.basis)) {
    return <MismatchedResponseIndex model={model} />;
  }
  const gapItems = model.items.filter(hasResponseGap);
  const visible = filter === "gaps" ? gapItems : model.items;
  const hiddenCount = model.items.length - gapItems.length;
  return (
    <section
      className={cn(
        CARD_SURFACE,
        "overview-response-index overview-response-index--dock px-3.5 py-2.5 shadow-sm",
      )}
      aria-label="Réponse au brief"
    >
      <details>
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("shrink-0", SECTION_LABEL)}>
              Réponse au brief
            </span>
            <span className="text-[13px] font-semibold">
              {responseIndexSummary(model)}
            </span>
            {gapItems.length > 0 && (
              <Badge variant="warning">
                {gapItems.length === 1
                  ? "1 lacune"
                  : `${gapItems.length} lacunes`}
              </Badge>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Index lisible de chaque élément approuvé · ni preuve ni réception.
          </span>
        </summary>
        <div
          className="mt-2 flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filtre des éléments"
        >
          <FilterButton
            active={filter === "gaps"}
            onClick={() => setFilter("gaps")}
          >
            {`Lacunes (${gapItems.length})`}
          </FilterButton>
          <FilterButton
            active={filter === "all"}
            onClick={() => setFilter("all")}
          >
            {`Tout voir (${model.items.length})`}
          </FilterButton>
        </div>
        {filter === "gaps" && hiddenCount > 0 && (
          <p className="m-0 mt-1 text-xs text-muted-foreground">
            {hiddenCount === 1
              ? "1 élément sans lacune explicite masqué."
              : `${hiddenCount} éléments sans lacune explicite masqués.`}{" "}
            Seules les lacunes explicites du serveur filtrent cette vue.
          </p>
        )}
        {model.diagnostics.length > 0 && (
          <details className="mt-1.5">
            <summary className={cn("cursor-pointer text-xs", DATA_LINE)}>
              Diagnostics de provenance ({model.diagnostics.length})
            </summary>
            <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
              {model.diagnostics.map((diagnostic) => (
                <li
                  key={diagnostic.code + diagnostic.message}
                  className={cn(DATA_LINE)}
                >
                  {diagnostic.code} · {diagnostic.message}
                </li>
              ))}
            </ul>
          </details>
        )}
        {visible.length === 0
          ? (
            <p className="m-0 mt-2 text-xs text-muted-foreground">
              Aucune lacune enregistrée sur cette base.
            </p>
          )
          : (
            <ol className="m-0 mt-2 list-none space-y-1.5 overflow-y-auto p-0 pr-1">
              {visible.map((row) => (
                <ResponseRow
                  key={`${
                    model.basis?.brief.snapshotId ?? "brief"
                  }:${row.item.id}`}
                  row={row}
                  clauseResponses={clauseResponsesOn(model, row)}
                  markGap={filter === "all"}
                  onOpenEvidence={onOpenEvidence}
                />
              ))}
            </ol>
          )}
        <BasisProvenance model={model} />
      </details>
    </section>
  );
}

function UnavailableResponseIndex(
  { model }: { readonly model: ProjectResponseDocument },
): JSX.Element {
  return (
    <section
      className={cn(
        CARD_SURFACE,
        "overview-response-index overview-response-index--dock px-3.5 py-2.5",
      )}
      aria-label="Réponse au brief indisponible"
    >
      <p className="m-0 text-[13px] font-semibold">
        Réponse au brief ·{" "}
        {model.status === "unavailable" ? "indisponible" : "non résolue"}
      </p>
      <p className="m-0 mt-0.5 text-xs text-muted-foreground">
        {model.basis
          ? `Base ${model.basis.brief.briefId} r${model.basis.brief.revision} · aucune couverture déduite.`
          : "Aucune base approuvée · aucune couverture déduite."}
      </p>
      {model.diagnostics.length > 0 && (
        <ul className="m-0 mt-1.5 list-none space-y-0.5 p-0">
          {model.diagnostics.map((diagnostic) => (
            <li
              key={diagnostic.code + diagnostic.message}
              className={cn(DATA_LINE)}
            >
              {diagnostic.code} · {diagnostic.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MismatchedResponseIndex(
  { model }: { readonly model: ProjectResponseDocument },
): JSX.Element {
  return (
    <section
      className="overview-response-index overview-response-index--dock rounded-lg border border-warning/40 bg-card px-3.5 py-2.5"
      aria-label="Réponse au brief sur une autre base"
    >
      <p className="m-0 text-[13px] font-semibold">
        Réponse au brief · base différente
      </p>
      <p className="m-0 mt-0.5 text-xs text-muted-foreground">
        L&apos;index reçu ne correspond pas au projet, brief ou thread affichés
        ; aucun lien n&apos;est proposé vers une autre base.
      </p>
      <BasisProvenance model={model} />
    </section>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: string;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-6 rounded-full border px-2.5 font-mono text-[10.5px] font-medium",
        active
          ? "border-border bg-muted text-foreground"
          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ResponseRow({
  row,
  clauseResponses,
  markGap,
  onOpenEvidence,
}: {
  readonly row: ProjectResponseV1Item | ProjectResponseItem;
  readonly clauseResponses: readonly ProjectResponseClauseResponse[];
  readonly markGap: boolean;
  readonly onOpenEvidence?: (reference: ThreadGraphRef) => void;
}): JSX.Element {
  const gap = hasResponseGap(row);
  const applicabilityStates = [
    ...new Set(
      row.requirements.flatMap((requirement) => [
        requirement.applicability,
        ...requirement.evaluations.map((evaluation) =>
          evaluation.applicability
        ),
      ]),
    ),
  ];
  return (
    <li className="overview-response-index-row rounded-md border border-border/70 px-2.5 py-1.5">
      <details>
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span
              className="line-clamp-2 w-full text-[12px] font-medium leading-relaxed"
              title={row.item.statement}
            >
              {row.item.statement}
            </span>
            <Badge variant="secondary">{row.item.kind}</Badge>
            <CorrespondenceBadge correspondence={row.correspondence} />
            {applicabilityStates.map((state) => (
              <Badge key={state} variant="secondary">
                {applicabilityLabel(state)}
              </Badge>
            ))}
            {markGap && gap && <Badge variant="warning">lacune</Badge>}
          </span>
        </summary>
        <p className="m-0 mt-1 text-[12.5px] leading-relaxed">
          {row.item.statement}
        </p>
        <p className={cn("m-0 mt-1 font-mono", DATA_LINE)}>
          {row.item.id}
        </p>
        {row.item.sourceRefs.length > 0 && (
          <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
            {row.item.sourceRefs.map((source) => (
              <li
                key={`${source.kind}:${source.reference}`}
                className={cn(DATA_LINE)}
              >
                source {source.kind} · {source.reference}
              </li>
            ))}
          </ul>
        )}
        {row.requirements.length === 0
          ? (
            <p className="m-0 mt-1 text-xs text-muted-foreground">
              Aucune exigence jointe sur cette base.
            </p>
          )
          : (
            <ul className="m-0 mt-1.5 list-none space-y-1.5 p-0">
              {row.requirements.map((requirement) => (
                <RequirementEntry
                  key={`${requirement.traceArtifactId}:${requirement.threadRequirementId}`}
                  requirement={requirement}
                  onOpenEvidence={onOpenEvidence}
                />
              ))}
            </ul>
          )}
        {clauseResponses.length > 0 && (
          <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
            {clauseResponses.map((record) => (
              <ClauseResponseEntry
                key={record.artifactId}
                record={record}
                onOpenEvidence={onOpenEvidence}
              />
            ))}
          </ul>
        )}
        {row.gaps.length > 0 && (
          <ul className="m-0 mt-1.5 list-none space-y-0.5 p-0">
            {row.gaps.map((item) => (
              <li
                key={item.code + item.message}
                className="text-[11.5px] text-muted-foreground"
              >
                <span className="font-mono text-[10.5px]">{item.code}</span>
                {" · "}
                {item.message}
              </li>
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

function ClauseResponseEntry({
  record,
  onOpenEvidence,
}: {
  readonly record: ProjectResponseClauseResponse;
  readonly onOpenEvidence?: (reference: ThreadGraphRef) => void;
}): JSX.Element {
  return (
    <li className="rounded border border-border/50 px-2 py-1.5">
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <EvidenceLink
          reference={{ kind: "artifact", id: record.artifactId }}
          onOpenEvidence={onOpenEvidence}
        />
        <Badge variant="warning">proposition documentaire</Badge>
        <span className={cn(DATA_LINE)}>
          {applicabilityLabel(record.applicability)}
          {" · "}
          {sourceStateLabel(record.sourceState)}
          {" · "}
          r{record.revision}
        </span>
      </span>
      <span className={cn("mt-0.5 block", DATA_LINE)}>
        {record.scope} · auteur agent · enregistrement, pas acceptation
      </span>
      <p className="m-0 mt-1 text-[12px] leading-relaxed">{record.answer}</p>
    </li>
  );
}

function RequirementEntry({
  requirement,
  onOpenEvidence,
}: {
  readonly requirement: ProjectResponseRequirementEvidence;
  readonly onOpenEvidence?: (reference: ThreadGraphRef) => void;
}): JSX.Element {
  return (
    <li className="rounded border border-border/50 px-2 py-1.5">
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <EvidenceLink
          reference={{
            kind: "requirement",
            id: requirement.threadRequirementId,
          }}
          onOpenEvidence={onOpenEvidence}
        />
        <Badge variant={requirement.origin === "native" ? "info" : "warning"}>
          {requirement.origin === "native" ? "native" : "documentaire"}
        </Badge>
        <span className={cn(DATA_LINE)}>
          {applicabilityLabel(requirement.applicability)}
          {" · "}
          {sourceStateLabel(requirement.sourceState)}
        </span>
      </span>
      <span className={cn("mt-0.5 block", DATA_LINE)}>
        source {requirement.sourceBrief.snapshotId} · {requirement.sourceItemId}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <EvidenceLink
          reference={{ kind: "artifact", id: requirement.traceArtifactId }}
          onOpenEvidence={onOpenEvidence}
        />
        <EvidenceLink
          reference={{
            kind: "artifact",
            id: requirement.requirementsArtifactId,
          }}
          onOpenEvidence={onOpenEvidence}
        />
      </span>
      {requirement.evaluations.length === 0
        ? (
          <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
            Aucune évaluation enregistrée.
          </span>
        )
        : (
          <ul className="m-0 mt-1 list-none space-y-1 p-0">
            {requirement.evaluations.map((evaluation) => (
              <EvaluationEntry
                key={evaluation.evaluationId}
                evaluation={evaluation}
                onOpenEvidence={onOpenEvidence}
              />
            ))}
          </ul>
        )}
      {requirement.origin === "documentary" && (
        <span className="mt-1 block text-[11px] text-muted-foreground">
          Déclaration documentaire : informative, ne vaut pas preuve de
          l&apos;élément.
        </span>
      )}
    </li>
  );
}

function EvaluationEntry({
  evaluation,
  onOpenEvidence,
}: {
  readonly evaluation: ProjectResponseEvaluation;
  readonly onOpenEvidence?: (reference: ThreadGraphRef) => void;
}): JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <EvidenceLink
        reference={{ kind: "evaluation", id: evaluation.evaluationId }}
        onOpenEvidence={onOpenEvidence}
      />
      <span className="font-mono text-[11px]">{evaluation.status}</span>
      <span className={cn(DATA_LINE)}>
        {applicabilityLabel(evaluation.applicability)} ·{" "}
        {freshnessLabel(evaluation.freshness)}
      </span>
      {evaluation.observationIds.map((id) => (
        <EvidenceLink
          key={`observation:${id}`}
          reference={{ kind: "observation", id }}
          onOpenEvidence={onOpenEvidence}
        />
      ))}
      {evaluation.evidenceArtifactIds.map((id) => (
        <EvidenceLink
          key={`artifact:${id}`}
          reference={{ kind: "artifact", id }}
          onOpenEvidence={onOpenEvidence}
        />
      ))}
    </li>
  );
}

function EvidenceLink({
  reference,
  onOpenEvidence,
}: {
  readonly reference: ThreadGraphRef;
  readonly onOpenEvidence?: (reference: ThreadGraphRef) => void;
}): JSX.Element {
  const label = `${reference.kind}:${reference.id}`;
  if (!onOpenEvidence) {
    return <span className="font-mono text-[11px]">{label}</span>;
  }
  return (
    <button
      type="button"
      title={label}
      onClick={() => onOpenEvidence(reference)}
      className="max-w-full truncate rounded px-0.5 font-mono text-[11px] text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
    >
      {reference.id}
    </button>
  );
}

function CorrespondenceBadge({
  correspondence,
}: {
  readonly correspondence: ProjectResponseCorrespondence;
}): JSX.Element {
  return (
    <Badge
      variant={correspondence === "native"
        ? "success"
        : correspondence === "documentary"
        ? "warning"
        : correspondence === "TRACE GAP"
        ? "destructive"
        : "outline"}
    >
      {correspondenceLabel(correspondence)}
    </Badge>
  );
}

function BasisProvenance(
  { model }: { readonly model: ProjectResponseDocument },
): JSX.Element | null {
  const basis = model.basis;
  if (!basis) return null;
  return (
    <details className="mt-2">
      <summary
        className={cn(
          "cursor-pointer",
          DATA_LINE,
          "list-none [&::-webkit-details-marker]:hidden",
        )}
      >
        provenance de la base
      </summary>
      <p className={cn("m-0 mt-0.5", DATA_LINE)}>
        {basis.projectId}@r{basis.projectRevision} · brief{" "}
        {basis.brief.snapshotId} r{basis.brief.revision}
        {basis.thread
          ? ` · thread ${basis.thread.snapshotId} r${basis.thread.revision}`
          : " · sans thread"}
      </p>
    </details>
  );
}

export type { ProjectResponseDocument, ProjectResponseReadModel };
