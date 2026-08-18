import type { JSX, ReactNode } from "react";
import { recordStatusVariant } from "./record-status.ts";
import type {
  EngineeringAgentRun,
  EngineeringBlocker,
  EngineeringPhaseStatus,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import { productDefinitionSummary } from "../thread/product-anchor-model.ts";
import { GltfAssetCanvas } from "../thread/gltf-asset-canvas.tsx";
import {
  resolveSealedAssemblyGeometry,
  sealedAssemblyGlbAsset,
} from "../thread/component-workspace-model.ts";
import { cn } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { DecisionCenter } from "./control-center.tsx";
import { ProjectBriefRecord } from "./brief-record.tsx";
import type { ProjectWorkspaceView } from "./navigation.tsx";
import {
  hasDistinctProjectObjectiveStatement,
  type ProjectDeepLinkTarget,
} from "./navigation-model.ts";
import {
  agentRunRecordedAt,
  agentRunSummary,
  buildCurrentProjectWork,
  buildProjectBrief,
  buildProjectPath,
  type ProjectPathPhaseView,
  projectPathStatusLabel,
  projectStatusTone,
  selectCurrentProjectFocus,
  splitLeadingSatisfiedGates,
  verificationChainDetail,
  workOwnerLabel,
  workStatusLabel,
} from "./model.ts";

export interface ProjectOverviewProps {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadWorkbenchSnapshot;
  readonly onNavigate: (view: ProjectWorkspaceView) => void;
  readonly onOpenActivity?: (decisionId?: string) => void;
  readonly onOpenDeepLink?: (target: ProjectDeepLinkTarget) => void;
  readonly onOpenEvidence?: (reference: EngineeringThreadEntityRef) => void;
}

/**
 * Grammaire de la page : une épine de gammes. Les phases ne sont pas une
 * carte parmi d'autres — elles sont l'axe vertical gauche, et la colonne
 * droite porte ce qui attend l'humain (Review) puis le pouls (Now). Le
 * record est un index de pied, pas une rangée de cartes.
 */
export function ProjectOverview({
  project,
  thread,
  onNavigate,
  onOpenActivity,
  onOpenDeepLink,
  onOpenEvidence,
}: ProjectOverviewProps): JSX.Element {
  const brief = buildProjectBrief(project);
  const currentWork = buildCurrentProjectWork(project);
  const projectPath = buildProjectPath(project, thread);
  const currentFocus = selectCurrentProjectFocus(project);
  const openBlocker = brief.openBlockers[0];
  const statusTone = projectStatusTone(projectPath.status);
  const statusLabel = projectPathStatusLabel(projectPath);
  const sealedAssembly = resolveSealedAssemblyGeometry(thread);
  const sealedAssemblyGlb = sealedAssembly
    ? sealedAssemblyGlbAsset(sealedAssembly)
    : undefined;
  const { collapsed: collapsedGates, visible: visiblePhases } =
    splitLeadingSatisfiedGates(projectPath.phases);

  // minmax(0,1fr) : sans lui, un contenu large imposerait sa largeur
  // min-content à toute la colonne (piège grid).
  return (
    <main
      className="grid grid-cols-[minmax(0,1fr)] gap-6"
      id="project-workspace-panel"
    >
      <section
        className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-start md:justify-between"
        aria-labelledby="project-objective-title"
      >
        <div className="min-w-0 [&>h3]:m-0 [&>h3]:max-w-3xl [&>h3]:text-balance [&>h3]:text-2xl [&>h3]:font-semibold [&>h3]:leading-snug [&>h3]:tracking-tight">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            Project objective
          </p>
          <h3 id="project-objective-title">
            {project.project.objective.title}
          </h3>
          {hasDistinctProjectObjectiveStatement(
            project.project.objective.title,
            project.project.objective.statement,
          ) && (
            <blockquote className="mt-3 max-w-3xl border-l-2 border-brand/30 pl-4 text-sm text-muted-foreground">
              {project.project.objective.statement}
            </blockquote>
          )}
        </div>
        {
          /* Cartouche : l'objet d'identité du sujet — statut, gates et
            révision exacte dans une grille à filets, comme le cartouche
            d'un plan technique. */
        }
        <div
          className="flex min-w-0 flex-col items-start gap-1.5 md:items-end"
          data-tone={statusTone}
          aria-label={`Project status: ${statusLabel}`}
        >
          {
            /* La colonne Status est la seule à rétrécir : les libellés de
              statut longs s'ellipsent au lieu de faire déborder le header. */
          }
          <dl className="grid max-w-full grid-cols-[minmax(0,1.4fr)_auto_auto] divide-x divide-border overflow-hidden rounded-md border border-border bg-card">
            <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
              <dt className="text-[10px] font-medium text-muted-foreground">
                Status
              </dt>
              <dd className="m-0 flex items-center gap-1.5 text-sm font-medium">
                <i
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    toneDotClass(statusTone),
                  )}
                />
                <span className="truncate" title={statusLabel}>
                  {statusLabel}
                </span>
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 px-3 py-2">
              <dt className="text-[10px] font-medium text-muted-foreground">
                Macro gates
              </dt>
              <dd className="m-0 font-mono text-sm tabular-nums">
                {projectPath.completedPhases}/{projectPath.phases.length}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 px-3 py-2">
              <dt className="text-[10px] font-medium text-muted-foreground">
                Snapshot
              </dt>
              <dd className="m-0 font-mono text-sm tabular-nums">
                @{project.revision}
              </dd>
            </div>
          </dl>
          {projectPath.status === "completed" && (
            <p className="text-xs text-muted-foreground">
              Concept/integration proof only · not certification or release
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-[17rem_minmax(0,1fr)]">
        {
          /* Colonne droite d'abord dans le DOM : en mobile (une colonne),
            Review et Now précèdent l'épine — l'ordre de lecture suit le
            devoir avant la position. */
        }
        <div className="flex min-w-0 flex-col gap-5 md:col-start-2 md:row-start-1">
          <DecisionCenter
            project={project}
            thread={thread}
            onOpenActivity={onOpenActivity}
            onOpenReview={(kind) =>
              onOpenDeepLink?.(reviewDeepLinkTarget(kind))}
            onOpenEvidence={onOpenEvidence}
          />
          <NowPanel
            project={project}
            activeRun={currentFocus.activeRun}
            focusWork={currentFocus.work}
            lastSettledRun={brief.lastSettledRun}
            nextWork={currentWork.nextWork[0]}
            openBlocker={openBlocker}
            onNavigate={onNavigate}
          />
        </div>

        <section
          className="md:col-start-1 md:row-start-1 [&>h3]:m-0 [&>h3]:mb-4 [&>h3]:text-base [&>h3]:font-semibold [&>h3]:tracking-tight"
          aria-labelledby="project-phase-title"
        >
          <h3 id="project-phase-title">Project path</h3>
          {/* display:grid retire le rôle liste sous VoiceOver/Safari. */}
          <ol className="grid" role="list">
            {collapsedGates.length > 0 && (
              <li
                data-state="completed"
                className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-3"
              >
                <span className="flex flex-col items-center">
                  <span
                    aria-hidden="true"
                    className="mt-1 size-3 shrink-0 rounded-full bg-success"
                  />
                  <span
                    aria-hidden="true"
                    className="w-0.5 flex-1 rounded-full bg-success/40"
                  />
                </span>
                <details className="min-w-0 pb-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {collapsedGates.length} earlier gates satisfied
                  </summary>
                  <ol className="mt-2 grid gap-1.5" role="list">
                    {collapsedGates.map((item) => (
                      <li
                        key={item.phase.id}
                        data-state={item.status}
                        className="min-w-0"
                      >
                        <span className="text-sm">{item.phase.name}</span>
                        <span className="sr-only">
                          {phaseStatusLabel(item.status)}
                        </span>
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {phaseCounterLabel(item)}
                        </p>
                      </li>
                    ))}
                  </ol>
                </details>
              </li>
            )}
            {visiblePhases.map((item, index) => (
              <SpinePhase
                key={item.phase.id}
                item={item}
                isLast={index === visiblePhases.length - 1}
              />
            ))}
          </ol>
          {
            /* L'épine se termine dans le produit — seulement quand la
              géométrie scellée existe : un placeholder rappellerait un
              manque pendant toutes les phases amont. */
          }
          {sealedAssemblyGlb?.uri && (
            <div className="mt-6 flex flex-col gap-2">
              {
                /* « preview » : le GLB est le dérivé de présentation du STEP
                  scellé, pas le sceau lui-même. */
              }
              <p className="text-xs font-medium text-muted-foreground">
                Sealed assembly preview · GLB
              </p>
              <div className="thread-spine-geometry overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                <GltfAssetCanvas
                  url={sealedAssemblyGlb.uri}
                  ariaLabel="Interactive sealed assembly geometry"
                  loadingLabel="Loading sealed model…"
                  errorLabel="Sealed model unavailable"
                />
              </div>
            </div>
          )}
        </section>
      </div>

      <section
        className="border-t border-border pt-5"
        aria-labelledby="evidence-overview-title"
      >
        <h3
          id="evidence-overview-title"
          className="m-0 mb-3 text-xs font-medium text-muted-foreground"
        >
          Technical record
        </h3>
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-3">
          <RecordRoute
            title="Product"
            detail={productDefinitionSummary(thread)}
            action="Explore product"
            href="#product"
            onOpen={() => onNavigate("product")}
          />
          <RecordRoute
            title="Evidence"
            detail={verificationChainDetail(thread)}
            action="Trace evidence"
            href="#verification"
            onOpen={() => onNavigate("verification")}
          />
          <RecordRoute
            title="Activity"
            detail={`${thread.graph.nodes.length} recorded facts. Latest change: ${thread.change.title}.`}
            action="Follow activity"
            href="#work"
            onOpen={() => onNavigate("work")}
          />
        </div>
        <details className="mt-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Exact project and thread revisions
          </summary>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <dt>Project snapshot</dt>
              <dd className="font-mono text-xs">
                {project.id}@{project.revision}
              </dd>
            </div>
            <div>
              <dt>Thread projection</dt>
              <dd className="font-mono text-xs">{thread.id}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd className="font-mono text-xs">
                {project.project.subjectId}
              </dd>
            </div>
          </dl>
        </details>
      </section>
      <div
        id={project.framing?.proposalReview?.status === "pending"
          ? "current-brief-record"
          : "review-brief"}
      >
        <ProjectBriefRecord project={project} />
      </div>
    </main>
  );
}

/**
 * Une vertèbre de l'épine, à deux densités : seules les phases active ou
 * bloquée s'ouvrent (statut, tallies, lifecycle) ; les autres restent des
 * lignes compactes — le statut y est porté par le nœud, et répété en
 * sr-only pour ne pas reposer sur la forme seule. Un lifecycle en
 * attention reste visible même compact : il réclame une review.
 */
function SpinePhase(
  { item, isLast }: { item: ProjectPathPhaseView; isLast: boolean },
): JSX.Element {
  const open = item.status === "active" || item.status === "blocked";
  return (
    <li
      data-state={item.status}
      aria-current={item.status === "active" ? "step" : undefined}
      className="relative grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-3"
    >
      {
        /* La coupe : un trait au bord droit du li, à hauteur du nœud actif,
          qui traverse la gouttière (gap-6 = w-6) vers le panneau. Si la
          phase active est plus basse que Review+Now, il pointe vers le
          canvas — limite assumée. */
      }
      {open && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -right-6 top-[9px] hidden h-0.5 w-6 md:block",
            item.status === "blocked" ? "bg-destructive" : "bg-success",
          )}
        />
      )}
      <span className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={cn(
            "mt-1 size-3 shrink-0 rounded-full",
            phaseNodeClass(item.status),
          )}
        />
        {!isLast && (
          <span
            aria-hidden="true"
            className={cn(
              "w-0.5 flex-1 rounded-full",
              item.status === "completed" ? "bg-success/40" : "bg-border",
            )}
          />
        )}
      </span>
      {open
        ? (
          <div
            className={cn("flex min-w-0 flex-col gap-0.5", !isLast && "pb-5")}
          >
            <span className="text-sm font-medium">{item.phase.name}</span>
            <p className={cn("text-xs", phaseStatusTextClass(item.status))}>
              {phaseStatusLabel(item.status)}
            </p>
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              {phaseCounterLabel(item)}
            </p>
            {item.lifecycle && (
              <p
                className="text-xs text-muted-foreground"
                data-state={item.lifecycle.state}
              >
                {item.lifecycle.affectedComponentIds.length > 0
                  ? "Component"
                  : "Lifecycle"}
                {" · "}
                {projectPhaseLifecycleLabel(item.lifecycle)}
              </p>
            )}
          </div>
        )
        // Pas de ligne lifecycle en compact : un état en attention n'arrive
        // jamais ici, le remap de lifecycleEffectivePhaseStatus le fait
        // passer en `blocked`, donc la phase s'ouvre.
        : (
          <div className={cn("min-w-0", !isLast && "pb-3")}>
            <span className="text-sm font-medium">{item.phase.name}</span>
            <span className="sr-only">{phaseStatusLabel(item.status)}</span>
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              {phaseCounterLabel(item)}
            </p>
          </div>
        )}
    </li>
  );
}

/**
 * Le pouls en trois lignes, posé nu sur le canvas comme l'épine : Review
 * reste la seule surface blanche de la page — la seule chose qui demande
 * quelque chose à l'humain. Une ligne Blockers n'existe que s'il y a un
 * blocker ouvert.
 */
function NowPanel({
  project,
  activeRun,
  focusWork,
  lastSettledRun,
  nextWork,
  openBlocker,
  onNavigate,
}: {
  project: EngineeringProjectSnapshot;
  activeRun?: EngineeringAgentRun;
  focusWork?: EngineeringWorkItem;
  lastSettledRun?: EngineeringAgentRun;
  nextWork?: EngineeringWorkItem;
  openBlocker?: EngineeringBlocker;
  onNavigate: (view: ProjectWorkspaceView) => void;
}): JSX.Element {
  return (
    <section
      aria-label="Current project control"
      className="flex flex-col gap-3"
    >
      <p className="text-xs font-medium text-muted-foreground">Now</p>
      <div className="grid divide-y divide-border">
        <NowRow title="Agent now">
          {activeRun
            ? <AgentRunLine run={activeRun} project={project} />
            : focusWork
            ? <WorkItemLine item={focusWork} />
            : lastSettledRun
            ? <AgentRunLine run={lastSettledRun} project={project} settled />
            : (
              <p className="text-sm text-muted-foreground">
                No active work or agent run is recorded.
              </p>
            )}
        </NowRow>
        <NowRow title="Up next">
          {nextWork
            ? <WorkItemLine item={nextWork} />
            : (
              <p className="text-sm text-muted-foreground">
                No further current work is recorded. Historical retries remain
                in Activity.
              </p>
            )}
        </NowRow>
        {openBlocker && (
          <NowRow title="Blockers">
            <BlockerLine blocker={openBlocker} />
          </NowRow>
        )}
      </div>
      <a
        href="#work"
        className="group flex items-center gap-1 self-start text-sm font-medium text-brand hover:underline"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          onNavigate("work");
        }}
      >
        Open activity
        <span
          aria-hidden="true"
          className="transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </a>
    </section>
  );
}

function NowRow(
  { title, children }: { title: string; children: ReactNode },
): JSX.Element {
  return (
    <div className="grid gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      <p className="text-xs font-medium text-muted-foreground sm:pt-0.5">
        {title}
      </p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function AgentRunLine({ run, project, settled }: {
  run: EngineeringAgentRun;
  project: EngineeringProjectSnapshot;
  /** A settled run is history, never presented as in-flight activity. */
  settled?: boolean;
}): JSX.Element {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  return (
    <div className="min-w-0" data-state={run.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={recordStatusVariant(run.status)}>
          {sentenceLabel(run.status)}
        </Badge>
        <span className="text-sm font-medium">
          {workItem?.title ?? run.workItemId}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {agentRunSummary(project, run)}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {settled
          ? `Last agent run · ${formatShortTime(agentRunRecordedAt(run))}`
          : `Agent run · ${formatShortTime(run.startedAt ?? run.queuedAt)}`}
      </p>
    </div>
  );
}

function WorkItemLine({ item }: { item: EngineeringWorkItem }): JSX.Element {
  return (
    <div className="min-w-0" data-state={item.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={recordStatusVariant(item.status)}>
          {sentenceLabel(workStatusLabel(item.status))}
        </Badge>
        <span className="text-sm font-medium">{item.title}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {workOwnerLabel(item.owner)} · {item.kind}
      </p>
    </div>
  );
}

function BlockerLine(
  { blocker }: { blocker: EngineeringBlocker },
): JSX.Element {
  return (
    <div className="min-w-0" data-state="blocked">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="destructive">{sentenceLabel(blocker.kind)}</Badge>
        <span className="text-sm font-medium">{blocker.title}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {blocker.description}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Open since {formatShortDate(blocker.openedAt)}
      </p>
    </div>
  );
}

function RecordRoute({ title, detail, action, href, onOpen }: {
  title: string;
  detail: string;
  action: string;
  href: string;
  onOpen: () => void;
}): JSX.Element {
  return (
    <a
      href={href}
      className="group flex min-w-0 flex-col gap-1"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        onOpen();
      }}
    >
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-sm text-muted-foreground">{detail}</span>
      <span className="mt-1 flex items-center gap-1 text-sm font-medium text-brand">
        {action}
        <span
          aria-hidden="true"
          className="transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </span>
    </a>
  );
}

function reviewDeepLinkTarget(
  kind: "brief" | "architecture" | "requirements" | "geometry",
): ProjectDeepLinkTarget {
  return kind === "brief" ? "review/brief" : `review/${kind}`;
}

function toneDotClass(tone: ReturnType<typeof projectStatusTone>): string {
  if (tone === "active" || tone === "complete") return "bg-success";
  if (tone === "attention") return "bg-warning";
  if (tone === "blocked") return "bg-destructive";
  return "bg-muted-foreground";
}

function phaseNodeClass(status: EngineeringPhaseStatus): string {
  if (status === "completed") return "bg-success";
  if (status === "active") {
    return "border-2 border-success bg-background ring-4 ring-success/15";
  }
  if (status === "blocked") return "bg-destructive";
  return "border border-muted-foreground/40 bg-background";
}

function phaseStatusTextClass(status: EngineeringPhaseStatus): string {
  if (status === "active") return "font-medium text-success";
  if (status === "blocked") return "font-medium text-destructive";
  return "text-muted-foreground";
}

function sentenceLabel(value: string): string {
  const label = value.replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function phaseCounterLabel(
  item: ReturnType<typeof buildProjectPath>["phases"][number],
): string {
  const parts = [
    `${item.completedWorkItems}/${item.totalWorkItems} work`,
    `${item.evidenceCount} evidence`,
  ];
  if (item.requiredDecisions > 0) {
    parts.splice(
      1,
      0,
      `${item.approvedDecisions}/${item.requiredDecisions} decisions`,
    );
  }
  return parts.join(" · ");
}

function phaseStatusLabel(status: EngineeringPhaseStatus): string {
  if (status === "completed") return "Gate satisfied";
  if (status === "active") return "In progress";
  if (status === "blocked") return "Blocked";
  return "Planned";
}

function projectPhaseLifecycleLabel(
  lifecycle: NonNullable<
    ReturnType<typeof buildProjectPath>["phases"][number]["lifecycle"]
  >,
): string {
  const componentCount = lifecycle.affectedComponentIds.length;
  const enrichmentCount = lifecycle.modelEnrichmentCount ?? 0;
  const subject = componentCount > 0
    ? `${componentCount} component${componentCount === 1 ? "" : "s"}`
    : enrichmentCount > 0 && lifecycle.correctionCount === 0
    ? `${enrichmentCount} model enrichment${enrichmentCount === 1 ? "" : "s"}`
    : `${lifecycle.correctionCount} evidence update${
      lifecycle.correctionCount === 1 ? "" : "s"
    }`;
  if (lifecycle.state === "current") return `${subject} updated`;
  if (lifecycle.state === "attention") return `${subject} needs review`;
  return `${subject} retained`;
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatShortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
