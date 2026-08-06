/**
 * Runner for the B-vs-C oracle experiment.
 *
 * Dry-run (no flags): prints the task plan and exits. No provider call, no
 * solve, no file write.
 *
 * Execute (--execute --acknowledge=EXECUTE_ORACLE_B_VS_C_DRIP_TRAY):
 *   1. Loads and fingerprints tasks.json (the frozen judge).
 *   2. Loads and validates the sensitivity case.
 *   3. Runs a 2-solve repeatability check at the declared height; logs spread.
 *   4. For each task: runs Arm B (bisection), then Arm C (gradient-guided).
 *   5. Writes experiments/oracle/results/<timestamp>-b-vs-c.json.
 *
 * This runner never writes to state/, never publishes a ThreadSnapshot, and
 * never updates a project revision. It is a measurement harness only.
 */

import { sha256Fingerprint } from "../../src/domain/kernel/deterministic-json.ts";
import { validateSensitivityStudyCase } from "../../src/domain/analysis/sensitivity-study.ts";
import { HttpMcpToolClient } from "../../src/adapters/mcp/http-mcp-tool-client.ts";
import {
  armBStep,
  armCAmortisedStep,
  armCStep,
  type OracleTask,
  type PolicyStep,
  type PolicyStop,
  type SolveObservation,
} from "./policies.ts";
import { judgeDisplacement, solveAtHeight } from "./harness.ts";

// ── Constants ──────────────────────────────────────────────────────────────────

export const ORACLE_EXECUTE_ACKNOWLEDGEMENT =
  "EXECUTE_ORACLE_B_VS_C_DRIP_TRAY" as const;

/** build123d port, from config/mcp-fleet.json. */
const BUILD123D_URL = "http://127.0.0.1:3014/mcp";
/** CalculiX port, from config/mcp-fleet.json. */
const CALCULIX_URL = "http://127.0.0.1:3015/mcp";

const TASKS_JSON_PATH = "experiments/oracle/tasks.json";
const RESULTS_DIR = "experiments/oracle/results";

// ── Schema types for tasks.json ────────────────────────────────────────────────

interface OracleTaskDeclaration {
  readonly id: string;
  readonly startingHeightMm: number;
  readonly displacementThresholdMm: number;
  readonly toleranceMm: number;
  readonly designNote?: string;
}

interface OracleTaskSet {
  readonly schemaVersion: string;
  readonly id: string;
  readonly description: string;
  readonly sensitivityCaseRef: {
    readonly path: string;
    readonly id: string;
    readonly revision: number;
  };
  readonly targetMetric: { readonly id: string; readonly unit: string };
  readonly safeHeightDomainMm: { readonly min: number; readonly max: number };
  readonly measureStepMm: number;
  readonly toleranceMm: number;
  readonly budgetSolvesPerArm: number;
  readonly repeatabilityCheckHeightMm: number;
  readonly repeatabilityThresholdMm: number;
  readonly tasks: readonly OracleTaskDeclaration[];
}

// ── Result types ───────────────────────────────────────────────────────────────

interface SolveLog {
  readonly solveIndex: number;
  readonly heightMm: number;
  readonly displacementMm: number;
  readonly vonMisesMpa: number;
  readonly verdict: "pass" | "fail";
  readonly wallTimeMs: number;
  readonly rationale: string;
}

interface TaskArmResult {
  readonly taskId: string;
  readonly arm: "B" | "C" | "CA";
  readonly stopReason: PolicyStop["reason"];
  readonly converged: boolean;
  readonly nSolves: number;
  readonly finalHeightMm: number | null;
  readonly finalDisplacementMm: number | null;
  readonly wallTimeMs: number;
  readonly solves: readonly SolveLog[];
}

interface RepeatabilityResult {
  readonly heightMm: number;
  readonly solves: readonly { displacementMm: number; vonMisesMpa: number }[];
  readonly minDisplacementMm: number;
  readonly maxDisplacementMm: number;
  readonly amplitudeMm: number;
  readonly thresholdMm: number;
  readonly withinThreshold: boolean;
}

/**
 * The one-off campaign gradient measurement: two solves (reference height and
 * reference+step). Paid once per campaign and always reported in the CA total.
 */
const CAMPAIGN_GRADIENT_SOLVES = 2;

interface CampaignSummary {
  readonly totalSolvesB: number;
  readonly totalSolvesC: number;
  /** Measured Arm CA task solves, EXCLUDING the campaign gradient measurement. */
  readonly totalSolvesCA: number;
  /** The two campaign-gradient solves, paid once, never hidden. */
  readonly campaignGradientSolves: number;
  /** totalSolvesCA + campaignGradientSolves — the honest CA campaign total. */
  readonly totalSolvesCAWithMeasurement: number;
  readonly convergedB: number;
  readonly convergedC: number;
  readonly convergedCA: number;
  readonly avgSolvesPerTaskB: number;
  readonly avgSolvesPerTaskC: number;
  readonly avgSolvesPerTaskCA: number;
  /** N* where measured CA (gradient + N×avgCA) breaks even with N×avgB. */
  readonly amortisedBreakEvenAtNTasks: number | null;
  readonly amortisedNote: string;
}

interface CampaignResult {
  readonly schemaVersion: "oracle-campaign/1.0";
  readonly taskSetId: string;
  readonly tasksDigest: { readonly algorithm: string; readonly digest: string };
  readonly sensitivityCaseDigest: {
    readonly algorithm: string;
    readonly digest: string;
  };
  readonly sensitivityCaseId: string;
  readonly meshSizeMm: number;
  readonly safeHeightDomainMm: { readonly min: number; readonly max: number };
  readonly repeatability: RepeatabilityResult;
  readonly runs: readonly TaskArmResult[];
  readonly summary: CampaignSummary;
  readonly startedAt: string;
  readonly finishedAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Deno.args.find((v) => v.startsWith(prefix))?.slice(prefix.length);
}

function loadJson(path: string): unknown {
  const text = Deno.readTextFileSync(path);
  return JSON.parse(text);
}

function validateTaskSet(raw: unknown): OracleTaskSet {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("tasks.json must be a JSON object");
  }
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== "oracle-tasks/1.0") {
    throw new TypeError(
      `tasks.json schemaVersion must be oracle-tasks/1.0, got ${r.schemaVersion}`,
    );
  }
  if (!Array.isArray(r.tasks) || r.tasks.length === 0) {
    throw new TypeError("tasks.json must declare at least one task");
  }
  // Solvability guard: a threshold at or below the displacement measured at
  // the domain ceiling (u at safeMax, declared with provenance in tasks.json)
  // has no solution inside the safe domain — Arm B would then treat safeMax
  // as a passing bracket bound it never solves, and silently converge on an
  // unsatisfiable task. Reject the task set instead of running a lie.
  const ceiling = r.ceilingDisplacementMm as
    | { value?: unknown; unit?: unknown }
    | undefined;
  if (
    !ceiling || typeof ceiling.value !== "number" || ceiling.unit !== "mm"
  ) {
    throw new TypeError(
      "tasks.json must declare ceilingDisplacementMm {value, unit: mm} with provenance",
    );
  }
  for (const task of r.tasks as { id?: unknown; displacementThresholdMm?: unknown }[]) {
    if (
      typeof task.displacementThresholdMm !== "number" ||
      task.displacementThresholdMm <= ceiling.value
    ) {
      throw new TypeError(
        `Task ${String(task.id)}: threshold ${
          String(task.displacementThresholdMm)
        } mm is at or below the ceiling displacement ${ceiling.value} mm — ` +
          "unsolvable inside the safe domain.",
      );
    }
  }
  return raw as OracleTaskSet;
}

function isoTimestampForFilename(d: Date): string {
  return d.toISOString().replace(/:/g, "-").replace(/\./g, "-");
}

// ── Arm runner ─────────────────────────────────────────────────────────────────

/**
 * Run a single arm on a single task.
 *
 * The policyFn is a closure that already captures task-specific parameters
 * (safeMaxMm, budgetMax, etc.) so this function only needs the history.
 * Timestamps are recorded per solve for wall-time analysis.
 */
async function runArm(
  arm: "B" | "C" | "CA",
  policyFn: (history: readonly SolveObservation[]) => PolicyStep,
  task: OracleTask,
  threshold: { value: number; unit: string },
  build123d: HttpMcpToolClient,
  calculix: HttpMcpToolClient,
  sc: ReturnType<typeof validateSensitivityStudyCase>,
): Promise<TaskArmResult> {
  const history: SolveObservation[] = [];
  const solveLogs: SolveLog[] = [];
  const armStart = Date.now();
  let stopResult: PolicyStep & { action: "stop" } = {
    action: "stop",
    reason: "budget_exceeded",
    detail: "arm runner exited without a policy stop",
  };

  let solveIndex = 0;

  while (true) {
    const step = policyFn(history);
    if (step.action === "stop") {
      stopResult = step;
      break;
    }

    const armId = arm.toLowerCase();
    const taskId = task.id.toLowerCase();
    const exportName = `oracle-drip-tray-${armId}-${taskId}-s${solveIndex}`;

    const solveStart = Date.now();
    const result = await solveAtHeight(
      build123d,
      calculix,
      sc,
      step.heightMm,
      exportName,
    );
    const solveMs = Date.now() - solveStart;

    const verdict = judgeDisplacement(
      { value: result.displacementMm, unit: "mm" },
      threshold,
    );

    history.push({
      heightMm: step.heightMm,
      displacementMm: result.displacementMm,
      vonMisesMpa: result.vonMisesMpa,
      verdict,
    });
    solveLogs.push({
      solveIndex,
      heightMm: step.heightMm,
      displacementMm: result.displacementMm,
      vonMisesMpa: result.vonMisesMpa,
      verdict,
      wallTimeMs: solveMs,
      rationale: step.rationale,
    });
    solveIndex++;
  }

  const passes = history.filter((o) => o.verdict === "pass");
  const lastPass = passes.length > 0 ? passes[passes.length - 1] : null;

  return {
    taskId: task.id,
    arm,
    stopReason: stopResult.reason,
    converged: stopResult.reason === "converged",
    nSolves: history.length,
    finalHeightMm: lastPass?.heightMm ?? null,
    finalDisplacementMm: lastPass?.displacementMm ?? null,
    wallTimeMs: Date.now() - armStart,
    solves: solveLogs,
  };
}

// ── Repeatability check ────────────────────────────────────────────────────────

async function runRepeatabilityCheck(
  heightMm: number,
  thresholdMm: number,
  build123d: HttpMcpToolClient,
  calculix: HttpMcpToolClient,
  sc: ReturnType<typeof validateSensitivityStudyCase>,
): Promise<RepeatabilityResult> {
  const measurements: { displacementMm: number; vonMisesMpa: number }[] = [];

  for (let i = 0; i < 2; i++) {
    const exportName = `oracle-drip-tray-repeatability-h${heightMm}-s${i}`;
    const r = await solveAtHeight(build123d, calculix, sc, heightMm, exportName);
    measurements.push({ displacementMm: r.displacementMm, vonMisesMpa: r.vonMisesMpa });
  }

  const displacements = measurements.map((m) => m.displacementMm);
  const minD = Math.min(...displacements);
  const maxD = Math.max(...displacements);
  const amplitude = maxD - minD;

  return {
    heightMm,
    solves: measurements,
    minDisplacementMm: minD,
    maxDisplacementMm: maxD,
    amplitudeMm: amplitude,
    thresholdMm,
    withinThreshold: amplitude <= thresholdMm,
  };
}

// ── Campaign summary ───────────────────────────────────────────────────────────

function computeSummary(
  runs: readonly TaskArmResult[],
  nTasks: number,
): CampaignSummary {
  const bRuns = runs.filter((r) => r.arm === "B");
  const cRuns = runs.filter((r) => r.arm === "C");
  const caRuns = runs.filter((r) => r.arm === "CA");

  const totalSolvesB = bRuns.reduce((s, r) => s + r.nSolves, 0);
  const totalSolvesC = cRuns.reduce((s, r) => s + r.nSolves, 0);
  const totalSolvesCA = caRuns.reduce((s, r) => s + r.nSolves, 0);
  const convergedB = bRuns.filter((r) => r.converged).length;
  const convergedC = cRuns.filter((r) => r.converged).length;
  const convergedCA = caRuns.filter((r) => r.converged).length;
  const avgB = nTasks > 0 ? totalSolvesB / nTasks : 0;
  const avgC = nTasks > 0 ? totalSolvesC / nTasks : 0;
  const avgCA = nTasks > 0 ? totalSolvesCA / nTasks : 0;
  const totalSolvesCAWithMeasurement = totalSolvesCA + CAMPAIGN_GRADIENT_SOLVES;

  // Break-even derived from MEASURED averages: the one-off campaign gradient
  // amortises when gradient + N×avgCA < N×avgB, i.e. N > gradient/(avgB-avgCA).
  let breakEven: number | null = null;
  if (avgB > avgCA) {
    breakEven = Math.ceil(CAMPAIGN_GRADIENT_SOLVES / (avgB - avgCA));
  }

  const amortisedNote =
    `Measured: B total = ${totalSolvesB}, C (self-measured gradient) total = ` +
    `${totalSolvesC}, CA task solves = ${totalSolvesCA} + ` +
    `${CAMPAIGN_GRADIENT_SOLVES} campaign-gradient solves = ` +
    `${totalSolvesCAWithMeasurement}. ` +
    (breakEven !== null
      ? `Break-even at N≥${breakEven} tasks (avgB=${avgB.toFixed(2)}, ` +
        `avgCA=${avgCA.toFixed(2)}).`
      : `avgB=${avgB.toFixed(2)} ≤ avgCA=${avgCA.toFixed(2)} — ` +
        `the campaign gradient never amortises on these tasks.`);

  return {
    totalSolvesB,
    totalSolvesC,
    totalSolvesCA,
    campaignGradientSolves: CAMPAIGN_GRADIENT_SOLVES,
    totalSolvesCAWithMeasurement,
    convergedB,
    convergedC,
    convergedCA,
    avgSolvesPerTaskB: avgB,
    avgSolvesPerTaskC: avgC,
    avgSolvesPerTaskCA: avgCA,
    amortisedBreakEvenAtNTasks: breakEven,
    amortisedNote,
  };
}

// ── Plan printer ───────────────────────────────────────────────────────────────

function printPlan(taskSet: OracleTaskSet): void {
  console.log("=== Oracle B-vs-C Experiment Plan ===");
  console.log(`Task set: ${taskSet.id}`);
  console.log(`Description: ${taskSet.description}`);
  console.log(
    `Safe domain: [${taskSet.safeHeightDomainMm.min}, ${taskSet.safeHeightDomainMm.max}] mm`,
  );
  console.log(`Measure step (C): ${taskSet.measureStepMm} mm`);
  console.log(`Convergence tolerance: ${taskSet.toleranceMm} mm`);
  console.log(`Budget per arm: ${taskSet.budgetSolvesPerArm} solves`);
  console.log(
    `Repeatability check: 2 solves at H=${taskSet.repeatabilityCheckHeightMm} mm`,
  );
  console.log("");
  console.log("Tasks:");
  for (const t of taskSet.tasks) {
    console.log(
      `  ${t.id}: H0=${t.startingHeightMm} mm, ` +
        `threshold=${t.displacementThresholdMm} mm — ${t.designNote ?? ""}`,
    );
  }
  console.log("");
  console.log(
    "To execute: deno task experiment:oracle --execute " +
      `--acknowledge=${ORACLE_EXECUTE_ACKNOWLEDGEMENT}`,
  );
  console.log(
    "No provider call, no solve, no file write until both flags are present.",
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const execute = Deno.args.includes("--execute");
  const acknowledge = argument("acknowledge");

  // Load and validate the task set regardless of mode (catches malformed JSON early).
  const rawTaskSet = loadJson(TASKS_JSON_PATH);
  const taskSet = validateTaskSet(rawTaskSet);

  if (!execute || acknowledge !== ORACLE_EXECUTE_ACKNOWLEDGEMENT) {
    printPlan(taskSet);
    Deno.exit(0);
  }

  // ── Execution path ───────────────────────────────────────────────────────────

  const startedAt = new Date();

  console.log("[oracle] Loading and fingerprinting task set ...");
  const tasksDigest = await sha256Fingerprint(rawTaskSet);
  console.log(`[oracle] tasks.json digest: ${tasksDigest.digest.slice(0, 12)}...`);

  console.log("[oracle] Loading and validating sensitivity case ...");
  const rawSensitivityCase = loadJson(taskSet.sensitivityCaseRef.path);
  const sc = validateSensitivityStudyCase(rawSensitivityCase);
  const sensitivityCaseDigest = await sha256Fingerprint(rawSensitivityCase);
  console.log(
    `[oracle] Sensitivity case: ${sc.id} (revision ${sc.revision}), ` +
      `digest: ${sensitivityCaseDigest.digest.slice(0, 12)}...`,
  );

  if (sc.id !== taskSet.sensitivityCaseRef.id) {
    throw new Error(
      `Sensitivity case ID mismatch: tasks.json declares ` +
        `"${taskSet.sensitivityCaseRef.id}" but the file contains "${sc.id}".`,
    );
  }

  const build123d = new HttpMcpToolClient({ mcpUrl: BUILD123D_URL });
  const calculix = new HttpMcpToolClient({ mcpUrl: CALCULIX_URL });
  const safeMaxMm = taskSet.safeHeightDomainMm.max;
  const budgetMax = taskSet.budgetSolvesPerArm;
  const measureStepMm = taskSet.measureStepMm;

  // ── Repeatability check ──────────────────────────────────────────────────────

  console.log(
    `[oracle] Repeatability check: 2 solves at H=${taskSet.repeatabilityCheckHeightMm} mm ...`,
  );
  const repeatability = await runRepeatabilityCheck(
    taskSet.repeatabilityCheckHeightMm,
    taskSet.repeatabilityThresholdMm,
    build123d,
    calculix,
    sc,
  );
  console.log(
    `[oracle] Repeatability: amplitude=${repeatability.amplitudeMm.toFixed(6)} mm ` +
      `(threshold=${taskSet.repeatabilityThresholdMm} mm, ` +
      `within=${repeatability.withinThreshold ? "YES" : "NO — WARNING"})`,
  );
  if (!repeatability.withinThreshold) {
    console.warn(
      "[oracle] WARNING: repeatability amplitude exceeds threshold. " +
        "Gradient measurements may be unreliable. Campaign continues but " +
        "results must be interpreted with caution.",
    );
  }

  // ── Task loop ────────────────────────────────────────────────────────────────

  const allRuns: TaskArmResult[] = [];

  // ── Campaign gradient: measured once, reused by Arm CA on every task ────────
  // Reference points come from the reviewed sensitivity case (base 30, step +1);
  // both solves are real and counted in the CA campaign total.
  console.log("[oracle] Campaign gradient: solving reference and stepped heights ...");
  const gradBase = await solveAtHeight(
    build123d,
    calculix,
    sc,
    30,
    "campaign-grad-base",
  );
  const gradStepped = await solveAtHeight(
    build123d,
    calculix,
    sc,
    31,
    "campaign-grad-stepped",
  );
  const campaignGradient = (gradStepped.displacementMm - gradBase.displacementMm) / 1;
  console.log(
    `[oracle] Campaign gradient dDisp/dH = ${campaignGradient.toFixed(6)} mm/mm ` +
      `(u(30)=${gradBase.displacementMm.toFixed(6)}, u(31)=${
        gradStepped.displacementMm.toFixed(6)
      })`,
  );

  for (const taskDecl of taskSet.tasks) {
    const task: OracleTask = {
      id: taskDecl.id,
      startingHeightMm: taskDecl.startingHeightMm,
      displacementThresholdMm: taskDecl.displacementThresholdMm,
      toleranceMm: taskDecl.toleranceMm,
    };
    const taskThreshold = {
      value: taskDecl.displacementThresholdMm,
      unit: taskSet.targetMetric.unit,
    };

    console.log(
      `[oracle] Task ${task.id}: H0=${task.startingHeightMm} mm, ` +
        `threshold=${taskDecl.displacementThresholdMm} mm`,
    );

    // Arm B: bisection.
    console.log(`[oracle]   Arm B (bisection) ...`);
    const bResult = await runArm(
      "B",
      (history) => armBStep(history, task, safeMaxMm, budgetMax),
      task,
      taskThreshold,
      build123d,
      calculix,
      sc,
    );
    allRuns.push(bResult);
    console.log(
      `[oracle]   Arm B: ${bResult.nSolves} solves, ` +
        `${bResult.converged ? "converged" : "DID NOT CONVERGE"} at ` +
        `H=${bResult.finalHeightMm ?? "N/A"} mm`,
    );

    // Arm C: gradient-guided.
    console.log(`[oracle]   Arm C (gradient) ...`);
    const cResult = await runArm(
      "C",
      (history) => armCStep(history, task, measureStepMm, safeMaxMm, budgetMax),
      task,
      taskThreshold,
      build123d,
      calculix,
      sc,
    );
    allRuns.push(cResult);
    console.log(
      `[oracle]   Arm C: ${cResult.nSolves} solves, ` +
        `${cResult.converged ? "converged" : "DID NOT CONVERGE"} at ` +
        `H=${cResult.finalHeightMm ?? "N/A"} mm`,
    );

    // Arm CA: campaign-gradient amortised.
    console.log(`[oracle]   Arm CA (campaign gradient) ...`);
    const caResult = await runArm(
      "CA",
      (history) =>
        armCAmortisedStep(history, task, campaignGradient, safeMaxMm, budgetMax),
      task,
      taskThreshold,
      build123d,
      calculix,
      sc,
    );
    allRuns.push(caResult);
    console.log(
      `[oracle]   Arm CA: ${caResult.nSolves} solves, ` +
        `${caResult.converged ? "converged" : "DID NOT CONVERGE"} at ` +
        `H=${caResult.finalHeightMm ?? "N/A"} mm`,
    );
  }

  // ── Results ──────────────────────────────────────────────────────────────────

  const finishedAt = new Date();
  const summary = computeSummary(allRuns, taskSet.tasks.length);

  const campaignResult: CampaignResult = {
    schemaVersion: "oracle-campaign/1.0",
    taskSetId: taskSet.id,
    tasksDigest,
    sensitivityCaseDigest,
    sensitivityCaseId: sc.id,
    meshSizeMm: sc.solver.mesh.targetSizeMm,
    safeHeightDomainMm: taskSet.safeHeightDomainMm,
    repeatability,
    runs: allRuns,
    summary,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };

  const timestamp = isoTimestampForFilename(startedAt);
  const resultPath = `${RESULTS_DIR}/${timestamp}-b-vs-c.json`;
  await Deno.mkdir(RESULTS_DIR, { recursive: true });
  await Deno.writeTextFile(resultPath, JSON.stringify(campaignResult, null, 2));

  console.log("");
  console.log("=== Campaign Summary ===");
  console.log(`Total solves B: ${summary.totalSolvesB}`);
  console.log(`Total solves C: ${summary.totalSolvesC}`);
  console.log(
    `Converged B/C: ${summary.convergedB}/${summary.convergedC} of ${taskSet.tasks.length}`,
  );
  console.log(summary.amortisedNote);
  console.log(`Results: ${resultPath}`);
}
