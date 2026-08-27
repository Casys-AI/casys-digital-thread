export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

/**
 * Le vocabulaire unique des états de run/record → variants de Badge.
 *
 * Un run en cours est une information (`info`), jamais un succès anticipé ;
 * une annulation est une fin neutre (`secondary`), jamais une erreur. Les
 * revues issues de ce choix : cinq vues affichaient les mêmes statuts avec
 * des couleurs contradictoires avant ce module.
 */
export function recordStatusVariant(status: string): BadgeVariant {
  if (
    status === "completed" ||
    status === "approved" ||
    status === "active" ||
    status === "in-progress" ||
    status === "sealed" ||
    status === "pass"
  ) {
    return "success";
  }
  if (
    status === "running" ||
    status === "publishing" ||
    status === "queued" ||
    status === "ready" ||
    status === "recording"
  ) {
    return "info";
  }
  if (
    status === "waiting-for-decision" ||
    status === "proposed" ||
    status === "needs-review" ||
    status === "revision-requested"
  ) {
    return "warning";
  }
  if (status === "failed" || status === "blocked" || status === "fail") {
    return "destructive";
  }
  if (status === "planned" || status === "cancelled") {
    return "secondary";
  }
  return "secondary";
}
