/**
 * La marge d'une exigence : où la mesure tombe dans l'intervalle admissible.
 *
 * Une valeur seule ne dit rien — `0.13 mm` n'informe pas. `0.13 mm pour une
 * limite de 2 mm` dit tout, et surtout distingue une exigence tenue de
 * justesse d'une exigence tenue largement. Deux verdicts « pass » aujourd'hui
 * s'affichent à l'identique, alors que l'un est le sujet de la revue suivante.
 *
 * Rien n'est deviné : la limite se lit dans l'expression ENREGISTRÉE et la
 * valeur dans l'observation enregistrée, avec la même unité de part et
 * d'autre. Dès qu'un des deux manque, ou que les unités diffèrent, la fonction
 * renonce — une jauge fausse serait pire qu'une absence de jauge.
 */

export type MarginDirection = "at-most" | "at-least";

export interface RequirementMargin {
  readonly direction: MarginDirection;
  readonly value: number;
  readonly limit: number;
  readonly unit: string;
  /** Part de l'intervalle admissible consommée, bornée à [0, 1]. */
  readonly used: number;
  /** Marge restante en fraction de la limite, négative si dépassée. */
  readonly slack: number;
}

const EXPRESSION =
  /^\s*\S+\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)\s*(\S+)?\s*$/i;
const MEASUREMENT = /^\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)\s*(\S+)?\s*$/i;

/**
 * `expression` est la contrainte telle qu'enregistrée (`maxDisplacement <= 2
 * mm`), `computed` la valeur observée (`0.1307075 mm`). Les unités doivent
 * coïncider : convertir ici reviendrait à interpréter une physique que le
 * cockpit n'a pas autorité pour interpréter.
 */
export function requirementMargin(
  expression: string,
  computed: string,
): RequirementMargin | undefined {
  const constraint = EXPRESSION.exec(expression);
  const measured = MEASUREMENT.exec(computed);
  if (!constraint || !measured) return undefined;

  const operator = constraint[1];
  const rawLimit = constraint[2];
  const limitUnit = constraint[3];
  const rawValue = measured[1];
  const valueUnit = measured[2];
  if (operator === undefined || rawLimit === undefined) return undefined;
  if (rawValue === undefined) return undefined;
  if ((limitUnit ?? "") !== (valueUnit ?? "")) return undefined;

  const limit = Number(rawLimit);
  const value = Number(rawValue);
  if (!Number.isFinite(limit) || !Number.isFinite(value)) return undefined;
  if (limit === 0) return undefined;

  const direction: MarginDirection = operator.startsWith("<")
    ? "at-most"
    : "at-least";
  const ratio = value / limit;
  const used = direction === "at-most" ? ratio : (ratio === 0 ? 1 : 1 / ratio);
  const slack = direction === "at-most" ? 1 - ratio : ratio - 1;

  return {
    direction,
    value,
    limit,
    unit: limitUnit ?? "",
    used: Math.min(1, Math.max(0, used)),
    slack,
  };
}

/** Marge en pourcentage, arrondie, prête à afficher. */
export function marginLabel(margin: RequirementMargin): string {
  const percent = Math.round(margin.slack * 100);
  return percent >= 0 ? `+${percent}% margin` : `${percent}% over`;
}
