import { CARD_SURFACE, PAGE_EYEBROW } from "../ui/cockpit.tsx";
import { Fragment, useState } from "react";
import type { JSX, ReactNode } from "react";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import { Accordion } from "@ark-ui/react/accordion";
import {
  compactEmbeddedFingerprints,
  compactTechnicalIdentifier,
} from "../thread/compact-identifier-model.ts";
import { cn } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { recordStatusVariant } from "./record-status.ts";
import {
  buildRequirementMatrix,
  filterRequirementRows,
  hasRecordedMargin,
  hasRecordedObservation,
  type RequirementMatrixFilter,
  type RequirementMatrixRow,
  type RequirementVerdictTrailStep,
} from "./product-requirements-model.ts";

const MATRIX_GRID =
  "grid-cols-[204px_minmax(230px,2fr)_minmax(170px,1.3fr)_minmax(140px,1fr)_84px_90px_minmax(180px,1.3fr)]";

export function ProductRequirementsMatrix({
  thread,
  onOpenVerification,
}: {
  readonly thread: ThreadWorkbenchSnapshot;
  readonly onOpenVerification: () => void;
}): JSX.Element {
  const matrix = buildRequirementMatrix(thread);
  const [filter, setFilter] = useState<RequirementMatrixFilter>("all");
  const [openId, setOpenId] = useState<string>();
  const rows = filterRequirementRows(matrix, filter);
  const openCount = matrix.counts.fail + matrix.counts.unresolved;
  const noModelledRequirements = matrix.counts.all === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className={cn("mb-0", PAGE_EYEBROW)}>
          Verification · requirement verdicts
        </p>
        <dl
          className={cn(
            "grid shrink-0 grid-cols-3 divide-x divide-border overflow-hidden font-mono tabular-nums",
            CARD_SURFACE,
          )}
        >
          <CoverageCell
            label={noModelledRequirements ? "MODELLED" : "VERIFIED"}
            value={noModelledRequirements
              ? "0"
              : `${matrix.counts.pass}/${matrix.counts.all} PASS`}
            tone={noModelledRequirements ? "warning" : "success"}
          />
          <CoverageCell
            label="OPEN"
            value={`${openCount}`}
            tone={matrix.counts.fail > 0 ? "warning" : undefined}
          />
          <CoverageCell
            label="WORST MARGIN"
            value={matrix.worstMargin ?? "—"}
            tone={matrix.worstMargin ? "warning" : undefined}
          />
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip
          active={filter === "all"}
          onSelect={() => setFilter("all")}
        >
          All {matrix.counts.all}
        </FilterChip>
        <FilterChip
          active={filter === "pass"}
          tone="success"
          onSelect={() => setFilter("pass")}
        >
          Pass {matrix.counts.pass}
        </FilterChip>
        <FilterChip
          active={filter === "fail"}
          tone="danger"
          onSelect={() => setFilter("fail")}
        >
          Fail {matrix.counts.fail}
        </FilterChip>
        <FilterChip
          active={filter === "unresolved"}
          onSelect={() => setFilter("unresolved")}
        >
          Unverified {matrix.counts.unresolved}
        </FilterChip>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          constraint-solver · units checked
        </span>
      </div>

      <div className={cn("overflow-x-auto shadow-sm", CARD_SURFACE)}>
        <div className="min-w-[1120px]">
          <div
            className={cn(
              "grid font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground",
              MATRIX_GRID,
            )}
          >
            <span className="border-b border-border px-3.5 py-2">
              REQ
            </span>
            <span className="border-b border-border px-2 py-2">
              REQUIREMENT
            </span>
            <span className="border-b border-border px-2 py-2">
              LIMIT
            </span>
            <span className="border-b border-border px-2 py-2">
              COMPUTED
            </span>
            <span className="border-b border-border px-2 py-2 text-right">
              MARGIN
            </span>
            <span className="border-b border-border px-2 py-2">
              VERDICT
            </span>
            <span className="border-b border-border px-3.5 py-2 pl-2">
              EVIDENCE
            </span>
          </div>
          {matrix.counts.all === 0
            ? (
              <p className="px-3.5 py-6 text-sm text-muted-foreground">
                No requirements are recorded in this exact Thread snapshot.
                SysML parts and attributes are not inferred as requirements.
              </p>
            )
            : rows.length === 0
            ? (
              <p className="px-3.5 py-6 text-sm text-muted-foreground">
                No current modelled requirements match this filter.
              </p>
            )
            : (
              <Accordion.Root
                collapsible
                value={openId === undefined ? [] : [openId]}
                onValueChange={(details) => setOpenId(details.value[0])}
              >
                {rows.map((row) => (
                  <RequirementRow
                    key={row.id}
                    row={row}
                    open={openId === row.id}
                    onOpenVerification={onOpenVerification}
                  />
                ))}
              </Accordion.Root>
            )}
          <div className="flex flex-col gap-0.5 border-t border-border bg-muted/40 px-3.5 py-2">
            <span className="font-mono text-[10px] tracking-[0.05em] text-muted-foreground">
              <span className="text-foreground/70">TO MAKE</span>
              {" · printability + print estimate — lane reserved"}
            </span>
            <span className="font-mono text-[10px] tracking-[0.05em] text-muted-foreground">
              <span className="text-foreground/70">TO BUY</span>
              {" · sourcing evidence via ERP — lane reserved"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RequirementRow({
  row,
  open,
  onOpenVerification,
}: {
  row: RequirementMatrixRow;
  open: boolean;
  onOpenVerification: () => void;
}): JSX.Element {
  return (
    <Accordion.Item
      value={row.id}
      className={cn(
        "block",
        open && "border-l-2 border-brand bg-brand/[0.03]",
      )}
    >
      <Accordion.ItemTrigger
        className={cn(
          "grid w-full items-center text-left tabular-nums transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          MATRIX_GRID,
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5 px-3.5 py-2 font-mono text-[10px] font-medium text-brand">
          <RequirementChevron open={open} />
          <span className="truncate" title={row.id} aria-hidden="true">
            {compactTechnicalIdentifier(row.id)}
          </span>
          <span className="sr-only">Requirement identifier: {row.id}</span>
        </span>
        <span className="flex flex-col gap-0.5 px-2 py-2">
          <span className="truncate text-xs">{row.label}</span>
          {row.anchor && (
            <span className="truncate font-mono text-[9px] text-muted-foreground">
              {row.anchor}
            </span>
          )}
        </span>
        <span className="truncate px-2 py-2 font-mono text-[10px] text-muted-foreground">
          {row.expression}
        </span>
        <span className="truncate px-2 py-2 font-mono text-[11px] font-medium">
          {row.computed}
        </span>
        <span className="truncate px-2 py-2 text-right font-mono text-[11px] font-medium">
          {row.marginLabel}
        </span>
        <span className="px-2 py-1.5">
          <Badge variant={recordStatusVariant(row.status)}>
            {row.status.toUpperCase()}
          </Badge>
        </span>
        <span className="truncate px-3.5 py-2 pl-2 font-mono text-[10px] text-muted-foreground">
          {row.evidenceLabel}
        </span>
      </Accordion.ItemTrigger>
      <Accordion.ItemContent className="flex flex-col gap-2.5 overflow-hidden px-3.5 pb-3">
        <EvidenceChain row={row} />
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[10px] text-muted-foreground">
            {row.observationId
              ? `Observation ${compactEmbeddedFingerprints(row.observationId)}`
              : "No persisted observation on this requirement"}
            {row.violationId ? ` · violation ${row.violationId}` : ""}
          </span>
          {row.verdictTrail.length === 0 && (
            <InspectVersionsLink
              onOpenVerification={onOpenVerification}
            />
          )}
        </div>
        {row.verdictTrail.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 font-mono text-[8.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Verdict history
            </span>
            <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
              {row.verdictTrail.map((step, index) => (
                <li
                  key={step.id}
                  className="flex items-center gap-1.5"
                  data-current={step.current ? "true" : "false"}
                >
                  {index > 0 && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      →
                    </span>
                  )}
                  <TrailStep step={step} />
                </li>
              ))}
            </ol>
            <InspectVersionsLink
              onOpenVerification={onOpenVerification}
            />
          </div>
        )}
      </Accordion.ItemContent>
    </Accordion.Item>
  );
}

function RequirementChevron({ open }: { readonly open: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={cn(
        "size-3 shrink-0 text-muted-foreground transition-transform",
        open && "rotate-90",
      )}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m9 18 6-6-6-6"
      />
    </svg>
  );
}

/**
 * Evidence chain: [artifact] → [observation] → [verdict].
 * Each card only appears when data is recorded. Stops honestly at
 * the first missing link — no card is invented for absent data.
 */
function EvidenceChain({
  row,
}: {
  row: RequirementMatrixRow;
}): JSX.Element | null {
  const links: {
    label: string;
    title: string;
    subtitle: string;
    tone?: "pass" | "fail" | "unresolved";
  }[] = [];

  if (row.artifactRef) {
    const fp = row.artifactRef.fingerprint;
    links.push({
      label: "ARTIFACT SOURCE",
      title: row.artifactRef.label,
      subtitle: fp
        ? `${row.artifactRef.kind} · ${fp.slice(0, 16)}…`
        : row.artifactRef.kind,
    });
  }

  if (hasRecordedObservation(row)) {
    links.push({
      label: "OBSERVATION",
      title: `${row.computed} · ${
        compactEmbeddedFingerprints(row.observationId ?? "")
      }`,
      subtitle: "units checked",
    });
  }

  if (links.length > 0) {
    const verdictTitle = hasRecordedMargin(row)
      ? `${row.status.toUpperCase()} · ${row.marginLabel}`
      : row.status.toUpperCase();
    links.push({
      label: "VERDICT",
      title: verdictTitle,
      subtitle: "constraint-solver",
      tone: row.status,
    });
  }

  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      {links.map((link, index) => (
        <Fragment key={link.label}>
          {index > 0 && (
            <span className="self-center font-mono text-[12px] text-muted-foreground">
              →
            </span>
          )}
          <EvidenceChainCard
            label={link.label}
            title={link.title}
            subtitle={link.subtitle}
            tone={link.tone}
          />
        </Fragment>
      ))}
    </div>
  );
}

function EvidenceChainCard({
  label,
  title,
  subtitle,
  tone,
}: {
  label: string;
  title: string;
  subtitle: string;
  tone?: "pass" | "fail" | "unresolved";
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg border p-2",
        tone === "pass" &&
          "border-success/40 bg-success/[0.04]",
        tone === "fail" &&
          "border-destructive/40 bg-destructive/[0.04]",
        (tone === "unresolved" || tone === undefined) &&
          "border-border bg-card",
      )}
    >
      <span className="font-mono text-[8.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 break-words font-mono text-[11px] font-medium",
          tone === "pass" && "text-success",
          tone === "fail" && "text-destructive",
          !tone && "text-foreground",
        )}
      >
        {title}
      </span>
      <span className="font-mono text-[9.5px] text-muted-foreground">
        {subtitle}
      </span>
    </div>
  );
}

function InspectVersionsLink({
  onOpenVerification,
}: {
  onOpenVerification: () => void;
}): JSX.Element {
  return (
    <Button
      variant="link"
      size="sm"
      className="ml-auto h-auto px-0 text-[11.5px]"
      onClick={onOpenVerification}
    >
      Inspect versions in Evidence →
    </Button>
  );
}

function TrailStep({
  step,
}: {
  step: RequirementVerdictTrailStep;
}): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "font-mono text-[10px]",
          step.status === "pass" && "text-success",
          step.status === "fail" && "text-destructive",
          step.status === "unresolved" && "text-muted-foreground",
        )}
      >
        {step.label}
      </span>
      {step.current && <Badge variant="success">CURRENT</Badge>}
    </span>
  );
}

function CoverageCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning";
}): JSX.Element {
  return (
    <div className="flex flex-col gap-px px-3 py-1.5">
      <dt className="font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "m-0 font-mono text-[12.5px] font-medium",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function FilterChip({
  active,
  tone,
  onSelect,
  children,
}: {
  active: boolean;
  tone?: "success" | "danger";
  onSelect: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Button
      size="sm"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      className={cn(
        "h-[26px] px-2.5 font-mono text-[11px]",
        !active && tone === "success" && "text-success",
        !active && tone === "danger" && "text-destructive",
      )}
      onClick={onSelect}
    >
      {children}
    </Button>
  );
}
