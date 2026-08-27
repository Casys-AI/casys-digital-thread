import { marginLabel, requirementMargin } from "./requirement-margin-model.ts";
import { compactEmbeddedFingerprints } from "../thread/compact-identifier-model.ts";
import type { JSX } from "react";
import { recordStatusVariant } from "./record-status.ts";
import type {
  EngineeringAgentRun,
  EngineeringBlocker,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type {
  EngineeringWorkbenchActivity,
  EngineeringWorkbenchCaseActivityJoin,
  EngineeringWorkbenchPhaseLane,
  ThreadGraphRef,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";
import { exactThreadAssetHref } from "../cad/exact-thread-asset.ts";
import { ThreadAssetOpenLinks } from "../cad/thread-asset-open-links.tsx";
import { GltfAssetCanvas } from "../thread/gltf-asset-canvas.tsx";
import {
  resolveSealedAssemblyGeometry,
  sealedAssemblyGlbAsset,
} from "../thread/component-workspace-model.ts";
import { OverviewThreadHero } from "./overview-thread-hero.tsx";
import { Progress } from "@ark-ui/react/progress";
import { cn } from "../lib/utils.ts";
import {
  CARD_SURFACE,
  PAGE_EYEBROW,
  PanelFoot,
  SECTION_LABEL,
} from "../ui/cockpit.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent } from "../ui/card.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";
import type { ProjectWorkspaceView } from "./navigation.tsx";
import {
  hasDistinctProjectObjectiveStatement,
  type ProductWorkspaceFacet,
  type ProjectDeepLinkTarget,
} from "./navigation-model.ts";
import {
  buildRequirementMatrix,
  hasRecordedEvidence,
  hasRecordedMargin,
  type RequirementMatrixRow,
} from "./product-requirements-model.ts";
import {
  buildProjectReviewRecords,
  currentProjectReview,
} from "./review-decision-model.ts";
import {
  agentRunRecordedAt,
  buildCurrentProjectWork,
  buildProjectBrief,
  buildProjectPath,
  groupProjectPathGatesByLane,
  type ProjectPathLaneGroup,
  projectPathLaneStageStatus,
  type ProjectPathStageStatus,
  projectPathStatusLabel,
  projectStatusTone,
  selectCurrentProjectFocus,
  workOwnerLabel,
} from "./model.ts";
import { PROJECT_PATH_STAGE_LABELS } from "./overview-lanes.ts";

export interface ProjectOverviewProps {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadWorkbenchSnapshot;
  readonly phaseLanes: readonly EngineeringWorkbenchPhaseLane[];
  readonly activities: readonly EngineeringWorkbenchActivity[];
  readonly caseActivityJoins: readonly EngineeringWorkbenchCaseActivityJoin[];
  readonly onNavigate: (view: ProjectWorkspaceView) => void;
  readonly onOpenProductFacet?: (facet: ProductWorkspaceFacet) => void;
  readonly onOpenActivity?: (decisionId?: string) => void;
  readonly onOpenDeepLink?: (target: ProjectDeepLinkTarget) => void;
  readonly onOpenEvidence?: (reference: ThreadGraphRef) => void;
}

/**
 * Grammaire 2a : thread-first. Une bannière de review, le bandeau cinq
 * étapes, le graphe enregistré (ThreadGraph), les tuiles de verdict, Now
 * en feed, GLB en vignette.
 */
export function ProjectOverview({
  project,
  thread,
  phaseLanes,
  activities,
  caseActivityJoins,
  onNavigate,
  onOpenProductFacet,
  onOpenActivity,
  onOpenDeepLink,
  onOpenEvidence,
}: ProjectOverviewProps): JSX.Element {
  const brief = buildProjectBrief(project);
  const currentWork = buildCurrentProjectWork(project);
  const projectPath = buildProjectPath(
    project,
    thread,
    activities,
    caseActivityJoins,
  );
  const requirementMatrix = buildRequirementMatrix(thread);
  const assemblyIntegrity = recordedAssemblyIntegrityL4(thread);
  const currentFocus = selectCurrentProjectFocus(project);
  const openBlocker = brief.openBlockers[0];
  const statusTone = projectStatusTone(projectPath.status);
  const statusLabel = projectPathStatusLabel(projectPath);
  const sealedAssembly = resolveSealedAssemblyGeometry(thread);
  const sealedAssemblyGlb = sealedAssembly
    ? sealedAssemblyGlbAsset(sealedAssembly)
    : undefined;
  const sealedAssemblyStep = sealedAssembly?.assemblyAssets.find((artifact) =>
    artifact.kind === "step"
  );
  const pathStages = groupProjectPathGatesByLane(
    projectPath.activities,
    phaseLanes,
  );
  const openProductFacet = (facet: ProductWorkspaceFacet) => {
    if (onOpenProductFacet) {
      onOpenProductFacet(facet);
      return;
    }
    onNavigate("product");
  };
  const openOverviewEvidence = (reference: ThreadGraphRef) => {
    if (onOpenEvidence) {
      onOpenEvidence(reference);
      return;
    }
    onNavigate("verification");
  };
  const openOverviewActivity = () => {
    if (onOpenActivity) {
      onOpenActivity();
      return;
    }
    onNavigate("work");
  };

  // minmax(0,1fr) : sans lui, un contenu large imposerait sa largeur
  // min-content à toute la colonne (piège grid).
  return (
    <main
      className="overview-2a grid grid-cols-[minmax(0,1fr)] gap-3"
      id="project-workspace-panel"
      tabIndex={-1}
    >
      <section
        className="flex flex-col items-start justify-between gap-6 pb-3 md:flex-row md:items-end"
        aria-labelledby="project-objective-title"
      >
        <div className="min-w-0 [&>h3]:m-0 [&>h3]:max-w-[620px] [&>h3]:text-balance [&>h3]:text-[19px] [&>h3]:font-semibold [&>h3]:leading-snug [&>h3]:tracking-tight">
          <p className={cn("mb-1", PAGE_EYEBROW)}>
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
        <div
          className="flex shrink-0 flex-col items-start gap-1.5 md:items-end"
          data-tone={statusTone}
          aria-label={`Project status: ${statusLabel}`}
        >
          <dl
            className={cn(
              "grid max-w-full divide-x divide-border overflow-hidden",
              thread.assemblyIntegrity
                ? "grid-cols-[minmax(0,1.4fr)_auto_auto_auto]"
                : "grid-cols-[minmax(0,1.4fr)_auto_auto]",
              CARD_SURFACE,
            )}
          >
            <div className="flex min-w-0 flex-col gap-px px-3 py-1.5">
              <dt className="font-mono text-[9px] font-medium tracking-wider text-muted-foreground">
                Status
              </dt>
              <dd className="m-0 flex items-center gap-1.5 text-[13px] font-medium">
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
            <div className="flex flex-col gap-px px-3 py-1.5">
              <dt className="font-mono text-[9px] font-medium tracking-wider text-muted-foreground">
                Requirements
              </dt>
              <dd className="m-0 font-mono text-[13px] tabular-nums">
                <span className="text-success">
                  {requirementMatrix.counts.pass} pass
                </span>
                {requirementMatrix.counts.fail > 0
                  ? ` · ${requirementMatrix.counts.fail} fail`
                  : ""}
                {requirementMatrix.counts.unresolved > 0
                  ? ` · ${requirementMatrix.counts.unresolved} unresolved`
                  : requirementMatrix.counts.all === 0
                  ? " · none recorded"
                  : ""}
              </dd>
            </div>
            {thread.assemblyIntegrity && (
              <div className="flex min-w-0 flex-col gap-px px-3 py-1.5">
                <dt className="font-mono text-[9px] font-medium tracking-wider text-muted-foreground">
                  Assembly integrity
                </dt>
                <dd className="m-0 truncate font-mono text-[13px] tabular-nums">
                  {assemblyIntegrity
                    ? `${assemblyIntegrity.verdict} · L4`
                    : "no L4 verdict"}
                </dd>
              </div>
            )}
            <div className="flex flex-col gap-px px-3 py-1.5">
              <dt className="font-mono text-[9px] font-medium tracking-wider text-muted-foreground">
                Snapshot
              </dt>
              <dd className="m-0 font-mono text-[13px] tabular-nums">
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

      <OverviewReviewBanner
        project={project}
        thread={thread}
        onOpenActivity={onOpenActivity}
        onOpenDeepLink={onOpenDeepLink}
        onOpenEvidence={onOpenEvidence}
      />

      <Card className="overflow-hidden">
        <section aria-labelledby="project-phase-title">
          <h3 id="project-phase-title" className="sr-only">Project path</h3>
          <ProjectPathStageBand groups={pathStages} />
        </section>
        <OverviewThreadHero
          thread={thread}
          activities={projectPath.activities}
          onOpenEvidence={openOverviewEvidence}
          onOpenActivity={openOverviewActivity}
        />
      </Card>

      <OverviewVerdictTiles
        thread={thread}
        onOpenRequirements={() => openProductFacet("requirements")}
      />

      <div
        className={cn(
          "grid items-start gap-3.5",
          sealedAssemblyGlb?.uri && "lg:grid-cols-[minmax(0,1fr)_340px]",
        )}
      >
        <Card className="overflow-hidden">
          <NowPanel
            project={project}
            activeRun={currentFocus.activeRun}
            focusWork={currentFocus.work}
            lastSettledRun={brief.lastSettledRun}
            nextWork={currentWork.nextWork[0]}
            openBlocker={openBlocker}
            onNavigate={onNavigate}
          />
        </Card>
        {sealedAssemblyGlb?.uri && (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <p className={cn("m-0", SECTION_LABEL)}>
                Sealed assembly preview · GLB
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <ThreadAssetOpenLinks
                  stepHref={exactThreadAssetHref(
                    sealedAssemblyStep?.uri,
                    sealedAssemblyStep?.fingerprint,
                    "step",
                  )}
                  glbHref={exactThreadAssetHref(
                    sealedAssemblyGlb.uri,
                    sealedAssemblyGlb.fingerprint,
                    "glb",
                  )}
                  subject="sealed assembly"
                />
                <span className="font-mono text-[9.5px] text-muted-foreground">
                  {sealedAssembly?.assemblyFormats.join(" · ") || "GLB"}
                </span>
              </div>
            </div>
            <div className="h-[158px] overflow-hidden bg-muted/30">
              <GltfAssetCanvas
                url={sealedAssemblyGlb.uri}
                ariaLabel="Interactive sealed assembly geometry"
                loadingLabel="Loading sealed model…"
                errorLabel="Sealed model unavailable"
              />
            </div>
            <PanelFoot className="font-mono text-[10px] tabular-nums text-muted-foreground">
              <span>{sealedAssembly?.captureArtifact.label}</span>
              <span>
                {thread.components.components.length} recorded components
              </span>
            </PanelFoot>
          </Card>
        )}
      </div>
      <p className="m-0 font-mono text-[10px] text-muted-foreground">
        {project.id}@{project.revision}
        {" · "}
        {thread.id}
        {" · "}
        {project.project.subjectId}
        {" — "}
        <button
          type="button"
          className="text-brand"
          onClick={() => openProductFacet("structure")}
        >
          Product
        </button>
        {" · "}
        <button
          type="button"
          className="text-brand"
          onClick={() => onNavigate("verification")}
        >
          Evidence
        </button>
        {" · "}
        <button
          type="button"
          className="text-brand"
          onClick={() => onNavigate("work")}
        >
          Activity
        </button>
      </p>
    </main>
  );
}

/**
 * Bande cinq étapes : un nœud par lane persistée, x/y d'activités stables.
 * `flex` et `role="list"` conservent le rôle liste ; `display:grid` le
 * retirerait sous VoiceOver/Safari.
 */
function ProjectPathStageBand(
  { groups }: { readonly groups: readonly ProjectPathLaneGroup[] },
): JSX.Element {
  return (
    <ol
      className="flex items-center gap-0 overflow-x-auto px-4 py-2 tabular-nums"
      role="list"
    >
      {groups.map((group, index) => {
        const label = PROJECT_PATH_STAGE_LABELS[group.id];
        const status = projectPathLaneStageStatus(group);
        const count = `${group.satisfiedGates}/${group.totalGates}`;
        const suffix = status === "active" || status === "blocked"
          ? status.toUpperCase()
          : undefined;
        return (
          <li
            key={group.id}
            data-lane={group.id}
            data-state={status}
            aria-current={status === "active" ? "step" : undefined}
            aria-label={`${label} ${count} ${status}`}
            className="flex min-w-[6.75rem] shrink-0 flex-1 items-center"
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full",
                stageNodeClass(status),
              )}
            />
            <div className="mx-1.5 min-w-0">
              <span className={cn("block truncate", SECTION_LABEL)}>
                {label}
              </span>
              <span
                className={cn(
                  "block font-mono text-[10.5px] font-medium tabular-nums",
                  stageCountClass(status),
                )}
              >
                {count}
                {suffix ? ` ${suffix}` : ""}
              </span>
            </div>
            {index < groups.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  "mx-1.5 h-px min-w-3 flex-1",
                  status === "completed" ? "bg-success/40" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function OverviewReviewBanner({
  project,
  thread,
  onOpenActivity,
  onOpenDeepLink,
  onOpenEvidence,
}: {
  project: EngineeringProjectSnapshot;
  thread: ThreadWorkbenchSnapshot;
  onOpenActivity?: (decisionId?: string) => void;
  onOpenDeepLink?: (target: ProjectDeepLinkTarget) => void;
  onOpenEvidence?: (reference: EngineeringThreadEntityRef) => void;
}): JSX.Element {
  const records = buildProjectReviewRecords(project, thread);
  const nextReview = currentProjectReview(records);
  const needsReviewCount =
    records.filter((record) => record.state === "needs-review").length;
  const pendingResultCount =
    records.filter((record) => record.state === "approved-awaiting-result")
      .length;
  return (
    <Card
      className={cn(
        "gap-0 py-0 shadow-sm",
        nextReview && "border-warning/40",
      )}
    >
      <CardContent className="flex flex-wrap items-center justify-between gap-4 px-3.5 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <i
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              nextReview ? "bg-warning" : "bg-muted-foreground",
            )}
          />
          <span className="shrink-0 text-[13px] font-semibold">
            {nextReview
              ? "Needs your review"
              : "No proposal is waiting for review"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {nextReview ? nextReview.title : "Past reviews remain in Activity."}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {needsReviewCount} waiting · {pendingResultCount} pending
          </span>
          {nextReview?.resultEvidence && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => onOpenEvidence?.(nextReview.resultEvidence!)}
            >
              Open published result
            </Button>
          )}
          {nextReview
            ? (
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    className="h-7 bg-zinc-900 px-3 text-xs text-zinc-50 hover:bg-zinc-800"
                  >
                    Open in Activity
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-[13px]">
                      {nextReview.title}
                    </DialogTitle>
                    <DialogDescription className="text-[11.5px] leading-relaxed">
                      {nextReview.question}
                    </DialogDescription>
                  </DialogHeader>
                  {nextReview.summary && (
                    <p className="m-0 text-[11.5px] text-muted-foreground">
                      {nextReview.summary}
                    </p>
                  )}
                  <p className="m-0 font-mono text-[10px] text-muted-foreground">
                    Signing happens in the paired conversation, never here.
                  </p>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline" size="sm" className="h-7">
                        Close
                      </Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button
                        size="sm"
                        className="h-7 bg-zinc-900 px-3 text-xs text-zinc-50 hover:bg-zinc-800"
                        onClick={() => {
                          onOpenDeepLink?.(reviewDeepLinkTarget(nextReview.id));
                          onOpenActivity?.(nextReview.decision?.id);
                        }}
                      >
                        Continue in Activity →
                      </Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )
            : (
              <Button
                size="sm"
                className="h-7 bg-zinc-900 px-3 text-xs text-zinc-50 hover:bg-zinc-800"
                onClick={() => onOpenActivity?.()}
              >
                Open in Activity
              </Button>
            )}
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewVerdictTiles({
  thread,
  onOpenRequirements,
}: {
  thread: ThreadWorkbenchSnapshot;
  onOpenRequirements: () => void;
}): JSX.Element | null {
  const matrix = buildRequirementMatrix(thread);
  const assemblyIntegrity = recordedAssemblyIntegrityL4(thread);
  if (matrix.rows.length === 0 && !assemblyIntegrity) return null;
  return (
    <section aria-labelledby="overview-verdicts-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <h3
          id="overview-verdicts-title"
          className={cn("m-0", SECTION_LABEL)}
        >
          Recorded verdicts
        </h3>
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0"
          onClick={onOpenRequirements}
        >
          Open requirements →
        </Button>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        {matrix.rows.map((row) => <VerdictTile key={row.id} row={row} />)}
        {assemblyIntegrity && (
          <AssemblyIntegrityVerdictTile
            value={assemblyIntegrity}
          />
        )}
      </div>
    </section>
  );
}

/** L4 is displayed as recorded; the browser does not derive an engineering result. */
function AssemblyIntegrityVerdictTile({
  value,
}: {
  value: NonNullable<ReturnType<typeof recordedAssemblyIntegrityL4>>;
}): JSX.Element {
  const variant = value.verdict === "pass"
    ? "success"
    : value.verdict === "fail"
    ? "destructive"
    : "warning";
  return (
    <Card data-verdict-family="assembly-integrity">
      <CardContent className="flex flex-col gap-0.5 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[12.5px] font-medium">
            Assembly integrity
          </span>
          <Badge variant={variant}>{value.verdict}</Badge>
        </div>
        <span className="font-mono text-[9.5px] text-muted-foreground">
          Recorded L4 evaluation · {value.chainStatus}
        </span>
        <p className="m-0 mt-1 text-[11px] leading-snug text-muted-foreground">
          Assembly import, occurrences, placement, BRep and pairwise
          intersection only. Not safety, clearance, motion, load or fabrication.
        </p>
      </CardContent>
    </Card>
  );
}

function recordedAssemblyIntegrityL4(thread: ThreadWorkbenchSnapshot): {
  readonly verdict: "pass" | "fail" | "unresolved";
  readonly chainStatus: "current" | "historical" | "unresolved";
} | undefined {
  const chains = thread.assemblyIntegrity?.chains ?? [];
  const current = chains.find((chain) =>
    chain.status === "current" && chain.evaluation !== undefined
  );
  const firstRecorded = chains.find((chain) => chain.evaluation !== undefined);
  const chain = current ?? firstRecorded;
  return chain?.evaluation === undefined ? undefined : {
    verdict: chain.evaluation.aggregateVerdict,
    chainStatus: chain.status,
  };
}

/**
 * Une tuile de verdict. La barre est un `Progress` d'Ark, donc porteuse de
 * `role="progressbar"` : sans valeur numérique enregistrée elle reste
 * indéterminée plutôt que de simuler un remplissage. La marge n'apparaît que
 * lorsqu'une violation en a produit une, et son tooltip cite la preuve.
 */
function VerdictTile({ row }: { row: RequirementMatrixRow }): JSX.Element {
  const running = row.status === "unresolved";
  const hasMargin = hasRecordedMargin(row);
  // La position dans l'intervalle admissible : c'est elle qui distingue une
  // exigence tenue de justesse d'une exigence tenue largement.
  const margin = requirementMargin(row.expression, row.computed);
  const hasEvidence = hasRecordedEvidence(row);
  return (
    <Card
      className={cn(
        running && "border-dashed border-brand/50 bg-brand/[0.03]",
      )}
    >
      <CardContent className="flex flex-col gap-0.5 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          {
            /* Le NOM de l'exigence porte le titre : son identifiant tronqué
              n'apprenait rien et poussait le nom en second rang. */
          }
          <span className="truncate text-[12.5px] font-medium">
            {row.label}
          </span>
          <Badge variant={recordStatusVariant(row.status)}>{row.status}</Badge>
        </div>
        <span
          className="truncate font-mono text-[9.5px] text-muted-foreground"
          title={row.id}
        >
          {compactEmbeddedFingerprints(row.id)}
        </span>
        <Progress.Root
          // Une jauge n'existe que si la limite ET la mesure sont lisibles
          // dans ce qui a été enregistré. Sinon elle reste indéterminée
          // plutôt que de suggérer une position qu'on n'a pas mesurée.
          value={margin ? Math.round(margin.used * 100) : null}
          min={0}
          max={100}
          className="mt-1 block"
          aria-label={margin
            ? `${row.label} — ${marginLabel(margin)}`
            : `${row.label} — ${row.status}`}
        >
          <Progress.ValueText asChild>
            <p className="m-0 truncate font-mono text-xs tabular-nums text-muted-foreground">
              {row.lastVerdict}
            </p>
          </Progress.ValueText>
          <Progress.Track className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            {
              /* Sans limite comparable, la piste reste VIDE. La remplir se
                lirait « intervalle consommé à 100 % », soit l'inverse de
                « on ne sait pas situer cette mesure ». Le statut, lui, est
                déjà porté par la pastille. */
            }
            {running
              ? (
                <span className="block h-full w-full bg-[repeating-linear-gradient(90deg,var(--color-brand)_0_6px,transparent_6px_12px)] opacity-40" />
              )
              : margin === undefined
              ? null
              : (
                <Progress.Range
                  className={cn(
                    "h-full rounded-full",
                    row.status === "fail" ? "bg-warning" : "bg-success",
                  )}
                />
              )}
          </Progress.Track>
        </Progress.Root>
        {(margin !== undefined || hasMargin) && (
          <Tooltip side="top">
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "mt-1.5 block w-full cursor-help truncate text-right font-mono text-[10px] font-medium",
                  row.status === "fail" ? "text-warning" : "text-success",
                )}
              >
                {margin ? marginLabel(margin) : row.marginLabel}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <span className="font-mono">
                {margin
                  ? `${row.expression} · ${row.computed}`
                  : hasEvidence
                  ? row.evidenceLabel
                  : row.expression}
              </span>
            </TooltipContent>
          </Tooltip>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Le pouls en feed mono 4 colonnes. Review est la bannière au-dessus —
 * Now expose les entrées enregistrées : run actif, dernier run settled,
 * prochain work item, blocker ouvert. Glyphes : ▸ brand (running),
 * ✓ success (settled/sealed), ⧗ muted (queued), • destructive (blocked).
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
  const liveRunCount = project.agentRuns.filter(
    (r) => r.status === "running",
  ).length;

  type FeedEntry = {
    time?: string;
    glyph: "running" | "settled" | "queued" | "blocked";
    description: string;
    tag?: string;
  };
  const feed: FeedEntry[] = [];

  if (activeRun) {
    const wi = project.workItems.find((w) => w.id === activeRun.workItemId);
    feed.push({
      time: activeRun.startedAt ?? activeRun.queuedAt ??
        agentRunRecordedAt(activeRun),
      glyph: "running",
      description: wi?.title ?? activeRun.workItemId,
      tag: "Agent",
    });
  } else if (focusWork) {
    feed.push({
      glyph: "queued",
      description: focusWork.title,
      tag: workOwnerLabel(focusWork.owner),
    });
  }

  if (lastSettledRun) {
    const wi = project.workItems.find(
      (w) => w.id === lastSettledRun.workItemId,
    );
    feed.push({
      time: agentRunRecordedAt(lastSettledRun),
      glyph: "settled",
      description: wi?.title ?? lastSettledRun.workItemId,
      tag: sentenceLabel(lastSettledRun.status),
    });
  }

  if (nextWork) {
    feed.push({
      glyph: "queued",
      description: nextWork.title,
      tag: workOwnerLabel(nextWork.owner),
    });
  }

  if (openBlocker) {
    feed.push({
      glyph: "blocked",
      description: openBlocker.title,
      tag: sentenceLabel(openBlocker.kind),
    });
  }

  return (
    <section aria-label="Current project control">
      <div className="flex items-center justify-between border-b border-border px-3.5 py-2">
        <p className={cn("m-0", SECTION_LABEL)}>
          NOW
        </p>
        {liveRunCount > 0 && (
          <span className="flex items-center gap-1.5 font-mono text-[9.5px] text-brand">
            <i
              aria-hidden="true"
              className="size-[5px] rounded-full bg-brand"
            />
            {liveRunCount} RUN LIVE
          </span>
        )}
      </div>
      <div className="py-1 tabular-nums" title="Agent now">
        {feed.length === 0
          ? (
            <p className="px-3.5 py-2 text-sm text-muted-foreground">
              No active work or agent run is recorded.
            </p>
          )
          : feed.map((entry, i) => <NowFeedRow key={i} entry={entry} />)}
      </div>
      <PanelFoot>
        <a
          href="#work"
          className="text-[12px] font-medium text-brand hover:underline"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            onNavigate("work");
          }}
        >
          Open activity →
        </a>
      </PanelFoot>
    </section>
  );
}

function NowFeedRow({ entry }: {
  entry: {
    time?: string;
    glyph: "running" | "settled" | "queued" | "blocked";
    description: string;
    tag?: string;
  };
}): JSX.Element {
  const glyph = entry.glyph === "running"
    ? "▸"
    : entry.glyph === "settled"
    ? "✓"
    : entry.glyph === "blocked"
    ? "•"
    : "⧗";
  return (
    <div className="grid grid-cols-[42px_14px_minmax(0,1fr)_auto] items-baseline gap-x-2 px-3.5 py-[5px]">
      <span className="pt-px font-mono text-[10.5px] text-muted-foreground">
        {entry.time ? formatShortTime(entry.time) : ""}
      </span>
      <span
        className={cn(
          "font-mono text-[10.5px] font-medium",
          entry.glyph === "running" && "text-brand",
          entry.glyph === "settled" && "text-success",
          entry.glyph === "queued" && "text-muted-foreground",
          entry.glyph === "blocked" && "text-destructive",
        )}
      >
        {glyph}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-[12px]",
          entry.glyph === "running"
            ? "text-foreground"
            : "text-muted-foreground",
        )}
      >
        {entry.description}
      </span>
      {entry.tag && (
        <span className="font-mono text-[10px] text-muted-foreground">
          {entry.tag}
        </span>
      )}
    </div>
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

function stageNodeClass(status: ProjectPathStageStatus): string {
  if (status === "completed") return "bg-success";
  if (status === "active") {
    return "border-2 border-success bg-background ring-4 ring-success/15";
  }
  if (status === "blocked") return "bg-destructive";
  return "border border-muted-foreground/40 bg-background";
}

function stageCountClass(status: ProjectPathStageStatus): string {
  if (status === "active") return "text-success";
  if (status === "blocked") return "text-destructive";
  return "text-muted-foreground";
}

function sentenceLabel(value: string): string {
  const label = value.replaceAll("-", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function formatShortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
