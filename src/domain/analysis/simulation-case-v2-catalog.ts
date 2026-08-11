/**
 * Closed server-owned V2 simulation-case catalogue.
 *
 * The catalogue is deliberately separate from V1: a V1 case cannot enter a
 * recorded @2 lifecycle by sharing a filename, fallback path, or identifier.
 * The declared digest is a reviewed source identity, not a value supplied by
 * an agent or inferred from a directory scan.
 */

import type { SimulationCaseV2 } from "./simulation-case-v2.ts";

export interface SimulationCaseV2CatalogEntry {
  readonly sourcePath: string;
  readonly canonicalDigest: string;
}

/** Read-only sealed catalogue port; only composition roots may select it. */
export type SimulationCaseV2Catalog = ReadonlyMap<string, SimulationCaseV2CatalogEntry>;

export const SIMULATION_CASE_V2_CATALOG: ReadonlyMap<
  string,
  SimulationCaseV2CatalogEntry
> = new Map([
  [
    simulationCaseV2CatalogKey({
      schemaVersion: "simulation-case/2.0",
      id: "coffee-machine-cm01-thermal-nominal-v2",
      revision: 1,
    }),
    {
      sourcePath: "config/simulation-cases/coffee-machine-cm01-thermal-nominal-v2.json",
      canonicalDigest:
        "7efeebf57c20cd2462395f8f47626392c3bb9be450c7ac2d471a9c2e060979bb",
    },
  ],
]);

export function simulationCaseV2CatalogKey(input: {
  readonly schemaVersion: string;
  readonly id: string;
  readonly revision: number;
}): string {
  return `${input.schemaVersion}:${input.id}:r${input.revision}`;
}

export function cataloguedSimulationCaseV2SourcePath(
  input: {
    readonly schemaVersion: string;
    readonly id: string;
    readonly revision: number;
  },
  catalog: SimulationCaseV2Catalog = SIMULATION_CASE_V2_CATALOG,
): string | undefined {
  return catalog.get(simulationCaseV2CatalogKey(input))?.sourcePath;
}

/**
 * Require the reviewed V2 catalogue entry to equal the exact canonical case
 * bytes.  This stops a server-side source edit from becoming eligible merely
 * because a different MRTR digest later repeats it.
 */
export function assertCataloguedSimulationCaseV2(
  simulationCase: SimulationCaseV2,
  canonicalDigest: string,
  catalog: SimulationCaseV2Catalog = SIMULATION_CASE_V2_CATALOG,
): void {
  const entry = catalog.get(
    simulationCaseV2CatalogKey(simulationCase),
  );
  if (!entry || entry.canonicalDigest !== canonicalDigest) {
    throw new TypeError(
      "Simulation case is not the exact reviewed entry in the closed V2 catalogue.",
    );
  }
}
