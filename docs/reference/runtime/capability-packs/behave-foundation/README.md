# Behave Foundation candidate review

This folder records the narrow, fingerprinted review inputs used to render the
`casys.behave-foundation@0.1.0` **local developer candidate**. It does not qualify a
production deployment and it never activates a runtime.

The review is deliberately split by concern:

- [platform coverage](platforms.md);
- [licence boundary](licences.md);
- [volume lifecycle](volumes.md);
- [security boundary](security.md).

The machine-readable review descriptor under
`config/capability-packs/behave-foundation.review.json` pins the exact SHA-256 of each
page. A changed page invalidates the candidate until the descriptor is reviewed again.

Installation guidance lives in
[Install the Behave Foundation candidate](../../../../how-to/setup/install-behave-foundation.md).
