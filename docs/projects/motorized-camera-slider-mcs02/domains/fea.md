# MCS-02 — FEA

Part-level static linear-isotropic proof on the exact r7 RailFrame STEP. The
resource-backed proof source was sealed at r10 and executed only through
`verify.run-fea-static-proof@3` at r11.

Gmsh 4.12.1 produced 4,267 nodes and 16,137 elements; CalculiX 2.21 exited 0. The
server-owned evaluation recorded:

- maximum displacement `0.3645119986 mm <= 1 mm`;
- maximum von Mises stress `3.486239191 MPa <= 55 MPa`.

Mechanical L5 was accepted at r12. The proof is limited to the sealed cantilever-like
RailFrame case, declared 19.62 N load and EN AW-6063 T5 linear-elastic properties. It
does not cover joints, contacts, carriage, buckling, fatigue, thermal stress, assembly
loads, safety or certification.
