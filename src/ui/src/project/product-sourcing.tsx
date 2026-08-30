import { CARD_SURFACE, PAGE_EYEBROW, SECTION_LABEL } from "../ui/cockpit.tsx";
import type { JSX } from "react";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { productSourcingCoverage } from "./product-requirements-model.ts";
import { cn } from "../lib/utils.ts";

/**
 * Reserved to-Buy coverage (mockup 3b / 5a). Count is a recorded ERP
 * binding, never an invented BOM or price.
 */
export function ProductSourcingCoverageLine({
  thread,
  onOpenSourcing,
}: {
  readonly thread: ThreadWorkbenchSnapshot;
  readonly onOpenSourcing?: () => void;
}): JSX.Element {
  const coverage = productSourcingCoverage(thread);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-3.5 py-2.5">
      <Badge variant={coverage.badge === "GAP" ? "warning" : "secondary"}>
        {coverage.badge}
      </Badge>
      <p className="m-0 min-w-0 flex-1 font-mono text-[10.5px] tracking-wide text-muted-foreground">
        ERPNext · to Buy — {coverage.boundCount}/{coverage.componentCount}{" "}
        records. Lane reserved until sourcing starts.
      </p>
      {onOpenSourcing && (
        <Button
          variant="link"
          size="sm"
          className="ml-auto h-auto px-0"
          onClick={onOpenSourcing}
        >
          Open Sourcing · ERP →
        </Button>
      )}
    </div>
  );
}

export function ProductSourcingLane({
  thread,
}: {
  readonly thread: ThreadWorkbenchSnapshot;
}): JSX.Element {
  const coverage = productSourcingCoverage(thread);
  return (
    <section className="flex flex-col gap-5" aria-labelledby="sourcing-title">
      <div className="max-w-3xl">
        <p className={cn("mb-1", PAGE_EYEBROW)}>Lifecycle coverage · To Buy</p>
        <h3 id="sourcing-title" className="text-lg font-semibold">
          Sourcing record
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          What is recorded for purchased parts in this exact project revision.
        </p>
      </div>
      <dl
        className={cn(
          CARD_SURFACE,
          "grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] overflow-hidden [&>div+div]:border-l [&>div+div]:border-border",
        )}
      >
        <div className="p-4">
          <dt className={SECTION_LABEL}>
            Coverage status
          </dt>
          <dd className="mt-2">
            <Badge variant={coverage.badge === "GAP" ? "warning" : "secondary"}>
              {coverage.badge}
            </Badge>
          </dd>
        </div>
        <div className="p-4">
          <dt className={SECTION_LABEL}>
            ERP records
          </dt>
          <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {coverage.boundCount}/{coverage.componentCount}
          </dd>
        </div>
        <div className="p-4">
          <dt className={SECTION_LABEL}>
            Record system
          </dt>
          <dd className="mt-1 text-sm font-medium">ERPNext</dd>
        </div>
      </dl>
      {coverage.boundCount === 0
        ? (
          <div className="rounded-lg border border-dashed border-warning/40 bg-warning/[0.04] p-4">
            <p className="text-sm font-medium">
              No sourcing record exists yet.
            </p>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              The lane stays{" "}
              <strong className="font-mono text-warning">GAP</strong>{" "}
              until exact ERP records are linked. No BOM, supplier, price or
              availability is inferred from the product structure.
            </p>
          </div>
        )
        : (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            {coverage.boundCount} of {coverage.componentCount}{" "}
            components have an exact ERP binding. Unbound components remain
            explicitly outside sourcing coverage.
          </div>
        )}
    </section>
  );
}
