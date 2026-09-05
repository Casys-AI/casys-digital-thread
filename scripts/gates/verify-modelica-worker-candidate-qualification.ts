/**
 * Maintainer-only qualification of one imported Modelica worker candidate.
 * Default mode is planning/read. `--run` is the explicit mutation
 * acknowledgement. `--recover` only reconciles the exact durable WAL.
 * Callers cannot select a provider, image, digest, platform, command,
 * endpoint, tool, worker, profile, source, or args. A run always owns both
 * server-owned proofs.
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
  planModelicaWorkerCandidateQualification,
  qualifyModelicaWorkerCandidate,
  recoverModelicaWorkerCandidateQualification,
  renderModelicaWorkerCandidateQualificationPlanText,
  renderModelicaWorkerCandidateQualificationResultText,
  retryModelicaWorkerCandidateQualificationFromInfrastructureFailure,
} from "../../src/adapters/modelica/modelica-worker-candidate-qualification.ts";

export const MODELICA_WORKER_CANDIDATE_QUALIFICATION_USAGE = [
  "Usage: verify-modelica-worker-candidate-qualification --import-record=<path> [--run|--recover|--retry-infrastructure-failure]",
  "",
  "Maintainer-only qualification of one imported Modelica worker candidate.",
  "Input is only an exact import record bound to the current distribution matrix.",
  "No provider, image, digest, platform, command, endpoint, tool, worker, profile, or source selection.",
  "A run always owns both server-owned proofs: openmodelica-qualified-kit and openmodelica-admitted-modelica.",
  "",
  "Default mode is planning/read: validate the import record and print the plan.",
  "Pass --run to execute the exact cached candidate image through both proofs,",
  "composition, broker, domain validators, CAS reread, WAL and proven destruction.",
  "Pass --recover to reconcile the exact durable WAL without redispatched worker calls.",
  "If successor.json exists, --recover reconciles that canonical successor without a worker call.",
  "Pass --retry-infrastructure-failure to authorize exactly one successor covering both",
  "profile predecessors after proven not-published destruction. A second retry fails closed.",
  "",
  "This path never touches the active catalogue pin or deletes the candidate image.",
  "Success is host/runtime candidate qualification only.",
  "eligibleForPromotion remains false.",
  "Admitted method and binding qualification remain unqualified.",
  "This is not L3/L4/L5 engineering evidence.",
  "",
].join("\n");

export function parseModelicaWorkerCandidateQualificationCli(
  args: readonly string[],
) {
  return parseFirstPartyMicrosandboxImageCandidateQualificationCli(args, {
    usage: MODELICA_WORKER_CANDIDATE_QUALIFICATION_USAGE,
    allowRecover: true,
    allowRetryInfrastructureFailure: true,
  });
}

export async function runModelicaWorkerCandidateQualificationCli(
  request: ReturnType<typeof parseModelicaWorkerCandidateQualificationCli>,
): Promise<{ readonly text: string; readonly exitCode: 0 | 1 }> {
  if (request.mode === "help") {
    return { text: MODELICA_WORKER_CANDIDATE_QUALIFICATION_USAGE, exitCode: 0 };
  }
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const record = await readBoundFirstPartyMicrosandboxImageCandidateImportRecord(
    await Deno.readTextFile(request.importRecordPath),
    matrix,
  );
  if (request.mode === "plan") {
    const plan = await planModelicaWorkerCandidateQualification(record);
    return {
      text: `${deterministicJson(plan)}\n${
        renderModelicaWorkerCandidateQualificationPlanText(plan)
      }`,
      exitCode: 0,
    };
  }
  const capabilityRuntime = await createLocalCapabilityRuntimeReadComposition();
  const ports = { observedHost: capabilityRuntime.host };
  const result = request.mode === "recover"
    ? await recoverModelicaWorkerCandidateQualification(record, ports)
    : request.mode === "retry-infrastructure-failure"
    ? await retryModelicaWorkerCandidateQualificationFromInfrastructureFailure(
      record,
      ports,
    )
    : await qualifyModelicaWorkerCandidate(record, ports);
  const text = `${deterministicJson(result)}\n${
    renderModelicaWorkerCandidateQualificationResultText(result)
  }`;
  return { text, exitCode: result.status === "passed" ? 0 : 1 };
}

if (import.meta.main) {
  try {
    const output = await runModelicaWorkerCandidateQualificationCli(
      parseModelicaWorkerCandidateQualificationCli(Deno.args),
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
