/**
 * Campaign 3: the vector traversal engine against a prudent baseline, on the
 * REAL two-parameter ribbed bench (rib height R, plate thickness T).
 *
 * Tasks: satisfy a displacement limit while keeping ADDED MASS under a cap.
 * The mass judge is analytic and exact (volume x density — never a solve);
 * the displacement judge is the FEA oracle (one real solve per proposal).
 *
 * The jacobian is NOT measured here: all three coefficients were already paid
 * for by earlier campaigns and are REUSED with their provenance — that is the
 * edge-amortisation the product argues for, exercised for real:
 *   du/dR = (u(6,8) - u(6,6)) / 2  from the hard-campaign reconnaissance
 *   du/dT = (u(8,6) - u(6,6)) / 2  from the two-parameter bench smoke
 *   mass edges: exact analytic derivatives of ribbedTrayVolumeMm3.
 * Their validity neighbourhoods are the measured intervals — narrow on
 * purpose: the hard campaign showed what extrapolation outside costs.
 *
 * Runs nothing without --execute and the exact acknowledgement.
 */

import { PLATE_THICKNESS_DEFAULT_MM, ribbedTrayVolumeMm3 } from "./ribbed-geometry.ts";
import { proposeVectorCorrection, type SensitivityEdge } from "./traversal.ts";
import { HttpMcpToolClient } from "../../src/adapters/mcp/http-mcp-tool-client.ts";
import { validateSensitivityStudyCase } from "../../src/domain/sensitivity-study.ts";
import { solveAtHeight } from "./harness.ts";

const ACK = "EXECUTE_ORACLE_2D_TRAVERSAL";
const DENSITY_G_PER_MM3 = 0.00105; // ABS-like, reviewed value of the case family.

// ── The reused, already-paid measurements (provenance cited) ──────────────────
const U_BASE = 4.998905551815817; // u(R=6, T=6), hard-campaign reconnaissance
const U_R8 = 4.281647561196031; // u(R=8, T=6), hard-campaign reconnaissance
const U_T8 = 2.5122629524409605; // u(R=6, T=8), two-parameter bench smoke
const DU_DR = (U_R8 - U_BASE) / 2; // -0.3586 mm/mm
const DU_DT = (U_T8 - U_BASE) / 2; // -1.2433 mm/mm
// Exact analytic mass derivatives (g/mm) — linear, so validity is unbounded;
// a large declared radius encodes that without special-casing the engine.
const DM_DR = 5 * 8 * 120 * DENSITY_G_PER_MM3; // 5.04 g/mm
const DM_DT = 190 * 135 * DENSITY_G_PER_MM3; // 26.9325 g/mm

const START = { rib: 6, plate: 6 };

const EDGES: readonly SensitivityEdge[] = [
  {
    parameter: "rib",
    metric: "disp",
    derivative: DU_DR,
    unit: "mm/mm",
    neighbourhood: { base: 7, radius: 1 }, // measured interval [6, 8]
    provenance:
      "hard-campaign reconnaissance 2026-08-04: u(6)=4.998906, u(8)=4.281648 at T=6",
  },
  {
    parameter: "plate",
    metric: "disp",
    derivative: DU_DT,
    unit: "mm/mm",
    neighbourhood: { base: 7, radius: 1 }, // measured interval [6, 8]
    provenance:
      "two-parameter bench smoke 2026-08-04: u(T=6)=4.998906, u(T=8)=2.512263 at R=6",
  },
  {
    parameter: "rib",
    metric: "added_mass",
    derivative: DM_DR,
    unit: "g/mm",
    neighbourhood: { base: 7, radius: 1000 }, // exact analytic: linear everywhere
    provenance: "analytic: 5 ribs x 8 x 120 mm2 x 0.00105 g/mm3, exact",
  },
  {
    parameter: "plate",
    metric: "added_mass",
    derivative: DM_DT,
    unit: "g/mm",
    neighbourhood: { base: 7, radius: 1000 },
    provenance: "analytic: 190 x 135 mm2 x 0.00105 g/mm3, exact",
  },
];

interface Task2D {
  readonly id: string;
  readonly dispThresholdMm: number;
  readonly addedMassCapG: number;
}
// Frozen: designed so the linear model admits a solution inside the measured
// neighbourhoods (delta R, delta T in [0, 2] reach u down to ~1.8 mm).
const TASKS: readonly Task2D[] = [
  { id: "T2D-1", dispThresholdMm: 4.5, addedMassCapG: 15 },
  { id: "T2D-2", dispThresholdMm: 4.0, addedMassCapG: 25 },
  { id: "T2D-3", dispThresholdMm: 3.5, addedMassCapG: 40 },
  { id: "T2D-4", dispThresholdMm: 3.0, addedMassCapG: 45 },
];
const BUDGET_SOLVES = 4;

// ── Real solve at (R, T) through the existing bench ───────────────────────────
const SENSITIVITY_CASE_PATH =
  "config/sensitivity-cases/coffee-machine-cm01-v3-drip-tray-size-z.json";

function addedMassG(rib: number, plate: number): number {
  return (ribbedTrayVolumeMm3(plate, rib) -
    ribbedTrayVolumeMm3(START.plate, START.rib)) * DENSITY_G_PER_MM3;
}

interface SolveLog {
  readonly rib: number;
  readonly plate: number;
  readonly displacementMm: number;
  readonly addedMassG: number;
  readonly dispVerdict: "PASS" | "FAIL";
  readonly massVerdict: "PASS" | "FAIL";
}

interface ArmResult {
  readonly arm: "TRAV" | "BASE";
  readonly taskId: string;
  readonly nSolves: number;
  readonly converged: boolean;
  readonly final: { rib: number; plate: number; addedMassG: number } | null;
  readonly stopReason: string;
  readonly log: readonly SolveLog[];
  readonly notes: readonly string[];
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Deno.args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

if (!Deno.args.includes("--execute") || argument("acknowledge") !== ACK) {
  console.log(JSON.stringify(
    {
      status: "confirmation-required",
      acknowledgement: ACK,
      tasks: TASKS,
      reusedMeasurements: 3,
      note: "No solver call happens until --execute and the exact acknowledgement " +
        "are both present. The jacobian is reused from prior campaigns, cited, " +
        "never re-measured here.",
    },
    null,
    2,
  ));
  Deno.exit(0);
}

const sc = validateSensitivityStudyCase(
  JSON.parse(await Deno.readTextFile(SENSITIVITY_CASE_PATH)),
);
const build123d = new HttpMcpToolClient({
  mcpUrl: "http://127.0.0.1:3014/mcp",
  timeoutMs: 120_000,
});
const calculix = new HttpMcpToolClient({
  mcpUrl: "http://127.0.0.1:3015/mcp",
  timeoutMs: 300_000,
});

// The bench's solveAtHeight solves the rib parameter at the default plate; for
// arbitrary (R, T) we go through the ribbed script directly via the solve-one
// pathway — but harness.solveAtHeight only varies height on the BOX bench.
// The honest bridge for (R, T) is the solve-one-ribs subprocess, reused as-is.
async function solve2d(
  rib: number,
  plate: number,
  label: string,
): Promise<{ displacementMm: number }> {
  const command = new Deno.Command("deno", {
    args: [
      "task",
      "experiment:solve-one-ribs",
      `--rib=${rib}`,
      `--plate=${plate}`,
      `--label=${label}`,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const out = await command.output();
  const text = new TextDecoder().decode(out.stdout).trim().split("\n").at(-1) ??
    "";
  const parsed = JSON.parse(text);
  if (parsed.error) {
    throw new Error(
      `solve2d(${rib}, ${plate}): ${parsed.error} — ${parsed.detail ?? ""}`,
    );
  }
  return { displacementMm: parsed.displacementMm };
}

function judge(rib: number, plate: number, u: number, task: Task2D): SolveLog {
  const mass = addedMassG(rib, plate);
  return {
    rib,
    plate,
    displacementMm: u,
    addedMassG: mass,
    dispVerdict: u <= task.dispThresholdMm ? "PASS" : "FAIL",
    massVerdict: mass <= task.addedMassCapG ? "PASS" : "FAIL",
  };
}

// ── Arm TRAV: the engine proposes once from the cited jacobian, the oracle
// verifies; a failed verification re-proposes from the new point only if the
// engine's neighbourhood contract still allows it. ───────────────────────────
async function runTrav(task: Task2D): Promise<ArmResult> {
  const log: SolveLog[] = [];
  const notes: string[] = [];
  let current = { ...START };
  let observedDisp = U_BASE; // reused measurement at the start point, cited
  notes.push("observed u at start reused from reconnaissance (0 solves)");
  let solves = 0;

  while (solves < BUDGET_SOLVES) {
    const proposal = proposeVectorCorrection(
      EDGES.map((e) => ({
        ...e,
        // Mass edges stay valid anywhere; disp edges keep their measured window.
      })),
      [
        {
          metric: "disp",
          operator: "<=",
          limit: task.dispThresholdMm,
          observed: observedDisp,
        },
        {
          metric: "added_mass",
          operator: "<=",
          limit: task.addedMassCapG,
          observed: addedMassG(current.rib, current.plate),
        },
      ],
      [
        {
          name: "rib",
          current: current.rib,
          domain: { min: 1, max: 14 },
          costPerUnit: DM_DR,
        },
        {
          name: "plate",
          current: current.plate,
          domain: { min: 4, max: 10 },
          costPerUnit: DM_DT,
        },
      ],
    );
    if (proposal.kind === "refuse") {
      return {
        arm: "TRAV",
        taskId: task.id,
        nSolves: solves,
        converged: false,
        final: null,
        stopReason: `engine_refused:${proposal.code}`,
        log,
        notes: [...notes, proposal.detail],
      };
    }
    const next = {
      rib: current.rib + proposal.deltas.rib,
      plate: current.plate + proposal.deltas.plate,
    };
    const { displacementMm } = await solve2d(
      next.rib,
      next.plate,
      `TRAV-${task.id}-s${solves + 1}`,
    );
    solves += 1;
    const entry = judge(next.rib, next.plate, displacementMm, task);
    log.push(entry);
    if (entry.dispVerdict === "PASS" && entry.massVerdict === "PASS") {
      return {
        arm: "TRAV",
        taskId: task.id,
        nSolves: solves,
        converged: true,
        final: { ...next, addedMassG: entry.addedMassG },
        stopReason: "converged",
        log,
        notes,
      };
    }
    notes.push(
      `verification failed at (${next.rib.toFixed(3)}, ${next.plate.toFixed(3)}): ` +
        `u=${displacementMm.toFixed(4)} — re-proposing from the verified point`,
    );
    current = next;
    observedDisp = displacementMm;
  }
  return {
    arm: "TRAV",
    taskId: task.id,
    nSolves: solves,
    converged: false,
    final: null,
    stopReason: "budget_exceeded",
    log,
    notes,
  };
}

// ── Arm BASE: the prudent designer — ribs first (cheap mass), plate second. ──
async function runBase(task: Task2D): Promise<ArmResult> {
  const log: SolveLog[] = [];
  let solves = 0;
  let rib = START.rib;
  let plate = START.plate;
  while (solves < BUDGET_SOLVES) {
    if (rib < 8) rib = Math.min(8, rib + 1);
    else plate = Math.min(8, plate + 0.5);
    const { displacementMm } = await solve2d(
      rib,
      plate,
      `BASE-${task.id}-s${solves + 1}`,
    );
    solves += 1;
    const entry = judge(rib, plate, displacementMm, task);
    log.push(entry);
    if (entry.dispVerdict === "PASS" && entry.massVerdict === "PASS") {
      return {
        arm: "BASE",
        taskId: task.id,
        nSolves: solves,
        converged: true,
        final: { rib, plate, addedMassG: entry.addedMassG },
        stopReason: "converged",
        log,
        notes: [],
      };
    }
    if (entry.massVerdict === "FAIL") {
      return {
        arm: "BASE",
        taskId: task.id,
        nSolves: solves,
        converged: false,
        final: null,
        stopReason: "mass_cap_exceeded",
        log,
        notes: [],
      };
    }
  }
  return {
    arm: "BASE",
    taskId: task.id,
    nSolves: solves,
    converged: false,
    final: null,
    stopReason: "budget_exceeded",
    log,
    notes: [],
  };
}

// ── Campaign ──────────────────────────────────────────────────────────────────
void sc;
void build123d;
void calculix;
void solveAtHeight;
void PLATE_THICKNESS_DEFAULT_MM;

const results: ArmResult[] = [];
for (const task of TASKS) {
  console.error(`[2d] ${task.id}: TRAV ...`);
  results.push(await runTrav(task));
  console.error(`[2d] ${task.id}: BASE ...`);
  results.push(await runBase(task));
}

const summary = ["TRAV", "BASE"].map((arm) => {
  const runs = results.filter((r) => r.arm === arm);
  return {
    arm,
    converged: runs.filter((r) => r.converged).length,
    runs: runs.length,
    totalSolves: runs.reduce((s, r) => s + r.nSolves, 0),
    totalAddedMassG: runs.reduce((s, r) => s + (r.final?.addedMassG ?? 0), 0),
  };
});

const out = {
  schemaVersion: "oracle-2d-traversal-campaign/1.0",
  reusedMeasurements: {
    count: 3,
    provenance: EDGES.filter((e) => e.metric === "disp").map((e) => e.provenance),
  },
  start: START,
  edges: EDGES,
  tasks: TASKS,
  summary,
  results,
  finishedAt: new Date().toISOString(),
};
const path = `experiments/oracle/results/${
  new Date().toISOString().replace(/[:.]/g, "-")
}-2d-traversal.json`;
await Deno.writeTextFile(path, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ status: "completed", path, summary }, null, 2));
