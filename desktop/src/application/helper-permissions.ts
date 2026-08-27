import type { ControlPlaneLayoutProfile } from "../control-plane/contracts.ts";

/**
 * Current compiled helpers grant one product root relative to their launch cwd.
 * This is a permission-shape contract, not proof of a Linux or Windows package.
 */
export const PACKAGED_HELPER_RELATIVE_GRANT_PROFILES = Object.freeze(
  [
    "macos-application-support",
    "linux-xdg",
    "windows-local-appdata",
  ] as const satisfies readonly ControlPlaneLayoutProfile[],
);

export function packagedHelperPermissionsCoverLayout(
  profile: ControlPlaneLayoutProfile,
): boolean {
  return PACKAGED_HELPER_RELATIVE_GRANT_PROFILES.some((value) => value === profile);
}
