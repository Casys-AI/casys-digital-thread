import { CONTROL_PLANE_HELPER_NAME } from "../sidecar/compile-permissions.ts";
import { WORKBENCH_HELPER_NAME } from "../workbench/contracts.ts";
import { WORKBENCH_STAGE_SOURCE } from "../workbench/compile-permissions.ts";

export const HELPER_STAGE_SOURCE = `dist/helpers/${CONTROL_PLANE_HELPER_NAME}`;
export const HELPER_BUNDLE_RELATIVE_PATH =
  `Contents/Helpers/${CONTROL_PLANE_HELPER_NAME}`;
export const WORKBENCH_BUNDLE_RELATIVE_PATH =
  `Contents/Helpers/${WORKBENCH_HELPER_NAME}`;
export { WORKBENCH_STAGE_SOURCE };

const GENERAL_DENO_NAMES = new Set(["deno", "deno.exe"]);

export function helperBundlePath(appPath: string): string {
  return `${appPath}/${HELPER_BUNDLE_RELATIVE_PATH}`;
}

export function workbenchBundlePath(appPath: string): string {
  return `${appPath}/${WORKBENCH_BUNDLE_RELATIVE_PATH}`;
}

export async function stageControlPlaneHelper(input: {
  readonly appPath: string;
  readonly sourcePath: string;
  readonly mkdir?: (path: string) => Promise<void>;
  readonly copyFile?: (from: string, to: string) => Promise<void>;
  readonly chmod?: (path: string, mode: number) => Promise<void>;
}): Promise<string> {
  return await stageDedicatedHelper({
    ...input,
    expectedName: CONTROL_PLANE_HELPER_NAME,
    destination: helperBundlePath(input.appPath),
  });
}

export async function stageWorkbenchHelper(input: {
  readonly appPath: string;
  readonly sourcePath: string;
  readonly mkdir?: (path: string) => Promise<void>;
  readonly copyFile?: (from: string, to: string) => Promise<void>;
  readonly chmod?: (path: string, mode: number) => Promise<void>;
}): Promise<string> {
  return await stageDedicatedHelper({
    ...input,
    expectedName: WORKBENCH_HELPER_NAME,
    destination: workbenchBundlePath(input.appPath),
  });
}

async function stageDedicatedHelper(input: {
  readonly appPath: string;
  readonly sourcePath: string;
  readonly expectedName: string;
  readonly destination: string;
  readonly mkdir?: (path: string) => Promise<void>;
  readonly copyFile?: (from: string, to: string) => Promise<void>;
  readonly chmod?: (path: string, mode: number) => Promise<void>;
}): Promise<string> {
  const basename = input.sourcePath.split("/").pop() ?? "";
  if (GENERAL_DENO_NAMES.has(basename)) {
    throw new Error("The host must not package a general Deno CLI.");
  }
  if (basename !== input.expectedName) {
    throw new Error(
      `The staged helper must be named ${input.expectedName}.`,
    );
  }

  const destination = input.destination;
  const helpersDir = destination.slice(0, destination.lastIndexOf("/"));
  const mkdir = input.mkdir ??
    ((path: string) => Deno.mkdir(path, { recursive: true }));
  const copyFile = input.copyFile ?? Deno.copyFile;
  const chmod = input.chmod ?? Deno.chmod;

  await mkdir(helpersDir);
  await copyFile(input.sourcePath, destination);
  await chmod(destination, 0o755);
  return destination;
}

export async function assertNoGeneralDenoCli(
  appPath: string,
  readDir: (path: string) => AsyncIterable<{ name: string; isDirectory: boolean }> =
    Deno.readDir,
): Promise<void> {
  const stack = [appPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for await (const entry of readDir(current)) {
      if (GENERAL_DENO_NAMES.has(entry.name)) {
        throw new Error(
          `The app bundle must not contain a general Deno CLI (${entry.name}).`,
        );
      }
      if (entry.isDirectory) {
        stack.push(`${current}/${entry.name}`);
      }
    }
  }
}
