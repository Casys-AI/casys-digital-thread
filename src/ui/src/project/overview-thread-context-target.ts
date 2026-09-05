export type OverviewThreadContextTarget =
  | { readonly kind: "node"; readonly key: string }
  | { readonly kind: "group"; readonly key: string };

const NODE_PREFIX = "node:";
const GROUP_PREFIX = "group:";

export function overviewThreadNodeContextValue(key: string): string {
  return `${NODE_PREFIX}${key}`;
}

export function overviewThreadGroupContextValue(key: string): string {
  return `${GROUP_PREFIX}${key}`;
}

export function parseOverviewThreadContextTarget(
  value: string | null | undefined,
): OverviewThreadContextTarget | undefined {
  if (value?.startsWith(NODE_PREFIX)) {
    const key = value.slice(NODE_PREFIX.length);
    return key ? { kind: "node", key } : undefined;
  }
  if (value?.startsWith(GROUP_PREFIX)) {
    const key = value.slice(GROUP_PREFIX.length);
    return key ? { kind: "group", key } : undefined;
  }
  return undefined;
}
