/**
 * Maintainer-only qualification of one imported geometry-module assembler
 * candidate. Default mode is planning/read. `--run` dispatches once.
 * `--recover` only reconciles the exact durable WAL attempt. Callers cannot
 * select a provider, image, digest, platform, command, endpoint, tool, or
 * worker.
 *
 * The active-pin qualification gate is unchanged. This path never writes the
 * normal capability-runtime-host qualification stores and never deletes the
 * candidate image.
 */

import { createFirstPartyCapabilityRuntimeCatalog } from "../../src/adapters/control-plane/first-party-capability-binding-catalog.ts";
import { createFirstPartyMicrosandboxImageDistributionMatrix } from "../../src/adapters/control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import { readBoundFirstPartyMicrosandboxImageCandidateImportRecord } from "../../src/adapters/control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import { parseFirstPartyMicrosandboxImageCandidateQualificationCli } from "../../src/adapters/control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import { createLocalCapabilityRuntimeReadComposition } from "../../src/adapters/control-plane/local-capability-runtime-read-composition.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import {
  applyGeometryModuleAssemblerWorkerCandidateQualification,
  planGeometryModuleAssemblerWorkerCandidateQualification,
  recoverGeometryModuleAssemblerWorkerCandidateQualification,
  renderGeometryModuleAssemblerWorkerCandidateQualificationPlanText,
  renderGeometryModuleAssemblerWorkerCandidateQualificationResultText,
  retryGeometryModuleAssemblerWorkerCandidateQualificationFromInfrastructureFailure,
} from "../../src/adapters/cad/module-assembly/geometry-module-assembler-worker-candidate-qualification.ts";

export const GEOMETRY_MODULE_ASSEMBLER_WORKER_CANDIDATE_QUALIFICATION_USAGE = [
  "Usage: verify-geometry-module-assembler-worker-candidate-qualification --import-record=<path> [--run|--recover|--retry-infrastructure-failure]",
  "",
  "Maintainer-only qualification of one imported geometry-module assembler candidate.",
  "Input is only an exact import record bound to the current distribution matrix.",
  "No provider, image, digest, platform, command, endpoint, tool, or worker selection.",
  "",
  "Default mode is planning/read: validate the import record and print the plan.",
  "Pass --run to dispatch the exact cached candidate image through the production",
  "assembler, CAS reread, validator, oracle, and proven destruction.",
  "Pass --recover to reconcile the exact durable WAL without redispatched worker calls.",
  "Pass --retry-infrastructure-failure to authorize exactly one successor after a",
  "proven not-published, destroyed dispatched predecessor. A second retry fails closed.",
  "",
  "This path never touches the active catalogue pin or deletes the candidate image.",
  "Success is host/runtime candidate qualification only.",
  "eligibleForPromotion remains false.",
  "This is not L3/L4/L5 engineering evidence.",
  "",
].join("\n");

export function parseGeometryModuleAssemblerWorkerCandidateQualificationCli(
  args: readonly string[],
) {
  return parseFirstPartyMicrosandboxImageCandidateQualificationCli(args, {
    usage: GEOMETRY_MODULE_ASSEMBLER_WORKER_CANDIDATE_QUALIFICATION_USAGE,
    allowRecover: true,
    allowRetryInfrastructureFailure: true,
  });
}

export async function runGeometryModuleAssemblerWorkerCandidateQualificationCli(
  request: ReturnType<
    typeof parseGeometryModuleAssemblerWorkerCandidateQualificationCli
  >,
): Promise<string> {
  if (request.mode === "help") {
    return GEOMETRY_MODULE_ASSEMBLER_WORKER_CANDIDATE_QUALIFICATION_USAGE;
  }
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const record = await readBoundFirstPartyMicrosandboxImageCandidateImportRecord(
    await Deno.readTextFile(request.importRecordPath),
    matrix,
  );
  if (request.mode === "plan") {
    const plan = await planGeometryModuleAssemblerWorkerCandidateQualification(
      record,
    );
    return `${deterministicJson(plan)}\n${
      renderGeometryModuleAssemblerWorkerCandidateQualificationPlanText(plan)
    }`;
  }
  const capabilityRuntime = await createLocalCapabilityRuntimeReadComposition();
  const ports = { observedHost: capabilityRuntime.host };
  const result = request.mode === "recover"
    ? await recoverGeometryModuleAssemblerWorkerCandidateQualification(record, ports)
    : request.mode === "retry-infrastructure-failure"
    ? await retryGeometryModuleAssemblerWorkerCandidateQualificationFromInfrastructureFailure(
      record,
      ports,
    )
    : await applyGeometryModuleAssemblerWorkerCandidateQualification(record, ports);
  return `${deterministicJson(result)}\n${
    renderGeometryModuleAssemblerWorkerCandidateQualificationResultText(result)
  }`;
}

if (import.meta.main) {
  try {
    const output = await runGeometryModuleAssemblerWorkerCandidateQualificationCli(
      parseGeometryModuleAssemblerWorkerCandidateQualificationCli(Deno.args),
    );
    console.log(output.endsWith("\n") ? output.slice(0, -1) : output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    Deno.exit(1);
  }
}
