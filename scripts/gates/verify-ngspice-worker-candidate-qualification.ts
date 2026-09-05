/**
 * Maintainer-only qualification of one imported ngspice-worker candidate.
 * Default mode is planning/read. `--run` is the explicit mutation
 * acknowledgement. `--recover` only reconciles the exact durable WAL.
 * Callers cannot select a provider, image, digest, platform, command,
 * endpoint, tool, worker, profile, source, netlist, or args.
 *
 * Import already owns acquisition. This path never builds Docker, never loads
 * or removes images, and never changes a catalogue pin.
 */

import { createFirstPartyCapabilityRuntimeCatalog } from "../../src/adapters/control-plane/first-party-capability-binding-catalog.ts";
import { createFirstPartyMicrosandboxImageDistributionMatrix } from "../../src/adapters/control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import { readBoundFirstPartyMicrosandboxImageCandidateImportRecord } from "../../src/adapters/control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import { parseFirstPartyMicrosandboxImageCandidateQualificationCli } from "../../src/adapters/control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import { createLocalCapabilityRuntimeReadComposition } from "../../src/adapters/control-plane/local-capability-runtime-read-composition.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import {
  planNgspiceWorkerCandidateQualification,
  qualifyNgspiceWorkerCandidate,
  recoverNgspiceWorkerCandidateQualification,
  renderNgspiceWorkerCandidateQualificationPlanText,
  renderNgspiceWorkerCandidateQualificationResultText,
} from "../../src/adapters/electrical/spice/admitted/ngspice-worker-candidate-qualification.ts";

export const NGSPICE_WORKER_CANDIDATE_QUALIFICATION_USAGE = [
  "Usage: verify-ngspice-worker-candidate-qualification --import-record=<path> [--run|--recover]",
  "",
  "Maintainer-only qualification of one imported ngspice-worker candidate.",
  "Input is only an exact import record bound to the current distribution matrix.",
  "No provider, image, digest, platform, command, endpoint, tool, worker, profile, source, or netlist selection.",
  "The server-owned admitted circuit profile and code-owned resistor-divider fixture are used.",
  "",
  "Default mode is planning/read: validate the import record and print the plan.",
  "Pass --run to execute the exact cached candidate image through the production",
  "composition, broker, admitted SPICE validators, CAS reread, WAL and proven destruction.",
  "Pass --recover to reconcile the exact durable WAL without redispatched worker calls.",
  "",
  "This path never touches the active catalogue pin or deletes the candidate image.",
  "Success is host/runtime candidate qualification only.",
  "eligibleForPromotion remains false.",
  "Admitted method and binding qualification remain unqualified.",
  "This is not L3/L4/L5 engineering evidence.",
  "Distinct from the Docker ngspice worker smoke.",
  "",
].join("\n");

export function parseNgspiceWorkerCandidateQualificationCli(
  args: readonly string[],
) {
  return parseFirstPartyMicrosandboxImageCandidateQualificationCli(args, {
    usage: NGSPICE_WORKER_CANDIDATE_QUALIFICATION_USAGE,
    allowRecover: true,
  });
}

export async function runNgspiceWorkerCandidateQualificationCli(
  request: ReturnType<typeof parseNgspiceWorkerCandidateQualificationCli>,
): Promise<{ readonly text: string; readonly exitCode: 0 | 1 }> {
  if (request.mode === "help") {
    return { text: NGSPICE_WORKER_CANDIDATE_QUALIFICATION_USAGE, exitCode: 0 };
  }
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const record = await readBoundFirstPartyMicrosandboxImageCandidateImportRecord(
    await Deno.readTextFile(request.importRecordPath),
    matrix,
  );
  if (request.mode === "plan") {
    const plan = await planNgspiceWorkerCandidateQualification(record);
    return {
      text: `${deterministicJson(plan)}\n${
        renderNgspiceWorkerCandidateQualificationPlanText(plan)
      }`,
      exitCode: 0,
    };
  }
  const capabilityRuntime = await createLocalCapabilityRuntimeReadComposition();
  const ports = { observedHost: capabilityRuntime.host };
  const result = request.mode === "recover"
    ? await recoverNgspiceWorkerCandidateQualification(record, ports)
    : await qualifyNgspiceWorkerCandidate(record, ports);
  const text = `${deterministicJson(result)}\n${
    renderNgspiceWorkerCandidateQualificationResultText(result)
  }`;
  return { text, exitCode: result.status === "passed" ? 0 : 1 };
}

if (import.meta.main) {
  try {
    const output = await runNgspiceWorkerCandidateQualificationCli(
      parseNgspiceWorkerCandidateQualificationCli(Deno.args),
    );
    const text = output.text.endsWith("\n") ? output.text.slice(0, -1) : output.text;
    console.log(text);
    if (output.exitCode !== 0) Deno.exit(output.exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    Deno.exit(1);
  }
}
