import { fail, type HostResult, ok } from "../host/result.ts";
import type { ChatHostBundlePaths } from "./client.ts";
import { type ChatHostTarget, resolveTargetArtifacts } from "./target.ts";

const RECOVERY =
  "Install a signed application bundle for this target. Do not use an ambient Node, acpx, adapter, or checkout fallback.";
export const PACKAGED_CHAT_HOST_NAME = "casys-chat-host" as const;
const MACOS_FINAL_RUNTIME_NAME = "casys-desktop-runtime";

export function resolvePackagedChatHost(
  executablePath: string,
  target: ChatHostTarget,
): HostResult<ChatHostBundlePaths> {
  let implementedTarget: ChatHostBundlePaths["target"];
  try {
    implementedTarget = resolveTargetArtifacts(target).target;
  } catch (error) {
    return fail(
      "chat-host-target.unsupported",
      error instanceof Error ? error.message : "Chat Host target is unsupported",
      RECOVERY,
    );
  }
  const executable = resolveChatHostExecutable(executablePath, target);
  if (executable === undefined) {
    return fail(
      "chat-host-path.unavailable",
      `Packaged Chat Host layout is invalid for ${target}`,
      RECOVERY,
    );
  }
  return ok(Object.freeze({ executable, target: implementedTarget }));
}

/** Target-layout seam; it is testable independently of artifact availability. */
export function resolveChatHostExecutable(
  executablePath: string,
  target: ChatHostTarget,
): string | undefined {
  if (target === "windows-x64") {
    if (
      executablePath.includes("\0") ||
      !(/^[A-Za-z]:\\/.test(executablePath) ||
        /^\\\\[^\\]+\\[^\\]+\\/.test(executablePath)) ||
      executablePath.split("\\").some((part) => part === "." || part === "..")
    ) return undefined;
    const suffix = "\\CasysDigitalThread\\CasysDigitalThread.exe";
    if (!executablePath.endsWith(suffix)) return undefined;
    const productRoot = executablePath.slice(0, -"\\CasysDigitalThread.exe".length);
    return `${productRoot}\\Helpers\\${PACKAGED_CHAT_HOST_NAME}.exe`;
  }
  if (
    executablePath.trim() !== executablePath ||
    !executablePath.startsWith("/") || executablePath.includes("\0") ||
    executablePath.includes("//") ||
    executablePath.split("/").some((part) => part === "." || part === "..")
  ) return undefined;
  if (target === "linux-x64") {
    const suffix = "/casys-digital-thread/bin/casys-digital-thread";
    if (!executablePath.endsWith(suffix)) return undefined;
    const productRoot = executablePath.slice(0, -"/bin/casys-digital-thread".length);
    return `${productRoot}/libexec/${PACKAGED_CHAT_HOST_NAME}`;
  }
  const suffix = `/CasysDigitalThread.app/Contents/MacOS/${MACOS_FINAL_RUNTIME_NAME}`;
  if (!executablePath.endsWith(suffix)) return undefined;
  const appRoot = executablePath.slice(
    0,
    -`/Contents/MacOS/${MACOS_FINAL_RUNTIME_NAME}`.length,
  );
  return `${appRoot}/Contents/Helpers/${PACKAGED_CHAT_HOST_NAME}`;
}
