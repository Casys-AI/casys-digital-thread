/**
 * Maintainer-only qualification of one imported CalculiX worker candidate.
 * Default mode is planning/read. `--run` is the explicit mutation
 * acknowledgement. `--recover` only reconciles the exact durable WAL attempt.
 * Callers cannot select a provider, image, digest, platform, command,
 * endpoint, tool, worker, proof, or STEP.
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
  planCalculixWorkerCandidateQualification,
  qualifyCalculixWorkerCandidate,
  recoverCalculixWorkerCandidateQualification,
  renderCalculixWorkerCandidateQualificationPlanText,
  renderCalculixWorkerCandidateQualificationResultText,
} from "../../src/adapters/fea/isolated-v3/calculix-worker-candidate-qualification.ts";

export const CALCULIX_WORKER_CANDIDATE_QUALIFICATION_USAGE = [
  "Usage: verify-calculix-worker-candidate-qualification --import-record=<path> [--run|--recover]",
  "",
  "Maintainer-only qualification of one imported CalculiX worker candidate.",
  "Input is only an exact import record bound to the current distribution matrix.",
  "No provider, image, digest, platform, command, endpoint, tool, worker, proof, or STEP selection.",
  "",
  "Default mode is planning/read: validate the import record and print the plan.",
  "Pass --run to execute the exact cached candidate image through the production",
  "composition, broker, CalculiX validators, batch inspector, CAS reread, WAL and",
  "proven destruction.",
  "Pass --recover to reconcile the exact durable WAL without redispatched worker calls.",
  "",
  "This path never touches the active catalogue pin or deletes the candidate image.",
  "Success is host/runtime candidate qualification only.",
  "eligibleForPromotion remains false.",
  "This is not L3/L4/L5 engineering evidence.",
  "",
].join("\n");

export function parseCalculixWorkerCandidateQualificationCli(
  args: readonly string[],
) {
  return parseFirstPartyMicrosandboxImageCandidateQualificationCli(args, {
    usage: CALCULIX_WORKER_CANDIDATE_QUALIFICATION_USAGE,
    allowRecover: true,
  });
}

export async function runCalculixWorkerCandidateQualificationCli(
  request: ReturnType<typeof parseCalculixWorkerCandidateQualificationCli>,
): Promise<string> {
  if (request.mode === "help") {
    return CALCULIX_WORKER_CANDIDATE_QUALIFICATION_USAGE;
  }
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const record = await readBoundFirstPartyMicrosandboxImageCandidateImportRecord(
    await Deno.readTextFile(request.importRecordPath),
    matrix,
  );
  if (request.mode === "plan") {
    const plan = await planCalculixWorkerCandidateQualification(record);
    return `${deterministicJson(plan)}\n${
      renderCalculixWorkerCandidateQualificationPlanText(plan)
    }`;
  }
  const capabilityRuntime = await createLocalCapabilityRuntimeReadComposition();
  const ports = { observedHost: capabilityRuntime.host };
  const result = request.mode === "recover"
    ? await recoverCalculixWorkerCandidateQualification(record, ports)
    : await qualifyCalculixWorkerCandidate(record, ports);
  return `${deterministicJson(result)}\n${
    renderCalculixWorkerCandidateQualificationResultText(result)
  }`;
}

if (import.meta.main) {
  try {
    const output = await runCalculixWorkerCandidateQualificationCli(
      parseCalculixWorkerCandidateQualificationCli(Deno.args),
    );
    console.log(output.endsWith("\n") ? output.slice(0, -1) : output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    Deno.exit(1);
  }
}
