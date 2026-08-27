/**
 * Public facade for the deterministic source-alpha release inventory.
 *
 * The implementation is split by responsibility under source-alpha/; this facade
 * remains the stable import named by the CLI scripts, tests, and tools lock.
 */

export {
  buildSourceAlphaRelease,
  renderThirdPartyNotices,
  sourceAlphaTagFromArgs,
  verifySourceAlphaRelease,
} from "./source-alpha/release.ts";
export {
  canonicalJson,
  sha256,
  SOURCE_ALPHA_GENERATOR_VERSION,
} from "./source-alpha/contract.ts";
export type {
  BuildSourceAlphaReleaseOptions,
  SourceAlphaInputDigest,
  SourceAlphaReleaseContext,
  SourceAlphaScope,
  SourceAlphaToolsLock,
} from "./source-alpha/contract.ts";
