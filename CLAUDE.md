# Casys Digital Thread — contexte projet

Ce repo est **l'atelier** de la chaîne « executable digital thread » : exigence → modèle SysML v2 → géométrie → physique → preuve. Les serveurs MCP vivent dans leurs propres repos et s'exécutent depuis l'image `ghcr.io/casys-ai/engineering-toolchain` — on ne clone ici aucune source de serveur. Pour éditer un serveur, cloner SON repo (`Casys-AI/mcp-syson`, `mcp-build123d`, `mcp-calculix`, `constraint-solver`).

## Les outils de la chaîne (via .mcp.json)

- `syson_*` — modèle SysML v2 (31 tools) : projets, éléments, AQL, contraintes (`syson_constraint_validate`, `syson_constraint_solve` — z3), structure produit (`syson_part_structure`), valeurs. Nécessite SysON sur `localhost:8180` (`docker compose up -d syson-db syson-app`).
- `build123d_execute` / `build123d_export` — CAD as code (Python/OCCT) : le script assigne `result`, masse **uniquement** si `density_kg_m3` explicite. Exports STEP/STL/GLB dans le volume partagé `/exports`.
- `calculix_solve_static` — FEA : STEP → maillage Gmsh (faces désignées par bounding boxes nommées, mm) → statique linéaire → déplacement max + von Mises max. Tout le physique est explicite (mesh_size_mm, e_mpa, nu, forces totales). Unités fixes : mm, N, MPa.

Composition type : `build123d_export` écrit `/exports/piece.step` → `calculix_solve_static` le lit au même chemin → le résultat (masse, contrainte) se vérifie contre le modèle via `syson_constraint_evaluate` avec valeurs unitées (`{"value": 0.0569, "unit": "kg"}`).

## Principes non négociables (hérités des règles AgentCards)

- **Le calcul est l'oracle, pas le produit** : aucune intelligence dans la couche outil — jamais d'outil MCP adossé à un LLM.
- **No hidden heuristics** : pas de valeur inventée, pas de défaut qui ressemble à une donnée. Une masse sans densité n'existe pas ; une multiplicité illisible est un défaut SysML *labellisé*.
- **Les unités sont des valeurs** : 2,5 kg contre un budget de 4 lb → `fail`. Comparer dimensionné/adimensionné est une erreur, jamais une comparaison de nombres nus.
- **Fail-fast** : `unresolved`/`error` sont des états de première classe ; « je ne sais pas » ne devient jamais « satisfait ».
- **Test de l'équivalent AQL** avant tout nouvel outil : si l'agent peut le faire en une expression avec les primitives existantes, l'outil est un raccourci qui n'en est pas un.

## État et prochaine étape

Chaîne complète publiée le 2026-07-30 (voir `docs/positioning.md` pour le SOTA). **Le chantier décisif est `experiments/oracle/`** : mesurer le taux de correction de l'agent modeleur avec et sans oracle — le benchmark Hephaestus-CCX (50 cas, kits CalculiX, arXiv 2605.17448) fournit un protocole tout prêt. C'est ce qui fait passer le projet du niveau « ancré, vérifié » au niveau « boucle fermée » de l'échelle de maturité neurosymbolique.
