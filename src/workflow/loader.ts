import { parse as parseYaml } from "@std/yaml";
import {
  compileThreadWorkflow,
  ThreadWorkflowError,
  validateThreadWorkflow,
} from "./compiler.ts";
import type { CompiledThreadWorkflow, ThreadWorkflowDefinition } from "./types.ts";

export interface ThreadWorkflowLoaderOptions {
  readTextFile?: (path: string | URL) => Promise<string>;
}

export async function loadThreadWorkflow(
  path: string | URL,
  options: ThreadWorkflowLoaderOptions = {},
): Promise<ThreadWorkflowDefinition> {
  const readTextFile = options.readTextFile ?? Deno.readTextFile;
  let source: string;
  try {
    source = await readTextFile(path);
  } catch (error) {
    throw new ThreadWorkflowError(
      "validation",
      `Unable to read thread workflow ${String(path)}: ${errorMessage(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    throw new ThreadWorkflowError(
      "validation",
      `Invalid YAML in thread workflow ${String(path)}: ${errorMessage(error)}`,
    );
  }
  return validateThreadWorkflow(parsed);
}

export async function loadAndCompileThreadWorkflow(
  path: string | URL,
  options: ThreadWorkflowLoaderOptions = {},
): Promise<CompiledThreadWorkflow> {
  return compileThreadWorkflow(await loadThreadWorkflow(path, options));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
