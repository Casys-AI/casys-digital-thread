import type {
  ThreadGraphEdge,
  ThreadGraphNode,
} from "../contracts/thread-workbench.ts";
import type { LiveThreadGraphPatch } from "./live-thread-update-store.ts";
import type { RecordingMcpToolEvent } from "./recording-mcp-tool-client.ts";

/**
 * The only presentation milestones produced while the reviewed r3 SysON
 * authoring operation is running. These are deliberately about the guarded
 * lifecycle, not the SysML text, provider identities, or raw responses.
 */
export const INSPECTION_DRONE_ARCHITECTURE_LIVE_STEPS = [
  {
    id: "root-preflight",
    toolName: "syson_element_children",
    label: "Root package preflight",
  },
  {
    id: "architecture-insert",
    toolName: "syson_element_insert_sysml",
    label: "Inspection drone architecture insertion",
  },
  {
    id: "root-readback",
    toolName: "syson_element_children",
    label: "Root package read-back",
  },
  {
    id: "package-readback",
    toolName: "syson_element_children",
    label: "Architecture package read-back",
  },
] as const;

type InspectionDroneArchitectureLiveStep =
  (typeof INSPECTION_DRONE_ARCHITECTURE_LIVE_STEPS)[number];

interface ActiveCall {
  operationId: string;
  step: InspectionDroneArchitectureLiveStep;
}

/**
 * Produces a browser-safe live projection for
 * `architecture.author-inspection-drone@1`.
 *
 * One instance belongs to one run. It allocates the three identical
 * `syson_element_children` calls to their reviewed lifecycle positions, so a
 * browser sees a preflight and two different read-backs rather than one
 * ambiguous generic SysON read. The projection deliberately ignores both
 * `event.call.arguments` and `event.result`: canonical validation owns the
 * SysML payload and provider evidence after the run completes.
 */
export function createInspectionDroneArchitectureLiveProjector(
  runId: string,
): (event: RecordingMcpToolEvent) => LiveThreadGraphPatch {
  let nextStepIndex = 0;
  const activeCalls: ActiveCall[] = [];

  return (event) => {
    if (event.runId !== runId) return emptyPatch();
    const step = stepForEvent(event, activeCalls, () => {
      const candidate = INSPECTION_DRONE_ARCHITECTURE_LIVE_STEPS[nextStepIndex];
      if (!candidate || candidate.toolName !== event.toolName) return undefined;
      nextStepIndex++;
      return candidate;
    });
    if (!step) return emptyPatch();

    return {
      // Emit only the current milestone. LiveThreadUpdateStore assigns the
      // lifecycle state to every node in a patch; returning earlier milestones
      // here would incorrectly make a completed preflight look running again
      // when a later read-back starts.
      nodes: [milestoneNode(runId, step, event.phase, event.recordedAt)],
      edges: predecessorEdge(runId, step),
    };
  };
}

function stepForEvent(
  event: RecordingMcpToolEvent,
  activeCalls: ActiveCall[],
  allocateNext: () => InspectionDroneArchitectureLiveStep | undefined,
): InspectionDroneArchitectureLiveStep | undefined {
  const activeIndex = activeCalls.findLastIndex((candidate) =>
    candidate.operationId === event.operationId &&
    candidate.step.toolName === event.toolName
  );
  if (activeIndex >= 0) {
    const active = activeCalls[activeIndex]!;
    if (event.phase !== "started") activeCalls.splice(activeIndex, 1);
    return active.step;
  }

  const step = allocateNext();
  if (!step) return undefined;
  if (event.phase === "started") {
    activeCalls.push({ operationId: event.operationId, step });
  }
  return step;
}

function milestoneNode(
  runId: string,
  step: InspectionDroneArchitectureLiveStep,
  phase: RecordingMcpToolEvent["phase"],
  recordedAt: string,
): ThreadGraphNode {
  return {
    id: `${runId}:${step.id}`,
    ref: { kind: "artifact", id: `${runId}:${step.id}` },
    entityKind: "artifact",
    artifactKind: "other",
    label: step.label,
    system: "SysON",
    freshness: phase === "started"
      ? "running"
      : phase === "completed"
      ? "fresh"
      : "failed",
    summary: milestoneSummary(step.id, phase),
    recordedAt,
  };
}

function predecessorEdge(
  runId: string,
  step: InspectionDroneArchitectureLiveStep,
): ThreadGraphEdge[] {
  const index = INSPECTION_DRONE_ARCHITECTURE_LIVE_STEPS.findIndex((candidate) =>
    candidate.id === step.id
  );
  const predecessor = INSPECTION_DRONE_ARCHITECTURE_LIVE_STEPS[index - 1];
  if (!predecessor) return [];
  return [{
    id: `${runId}:${predecessor.id}-to-${step.id}`,
    from: { kind: "artifact", id: `${runId}:${predecessor.id}` },
    to: { kind: "artifact", id: `${runId}:${step.id}` },
    relation: "source_of",
    rationale: "This guarded SysON milestone follows the preceding reviewed step.",
    origin: "structure",
  }];
}

function milestoneSummary(
  stepId: InspectionDroneArchitectureLiveStep["id"],
  phase: RecordingMcpToolEvent["phase"],
): string {
  const subject = stepId === "root-preflight"
    ? "the reviewed root package"
    : stepId === "architecture-insert"
    ? "the fixed inspection-drone architecture"
    : stepId === "root-readback"
    ? "the root package"
    : "the architecture package";
  if (phase === "started") return `Checking ${subject}.`;
  if (phase === "failed") {
    return `This ${
      stepId.replaceAll("-", " ")
    } step did not complete. The live feed does not retry it or infer provider state.`;
  }
  if (stepId === "root-preflight") {
    return "Preflight response received. The guarded insertion precondition is still evaluated by the executor.";
  }
  if (stepId === "architecture-insert") {
    return "Insertion response received. Guarded SysON read-back is still required before an architecture is published.";
  }
  if (stepId === "root-readback") {
    return "Root-package read-back response received. The architecture package identity is still being checked.";
  }
  return "Architecture-package read-back response received. Named declarations remain subject to canonical validation.";
}

function emptyPatch(): LiveThreadGraphPatch {
  return { nodes: [], edges: [] };
}
