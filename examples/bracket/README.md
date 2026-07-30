# The bracket — one part, the whole thread

A mounting bracket (Al 6061), walked through every link with real, reproducible numbers.

## 1. Requirements (SysML v2, in SysON)

```sysml
part bracket {
    attribute totalMass;
    constraint massBudget { totalMass <= 0.070 [kg] }
}
requirement holdLoad {
    doc /* Under 500 N vertical service load, stress stays below Al 6061 yield with SF 1.5 */
    // maxStress <= 160 [MPa]   (240 MPa yield / 1.5)
}
```

## 2. Geometry — `build123d_execute` on [bracket.py](bracket.py)

With `density_kg_m3: 2700` (explicit — mass is never guessed from a name):

| metric | value |
|---|---|
| volume | 21 079.9 mm³ |
| **mass** | **56.92 g** |
| centre of mass | (−12.43, 0.00, 11.51) mm |
| bbox | 60 × 40 × 52 mm |

Then `build123d_export` writes `/exports/bracket.step`.

## 3. Physics — `calculix_solve_static` on [solve-case.json](solve-case.json)

Base fixed, 500 N downward on the wing top (mesh 3 mm, C3D10):

| result | value |
|---|---|
| max displacement | 0.043 mm |
| **max von Mises** | **26.6 MPa** |

## 4. Verdict — `syson_constraint_evaluate`, units included

| constraint | computed | limit | status | margin |
|---|---|---|---|---|
| massBudget | 56.92 g | 70 g | **pass** | 13.1 g (18.7 %) |
| holdLoad | 26.6 MPa | 160 MPa | **pass** | 133.4 MPa (83 %) |

And the question no evaluation can answer — are the requirements even mutually satisfiable? — goes to `syson_constraint_solve` (z3): `sat`, with admissible ranges. Had someone written `totalMass <= 0.05 [lb]` by mistake, the kg/lb conversion makes it **fail** honestly instead of passing on bare numbers.

Every number above is reproducible from this folder with the three MCP servers of `.mcp.json`.
