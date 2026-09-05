/**
 * Vocabulaire de composition du cockpit.
 *
 * Ces pièces ne portent aucune donnée ni aucune règle : elles fixent la
 * grammaire visuelle partagée par les cinq vues — en-tête de page, cartes à
 * chapeau et pied, pastilles d'état, cartouche de mesures. Les vues n'écrivent
 * plus de classes de chrome, elles composent ces éléments.
 *
 * Les couleurs viennent des jetons de thème (`card`, `border`, `brand`,
 * `lane-*`), jamais d'une échelle Tailwind brute : le cockpit doit rester
 * pilotable depuis `styles.css`.
 */

import type { ComponentChildren } from "preact";
import type { JSX } from "react";
import { cn } from "../lib/utils.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

/**
 * Surtitre de page : mono, capitales, teinté de l'accent produit. Il nomme
 * l'espace où l'on se trouve — un seul par page.
 */
export const PAGE_EYEBROW =
  "font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-brand";

/** Étiquette de section : mono, capitales, interlettrage large. */
export const SECTION_LABEL =
  "font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

/**
 * Libellé de voie du fil. Il ne porte pas sa couleur : elle vient de la
 * discipline, appliquée par l'appelant, parce que c'est une donnée.
 */
export const LANE_LABEL =
  "font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em]";

/**
 * Surface de carte : bord, fond, coins, ombre. Une seule définition.
 *
 * `Card` la porte pour le cas courant. La constante existe pour les surfaces
 * qui ne sont pas un <div> — un <dl> de mesures, un <button> cliquable — afin
 * qu'elles restent la même carte sans recopier les classes.
 */
export const CARD_SURFACE =
  "rounded-lg border border-border bg-card text-card-foreground";

/** Ligne de données : mono discret, pour les identités et les empreintes. */
export const DATA_LINE = "font-mono text-[10px] text-muted-foreground";

const CHIP_TONE = {
  pass: "bg-lane-verdict/10 text-lane-verdict",
  run: "bg-brand/12 text-brand",
  warn: "bg-lane-phys/12 text-lane-phys",
  fail: "bg-destructive/10 text-destructive",
  flat: "bg-muted text-foreground",
} as const;

export type ChipTone = keyof typeof CHIP_TONE;

/** Pastille d'état compacte. Le ton est un signal, jamais une décoration. */
export function Chip(
  { tone = "flat", className, children }: {
    tone?: ChipTone;
    className?: string;
    children: ComponentChildren;
  },
): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-px font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em]",
        CHIP_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Marqueur d'absence enregistrée. Le pointillé dit « rien n'est consigné
 * ici », ce qui n'est pas la même chose qu'un état neutre.
 */
export function Gap({ children = "gap" }: { children?: ComponentChildren }) {
  return (
    <span className="inline-flex items-center rounded-md border border-dashed border-lane-phys/50 px-1.5 py-px font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em] text-lane-phys">
      {children}
    </span>
  );
}

/** Pied de carte : la zone des renvois, visuellement en retrait. */
export function PanelFoot(
  { className, children }: { className?: string; children: ComponentChildren },
): JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-3 py-1.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * En-tête de page : surtitre mono, titre équilibré, et un emplacement libre
 * à droite pour le cartouche de mesures.
 */
export function PageHead(
  { eyebrow, title, children }: {
    eyebrow: ComponentChildren;
    title: ComponentChildren;
    children?: ComponentChildren;
  },
): JSX.Element {
  return (
    <div className="flex items-end justify-between gap-6 pb-3.5">
      <div className="min-w-0">
        <p className={cn("m-0", PAGE_EYEBROW)}>{eyebrow}</p>
        <h1 className="m-0 mt-1 max-w-[640px] text-balance text-[19px]/tight font-semibold -tracking-[0.015em]">
          {title}
        </h1>
      </div>
      {children}
    </div>
  );
}

/**
 * Cartouche de mesures. Les cellules se séparent d'un filet ; la valeur est
 * en mono parce que c'est une donnée, pas un libellé.
 */
export function StatBar(
  { className, children }: { className?: string; children: ComponentChildren },
): JSX.Element {
  return (
    <dl
      className={cn(
        "m-0 grid shrink-0 auto-cols-fr grid-flow-col overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function Stat(
  { label, tone, children }: {
    label: ComponentChildren;
    tone?: string;
    children: ComponentChildren;
  },
): JSX.Element {
  return (
    <div className="min-w-0 px-3 py-1.5 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-border">
      <dt className="m-0 font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "m-0 mt-px truncate text-[12.5px] font-medium tabular-nums",
          tone,
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * Fond de viewport : la trame diagonale dit « surface de rendu », et se
 * distingue d'une carte vide qui, elle, dirait « rien à montrer ».
 */
export function ViewportSurface(
  { className, children }: { className?: string; children?: ComponentChildren },
): JSX.Element {
  return (
    <div
      className={cn(
        "grid place-items-center bg-[repeating-linear-gradient(45deg,var(--color-muted)_0_8px,var(--color-background)_8px_16px)] text-center font-mono text-[10px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Infobulle courte sur un élément déclencheur déjà interactif. */
export function Hint(
  { label, children }: { label: ComponentChildren; children: JSX.Element },
): JSX.Element {
  return (
    <Tooltip side="top">
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-64">{label}</TooltipContent>
    </Tooltip>
  );
}
