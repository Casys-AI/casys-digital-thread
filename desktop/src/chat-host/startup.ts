import { CONTROL_PLANE_PRODUCT_IDENTIFIER } from "../control-plane/contracts.ts";
import {
  type DesktopPlatform,
  type EnvironmentReader,
  resolveApplicationSupportLayout,
} from "../host/mod.ts";
import { ChatHostClient, type ChatHostClientOptions } from "./client.ts";
import { resolvePackagedChatHost } from "./path.ts";
import { chatHostTarget } from "./target.ts";

export interface PackagedChatHostStartupInput {
  /** Produced only by the validated Desktop application bootstrap. */
  readonly launchable: boolean;
  readonly executablePath: string;
  readonly platform: DesktopPlatform;
  readonly arch: "aarch64" | "x86_64";
  readonly env: EnvironmentReader;
  readonly childEnv: () => Readonly<Record<string, string>>;
}

export interface PackagedChatHostStartupPorts {
  readonly start: (options: ChatHostClientOptions) => Promise<ChatHostClient>;
}

const DEFAULT_PORTS: PackagedChatHostStartupPorts = Object.freeze({
  start: (options: ChatHostClientOptions) => ChatHostClient.start(options),
});

/**
 * Starts no process unless the product bootstrap authorized Chat Host first.
 * Target artifacts and the platform-owned data layout are then resolved from
 * fixed package/runtime facts; there is no ambient executable fallback.
 */
export async function startPackagedChatHost(
  input: PackagedChatHostStartupInput,
  ports: PackagedChatHostStartupPorts = DEFAULT_PORTS,
): Promise<ChatHostClient | undefined> {
  if (!input.launchable) return undefined;

  try {
    const target = chatHostTarget(input.platform, input.arch);
    const paths = resolvePackagedChatHost(input.executablePath, target);
    const layout = resolveApplicationSupportLayout({
      platform: input.platform,
      productIdentifier: CONTROL_PLANE_PRODUCT_IDENTIFIER,
      env: input.env,
    });
    if (!paths.ok || !layout.ok) return undefined;

    const separator = input.platform === "Windows" ? "\\" : "/";
    return await ports.start({
      paths: paths.value,
      dataRoot: `${layout.value.root}${separator}chat-host`,
      launchCwd: layout.value.controlPlaneLaunchCwd,
      env: input.childEnv(),
      platform: input.platform,
    });
  } catch {
    return undefined;
  }
}
