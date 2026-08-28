# Behave Foundation licence boundary

Review date: 2026-08-29.

This candidate describes a local developer installation that pulls exact third-party
and Casys runtime images. It does not vendor those images into the source repository and
does not assert that one repository licence replaces the licences of PostgreSQL, SysON,
build123d, CalculiX, Gmsh or their transitive operating-system packages.

The review therefore establishes only this boundary:

- the pack manifest may identify and reuse the exact runtime images;
- the dedicated `mcp-syson@0.8.3` image publishes an SPDX SBOM and SLSA provenance for
  its exact OCI index; those supply-chain records do not replace licence review;
- the dedicated `mcp-build123d@0.6.1` image likewise has release SBOM/provenance for
  its exact OCI index; those records do not replace licence review;
- source publication does not imply image redistribution clearance;
- production or bundled distribution still requires image-level SBOM, notices and
  licence review for the exact digests;
- changing any runtime digest invalidates this review input.

This is sufficient for a `productionEligible: false` local candidate. It is not legal
advice, a production qualification or a blanket redistribution approval.
