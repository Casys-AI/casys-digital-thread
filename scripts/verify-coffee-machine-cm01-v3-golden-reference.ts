import { parseArgs } from "./cli.ts";
import {
  compareCoffeeMachineCm01V3GoldenReference,
  validateCoffeeMachineCm01V3GoldenObservation,
  validateCoffeeMachineCm01V3GoldenReference,
} from "../src/domain/coffee-machine-cm01-v3-golden-reference.ts";

const DEFAULT_REFERENCE_PATH = "config/golden-references/coffee-machine-cm01-v3.json";

export interface VerifyCoffeeMachineCm01V3GoldenReferenceOptions {
  readonly observationPath: string;
  readonly referencePath?: string;
}

/**
 * Compare a normalized fresh CM-01 V3 run with the static reviewed reference.
 *
 * This gate reads only JSON projections. It cannot call a provider, derive a
 * join from names, or make a historical CM-01 record executable.
 */
export async function verifyCoffeeMachineCm01V3GoldenReference(
  options: VerifyCoffeeMachineCm01V3GoldenReferenceOptions,
) {
  const referencePath = requiredPath(
    options.referencePath ?? DEFAULT_REFERENCE_PATH,
    "referencePath",
  );
  const observationPath = requiredPath(options.observationPath, "observationPath");
  const reference = validateCoffeeMachineCm01V3GoldenReference(
    await readJson(referencePath),
  );
  const observation = validateCoffeeMachineCm01V3GoldenObservation(
    await readJson(observationPath),
  );
  return compareCoffeeMachineCm01V3GoldenReference(reference, observation);
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const observationPath = args["observation"];
  if (!observationPath) {
    throw new Error("--observation=<normalized-result.json> is required.");
  }
  const result = await verifyCoffeeMachineCm01V3GoldenReference({
    observationPath,
    referencePath: args["reference"],
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.matches) Deno.exitCode = 1;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${path} does not contain valid JSON.`);
    }
    throw error;
  }
}

function requiredPath(value: string, name: string): string {
  if (value.trim() === "") throw new Error(`${name} must be non-empty.`);
  return value;
}
