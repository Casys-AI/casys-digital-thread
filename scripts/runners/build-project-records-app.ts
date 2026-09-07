/**
 * Trusted builder for the Digital Thread-owned project-records whole App.
 *
 * Emits one single-file HTML document with inline styles and exactly one
 * inline `type="module"` bootstrap. It does not register, materialize, or
 * launch the App.
 */

import { parseArgs } from "../lib/cli.ts";
import { planMcpAppDocument } from "../../src/ui/src/thread/mcp-app-document-loader.ts";
import { buildProjectRecordsAppHtml } from "../../src/apps/project-records/project-records-app.ts";

export const DEFAULT_PROJECT_RECORDS_HTML_PATH =
  "src/apps/project-records/project-records.html" as const;

export interface BuildProjectRecordsAppRequest {
  readonly outputPath?: string;
}

export interface BuildProjectRecordsAppResult {
  readonly outputPath: string;
  readonly bytes: number;
}

export async function buildProjectRecordsApp(
  request: BuildProjectRecordsAppRequest = {},
): Promise<BuildProjectRecordsAppResult> {
  const outputPath = boundedPath(
    request.outputPath ?? DEFAULT_PROJECT_RECORDS_HTML_PATH,
    "Output path",
  );
  const html = buildProjectRecordsAppHtml();
  planMcpAppDocument(html);
  const slash = outputPath.replace(/\/+$/, "").lastIndexOf("/");
  if (slash > 0) {
    await Deno.mkdir(outputPath.slice(0, slash), { recursive: true });
  }
  const bytes = new TextEncoder().encode(html);
  await Deno.writeFile(outputPath, bytes);
  return { outputPath, bytes: bytes.byteLength };
}

export function parseBuildProjectRecordsAppCli(
  args: readonly string[],
): BuildProjectRecordsAppRequest {
  const allowed = new Set(["output"]);
  const normalized = args.filter((argument) => argument !== "--");
  for (const argument of normalized) {
    const match = /^--([^=]+)=/.exec(argument);
    if (!match || !allowed.has(match[1])) {
      throw new TypeError(
        `Unsupported project-records App builder argument: ${argument}`,
      );
    }
  }
  const flags = parseArgs(normalized);
  return { outputPath: flags.output };
}

function boundedPath(value: string, label: string): string {
  if (
    value.length === 0 || value !== value.trim() || value.includes("\0") ||
    value === "/"
  ) {
    throw new TypeError(`${label} must be an explicit bounded path.`);
  }
  return value;
}

if (import.meta.main) {
  const result = await buildProjectRecordsApp(
    parseBuildProjectRecordsAppCli(Deno.args),
  );
  console.log(JSON.stringify(result));
}
