export const MACOS_MINIMUM_SYSTEM_VERSION = "14.0";

export interface MacosProductIdentity {
  readonly identifier: string;
  readonly version: string;
}

export const MACOS_BUNDLE_STRING_KEYS = [
  "CFBundleIdentifier",
  "CFBundleShortVersionString",
  "CFBundleVersion",
  "LSMinimumSystemVersion",
] as const;

export type MacosBundleStringKey = typeof MACOS_BUNDLE_STRING_KEYS[number];

export function expectedMacosBundleStrings(
  product: MacosProductIdentity,
): Readonly<Record<MacosBundleStringKey, string>> {
  return Object.freeze({
    CFBundleIdentifier: product.identifier,
    CFBundleShortVersionString: product.version,
    CFBundleVersion: product.version,
    LSMinimumSystemVersion: MACOS_MINIMUM_SYSTEM_VERSION,
  });
}

export function assertMacosBundleStrings(
  actual: Readonly<Record<MacosBundleStringKey, string | undefined>>,
  expected: Readonly<Record<MacosBundleStringKey, string>>,
): void {
  for (const key of MACOS_BUNDLE_STRING_KEYS) {
    if (actual[key] !== expected[key]) {
      throw new Error(`Final bundle ${key} does not match ${expected[key]}.`);
    }
  }
}
