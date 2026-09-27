/**
 * Tool runtime preparation for the Desktop host backend (#56).
 *
 * Journalled, resumable, and explicit: every step transition is persisted to
 * the durable intent before acting, interrupted work resumes instead of
 * duplicating, and every invocation is already an explicit operator action,
 * so failed or uncertain steps are retried on re-invocation — except smoke,
 * which may have executed server-side and requires its own explicit retry
 * flag. All Docker actions are scoped to owned Compose project names and
 * `casys.tool-runtime.*` labels; prune, remove-all, and volume removal
 * commands do not exist in this module.
 */
import type { CommandRunner } from "../../../src/adapters/shared/docker-observer.ts";
import { HttpMcpProbe } from "../../../src/adapters/shared/mcp/http-mcp-probe.ts";
import {
  HttpMcpToolClient,
  McpToolCallError,
} from "../../../src/adapters/shared/mcp/http-mcp-tool-client.ts";
import type { DesiredServer } from "../../../src/application/control-plane/read-model/fleet-manifest.ts";
import type { McpToolResult } from "../../../src/application/ports/out/mcp-tool-client.ts";
import {
  detectToolRuntimeEngine,
  type ToolRuntimeEngineObservation,
} from "./engine.ts";
import {
  loadToolRuntimeIntent,
  newToolRuntimeIntent,
  PREPARATION_STEPS,
  type PreparationStepId,
  type PreparationStepStatus,
  recordStep,
  resetStepForRetry,
  saveToolRuntimeIntent,
  type ToolRuntimeIntent,
} from "./intent.ts";

export const TOOL_RUNTIME_OWNER_LABEL = "casys.tool-runtime.owner" as const;
export const TOOL_RUNTIME_TOOL_LABEL = "casys.tool-runtime.tool" as const;

/** Bounded retries for idempotent acquisition; execution steps never retry. */
const ACQUIRE_MAX_ATTEMPTS = 3;
const READINESS_POLL_MS = 3_000;
const COMPOSE_WAIT_TIMEOUT_SECONDS = 300;

export interface MacOSDockerDesktopInstall {
  /** Pinned official download URL (never constructed from input). */
  readonly dmgUrl: string;
  /** Exact required Apple signing authority of the downloaded image. */
  readonly expectedAuthority: string;
  /** Upper bound for the post-install daemon wait. */
  readonly daemonWaitMs: number;
}

export interface ToolRuntimeSmoke {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
  /** Returns an error message when the result is unacceptable, else undefined. */
  verify(result: McpToolResult): string | undefined;
}

export interface ToolRuntimePlan {
  readonly toolId: string;
  readonly displayName: string;
  /** Exact digest-pinned reference; tags and aliases are refused. */
  readonly imageRef: string;
  /** Provider release version for status display (never used for selection). */
  readonly providerVersion: string;
  readonly platform: "linux/amd64" | "linux/arm64";
  readonly projectName: string;
  readonly serviceName: string;
  readonly hostPort: number;
  readonly containerPort: number;
  readonly volumeName: string;
  readonly mcpUrl: string;
  readonly healthUrl: string;
  readonly expectedTools: readonly string[];
  readonly smoke: ToolRuntimeSmoke;
  readonly readinessTimeoutMs: number;
  readonly workdir: string;
  readonly macOSInstall?: MacOSDockerDesktopInstall;
}

export interface PreparationEvent {
  readonly step: PreparationStepId;
  readonly status: PreparationStepStatus;
  readonly detail: string;
}

export interface PreparationDeps {
  /** Fast probes (detection, inspect, ps). */
  readonly probeRunner: CommandRunner;
  /** Long commands (pull, compose up, install). */
  readonly execRunner: CommandRunner;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => string;
  readonly platform?: () => { os: string; arch: string };
  /** Explicit user approval for the OS package install; absent means declined. */
  readonly confirmInstall?: () => Promise<boolean>;
  readonly onEvent?: (event: PreparationEvent) => void;
  /** Explicit operator re-invocation of a failed/uncertain smoke step. */
  readonly retryFailedSmoke?: boolean;
}

export type ToolRuntimeRecoveryCode =
  | "engine-stopped"
  | "engine-incompatible"
  | "install-approval-required"
  | "install-unsupported-platform"
  | "install-failed"
  | "image-acquire-failed"
  | "image-unverified"
  | "port-conflict"
  | "start-failed"
  | "readiness-timeout"
  | "readiness-tools-mismatch"
  | "smoke-uncertain"
  | "smoke-failed"
  | "intent-image-mismatch"
  | "update-blocked";

export type PreparationOutcome =
  | {
    readonly status: "ready";
    readonly detail: string;
  }
  | {
    readonly status: "needs-action";
    readonly code: ToolRuntimeRecoveryCode;
    readonly detail: string;
    readonly recovery: string;
  };

interface StepContext {
  readonly deps:
    & Required<
      Pick<PreparationDeps, "fetch" | "sleep" | "now" | "platform">
    >
    & PreparationDeps;
  readonly plan: ToolRuntimePlan;
  intent: ToolRuntimeIntent;
}

const IMAGE_REF_PATTERN = /^(.+)@sha256:([a-f0-9]{64})$/;
const MOUNT_POINT_PATTERN = /^\/Volumes\/[A-Za-z0-9 ._-]+$/;

/**
 * Runs the preparation flow to ready or to an explicit needs-action stop.
 * Resuming: steps recorded `running` at load were interrupted and rerun;
 * `done` steps are re-verified cheaply (except smoke, which is trusted and
 * never re-executed); `failed`/`uncertain` non-smoke steps are reset and
 * re-executed, because this invocation already is the explicit operator
 * re-run the recovery strings ask for. A `failed`/`uncertain` smoke step
 * still stops unless `retryFailedSmoke` is set: it may have executed.
 */
export async function prepareToolRuntime(
  deps: PreparationDeps,
  plan: ToolRuntimePlan,
): Promise<PreparationOutcome> {
  const full: StepContext["deps"] = {
    ...deps,
    fetch: deps.fetch ?? fetch,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: deps.now ?? (() => new Date().toISOString()),
    platform: deps.platform ?? (() => ({ os: Deno.build.os, arch: Deno.build.arch })),
  };
  const image = parseImageRef(plan.imageRef);
  if (image === undefined) {
    return needsAction(
      "image-unverified",
      `Refusing plan image ${plan.imageRef}: only repo@sha256:<hex> pins are accepted.`,
      "Fix the plan to name an exact digest-pinned image; tags and aliases are never accepted.",
    );
  }
  const intent = await loadToolRuntimeIntent(plan.workdir, plan.toolId) ??
    newToolRuntimeIntent({
      toolId: plan.toolId,
      imageRef: plan.imageRef,
      platform: plan.platform,
      now: full.now(),
    });
  if (intent.imageRef !== plan.imageRef) {
    return needsAction(
      "intent-image-mismatch",
      `The durable intent pins ${intent.imageRef} but the plan names ${plan.imageRef}.`,
      "Run the explicit update flow to move this tool to a new pinned image.",
    );
  }
  const context: StepContext = { deps: full, plan, intent };
  for (const step of PREPARATION_STEPS) {
    const record = context.intent.steps[step];
    if (record.status === "failed" || record.status === "uncertain") {
      if (step === "smoke" && full.retryFailedSmoke !== true) {
        return resumeRefusal(context, step);
      }
      // Explicit operator re-invocation; never automatic. The retry budget
      // restarts so this run owns the same bounded attempts as a fresh run.
      await resetForRetry(
        context,
        step,
        `Explicit operator re-run after ${record.status}; retry budget reset.`,
      );
    }
    if (record.status === "done") {
      const reverified = await reverifyStep(context, step);
      if (reverified !== undefined) return reverified;
      continue;
    }
    const outcome = await runStep(context, step);
    if (outcome !== undefined) return outcome;
  }
  return { status: "ready", detail: `${plan.displayName} is prepared and proven.` };
}

function resumeRefusal(
  context: StepContext,
  step: PreparationStepId,
): PreparationOutcome {
  const record = context.intent.steps[step];
  return needsAction(
    (record.code as ToolRuntimeRecoveryCode | undefined) ?? "start-failed",
    `Step ${step} previously ended ${record.status}; automatic resume refuses to continue. ` +
      (record.detail ?? "No further detail was recorded."),
    record.recovery ??
      "Inspect the diagnostics, resolve the cause, then re-invoke preparation explicitly.",
  );
}

/** Journals a terminal step failure and returns the matching needs-action outcome. */
async function failStep(
  context: StepContext,
  step: PreparationStepId,
  status: "failed" | "uncertain",
  code: ToolRuntimeRecoveryCode,
  detail: string,
  recovery: string,
): Promise<PreparationOutcome> {
  await transition(context, step, status, detail, code, recovery);
  return needsAction(code, detail, recovery);
}

async function runStep(
  context: StepContext,
  step: PreparationStepId,
): Promise<PreparationOutcome | undefined> {
  await transition(context, step, "running");
  switch (step) {
    case "detect-engine":
      return await stepDetectEngine(context);
    case "ensure-engine":
      return await stepEnsureEngine(context);
    case "acquire-image":
      return await stepAcquireImage(context);
    case "start-owned":
      return await stepStartOwned(context);
    case "readiness":
      return await stepReadiness(context);
    case "smoke":
      return await stepSmoke(context);
  }
}

/** Re-verify a step recorded done; undefined means verified. */
async function reverifyStep(
  context: StepContext,
  step: PreparationStepId,
): Promise<PreparationOutcome | undefined> {
  switch (step) {
    case "detect-engine":
    case "ensure-engine": {
      // Engine state is cheap to re-observe and may have changed across restarts.
      await transition(context, step, "pending");
      return await runStep(context, step);
    }
    case "acquire-image": {
      const verified = await verifyOwnedImage(context);
      if (verified === undefined) return undefined;
      await transition(
        context,
        step,
        "pending",
        "Image no longer verifies; reacquiring.",
      );
      return await runStep(context, step);
    }
    case "start-owned": {
      const running = await ownedContainerRunning(context);
      if (running) return undefined;
      await transition(
        context,
        step,
        "pending",
        "Owned container is gone; restarting.",
      );
      return await runStep(context, step);
    }
    case "readiness": {
      const ready = await probeReadinessOnce(context);
      if (ready === undefined) return undefined;
      await transition(
        context,
        step,
        "pending",
        "Provider no longer ready; re-probing.",
      );
      return await runStep(context, step);
    }
    case "smoke":
      // Trusted from the journal: a completed smoke execution is never re-run.
      return undefined;
  }
}

async function stepDetectEngine(
  context: StepContext,
): Promise<PreparationOutcome | undefined> {
  const observed = await detectToolRuntimeEngine(
    context.deps.probeRunner,
    context.plan.workdir,
  );
  await transition(context, "detect-engine", "done", observed.detail);
  return undefined;
}

async function stepEnsureEngine(
  context: StepContext,
): Promise<PreparationOutcome | undefined> {
  const observed = await detectToolRuntimeEngine(
    context.deps.probeRunner,
    context.plan.workdir,
  );
  if (observed.status === "ready") {
    await transition(context, "ensure-engine", "done", observed.detail);
    return undefined;
  }
  if (observed.status === "stopped" || observed.status === "incompatible") {
    return await failUnusableEngine(context, observed);
  }
  return await installEngine(context);
}

/**
 * Single-sourced failure for a present but unusable engine, shared by the
 * initial observation and the post-approval re-observation.
 */
async function failUnusableEngine(
  context: StepContext,
  observed: ToolRuntimeEngineObservation,
): Promise<PreparationOutcome> {
  if (observed.status === "incompatible") {
    return await failStep(
      context,
      "ensure-engine",
      "failed",
      "engine-incompatible",
      observed.detail,
      `Resolve the incompatibility (${
        observed.reasons.join(", ")
      }) or remove the engine so the app-managed install path applies.`,
    );
  }
  return await failStep(
    context,
    "ensure-engine",
    "failed",
    "engine-stopped",
    observed.detail,
    "Start Docker Desktop (one explicit action in the runtime panel), then re-run preparation. Casys never auto-starts your engine.",
  );
}

async function installEngine(
  context: StepContext,
): Promise<PreparationOutcome | undefined> {
  const { deps, plan } = context;
  const os = deps.platform().os;
  if (os !== "darwin" || plan.macOSInstall === undefined) {
    return await failStep(
      context,
      "ensure-engine",
      "failed",
      "install-unsupported-platform",
      `No engine installed and no app-managed install path exists for ${os}.`,
      "Install a compatible OCI engine manually, then re-run preparation.",
    );
  }
  if (deps.confirmInstall === undefined || await deps.confirmInstall() !== true) {
    return await failStep(
      context,
      "ensure-engine",
      "failed",
      "install-approval-required",
      "Installing Docker Desktop needs your explicit approval.",
      "Approve the install from the runtime panel, or install a compatible engine manually.",
    );
  }
  // Re-observe after approval: the engine may have appeared meanwhile.
  // Only a ready engine short-circuits; a stopped or incompatible engine
  // fails honestly instead of being marked done.
  const reobserved = await detectToolRuntimeEngine(deps.probeRunner, plan.workdir);
  if (reobserved.status === "ready") {
    await transition(
      context,
      "ensure-engine",
      "done",
      `Engine appeared: ${reobserved.detail}`,
    );
    return undefined;
  }
  if (reobserved.status === "stopped" || reobserved.status === "incompatible") {
    return await failUnusableEngine(context, reobserved);
  }
  try {
    const dmgPath = await downloadInstaller(context);
    await verifyInstallerSignature(context, dmgPath);
    await installMacOSPackage(context, dmgPath);
    await waitForDaemon(context);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return await failStep(
      context,
      "ensure-engine",
      "failed",
      "install-failed",
      `Docker Desktop install failed: ${detail}`,
      "Inspect the diagnostics, resolve the cause, then re-run preparation; completed download/verify work resumes.",
    );
  }
  await transition(
    context,
    "ensure-engine",
    "done",
    "Engine installed by Casys; daemon reachable.",
  );
  return undefined;
}

async function downloadInstaller(context: StepContext): Promise<string> {
  const { deps, plan } = context;
  const url = plan.macOSInstall!.dmgUrl;
  const path = `${plan.workdir}/Docker.dmg`;
  let existing = false;
  try {
    await Deno.stat(path);
    existing = true;
  } catch {
    existing = false;
  }
  if (existing) {
    // A previous attempt left bytes behind; they only ever proceed to install
    // after signature verification below, so resume is safe.
    return path;
  }
  const response = await deps.fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`Installer download failed with HTTP ${response.status}.`);
  }
  await Deno.mkdir(plan.workdir, { recursive: true });
  const file = await Deno.open(path, { write: true, create: true, truncate: true });
  try {
    await response.body.pipeTo(file.writable, { preventClose: true });
  } finally {
    file.close();
  }
  return path;
}

async function verifyInstallerSignature(
  context: StepContext,
  dmgPath: string,
): Promise<void> {
  const { deps, plan } = context;
  const checked = await deps.execRunner.run(
    "/usr/bin/codesign",
    ["-dv", "--verbose=4", dmgPath],
    plan.workdir,
  );
  // codesign -dv reports to stderr with exit 0 on a valid signature.
  const output = `${checked.stdout}\n${checked.stderr}`;
  if (
    !checked.success ||
    !output.includes(`Authority=${plan.macOSInstall!.expectedAuthority}`)
  ) {
    throw new Error(
      "Installer signature is not the expected Apple Developer ID authority.",
    );
  }
}

async function installMacOSPackage(
  context: StepContext,
  dmgPath: string,
): Promise<void> {
  const { deps, plan } = context;
  const attached = await deps.execRunner.run(
    "/usr/bin/hdiutil",
    ["attach", "-nobrowse", "-readonly", dmgPath],
    plan.workdir,
  );
  if (!attached.success) {
    throw new Error(`Could not attach installer image: ${attached.stderr}`);
  }
  const mount = parseMountPoint(attached.stdout);
  if (mount === undefined) {
    throw new Error("Could not parse the installer mount point.");
  }
  try {
    const copy = await deps.execRunner.run(
      "/usr/bin/osascript",
      [
        "-e",
        `do shell script "/bin/cp -R ${
          shellQuote(`${mount}/Docker.app`)
        } /Applications/" with administrator privileges`,
      ],
      plan.workdir,
    );
    if (!copy.success) {
      throw new Error(`Admin install was not completed: ${copy.stderr}`);
    }
  } finally {
    await deps.execRunner.run("/usr/bin/hdiutil", ["detach", mount], plan.workdir);
  }
}

async function waitForDaemon(context: StepContext): Promise<void> {
  const { deps, plan } = context;
  const launched = await deps.execRunner.run(
    "/usr/bin/open",
    ["-a", "Docker"],
    plan.workdir,
  );
  if (!launched.success) {
    throw new Error(`Could not launch Docker Desktop: ${launched.stderr}`);
  }
  const deadline = Date.now() + plan.macOSInstall!.daemonWaitMs;
  for (;;) {
    const observed = await detectToolRuntimeEngine(deps.probeRunner, plan.workdir);
    if (observed.status === "ready") return;
    if (observed.status === "incompatible") {
      throw new Error(`Installed engine is incompatible: ${observed.detail}`);
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the Docker daemon.");
    }
    await deps.sleep(READINESS_POLL_MS);
  }
}

async function stepAcquireImage(
  context: StepContext,
): Promise<PreparationOutcome | undefined> {
  const { deps, plan } = context;
  const record = context.intent.steps["acquire-image"];
  const remaining = ACQUIRE_MAX_ATTEMPTS - record.attempts;
  const pulled = await deps.execRunner.run(
    "docker",
    ["pull", plan.imageRef],
    plan.workdir,
  );
  if (!pulled.success) {
    if (remaining > 0) {
      await transition(
        context,
        "acquire-image",
        "running",
        `Pull failed; ${remaining} attempt(s) left: ${firstLine(pulled.stderr)}`,
      );
      return await stepAcquireImage(context);
    }
    return await failStep(
      context,
      "acquire-image",
      "failed",
      "image-acquire-failed",
      `Could not pull the ${plan.displayName} image: ${
        scrubDigest(firstLine(pulled.stderr))
      }`,
      "Check network access to the registry, then re-run preparation; pulls resume.",
    );
  }
  const unverified = await verifyOwnedImage(context);
  if (unverified !== undefined) return unverified;
  await transition(context, "acquire-image", "done", `Verified ${plan.imageRef}.`);
  return undefined;
}

/** Returns an outcome when the local image does not verify, else undefined. */
async function verifyOwnedImage(
  context: StepContext,
): Promise<PreparationOutcome | undefined> {
  const { deps, plan } = context;
  const image = parseImageRef(plan.imageRef)!;
  const inspected = await deps.probeRunner.run(
    "docker",
    ["image", "inspect", plan.imageRef, "--format", "{{json .}}"],
    plan.workdir,
  );
  if (!inspected.success) {
    return await failStep(
      context,
      "acquire-image",
      "failed",
      "image-unverified",
      "The pulled image cannot be inspected for verification.",
      "Re-run preparation; a corrupt local copy is replaced by the pull.",
    );
  }
  let parsed: { RepoDigests?: unknown; Architecture?: unknown };
  try {
    parsed = JSON.parse(inspected.stdout);
  } catch {
    parsed = {};
  }
  const digests = Array.isArray(parsed.RepoDigests)
    ? parsed.RepoDigests.filter((entry): entry is string => typeof entry === "string")
    : [];
  const arch = typeof parsed.Architecture === "string"
    ? parsed.Architecture
    : undefined;
  const wantArch = plan.platform === "linux/arm64" ? "arm64" : "amd64";
  if (
    !digests.includes(`${image.repository}@sha256:${image.digest}`) || arch !== wantArch
  ) {
    return await failStep(
      context,
      "acquire-image",
      "failed",
      "image-unverified",
      `Digest or architecture mismatch (want ${plan.platform}).`,
      "Remove the mismatched local image explicitly, then re-run preparation. Casys never falls back to another tag.",
    );
  }
  return undefined;
}

async function stepStartOwned(
  context: StepContext,
): Promise<PreparationOutcome | undefined> {
  const { deps, plan } = context;
  if (await ownedContainerRunning(context)) {
    await transition(
      context,
      "start-owned",
      "done",
      "Owned container already running.",
    );
    return undefined;
  }
  await Deno.writeTextFile(`${plan.workdir}/compose.yml`, hostComposeDocument(plan));
  const up = await deps.execRunner.run(
    "docker",
    [
      "compose",
      "-p",
      plan.projectName,
      "up",
      "--detach",
      "--wait",
      "--wait-timeout",
      String(COMPOSE_WAIT_TIMEOUT_SECONDS),
      "--pull",
      "never",
      "--no-build",
      plan.serviceName,
    ],
    plan.workdir,
  );
  if (!up.success) {
    const output = `${up.stdout}\n${up.stderr}`;
    if (/port is already allocated|address already in use|bind/i.test(output)) {
      return await failStep(
        context,
        "start-owned",
        "failed",
        "port-conflict",
        "The configured host port is occupied by another workload.",
        "Free the configured host port (for example stop the other stack), then re-run preparation. Casys never stops containers it does not own.",
      );
    }
    return await failStep(
      context,
      "start-owned",
      "failed",
      "start-failed",
      `Owned service failed to start: ${scrubDigest(firstLine(up.stderr))}`,
      "Inspect the diagnostics, resolve the cause, then re-run preparation.",
    );
  }
  await transition(context, "start-owned", "done", "Owned service started.");
  return undefined;
}

async function stepReadiness(
  context: StepContext,
): Promise<PreparationOutcome | undefined> {
  const { deps, plan } = context;
  const deadline = Date.now() + plan.readinessTimeoutMs;
  for (;;) {
    const mismatch = await probeReadinessOnce(context);
    if (mismatch === undefined) {
      await transition(
        context,
        "readiness",
        "done",
        "Provider healthy with expected tools.",
      );
      return undefined;
    }
    if (mismatch !== "not-ready") {
      return await failStep(
        context,
        "readiness",
        "failed",
        "readiness-tools-mismatch",
        mismatch,
        "The reachable provider is not the expected one; inspect it explicitly before proceeding.",
      );
    }
    if (Date.now() >= deadline) {
      return await failStep(
        context,
        "readiness",
        "failed",
        "readiness-timeout",
        "The provider did not become ready in time.",
        "Inspect the owned container logs explicitly, then re-run preparation.",
      );
    }
    await deps.sleep(READINESS_POLL_MS);
  }
}

/** undefined = ready; "not-ready" = retryable; otherwise a terminal mismatch. */
async function probeReadinessOnce(context: StepContext): Promise<string | undefined> {
  const { deps, plan } = context;
  const probe = new HttpMcpProbe({ fetch: deps.fetch, timeoutMs: 5_000 });
  let result;
  try {
    result = await probe.probe(desiredServer(plan));
  } catch {
    return "not-ready";
  }
  if (result.status !== "healthy") return "not-ready";
  const names = new Set(result.mcp.tools.map((tool) => tool.name));
  const missing = plan.expectedTools.filter((tool) => !names.has(tool));
  if (missing.length > 0) {
    return `Provider is healthy but misses expected tools: ${missing.join(", ")}.`;
  }
  return undefined;
}

async function stepSmoke(
  context: StepContext,
): Promise<PreparationOutcome | undefined> {
  const { deps, plan } = context;
  const client = new HttpMcpToolClient({
    mcpUrl: plan.mcpUrl,
    fetch: deps.fetch,
    timeoutMs: plan.smoke.timeoutMs,
  });
  let result;
  try {
    result = await withTimeout(
      client.callTool({ name: plan.smoke.tool, arguments: { ...plan.smoke.args } }),
      plan.smoke.timeoutMs,
    );
  } catch (error) {
    if (error instanceof SmokeTimeoutError) {
      // The call may still complete server-side: outcome unknown, never retried.
      return await failStep(
        context,
        "smoke",
        "uncertain",
        "smoke-uncertain",
        "Smoke call timed out; it may still have executed.",
        "Inspect the provider explicitly. Re-run the smoke step only as an explicit operator decision, never automatically.",
      );
    }
    if (!(error instanceof McpToolCallError)) throw error;
    return await failStep(
      context,
      "smoke",
      "failed",
      "smoke-failed",
      `Smoke execution failed: ${error.message}`,
      "Inspect the provider explicitly, then re-invoke the smoke step as an explicit operator decision.",
    );
  }
  const unacceptable = plan.smoke.verify(result);
  if (unacceptable !== undefined) {
    return await failStep(
      context,
      "smoke",
      "failed",
      "smoke-failed",
      `Smoke execution returned an unacceptable result: ${unacceptable}`,
      "Inspect the provider explicitly, then re-invoke the smoke step as an explicit operator decision.",
    );
  }
  await transition(context, "smoke", "done", "Real provider result verified.");
  return undefined;
}

async function ownedContainerRunning(context: StepContext): Promise<boolean> {
  const { deps, plan } = context;
  const listed = await deps.probeRunner.run(
    "docker",
    [
      "ps",
      "--filter",
      `label=${TOOL_RUNTIME_OWNER_LABEL}=${plan.projectName}`,
      "--format",
      "{{json .}}",
    ],
    plan.workdir,
  );
  if (!listed.success) return false;
  return listed.stdout.split("\n").some((line) => {
    if (line.trim() === "") return false;
    try {
      const row = JSON.parse(line) as { State?: unknown };
      return row.State === "running";
    } catch {
      return false;
    }
  });
}

async function resetForRetry(
  context: StepContext,
  step: PreparationStepId,
  detail: string,
): Promise<void> {
  context.intent = resetStepForRetry(context.intent, step, context.deps.now(), detail);
  await saveToolRuntimeIntent(context.plan.workdir, context.intent);
  context.deps.onEvent?.({ step, status: "pending", detail });
}

async function transition(
  context: StepContext,
  step: PreparationStepId,
  status: PreparationStepStatus,
  detail?: string,
  code?: string,
  recovery?: string,
): Promise<void> {
  context.intent = recordStep(
    context.intent,
    step,
    status,
    context.deps.now(),
    detail,
    code,
    recovery,
  );
  await saveToolRuntimeIntent(context.plan.workdir, context.intent);
  context.deps.onEvent?.({ step, status, detail: detail ?? status });
}

function needsAction(
  code: ToolRuntimeRecoveryCode,
  detail: string,
  recovery: string,
): PreparationOutcome {
  return { status: "needs-action", code, detail, recovery };
}

export function parseImageRef(
  imageRef: string,
): { repository: string; digest: string } | undefined {
  const match = IMAGE_REF_PATTERN.exec(imageRef);
  if (!match) return undefined;
  return { repository: match[1]!, digest: match[2]! };
}

function parseMountPoint(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    const fields = line.split("\t").map((field) => field.trim()).filter(Boolean);
    const candidate = fields[fields.length - 1];
    if (candidate !== undefined && MOUNT_POINT_PATTERN.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function firstLine(text: string): string {
  const line = text.split("\n").map((entry) => entry.trim()).find((entry) =>
    entry !== ""
  );
  return line ?? "(no output)";
}

/**
 * Docker CLI output can echo the pinned reference. Journaled details cross
 * to the renderer through the status projection, where digests are
 * forbidden, so digest hex is redacted at the source.
 */
function scrubDigest(text: string): string {
  return text.replace(/sha256:[a-f0-9]{64}/gi, "sha256:<digest>");
}

function desiredServer(plan: ToolRuntimePlan): DesiredServer {
  return {
    id: plan.toolId,
    displayName: plan.displayName,
    role: "Desktop host-managed engineering provider",
    serviceName: plan.serviceName,
    transport: "streamable-http",
    mcpUrl: plan.mcpUrl,
    healthUrl: plan.healthUrl,
    image: plan.imageRef,
    required: true,
    expectedTools: [...plan.expectedTools],
  };
}

/**
 * Exact single-service Compose document for a host-owned provider. Loopback
 * port, owned named volume, project-default network (isolated per project),
 * and the same quantitative bounds as the supervised fleet service. Labels
 * establish stop/remove ownership; the image ref is always digest-pinned.
 */
export function hostComposeDocument(plan: ToolRuntimePlan): string {
  return [
    "services:",
    `  ${plan.serviceName}:`,
    `    image: "${plan.imageRef}"`,
    "    ports:",
    `      - "127.0.0.1:${plan.hostPort}:${plan.containerPort}"`,
    "    volumes:",
    `      - ${plan.volumeName}:/exports`,
    "    mem_limit: 2g",
    "    cpus: 2.0",
    "    pids_limit: 128",
    "    security_opt:",
    "      - no-new-privileges:true",
    "    cap_drop:",
    "      - ALL",
    "    labels:",
    `      ${TOOL_RUNTIME_OWNER_LABEL}: "${plan.projectName}"`,
    `      ${TOOL_RUNTIME_TOOL_LABEL}: "${plan.toolId}"`,
    "volumes:",
    `  ${plan.volumeName}:`,
    "",
  ].join("\n");
}

class SmokeTimeoutError extends Error {
  constructor() {
    super("smoke timed out");
    this.name = "SmokeTimeoutError";
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SmokeTimeoutError()), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Re-exported for the host boundary and tests.
export type { ToolRuntimeEngineObservation, ToolRuntimeIntent };
export { PREPARATION_STEPS };
export type { McpToolResult };
