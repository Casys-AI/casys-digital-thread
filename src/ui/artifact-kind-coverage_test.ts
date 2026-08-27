/**
 * Completeness guard — every artifact kind known to the domain has an
 * explicit presentation classification (supporting or essential) and a
 * valid displayKindOf mapping.
 *
 * The literal list CONTRACT_ARTIFACT_KINDS below mirrors
 * ThreadArtifactKind from src/domain/thread/thread-snapshot.ts. The
 * compiler enforces exact parity via `satisfies readonly ThreadArtifactKind[]`:
 * add a kind to the domain union → compiler forces you to add it here;
 * remove one → same error. This test then asserts that neither
 * classification is accidental.
 *
 * Why this lives in src/ui/ and not in src/domain/:
 * The presentation classification (SUPPORTING_ARTIFACT_KINDS, displayKindOf)
 * belongs to the UI model layer. The guard bridges the domain contract and
 * the UI classification so that a new domain kind never silently becomes
 * "artifact" (essential) when it should be "supporting-artifact".
 */

import { assertEquals } from "@std/assert";
import type { ThreadArtifactKind } from "../domain/thread/thread-snapshot.ts";
import {
  displayKindOf,
  isSupportingNode,
  SUPPORTING_ARTIFACT_KINDS,
} from "./src/thread/essential-graph-filter.ts";
import type { ThreadGraphNode } from "./src/thread/types.ts";

// ---------------------------------------------------------------------------
// Contract list — must stay identical to ThreadArtifactKind in
// src/domain/thread/thread-snapshot.ts.
// The `satisfies` annotation makes the compiler the enforcer of parity.
// ---------------------------------------------------------------------------

// deno-fmt-ignore
const CONTRACT_ARTIFACT_KINDS = [
  "sysml-model",
  "script",
  "cad-model",
  "step",
  "mesh",
  "simulation-model",
  "solver-input",
  "solver-result",
  "evidence",
  "bom",
  "document",
  "other",
] as const satisfies readonly ThreadArtifactKind[];

type ContractArtifactKind = (typeof CONTRACT_ARTIFACT_KINDS)[number];
type MissingContractArtifactKinds = Exclude<
  ThreadArtifactKind,
  ContractArtifactKind
>;
type ExtraContractArtifactKinds = Exclude<
  ContractArtifactKind,
  ThreadArtifactKind
>;

// `satisfies` rejects invalid list values, but does not reject omissions from
// a union. This assignment makes that parity bidirectional at type-check time.
const _CONTRACT_ARTIFACT_KINDS_ARE_EXHAUSTIVE: [
  MissingContractArtifactKinds,
  ExtraContractArtifactKinds,
] extends [never, never] ? true : never = true;

// ---------------------------------------------------------------------------
// Expected classification for each kind.
//
// "supporting" → raw technical intermediary; the essential evidence is the
//               observation/evaluation extracted from it.
// "essential"  → the artifact itself is presented in the condensed view.
// ---------------------------------------------------------------------------

const EXPECTED_CLASSIFICATION: Record<
  ContractArtifactKind,
  "supporting" | "essential"
> = {
  // SysML model and geometry outputs are primary engineering deliverables.
  "sysml-model": "essential",
  "cad-model": "essential",
  "step": "essential",
  "bom": "essential",
  // Input/output file formats of solvers and simulators: the observation
  // extracted from them is the essential fact, not the raw byte container.
  "solver-input": "supporting",
  "solver-result": "supporting",
  "simulation-model": "supporting",
  // Mesh files are intermediate geometry representations (STL, GLB).
  "mesh": "supporting",
  // Compiled script, CAS evidence envelope, general document, catch-all.
  "script": "supporting",
  "evidence": "supporting",
  "document": "supporting",
  "other": "supporting",
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function artifactNodeFor(artifactKind: string): ThreadGraphNode {
  return {
    id: `test-${artifactKind}`,
    ref: { kind: "artifact", id: `test-${artifactKind}` },
    entityKind: "artifact",
    artifactKind,
    label: artifactKind,
    system: "build123d",
    freshness: "fresh",
    summary: artifactKind,
  };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

Deno.test(
  "every contract artifact kind has an explicit presentation classification",
  () => {
    for (const kind of CONTRACT_ARTIFACT_KINDS) {
      const node = artifactNodeFor(kind);
      const expected = EXPECTED_CLASSIFICATION[kind];

      // 1. SUPPORTING_ARTIFACT_KINDS membership must match EXPECTED_CLASSIFICATION.
      const inSupportingSet = SUPPORTING_ARTIFACT_KINDS.has(kind);
      assertEquals(
        inSupportingSet,
        expected === "supporting",
        `artifactKind "${kind}": SUPPORTING_ARTIFACT_KINDS membership ` +
          `(${inSupportingSet}) disagrees with expected "${expected}"`,
      );

      // 2. isSupportingNode must agree with the set membership.
      assertEquals(
        isSupportingNode(node),
        expected === "supporting",
        `isSupportingNode for artifactKind "${kind}" must return ` +
          `${expected === "supporting"}`,
      );

      // 3. displayKindOf must map to the expected DisplayKind without
      //    falling through to a non-intentional default.
      const displayKind = displayKindOf(node);
      const expectedDisplayKind = expected === "supporting"
        ? "supporting-artifact"
        : "artifact";
      assertEquals(
        displayKind,
        expectedDisplayKind,
        `displayKindOf node with artifactKind "${kind}": ` +
          `expected "${expectedDisplayKind}", got "${displayKind}"`,
      );
    }
  },
);
