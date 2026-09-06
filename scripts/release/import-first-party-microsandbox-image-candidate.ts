/**
 * Maintainer-only import/inspection of one first-party Microsandbox image
 * candidate from an exact repository receipt. Default mode is planning/read.
 * `--run` is the explicit mutation acknowledgement. Callers cannot select a
 * provider, image, digest, platform, command, endpoint, tool, or worker.
 *
 * Domain qualification remains not-run. Promotion remains false.
 */

import { createFirstPartyCapabilityRuntimeCatalog } from "../../src/adapters/control-plane/first-party-capability-binding-catalog.ts";
import {
  importFirstPartyMicrosandboxImageCandidate,
  planFirstPartyMicrosandboxImageCandidateImport,
  renderFirstPartyMicrosandboxImageCandidateImportPlanText,
} from "../../src/adapters/control-plane/first-party-microsandbox-image-candidate-import.ts";
import { renderFirstPartyMicrosandboxImageCandidateImportRecordText } from "../../src/adapters/control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import { createLocalFirstPartyMicrosandboxImageCandidateImportPorts } from "../../src/adapters/control-plane/local-first-party-microsandbox-image-candidate-import-ports.ts";
import { readBoundFirstPartyMicrosandboxImageCandidateReceipt } from "../../src/adapters/control-plane/first-party-microsandbox-image-candidate-receipt.ts";
import { createFirstPartyMicrosandboxImageDistributionMatrix } from "../../src/adapters/control-plane/first-party-microsandbox-image-distribution-matrix.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";

export const FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_USAGE = [
  "Usage: import-first-party-microsandbox-image-candidate --receipt=<path> [--run]",
  "",
  "Maintainer-only import/inspection of one first-party Microsandbox image candidate.",
  "Input is only an exact repository receipt bound to the current distribution matrix.",
  "No provider, image, digest, platform, command, endpoint, tool, or worker selection.",
  "",
  "Default mode is planning/read: validate the receipt and print the import plan.",
  "Pass --run to pull the exact linux/arm64 OCI platform manifest, import it under a",
  "non-catalog Microsandbox candidate reference, and write a local factual import record.",
  "",
  "This path never touches the active catalogue pin.",
  "runtimeQualification remains not-run.",
  "eligibleForPromotion remains false.",
  "Domain qualification is not run. Promotion is false.",
  "",
].join("\n");

const FORBIDDEN_FLAG_PATTERN =
  /provider|image|digest|platform|command|endpoint|tool|worker|args|binding|unit-id/i;

export type FirstPartyMicrosandboxImageCandidateImportCliRequest =
  | { readonly mode: "help" }
  | { readonly mode: "plan"; readonly receiptPath: string }
  | { readonly mode: "run"; readonly receiptPath: string };

export function parseFirstPartyMicrosandboxImageCandidateImportCli(
  args: readonly string[],
): FirstPartyMicrosandboxImageCandidateImportCliRequest {
  const flags = parseFlags(args);
  if (flags.has("help")) {
    if (flags.size !== 1) {
      throw new TypeError(FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_USAGE);
    }
    return { mode: "help" };
  }
  const allowed = new Set(["receipt", "run"]);
  for (const name of flags.keys()) {
    if (!allowed.has(name)) {
      throw new TypeError(
        `--${name} is not valid for first-party candidate import.\n${FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_USAGE}`,
      );
    }
  }
  const receiptPath = flags.get("receipt");
  if (typeof receiptPath !== "string" || receiptPath.length === 0) {
    throw new TypeError(FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_USAGE);
  }
  const run = flags.get("run");
  if (run === true) {
    return { mode: "run", receiptPath };
  }
  if (run !== undefined) {
    throw new TypeError(
      "Candidate import --run is a boolean acknowledgement and takes no value.",
    );
  }
  return { mode: "plan", receiptPath };
}

export async function runFirstPartyMicrosandboxImageCandidateImportCli(
  request: FirstPartyMicrosandboxImageCandidateImportCliRequest,
): Promise<string> {
  if (request.mode === "help") {
    return FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_USAGE;
  }
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const matrix = createFirstPartyMicrosandboxImageDistributionMatrix(catalog);
  const receipt = await readBoundFirstPartyMicrosandboxImageCandidateReceipt(
    await Deno.readTextFile(request.receiptPath),
    matrix,
  );
  if (request.mode === "plan") {
    const plan = planFirstPartyMicrosandboxImageCandidateImport(receipt);
    return `${deterministicJson(plan)}\n${
      renderFirstPartyMicrosandboxImageCandidateImportPlanText(plan)
    }`;
  }
  const ports = await createLocalFirstPartyMicrosandboxImageCandidateImportPorts();
  const record = await importFirstPartyMicrosandboxImageCandidate({
    receipt,
    matrix,
    ports,
  });
  return `${deterministicJson(record)}\n${
    renderFirstPartyMicrosandboxImageCandidateImportRecordText(record)
  }`;
}

if (import.meta.main) {
  try {
    const output = await runFirstPartyMicrosandboxImageCandidateImportCli(
      parseFirstPartyMicrosandboxImageCandidateImportCli(Deno.args),
    );
    console.log(output.endsWith("\n") ? output.slice(0, -1) : output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    Deno.exit(1);
  }
}

function parseFlags(
  values: readonly string[],
): ReadonlyMap<string, string | true> {
  const result = new Map<string, string | true>();
  for (const value of values) {
    if (!value.startsWith("--")) {
      throw new TypeError(
        `Unsupported first-party candidate import argument ${value}.\n${FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_USAGE}`,
      );
    }
    const [name, ...rest] = value.slice(2).split("=");
    if (!name || result.has(name)) {
      throw new TypeError(
        `Invalid repeated first-party candidate import flag ${value}.`,
      );
    }
    if (
      FORBIDDEN_FLAG_PATTERN.test(name) &&
      name !== "receipt"
    ) {
      throw new TypeError(
        `--${name} is refused: candidate import does not accept provider, image, digest, platform, command, endpoint, tool, or worker inputs.\n${FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_USAGE}`,
      );
    }
    result.set(name, rest.length === 0 ? true : rest.join("="));
  }
  return result;
}
