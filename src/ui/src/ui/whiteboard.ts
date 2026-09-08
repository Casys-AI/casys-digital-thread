/**
 * Whiteboard chrome recipes.
 *
 * Presentation only. Identity classes (`overview-thread-*`) stay on the
 * markup as hooks for tests, geometry and pointer routing. Paint, type,
 * radius and hover/focus/selected states live here as Tailwind + cva on
 * the existing `--ui-*` theme (`bg-card`, `text-foreground`, `border-border`,
 * `ring-ring`, `text-brand`, `text-success`, `text-destructive`).
 *
 * Lane colour (`--flow-color`, `--ui-lane-*`) is domain identity. Status
 * colour is never a lane. Do not add a parallel token palette.
 */

import { cva, type VariantProps } from "class-variance-authority";
import { buttonVariants } from "./button.tsx";
import { cn } from "../lib/utils.ts";

/** Callers apply recipes directly; merge so variant paint replaces the base. */
function recipe<T extends (...args: never[]) => string>(variants: T): T {
  return ((...args: Parameters<T>) => cn(variants(...args))) as T;
}

const chromeButton = cn(
  buttonVariants({ variant: "ghost", size: "sm" }),
  "h-auto shadow-none",
);

/** Layout toolbar. Spatial placement stays in CSS (hero vs board). */
export const whiteboardToolbar =
  "inline-flex items-center gap-0.5 rounded-full border border-border/80 bg-card/90 p-[0.18rem] shadow-sm backdrop-blur-[8px]";

export const whiteboardToolbarButton = recipe(cva(
  cn(
    chromeButton,
    "min-h-6 rounded-full border border-transparent bg-transparent px-2",
    "py-[0.15rem] font-mono text-[0.5625rem] font-medium tracking-[0.055em]",
    "text-muted-foreground hover:bg-accent hover:text-foreground",
    "focus-visible:ring-1 focus-visible:ring-ring",
  ),
  {
    variants: {
      pressed: {
        true: "border-border bg-muted text-foreground hover:bg-muted",
        false: "",
      },
    },
    defaultVariants: { pressed: false },
  },
));

export type WhiteboardToolbarButtonProps = VariantProps<
  typeof whiteboardToolbarButton
>;

export const whiteboardToolbarPart = cva("", {
  variants: {
    part: {
      divider: "mx-0.5 h-4 w-px shrink-0 bg-border",
      scale:
        "px-1.5 font-mono text-[0.5rem] font-medium tabular-nums text-muted-foreground",
    },
  },
});

export const whiteboardViewer = cva(
  cn(
    "group grid h-[22.5rem] w-[27.5rem] min-h-0 min-w-0 cursor-default",
    "overflow-hidden rounded-md border border-border bg-card text-foreground",
    "shadow-none transition-[border-color] duration-100",
    "[grid-template-rows:auto_minmax(0,1fr)] @container/viewer",
    "hover:border-foreground/20 focus-within:border-primary/40",
    "has-[:active]:border-primary/50 has-[:active]:transition-none",
    "motion-reduce:transition-none",
  ),
  {
    variants: {
      expanded: {
        true: "rounded-md",
        false: "",
      },
    },
    defaultVariants: { expanded: false },
  },
);

export const whiteboardViewerPart = cva("", {
  variants: {
    part: {
      connectors: "text-muted-foreground/60",
      handle: cn(
        "grid min-h-8 cursor-grab touch-none select-none items-center",
        "gap-[0.35rem] border-b border-border/70 bg-card",
        "py-[0.18rem] pr-[0.24rem] pl-[0.55rem]",
        "grid-cols-[minmax(0,1fr)_auto] active:cursor-grabbing",
        "focus-visible:outline focus-visible:outline-1",
        "focus-visible:-outline-offset-1 focus-visible:outline-ring",
      ),
      title: cn(
        "min-w-0 overflow-hidden text-[0.7rem] font-semibold",
        "tracking-[-0.01em] text-ellipsis whitespace-nowrap",
      ),
      actions: "flex items-center gap-[0.22rem] @max-[18rem]/viewer:gap-0",
      action: cn(
        chromeButton,
        "min-h-6 rounded-sm border-0 bg-transparent px-[0.34rem] py-[0.18rem]",
        "text-[0.55rem] font-medium leading-none text-muted-foreground",
        "whitespace-nowrap opacity-60 touch-manipulation transition-colors",
        "hover:bg-muted/70 hover:text-foreground hover:opacity-100",
        "focus-visible:bg-muted/70 focus-visible:text-foreground",
        "focus-visible:opacity-100 focus-visible:outline-none",
        "group-hover:opacity-100 group-focus-within:opacity-100",
        "@max-[18rem]/viewer:px-1 motion-reduce:transition-none",
      ),
      body: cn(
        "min-h-0 min-w-0 cursor-auto overflow-auto overscroll-contain bg-card",
        "[scrollbar-width:thin] touch-pan-x touch-pan-y",
        "group-data-[viewer-kind=session]:grid",
        "group-data-[viewer-kind=session]:overflow-hidden",
        "group-data-[viewer-kind=session]:[grid-template-rows:minmax(0,1fr)]",
      ),
      resize: cn(
        chromeButton,
        "absolute right-[0.2rem] bottom-[0.2rem] z-[3] min-h-[1.2rem]",
        "min-w-[2.2rem] cursor-nwse-resize rounded-sm border-0 bg-card/90",
        "px-[0.26rem] py-[0.12rem] text-[0.5rem] font-medium leading-none",
        "text-muted-foreground opacity-40 touch-none select-none",
        "transition-colors hover:bg-card hover:text-foreground hover:opacity-100",
        "hover:outline hover:outline-1 hover:outline-offset-1 hover:outline-ring",
        "focus-visible:bg-card focus-visible:text-foreground",
        "focus-visible:opacity-100 focus-visible:outline",
        "focus-visible:outline-1 focus-visible:outline-offset-1",
        "focus-visible:outline-ring",
        "group-data-[expanded=true]:hidden motion-reduce:transition-none",
      ),
      unavailable: "m-0 p-3 text-[0.7rem] text-muted-foreground",
    },
  },
});

export const whiteboardMonitor = cn(
  "grid min-h-0 min-w-0 overflow-hidden rounded-[0.72rem] border",
  "border-primary/30 bg-background/95 text-foreground shadow-none",
  "[grid-template-rows:auto_auto_minmax(0,1fr)]",
);

export const whiteboardMonitorPart = cva("", {
  variants: {
    part: {
      header: cn(
        "grid min-w-0 cursor-grab touch-none select-none items-start gap-2.5",
        "border-b border-border px-[0.7rem] pt-[0.55rem] pb-[0.48rem] pr-2.5",
        "bg-[linear-gradient(100deg,color-mix(in_srgb,var(--ui-primary)_9%,white),transparent_72%),var(--ui-background)]",
        "grid-cols-[minmax(0,1fr)_auto] active:cursor-grabbing",
        "focus-visible:outline focus-visible:outline-1",
        "focus-visible:-outline-offset-1 focus-visible:outline-ring",
      ),
      title: cn(
        "mt-[0.12rem] overflow-hidden text-[0.78rem] font-bold leading-tight",
        "text-ellipsis whitespace-nowrap",
      ),
      close: cn(
        chromeButton,
        "min-h-[1.35rem] rounded-[0.32rem] border-0 bg-transparent",
        "px-[0.32rem] py-[0.15rem] text-[0.56rem] font-medium",
        "text-muted-foreground hover:bg-accent hover:text-foreground",
        "focus-visible:bg-accent focus-visible:text-foreground",
        "focus-visible:outline-none",
      ),
      metrics: cn(
        "grid grid-cols-4 border-b border-border",
        "bg-[color-mix(in_srgb,var(--ui-muted)_45%,white)]",
      ),
      metric: cn(
        "grid gap-[0.08rem] border-r border-border px-[0.45rem] py-[0.42rem]",
        "font-mono text-[0.51rem] uppercase leading-tight text-muted-foreground",
        "last:border-r-0 [&_strong]:text-[0.72rem] [&_strong]:text-foreground",
        "data-[live=true]:[&_strong]:text-success",
        "data-[alert=true]:[&_strong]:text-destructive",
      ),
      list: "min-h-0 overflow-auto overscroll-contain [scrollbar-width:thin]",
      item:
        "grid gap-[0.28rem] border-b border-border/70 px-[0.55rem] py-[0.45rem]",
      node: cn(
        "grid min-w-0 gap-[0.08rem] border-0 bg-transparent p-0 text-left",
        "text-inherit [&>span]:overflow-hidden [&>span]:text-ellipsis",
        "[&>span]:whitespace-nowrap [&>span]:text-[0.64rem] [&>span]:font-bold",
        "[&>small]:overflow-hidden [&>small]:text-ellipsis",
        "[&>small]:whitespace-nowrap [&>small]:font-mono",
        "[&>small]:text-[0.5rem] [&>small]:text-muted-foreground",
        "hover:[&>span]:text-primary focus-visible:[&>span]:text-primary",
      ),
      actions: "flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:thin]",
    },
  },
});

export const whiteboardMonitorAction = recipe(cva(
  cn(
    chromeButton,
    "h-[1.35rem] flex-none rounded-[0.32rem] border border-border bg-background",
    "px-[0.36rem] py-[0.16rem] text-[0.52rem] font-medium whitespace-nowrap",
    "text-muted-foreground hover:border-primary/50 hover:bg-accent",
    "hover:text-foreground focus-visible:border-primary/50",
    "focus-visible:bg-accent focus-visible:text-foreground",
    "focus-visible:outline-none",
  ),
  {
    variants: {
      app: {
        true: "border-primary/30 text-foreground",
        false: "",
      },
    },
    defaultVariants: { app: false },
  },
));

/**
 * Hull band controls. `--flow-color` is the hull's domain identity, not a
 * status. Position/transform of the band stay in CSS (CSS variables).
 * The band must keep the `group` class so fold uses group-hover.
 */
export const whiteboardHullControl = cva(
  cn(
    chromeButton,
    "pointer-events-auto flex-none grid place-items-center p-0",
    "rounded-[0.3rem] border border-foreground/10 bg-transparent text-[0.55rem]",
    "leading-none text-foreground/35 transition-colors",
    "hover:border-[color-mix(in_srgb,var(--flow-color)_32%,transparent)]",
    "hover:bg-card/80",
    "hover:text-[color-mix(in_srgb,var(--flow-color)_70%,var(--ui-foreground))]",
    "focus-visible:border-[color-mix(in_srgb,var(--flow-color)_32%,transparent)]",
    "focus-visible:bg-card/80",
    "data-[active=true]:border-[color-mix(in_srgb,var(--flow-color)_35%,transparent)]",
    "data-[active=true]:bg-card",
    "data-[active=true]:text-[color-mix(in_srgb,var(--flow-color)_72%,var(--ui-foreground))]",
    "data-[view=tree]:w-[2.6rem]",
  ),
  {
    variants: {
      labeled: {
        true:
          "h-[1.1rem] w-auto min-w-[1.1rem] shrink-0 px-1 text-[0.5rem] tracking-wide whitespace-nowrap",
        false: "size-[1.1rem]",
      },
    },
    defaultVariants: { labeled: false },
  },
);

export const whiteboardHullFold = cn(
  chromeButton,
  "pointer-events-auto h-6 w-5 flex-none rounded-[0.28rem] border-0",
  "bg-transparent p-0 text-[0.5rem] leading-none opacity-0 transition-opacity",
  "hover:bg-card/70 hover:opacity-100 focus-visible:opacity-85",
  "group-hover:opacity-85 group-data-[collapsed=true]:opacity-85",
);

export const whiteboardHullViewSelect = cn(
  "flex-none w-[3.4rem] cursor-pointer border-0 bg-transparent py-[0.2rem]",
  "font-mono text-[0.55rem] font-semibold",
  "text-[color-mix(in_srgb,var(--flow-color)_72%,var(--ui-foreground))]",
);

export const whiteboardHullMonitorChip = cn(
  "inline-flex items-center gap-1 rounded-full border bg-card/90 px-1.5",
  "py-[0.1rem] font-mono text-[0.5rem] font-bold whitespace-nowrap shadow-sm",
  "backdrop-blur-[8px]",
  "border-[color-mix(in_srgb,var(--flow-color)_22%,#e0d3c0)]",
  "text-[color-mix(in_srgb,var(--flow-color)_72%,var(--ui-foreground))]",
  "[&>i]:size-[0.34rem] [&>i]:rounded-full [&>i]:bg-[var(--flow-color)]",
  "[&>i]:shadow-[0_0_0_2.5px_color-mix(in_srgb,var(--flow-color)_18%,transparent)]",
  "data-[alert=true]:border-destructive/45 data-[alert=true]:bg-destructive",
  "data-[alert=true]:text-card data-[alert=true]:[&>i]:bg-card",
  "data-[alert=true]:[&>i]:shadow-none",
);

/** Reading note. Nearby top/left come from the selected row; z stays in CSS. */
export const whiteboardNote = cn(
  "overflow-auto overscroll-contain rounded-[6px_6px_12px_12px] border",
  "border-border border-t-[3px] border-t-brand bg-background text-xs",
  "shadow-[0_8px_28px_#153c3b14]",
);

export const whiteboardNoteState = recipe(cva("", {
  variants: {
    pinned: {
      true: "border-t-primary",
      false: "",
    },
  },
  defaultVariants: { pinned: false },
}));

export const whiteboardNotePart = cva("", {
  variants: {
    part: {
      header: cn(
        "sticky top-0 z-[1] flex items-center justify-between gap-2",
        "bg-background px-3 py-2 text-[10px] text-muted-foreground",
      ),
      headerActions: "flex items-center gap-0.5",
      close: cn(
        chromeButton,
        "min-h-7 px-1.5 py-1 text-[10px] text-muted-foreground",
        "hover:bg-accent hover:text-foreground",
      ),
      pin: cn(
        chromeButton,
        "min-h-7 px-1.5 py-1 text-[10px] text-muted-foreground",
        "hover:bg-accent hover:text-foreground",
      ),
      body: "px-3.5 pb-3.5",
      title: "mb-2 text-[15px] leading-snug [overflow-wrap:anywhere]",
      meta: cn(
        "m-0 text-[10px] text-muted-foreground [overflow-wrap:anywhere]",
      ),
      summary: "my-2.5 leading-normal [overflow-wrap:anywhere]",
      details: "mt-2.5 text-[10px] text-muted-foreground",
      detailsSummary: "cursor-pointer py-1",
      actions: "mt-3 flex flex-wrap gap-1.5",
      relations:
        "border-t border-border [&_ul]:m-0 [&_ul]:list-none [&_ul]:px-1.5 [&_ul]:pb-1.5",
      relationsSummary: "cursor-pointer px-3.5 py-3 font-semibold",
      relationsCount: "ml-1.5 tabular-nums text-muted-foreground",
      relationsHelp: "m-0 px-3.5 pb-2.5 text-[10px] text-muted-foreground",
      relation: cn(
        "grid w-full gap-0.5 rounded-[5px] p-2 text-left",
        "[overflow-wrap:anywhere] hover:bg-muted focus-visible:bg-muted",
      ),
      relationMeta: "text-[9px] text-muted-foreground",
      relationKind: "text-[10px] font-medium text-brand",
      heading: "mt-3 mb-1.5 text-[10px] text-muted-foreground",
      list: "m-0 pl-4",
      listItem: "mt-1.5 first:mt-0 [overflow-wrap:anywhere]",
    },
  },
});

export const whiteboardNotePin = recipe(cva(
  cn(
    chromeButton,
    "min-h-7 px-1.5 py-1 text-[10px] text-muted-foreground",
    "hover:bg-accent hover:text-foreground",
  ),
  {
    variants: {
      pressed: {
        true: "bg-muted text-foreground hover:bg-muted",
        false: "",
      },
    },
    defaultVariants: { pressed: false },
  },
));

export const whiteboardNoteAction = recipe(cva(
  cn(
    chromeButton,
    "min-h-8 rounded-[5px] border border-border px-2.5 py-1.5 text-[11px]",
  ),
  {
    variants: {
      app: {
        true:
          "border-brand bg-brand text-white hover:bg-brand hover:text-white",
        false: "bg-background text-foreground",
      },
    },
    defaultVariants: { app: false },
  },
));

export const whiteboardNoteLink = cn(
  chromeButton,
  "mt-1 min-h-7 rounded border border-border bg-background px-1.5 py-1",
  "text-left text-[10px] text-brand hover:bg-accent",
);

export const whiteboardBriefPart = cva("", {
  variants: {
    part: {
      root: "grid gap-3 px-3.5 pt-2.5 pb-4 text-foreground",
      title: "m-0 text-xs font-bold",
      meta: "mt-0.5 font-mono text-[0.55rem] text-muted-foreground",
      list: "m-0 grid list-none gap-2.5 p-0",
      heading: "mb-0.5 flex items-baseline gap-1.5 text-[0.68rem]",
      id: "font-mono text-[0.5rem] font-medium text-muted-foreground",
      statement: "mt-0.5 text-[0.62rem] leading-snug",
    },
  },
});

export const whiteboardTracePart = cva("", {
  variants: {
    part: {
      root: "mt-2.5 text-[10px] text-muted-foreground",
      summary: "cursor-pointer py-1 font-medium text-foreground",
      copy: "mt-1.5 leading-normal [overflow-wrap:anywhere]",
      clause: "mt-2 [overflow-wrap:anywhere]",
      clauseTitle: "m-0 text-[10px] text-muted-foreground",
    },
  },
});

/**
 * Shared record atom. Domain marker, listed 8% tint, focus and muted live
 * here. Related endpoints stay in that domain grammar; never a full-cell ring.
 * Activity status is a marker variant; it never replaces `--flow-color`.
 */
export const whiteboardFlowItem = recipe(cva(
  cn(
    "group pointer-events-auto border-0 bg-transparent p-0 outline-none",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
    "focus-visible:outline-[color-mix(in_srgb,var(--flow-color)_72%,#fff)]",
    "data-[state=muted]:opacity-[0.28]",
    "[[data-inspection=hover]_&]:data-[state=muted]:opacity-50",
    "[[data-inspection=selected]_&]:data-[state=muted]:opacity-[0.18]",
  ),
  {
    variants: {
      density: {
        point: "grid size-[0.875rem] place-items-center rounded-full",
        listed: cn(
          "flex items-center gap-[0.35rem] rounded-[0.34rem] text-left",
          "text-[0.6875rem]",
          "focus-visible:bg-[color-mix(in_srgb,var(--flow-color)_8%,transparent)]",
          "data-[state=related]:bg-[color-mix(in_srgb,var(--flow-color)_4%,transparent)]",
          "data-[state=selected]:bg-[color-mix(in_srgb,var(--flow-color)_8%,transparent)]",
          "data-[hull-row-view=list]:border-b",
          "data-[hull-row-view=list]:border-[rgb(39_54_61_/_0.06)]",
        ),
      },
      pending: {
        true: "pointer-events-none cursor-default opacity-100",
        false: "",
      },
    },
    compoundVariants: [
      {
        density: "listed",
        pending: false,
        class: "hover:bg-[color-mix(in_srgb,var(--flow-color)_8%,transparent)]",
      },
    ],
    defaultVariants: { density: "point", pending: false },
  },
));

export type WhiteboardFlowItemProps = VariantProps<typeof whiteboardFlowItem>;

export const whiteboardFlowItemPart = cva("", {
  variants: {
    part: {
      marker: cn(
        "block size-[0.4375rem] shrink-0 rounded-full border",
        "border-[color-mix(in_srgb,var(--flow-color)_76%,#fff)]",
        "bg-[var(--flow-color)]",
        "shadow-[0_0_0_2px_#fff]",
        "group-hover:shadow-[0_0_0_2px_#fff,0_0_0_4px_color-mix(in_srgb,var(--flow-color)_48%,transparent)]",
        "group-focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_color-mix(in_srgb,var(--flow-color)_48%,transparent)]",
        "group-data-[state=related]:shadow-[0_0_0_2px_#fff,0_0_0_3px_color-mix(in_srgb,var(--flow-color)_26%,transparent)]",
        "group-data-[state=selected]:shadow-[0_0_0_2px_#fff,0_0_0_4px_color-mix(in_srgb,var(--flow-color)_48%,transparent)]",
        "group-data-[has-viewer=true]:rounded-[0.125rem]",
        "group-data-[has-viewer=true]:outline",
        "group-data-[has-viewer=true]:outline-[1.5px]",
        "group-data-[has-viewer=true]:outline-[var(--flow-color)]",
        "group-data-[has-viewer=true]:outline-offset-2",
        "group-data-[kind=activity]:rounded-[0.125rem]",
      ),
      pendingMarker: cn(
        "block size-[0.4375rem] shrink-0 rounded-full border border-border",
        "bg-muted-foreground/20 shadow-[0_0_0_2px_#fff]",
        "motion-safe:animate-pulse",
      ),
      label: "min-w-0 flex-1 truncate",
      name: "flex min-w-0 flex-1 whitespace-nowrap",
      nameHead: "min-w-0 overflow-hidden text-ellipsis",
      nameTail: "max-w-[55%] flex-[0_1_auto] overflow-hidden text-ellipsis",
      detail: cn(
        "ml-auto min-w-0 shrink-0 truncate font-mono text-[0.5625rem]",
        "text-[var(--thread-muted,#68767c)]",
      ),
      viewer: cn(
        "ml-auto shrink-0 px-[0.3rem] font-mono text-[0.5rem]",
        "text-[var(--flow-color)]",
      ),
      tooltip: cn(
        "absolute bottom-[calc(100%+0.35rem)] left-1/2 z-10 hidden w-max",
        "max-w-[min(12rem,32cqi)] -translate-x-1/2 rounded-[0.35rem]",
        "border border-border bg-popover px-[0.45rem] py-[0.32rem]",
        "text-left text-[0.6875rem] font-semibold leading-tight",
        "text-popover-foreground shadow-[0_4px_14px_rgb(19_31_36_/_18%)]",
        "pointer-events-none",
        "group-hover:block group-focus-visible:block",
        "[&>strong]:block [&>span]:mt-[0.18rem] [&>span]:block",
        "[&>span]:overflow-hidden [&>span]:font-mono [&>span]:text-[0.5625rem]",
        "[&>span]:font-medium [&>span]:leading-tight",
        "[&>span]:text-muted-foreground [&>span]:[-webkit-box-orient:vertical]",
        "[&>span]:[-webkit-line-clamp:2] [&>span]:[display:-webkit-box]",
        "group-data-[lane=requirements]:left-0",
        "group-data-[lane=requirements]:translate-x-0",
        "group-data-[lane=verdicts]:right-0",
        "group-data-[lane=verdicts]:left-auto",
        "group-data-[lane=verdicts]:translate-x-0",
        "group-data-[hull-row-view=matrix]:max-w-[min(8.5rem,22cqi)]",
        "group-data-[hull-row-view=matrix]:px-[0.32rem]",
        "group-data-[hull-row-view=matrix]:py-[0.2rem]",
        "group-data-[hull-row-view=matrix]:text-[0.625rem]",
        "group-data-[hull-row-view=matrix]:[&>span]:mt-[0.08rem]",
        "group-data-[hull-row-view=matrix]:[&>span]:text-[0.5rem]",
        "group-data-[hull-row-view=matrix]:[&>span]:[-webkit-line-clamp:1]",
      ),
      activityLabel: cn(
        "absolute top-1/2 left-[calc(100%+0.38rem)] z-[3] grid w-max",
        "min-w-[5.25rem] max-w-[min(9rem,22cqi)] -translate-y-1/2",
        "gap-[0.16rem] rounded-[0.2rem] border-l-2",
        "border-[var(--thread-muted)] bg-[color-mix(in_srgb,#fff_92%,transparent)]",
        "px-[0.4rem] py-[0.28rem] pl-[0.48rem] text-left text-[#26363c]",
        "shadow-[0_1px_3px_rgb(24_38_43_/_10%)] pointer-events-auto",
        "cursor-inherit",
        "[&>strong]:line-clamp-2 [&>strong]:overflow-hidden",
        "[&>strong]:font-sans [&>strong]:text-[clamp(0.5625rem,0.88cqi,0.6875rem)]",
        "[&>strong]:font-semibold [&>strong]:leading-[1.18]",
        "[&>strong]:tracking-[-0.01em] [&>strong]:text-balance",
        "group-data-[lane=verdicts]:right-[calc(100%+0.38rem)]",
        "group-data-[lane=verdicts]:left-auto",
        "group-data-[lane=verdicts]:border-l-0",
        "group-data-[lane=verdicts]:border-r-2",
        "group-data-[lane=verdicts]:pr-[0.48rem]",
        "group-data-[lane=verdicts]:pl-[0.4rem]",
        "group-data-[lane=verdicts]:text-right",
        "group-data-[status=active]:border-[var(--ui-success)]",
        "group-data-[status=blocked]:border-[var(--ui-destructive)]",
      ),
      activityStatus: cn(
        "inline-flex items-center gap-[0.22rem] font-mono text-[0.475rem]",
        "font-bold uppercase tracking-[0.055em] leading-none",
        "text-[var(--thread-muted)]",
        "group-data-[status=active]:text-[var(--ui-success)]",
        "group-data-[status=blocked]:text-[var(--ui-destructive)]",
        "group-data-[lane=verdicts]:justify-end",
      ),
      activityMark: cn(
        "block size-[0.28rem] shrink-0 rounded-full border border-current",
        "bg-white",
        "group-data-[status=planned]:border-dashed",
        "group-data-[status=active]:bg-current",
        "group-data-[status=active]:shadow-[0_0_0_2px_color-mix(in_srgb,currentColor_12%,transparent)]",
      ),
      legendKey: cn(
        "block size-[0.42rem] rounded-[0.1rem] border-[1.5px]",
        "border-[var(--thread-muted)] bg-white",
      ),
      pendingBar: cn(
        "h-1.5 max-w-[70%] rounded-full bg-muted-foreground/20",
        "motion-safe:animate-pulse",
      ),
    },
    status: {
      planned: "",
      active: "",
      blocked: "",
    },
    emphasis: {
      true: "",
      false: "",
    },
    live: {
      true: "",
      false: "",
    },
  },
  compoundVariants: [
    {
      part: "marker",
      status: "planned",
      class: "border-dashed",
    },
    {
      part: "marker",
      status: "active",
      class:
        "outline outline-1 outline-offset-1 outline-[color-mix(in_srgb,var(--ui-success)_45%,transparent)]",
    },
    {
      part: "marker",
      status: "blocked",
      class:
        "outline outline-1 outline-offset-1 outline-[color-mix(in_srgb,var(--ui-destructive)_45%,transparent)]",
    },
    {
      part: "marker",
      emphasis: true,
      class: "size-[0.5625rem]",
    },
    {
      part: "detail",
      live: true,
      class: cn(
        "font-bold",
        "text-[color-mix(in_srgb,var(--flow-color)_72%,#405158)]",
      ),
    },
    {
      part: "legendKey",
      status: "planned",
      class: "border-dashed",
    },
    {
      part: "legendKey",
      status: "active",
      class: cn(
        "border-[var(--ui-success)]",
        "bg-[color-mix(in_srgb,var(--ui-success)_22%,#fff)]",
        "shadow-[0_0_0_2px_color-mix(in_srgb,var(--ui-success)_12%,transparent)]",
      ),
    },
    {
      part: "legendKey",
      status: "blocked",
      class: cn(
        "border-[var(--ui-destructive)]",
        "bg-[color-mix(in_srgb,var(--ui-destructive)_16%,#fff)]",
      ),
    },
  ],
  defaultVariants: { emphasis: false, live: false },
});

/**
 * Radial SVG graph cables. Paint tokens match FlowSegmentLayer / CSS18
 * (`#6e7f86` idle, `#6d28d9` incoming, `#0f766e` outgoing). Hierarchy
 * parent guides are a separate CSS18 layer, never this recipe.
 */
export const whiteboardFlowCable = recipe(cva(
  cn(
    "pointer-events-none [stroke-linecap:round] [stroke-linejoin:round]",
    "stroke-[#6e7f86] opacity-[0.16]",
  ),
  {
    variants: {
      state: {
        default: "",
        emphasis: "stroke-[var(--ui-warning)] opacity-[0.58]",
        incoming: "stroke-[#6d28d9] opacity-[0.68]",
        outgoing: "stroke-[#0f766e] opacity-[0.68]",
        muted: "opacity-[0.055]",
      },
    },
    defaultVariants: { state: "default" },
  },
));

export type WhiteboardFlowCableProps = VariantProps<typeof whiteboardFlowCable>;

/**
 * Radial SVG node state. Markers remain SVG geometry (circle/rect/leader);
 * selected/muted/focus follow the same tokens as the HTML flow item.
 */
export const whiteboardFlowRadialNode = cn(
  "cursor-pointer outline-none",
  "data-[state=muted]:opacity-[0.24]",
  "[&_.overview-thread-node-label]:fill-[#202b31]",
  "[&_.overview-thread-node-label]:font-medium",
  "hover:[&_.overview-thread-node-label]:fill-[#09090b]",
  "hover:[&_.overview-thread-node-label]:font-bold",
  "focus-visible:[&_.overview-thread-node-label]:fill-[#09090b]",
  "focus-visible:[&_.overview-thread-node-label]:font-bold",
  "data-[state=selected]:[&_.overview-thread-node-label]:fill-[#09090b]",
  "data-[state=selected]:[&_.overview-thread-node-label]:font-bold",
  "[&_.overview-thread-node-focus-ring]:opacity-0",
  "focus-visible:[&_.overview-thread-node-focus-ring]:opacity-100",
  "data-[state=selected]:[&_.overview-thread-node-focus-ring]:opacity-100",
  "data-[kind=activity]:[&_.overview-thread-node-label]:italic",
  "data-[kind=activity]:[&_.overview-thread-node-label]:fill-muted-foreground",
);
