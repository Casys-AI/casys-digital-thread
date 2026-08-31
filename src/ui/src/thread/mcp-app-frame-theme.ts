export interface McpAppThemeSignals {
  readonly dataTheme?: string;
  readonly darkClass?: boolean;
  readonly lightClass?: boolean;
  readonly colorScheme?: string;
  readonly prefersDark?: boolean;
}

/** Resolve the host's rendered theme before falling back to the OS preference. */
export function resolveMcpAppTheme(
  signals: McpAppThemeSignals,
): "light" | "dark" {
  if (signals.dataTheme === "dark") return "dark";
  if (signals.dataTheme === "light") return "light";
  if (signals.darkClass) return "dark";
  if (signals.lightClass) return "light";

  const computedSchemes = signals.colorScheme?.trim().split(/\s+/).filter(
    Boolean,
  ) ?? [];
  if (computedSchemes.length === 1 && computedSchemes[0] === "dark") {
    return "dark";
  }
  if (computedSchemes.length === 1 && computedSchemes[0] === "light") {
    return "light";
  }
  return signals.prefersDark ? "dark" : "light";
}
