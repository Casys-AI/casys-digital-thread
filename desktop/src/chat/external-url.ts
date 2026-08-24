import type { DesktopPlatform } from "../host/mod.ts";
import { validateExternalHttpsUrl } from "../../../src/presentation/desktop/chat/contracts.ts";

export interface ExternalUrlOpener {
  open(url: string): Promise<void>;
}

export const MACOS_EXTERNAL_URL_OPENER_NAME = "open" as const;

export type ExternalUrlRun = (
  command: string,
  args: readonly string[],
) => Promise<{ readonly success: boolean }>;

/**
 * Target-owned OS adapter. The webview never navigates to the elicitation URL.
 * Unpackaged targets expose no capability and therefore fail closed.
 */
export function createExternalUrlOpener(
  platform: DesktopPlatform,
  run: ExternalUrlRun = runExternal,
): ExternalUrlOpener | undefined {
  if (platform !== "macOS") return undefined;
  return Object.freeze({
    async open(value: string): Promise<void> {
      const url = validateExternalHttpsUrl(value);
      const result = await run("/usr/bin/open", ["--", url]);
      if (!result.success) throw new Error("The external browser rejected the URL");
    },
  });
}

async function runExternal(
  command: string,
  args: readonly string[],
): Promise<{ readonly success: boolean }> {
  return await new Deno.Command(command, {
    args: [...args],
    clearEnv: true,
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).output();
}
