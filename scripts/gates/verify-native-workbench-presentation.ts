/**
 * Release gate for the native Workbench presentation boundary.
 *
 * The Workbench is not an MCP App. Since the React migration its
 * presentation primitives and theme are local ports, so the boundary file
 * must not import `@casys/mcp-view` at all, and the emitted bundle must not
 * contain the MCP Apps bridge.
 *
 * `postMessage` is deliberately not a marker: react-dom's scheduler uses a
 * MessageChannel, so the literal appears in any React bundle. The two
 * remaining markers are signatures of the MCP Apps handshake itself.
 */

export const FORBIDDEN_NATIVE_BUNDLE_MARKERS = [
  "ui/initialize",
  "toolresult",
] as const;

export interface PresentationBoundaryInput {
  readonly primitiveAdapterSource: string;
  readonly nativeBundle: string;
}

export type PresentationBoundaryResult =
  | {
    readonly status: "ready";
  }
  | {
    readonly status: "failed";
    readonly errors: readonly string[];
  };

export function evaluatePresentationBoundary(
  input: PresentationBoundaryInput,
): PresentationBoundaryResult {
  const errors: string[] = [];

  const mcpViewImports = findMcpViewImports(input.primitiveAdapterSource);
  if (mcpViewImports.length > 0) {
    errors.push(
      `src/ui/src/mcp-view-primitives.ts must not import @casys/mcp-view entry points: ${
        mcpViewImports.join(", ")
      }.`,
    );
  }

  const runtimeMarkers = findMarkers(input.nativeBundle);
  if (runtimeMarkers.length > 0) {
    errors.push(
      `native Workbench bundle contains MCP Apps bridge markers: ${
        runtimeMarkers.join(", ")
      }.`,
    );
  }

  return errors.length > 0 ? { status: "failed", errors } : { status: "ready" };
}

function findMarkers(bundle: string): string[] {
  return FORBIDDEN_NATIVE_BUNDLE_MARKERS.filter((marker) => bundle.includes(marker));
}

function findMcpViewImports(source: string): string[] {
  return [...source.matchAll(/from\s+"(@casys\/mcp-view(?:\/[^\"]+)?)"/g)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined);
}

async function readNativeWorkbenchBundle(root = "src/ui/dist/thread"): Promise<string> {
  const html = await Deno.readTextFile(`${root}/native-workbench.html`);
  const parts = [html];
  try {
    for await (const entry of Deno.readDir(`${root}/assets`)) {
      if (!entry.isFile) continue;
      if (!/\.(js|css)$/.test(entry.name)) continue;
      parts.push(await Deno.readTextFile(`${root}/assets/${entry.name}`));
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return parts.join("\n");
}

if (import.meta.main) {
  const [primitiveAdapterSource, nativeBundle] = await Promise.all([
    Deno.readTextFile("src/ui/src/mcp-view-primitives.ts"),
    readNativeWorkbenchBundle(),
  ]);
  const result = evaluatePresentationBoundary({
    primitiveAdapterSource,
    nativeBundle,
  });

  switch (result.status) {
    case "ready":
      console.log(
        "OK native Workbench keeps its self-contained presentation boundary.",
      );
      break;
    case "failed":
      for (const error of result.errors) console.error(`ERROR ${error}`);
      Deno.exit(1);
  }
}
