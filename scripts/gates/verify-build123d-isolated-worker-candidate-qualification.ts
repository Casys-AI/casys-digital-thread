/**
 * Maintainer-only qualification of one imported Build123d isolated-worker
 * candidate. Default mode is planning/read. `--run` is the explicit mutation
 * acknowledgement. Callers cannot select a provider, image, digest, platform,
 * command, endpoint, tool, or worker.
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
  planBuild123dIsolatedWorkerCandidateQualification,
  qualifyBuild123dIsolatedWorkerCandidate,
  renderBuild123dIsolatedWorkerCandidateQualificationPlanText,
  renderBuild123dIsolatedWorkerCandidateQualificationResultText,
} from "../../src/adapters/cad/isolated/build123d-isolated-worker-candidate-qualification.ts";

export const BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_USAGE = [
  "Usage: verify-build123d-isolated-worker-candidate-qualification --import-record=<path> [--run]",
  "",
  "Maintainer-only qualification of one imported Build123d isolated-worker candidate.",
  "Input is only an exact import record bound to the current distribution matrix.",
  "No provider, image, digest, platform, command, endpoint, tool, or worker selection.",
  "",
  "Default mode is planning/read: validate the import record and print the plan.",
  "Pass --run to execute the exact cached candidate image through the production",
  "composition, broker, OCCT validator, CAS reread, and proven destruction.",
  "",
  "This path never touches the active catalogue pin or deletes the candidate image.",
  "Success is host/runtime candidate qualification only.",
  "eligibleForPromotion remains false.",
  "This is not L3/L4/L5 engineering evidence.",
  "",
].join("\n");

export function parseBuild123dIsolatedWorkerCandidateQualificationCli(
  args: readonly string[],
) {
  return parseFirstPartyMicrosandboxImageCandidateQualificationCli(args, {
    usage: BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_USAGE,
  });
}

export async function runBuild123dIsolatedWorkerCandidateQualificationCli(
  request: ReturnType<typeof parseBuild123dIsolatedWorkerCandidateQualificationCli>,
): Promise<string> {
  if (request.mode === "help") {
    return BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_USAGE;
  }
  if (request.mode === "recover") {
    throw new TypeError(BUILD123D_ISOLATED_WORKER_CANDIDATE_QUALIFICATION_USAGE);
  }
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const record = await readBoundFirstPartyMicrosandboxImageCandidateImportRecord(
    await Deno.readTextFile(request.importRecordPath),
    matrix,
  );
  if (request.mode === "plan") {
    const plan = await planBuild123dIsolatedWorkerCandidateQualification(record);
    return `${deterministicJson(plan)}\n${
      renderBuild123dIsolatedWorkerCandidateQualificationPlanText(plan)
    }`;
  }
  const capabilityRuntime = await createLocalCapabilityRuntimeReadComposition();
  const result = await qualifyBuild123dIsolatedWorkerCandidate(record, {
    observedHost: capabilityRuntime.host,
  });
  return `${deterministicJson(result)}\n${
    renderBuild123dIsolatedWorkerCandidateQualificationResultText(result)
  }`;
}

if (import.meta.main) {
  try {
    const output = await runBuild123dIsolatedWorkerCandidateQualificationCli(
      parseBuild123dIsolatedWorkerCandidateQualificationCli(Deno.args),
    );
    console.log(output.endsWith("\n") ? output.slice(0, -1) : output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    Deno.exit(1);
  }
}
