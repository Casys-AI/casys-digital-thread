/** Qualified parser/lowering seam used to cross-check a complete CalculiX batch. */

import {
  buildDeck,
  buildGeoScript,
  inspectInp,
  parseDat,
} from "jsr:@casys/mcp-calculix@0.7.0";
import type { CalculixIsolatedBatchInspector } from "../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";

const INSPECTOR: CalculixIsolatedBatchInspector = {
  buildMeshScript: (
    input: Parameters<CalculixIsolatedBatchInspector["buildMeshScript"]>[0],
  ) =>
    buildGeoScript({
      ...input,
      selections: input.selections.map((selection) => ({
        name: selection.name,
        box: {
          min: [...selection.box.min],
          max: [...selection.box.max],
        },
      })),
    }),
  inspectMesh: inspectInp,
  buildDeck,
  parseResult: parseDat,
};

export const CALCULIX_ISOLATED_OUTPUT_BATCH_INSPECTOR = Object.freeze(INSPECTOR);
