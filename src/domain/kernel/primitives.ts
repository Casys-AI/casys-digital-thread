/** Stable primitives shared by otherwise independent domain families. */
export type IsoDateTime = string;

export interface ContentFingerprint {
  algorithm: "sha256";
  digest: string;
}
