Audience: agent · Diátaxis: none · Kind: RFC

Status: implemented

# RFC record: acpx 0.13.1 elicitation alignment

This page records the completed alignment in the separate acpx workspace. It does not
vendor acpx into Casys Digital Thread or prove the Desktop chat path.

## Outcome

The Casys acpx fork, local checkout, and installed CLI/runtime now use the exact
upstream `v0.13.1` release that exposes native ACP elicitation. Casys does not maintain
a parallel elicitation protocol or patch once upstream already provides the capability.
Desktop does not consume acpx yet, so its future Chat Host must still add and pin that
dependency explicitly.

## Verified aligned state — 2026-08-22

- Upstream
  [`openclaw/acpx` v0.13.1](https://github.com/openclaw/acpx/releases/tag/v0.13.1)
  includes elicitation through [PR #508](https://github.com/openclaw/acpx/pull/508).
- Upstream runtime exposes `elicitationModes` and a per-turn `onElicitation` handler for
  `form` and `url` modes, with `accept`, `decline`, and `cancel` responses.
- Local `main`, `origin/main`, `upstream/main`, and tag `v0.13.1` resolve to exact
  commit `2d735cf18220e539bf7961a996bff0aceefcf3b0`.
- `/Users/erwanpesle/Documents/GitHub/acpx/package.json` declares `0.13.1`.
- `/opt/homebrew/bin/acpx --version` reports `0.13.1`.
- The repository contains focused runtime tests for form/URL advertisement,
  request/session/tool-call correlation, `accept`/`decline`/`cancel`, abort and late
  responses, and exclusion from generic taps.
- Historical Casys patches remain on separate archive/feature branches rather than
  making the aligned default branch diverge from the release.

The earlier proposed upstream issue is obsolete and must not be created.

## Completed alignment

The completed work occurred in `/Users/erwanpesle/Documents/GitHub/acpx`, not in this
repository:

1. The fork default branch was aligned to exact upstream release commit `2d735cf`.
2. Divergent Casys work was preserved on separate branches; it was not folded into
   `main`.
3. The intended local/global CLI reports `0.13.1`, and the public runtime source exposes
   the aligned elicitation types and handlers.
4. No duplicate upstream issue or Casys-specific elicitation implementation was added.

Adding acpx to Desktop is deliberately absent from this completed scope. The future Chat
Host must pin an exact reviewed version or commit; it must not consume `main`, a moving
tag alias, or `latest` at runtime.

## Required runtime behavior

The aligned public surface must retain:

- opt-in `form` and `url` capability advertisement;
- per-prompt ownership of the elicitation handler;
- exact `sessionId`, optional `toolCallId`, and JSON-RPC request correlation;
- `accept`, `decline`, and `cancel` without fabricated values;
- abort propagation for prompt cancellation, replacement, shutdown, and late responses;
- fail-closed handling for missing handlers, unsupported modes, mismatched sessions, and
  stale requests; and
- exclusion of form schemas and human answers from generic ACP taps/logs.

Advertising no mode when none is configured, and failing closed when an active turn has
no handler, are correct behavior rather than evidence that elicitation is missing.

## Non-goals

- No upstream issue or duplicate implementation.
- No Casys-specific ACP extension.
- No form renderer or Desktop UI in the acpx repository.
- No conflation of elicitation with `session/request_permission`.
- No persistence of engineering truth or human MRTR inside acpx session history.
- No provider credentials or direct engineering-provider access in acpx.

## Alignment completion evidence

- **Satisfied:** the intended CLI reports `0.13.1`, and the fork/default branch equals
  the reviewed upstream release commit.
- **Satisfied in the aligned source:** `elicitationModes` and `onElicitation` are public
  without a local type patch; focused tests cover form and URL modes,
  `accept`/`decline`/`cancel`, correlation, abort/late response, and sensitive tap
  suppression.
- **Preserved:** a consumer with no configured modes advertises no elicitation
  capability; a request with no active handler remains fail-closed.
- **Separate future gate:** the Desktop consumer must type-check and run its own
  external probe after it pins acpx. Product `0.2.0` has no such consumer and claims no
  embedded elicitation.

## Handoff

This completed alignment no longer blocks the
[embedded chat RFC](embedded-acpx-chat.md). The chat RFC remains wholly unimplemented
and must still prove its host, IPC, UI, privacy, lifecycle and real server-validated
human-decision path. This alignment does not block backend-only sensitivity
implementation.
