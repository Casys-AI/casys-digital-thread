# Casys Digital Thread — contexte projet

Ce repo est **l'atelier** de la chaîne « executable digital thread » : exigence
→ modèle SysML v2 → géométrie → physique → preuve. Les serveurs MCP d'ingénierie
vivent dans leurs propres repos et s'exécutent depuis des images publiées :
`engineering-toolchain` pour SysON/CAD/CalculiX, et `mcp-modelica` pour
OpenModelica + MSL. On ne clone ici aucune source de ces serveurs. Ce repo
contient en revanche la source de la Console MCP read-only, du workflow lié et
du Workbench natif (`server.ts`, `src/`). Pour éditer un serveur d'ingénierie,
cloner son repo (`Casys-AI/mcp-syson`, `mcp-build123d`, `mcp-calculix`,
`mcp-modelica`, `constraint-solver`).

## Les outils de la chaîne (MCP stateless)

Les serveurs exposent `/mcp` avec le protocole stateless `2026-07-28`. Démarrer
les services requis avec Compose ; ce repo n'embarque plus de configuration
stdio ni de chemin de compatibilité legacy.

- `syson_*` — modèle SysML v2 (31 tools) : projets, éléments, AQL, contraintes
  (`syson_constraint_validate`, `syson_constraint_solve` — z3), structure
  produit (`syson_part_structure`), valeurs. Nécessite SysON sur
  `localhost:8180` (`docker compose up -d syson-db syson-app`).
- `build123d_execute` / `build123d_export` — CAD as code (Python/OCCT) : le
  script assigne `result`, masse **uniquement** si `density_kg_m3` explicite.
  Exports STEP/STL/GLB dans le volume partagé `/exports`.
- `calculix_solve_static` — FEA : STEP → maillage Gmsh (faces désignées par
  bounding boxes nommées, mm) → statique linéaire → déplacement max + von Mises
  max. Tout le physique est explicite (mesh_size_mm, e_mpa, nu, forces totales).
  Unités fixes : mm, N, MPa.
- `modelica_kit_list` / `modelica_simulate` / `modelica_run_list` /
  `modelica_run_get` — simulation système OpenModelica de kits approuvés :
  température, temps, énergie et puissance. Le cockpit découvre les records via
  les deux outils de lecture, jamais via le volume Docker. Une simulation
  réussie produit des observations et artefacts hashés ; le verdict reste du
  ressort de SysON + `constraint-solver`.
- `erpnext_*` — chiffrage et manufacturing : un bridge provider-native sur
  `3012`. Le backend appelle seulement les tools revus par le workflow ; le
  navigateur ne reçoit ni credentials ERP ni autorité MCP générique.
- `console_*` — cockpit read-only : état désiré/observé des MCP, dérive, runs et
  preuves hashées. `console_refresh` est app-only ; aucun outil de cycle de vie
  n'est exposé.

Composition type : `build123d_export` écrit et hashe `/exports/piece.step` →
`calculix_solve_static` snapshotte l'entrée et atteste le même SHA-256 → le
résultat (masse, contrainte) se vérifie contre le modèle via
`syson_constraint_evaluate` avec valeurs unitées
(`{"value": 0.0569, "unit": "kg"}`). Les runs Modelica restent dans leur volume
dédié `/runs` : ils ne partagent ni export CAD ni socket Docker.

Le seul verdict CoffeeMachine actuellement branché au cockpit est le contrat de
scénario provisoire `config/verification-plans/coffee-machine-nominal-v1.json` :
`water_temperature_max >= 90 degC`, appelé en lecture seule via
`syson_constraint_evaluate` et lié aux hashes modèle/scénario. Ce n'est pas une
exigence produit/SysON ; les 900 s sont seulement la provenance du scénario.

Le produit est un Workbench Preact natif sur un `ThreadSnapshot` lié. Le backend
compose les données par un DAG explicite sous `config/thread-workflows/`; la
YAML ne décrit ni layout ni composant. Ouvrir la page ne lance aucun solver. Les
MCP Apps restent des réponses riches unitaires pour les agents, jamais des
panneaux du produit. Ports, contrats et frontières exacts :
`docs/reference/workspace-map.md`.

## Principes non négociables (hérités des règles AgentCards)

- **Le calcul est l'oracle, pas le produit** : aucune intelligence dans la
  couche outil — jamais d'outil MCP adossé à un LLM.
- **No hidden heuristics** : pas de valeur inventée, pas de défaut qui ressemble
  à une donnée. Une masse sans densité n'existe pas ; une multiplicité illisible
  est un défaut SysML _labellisé_.
- **Les unités sont des valeurs** : 2,5 kg contre un budget de 4 lb → `fail`.
  Comparer dimensionné/adimensionné est une erreur, jamais une comparaison de
  nombres nus.
- **Fail-fast** : `unresolved`/`error` sont des états de première classe ; « je
  ne sais pas » ne devient jamais « satisfait ».
- **Test de l'équivalent AQL** avant tout nouvel outil : si l'agent peut le
  faire en une expression avec les primitives existantes, l'outil est un
  raccourci qui n'en est pas un.
- **Desired ≠ observed** : le manifeste ne prouve jamais qu'un service tourne.
  Les sondes MCP/Docker restent la vérité d'exécution, y compris lorsqu'elles
  répondent `unavailable`.
- **Demo ≠ live** : le run bracket est une preuve de démonstration hashée. Son
  FEA `26.6 MPa` est un résultat documenté, jamais présenté comme un solve
  fraîchement exécuté.

## État et prochaine étape

Chaîne complète publiée le 2026-07-30 (voir `docs/positioning.md` pour le SOTA).
**Le chantier décisif est `experiments/oracle/`** : mesurer le taux de
correction de l'agent modeleur avec et sans oracle — le benchmark Hephaestus-CCX
(50 cas, kits CalculiX, arXiv 2605.17448) fournit un protocole tout prêt. C'est
ce qui fait passer le projet du niveau « ancré, vérifié » au niveau « boucle
fermée » de l'échelle de maturité neurosymbolique.
