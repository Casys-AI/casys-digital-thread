import { PAGE_EYEBROW } from "../ui/cockpit.tsx";
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
  return (
    <div className="flex flex-col gap-3">
      <p className={cn("mb-0", PAGE_EYEBROW)}>
        Product › Sourcing · ERP
      </p>
      <ProductSourcingCoverageLine thread={thread} />
    </div>
  );
}
