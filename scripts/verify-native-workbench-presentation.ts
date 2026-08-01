/**
 * Release gate for the native Workbench presentation boundary.
 *
 * The Workbench must use the presentation-only mcp-view entry point.  It is
 * deliberately not allowed to depend on the MCP Apps lifecycle merely because
 * both surfaces happen to share Preact primitives.
 *
 * Older working copies without `@casys/mcp-view/preact/components` receive a
 * precise release blocker. Published consumers use the hard gate for both the
 * import boundary and the emitted bundle.
 */

export const PURE_COMPONENTS_EXPORT = "./preact/components";

export const FORBIDDEN_NATIVE_BUNDLE_MARKERS = [
  "ui/initialize",
  "toolresult",
  "postMessage",
] as const;

export interface PresentationBoundaryInput {
  readonly packageJson: unknown;
  readonly primitiveAdapterSource: string;
  readonly nativeBundle: string;
}

export type PresentationBoundaryResult =
  | {
    readonly status: "blocked";
    readonly releaseStep: string;
    readonly runtimeMarkers: readonly string[];
  }
  | {
    readonly status: "ready";
  }
  | {
    readonly status: "failed";
    readonly errors: readonly string[];
  };

/**
 * Checks the native surface without conflating an unpublished package export
 * with an application regression.  `blocked` is intentional and exits zero:
 * it describes the exact release work still required before migration.
 */
export function evaluatePresentationBoundary(
  input: PresentationBoundaryInput,
): PresentationBoundaryResult {
  if (!hasPureComponentsExport(input.packageJson)) {
    return {
      status: "blocked",
      releaseStep:
        "Publish an npm version of @casys/mcp-view that exports ./preact/components, then update src/ui/package.json and its lockfile to that version.",
      runtimeMarkers: findMarkers(input.nativeBundle),
    };
  }

  const errors: string[] = [];
  if (
    !input.primitiveAdapterSource.includes(
      'from "@casys/mcp-view/preact/components"',
    )
  ) {
    errors.push(
      "src/ui/src/mcp-view-primitives.ts must import the published presentation-only entry point.",
    );
  }

  const nonPureMcpViewImports = findNonPureMcpViewImports(
    input.primitiveAdapterSource,
  );
  if (nonPureMcpViewImports.length > 0) {
    errors.push(
      `src/ui/src/mcp-view-primitives.ts must not import MCP Apps entry points: ${
        nonPureMcpViewImports.join(", ")
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

function hasPureComponentsExport(packageJson: unknown): boolean {
  if (!packageJson || typeof packageJson !== "object") return false;
  const exports = (packageJson as { exports?: unknown }).exports;
  return Boolean(
    exports && typeof exports === "object" &&
      PURE_COMPONENTS_EXPORT in exports,
  );
}

function findMarkers(bundle: string): string[] {
  return FORBIDDEN_NATIVE_BUNDLE_MARKERS.filter((marker) => bundle.includes(marker));
}

function findNonPureMcpViewImports(source: string): string[] {
  return [...source.matchAll(/from\s+"(@casys\/mcp-view(?:\/[^\"]+)?)"/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier !== "@casys/mcp-view/preact/components");
}

if (import.meta.main) {
  const [packageJsonText, primitiveAdapterSource, nativeBundle] = await Promise.all([
    Deno.readTextFile("src/ui/node_modules/@casys/mcp-view/package.json"),
    Deno.readTextFile("src/ui/src/mcp-view-primitives.ts"),
    Deno.readTextFile("src/ui/dist/thread/native-workbench.html"),
  ]);
  const result = evaluatePresentationBoundary({
    packageJson: JSON.parse(packageJsonText),
    primitiveAdapterSource,
    nativeBundle,
  });

  switch (result.status) {
    case "ready":
      console.log("OK native Workbench uses the pure mcp-view presentation bundle.");
      break;
    case "blocked":
      console.log("BLOCKED native Workbench pure-presentation migration:");
      console.log(result.releaseStep);
      console.log(
        `Current bundle bridge markers (expected until that release): ${
          result.runtimeMarkers.join(", ") || "none"
        }.`,
      );
      break;
    case "failed":
      for (const error of result.errors) console.error(`ERROR ${error}`);
      Deno.exit(1);
  }
}
