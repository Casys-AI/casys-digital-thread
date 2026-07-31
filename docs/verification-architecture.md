# Explanation: architecture de vérification — décision CoffeeMachine

**Statut : accepté — 2026-07-30**

Cette décision fixe les responsabilités de calcul de la chaîne et le premier cas
multi-physique, `CoffeeMachine`.

Cette page explique les frontières choisies. Pour exécuter et lire le premier run réel,
suivre le [tutoriel CoffeeMachine](tutorials/coffee-machine-nominal.md). Pour les
chemins, hashes, ports et contrats exacts, consulter la
[référence de l'espace de travail](reference/workspace-map.md).

## Décision

**OpenModelica est le backend système multi-physique de Casys.** Le premier modèle
CoffeeMachine sera un modèle Modelica à paramètres explicites, avec un modèle concentré
de chaudière au départ. Il pourra ensuite coupler thermique, hydraulique, électrique et
commande sans changer de frontière logicielle.

Nous ne réécrivons pas un solveur physique en TypeScript. Le code Casys porte le modèle,
ses paramètres, son adaptation MCP et ses preuves ; OpenModelica intègre et résout les
équations.

Cette reprise est intentionnelle : le choix historique était déjà « Modelica via OMC
Docker ». Le `lib/sim` historique n'était pas ce backend : c'était un évaluateur
TypeScript de contraintes SysML, désormais retiré et remplacé par
`@casys/constraint-solver` et les outils de contraintes de `mcp-syson`.

## Frontières retenues

```text
SysML requirements ─────────────── mcp-syson
          │                              │
          │                 @casys/constraint-solver
          │                              ▲
          ▼                              │
 CoffeeMachine kit ── mcp-modelica ──────┘
                           │
                           └── thermique, fluide, électrique, commande

 Geometry / H-CCX kit ── mcp-calculix ───► preuve mécanique
```

| Élément                    | Responsabilité                                                            | Ne fait pas                            |
| -------------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| `mcp-syson`                | modèle SysML, exigences, traçabilité, évaluation finale exposée à l'agent | calculer la physique                   |
| `@casys/constraint-solver` | unités, marges, `pass` / `fail` / `unresolved`, satisfiabilité            | estimer une température ou un courant  |
| `mcp-calculix`             | FEA mécanique : STEP → Gmsh → CalculiX                                    | thermique, hydraulique ou électronique |
| `mcp-modelica`             | simulation système multi-physique et séries temporelles                   | FEA 3D de contrainte locale            |
| `mcp-compose` / console    | composer et afficher les vues et les preuves                              | être propriétaire d'un calcul          |

Au premier incrément, `mcp-modelica` retourne directement des observations unitées, les
hypothèses, et les hashes de ses artefacts CSV/JSON. `mcp-syson` et
`@casys/constraint-solver` les comparent ensuite aux exigences. Un contrat partagé de
preuves ne sera extrait dans une bibliothèque que lorsqu'au moins deux producteurs en
auront réellement besoin ; nous ne créons pas cette abstraction maintenant.

Le cockpit applique déjà ce chemin à un **contrat de scénario provisoire** versionné
(`coffee-machine-nominal-v1`) : le seul test est la cible `90 degC` déclarée par le
scénario, avec binding exact sur les hashes modèle/scénario et appel live de
`syson_constraint_evaluate`. Ce contrat prouve le câblage des observations, unités et
marges ; il n'est ni une exigence produit ni une exigence déposée dans un projet SysON.
L'horizon de simulation (`900 s`) reste de la provenance de scénario, pas une limite de
performance inventée.

## CoffeeMachine v1

Le premier modèle Modelica reste volontairement simple et traçable : chaudière et eau
comme capacités thermiques, pertes explicites, résistance chauffante, commande
thermostat/hystérésis et, lorsqu'ils sont spécifiés, pompe et débit. Il produit une
courbe de température, puissance, énergie et états de commande. Ces observations, avec
leurs unités et paramètres, sont ensuite évaluées contre les exigences SysML.

Une exigence de pression, de débit ou d'extraction sans modèle paramétré et calibré
reste **`unresolved`**. Elle ne reçoit jamais un verdict artificiel. Une pièce qui exige
une preuve de tenue mécanique ajoute une preuve `mcp-calculix`; H-CCX reste un
kit/adaptateur structurel, pas le vérificateur global de CoffeeMachine.

## Déploiement choisi

`mcp-modelica` est un serveur indépendant, dans une image sidecar dérivée et verrouillée
par digest de `openmodelica/openmodelica:v1.27.0-minimal`, avec la version de la
Modelica Standard Library intégrée à l'image. Il n'entre pas dans l'image
`engineering-toolchain` actuelle : il a son propre cycle de release, ses artefacts et
son budget disque.

L'image publiée est un index OCI multi-architecture, `linux/arm64` natif sur le Mac et
`linux/amd64` en CI ou en production. Le fleet et Compose la référencent par son digest,
avec un volume `/runs` dédié et sans partage d'exports CAD. Les modèles, paramètres,
résultats CSV/JSON et tolérances de test sont versionnés, afin que l'architecture ne
change pas le sens de la preuve.

## Ce que nous ne créons pas

- Pas de `mcp-sim` : ce nom renverrait au moteur de contraintes retiré.
- Pas de `mcp-thermal` ni de `mcp-electronics` : ils couperaient un modèle système qui
  doit précisément pouvoir coupler chaleur, eau, puissance et commande.
- Pas de `mcp-verification` : il ne deviendra utile que si l'orchestration des preuves
  doit devenir un service autonome avec jobs, sandbox et stockage.
- Pas de `@casys/verification-core` au premier cas : les observations de Modelica sont
  déjà un format de preuve suffisant pour les outils de contraintes existants.
- Pas de `mcp-circuit` au premier cas. Il sera créé seulement lorsqu'un netlist, des
  modèles de composants versionnés et une exigence de circuit (inrush, PWM, transitoire,
  régulateur, etc.) imposeront SPICE au-delà du modèle système.

## Promotion et mise en oeuvre

1. Construire le kit CoffeeMachine et son premier modèle Modelica, avec un scénario
   nominal versionné et des sorties CSV/JSON hashées.
2. Construire `mcp-modelica`, puis faire évaluer ses observations par les outils de
   contraintes existants : fait pour le contrat de scénario provisoire ; les vraies
   exigences attendent encore leur modèle SysON et leurs limites métier.
3. L'ajouter au fleet/Compose après un run réel reproductible : fait ; l'image exacte
   est référencée par digest dans la topologie, sans figer cette décision à un numéro de
   release historique.
4. Extraire un contrat de preuve partagé seulement lorsqu'un second producteur impose
   réellement le même format durable.

Références :
[décision historique lib/sim / Modelica](https://github.com/Casys-AI/casys-pml/blob/ba8b9272fa2bbddcfddec18b74e87f8f8f2c33c6/_bmad-output/implementation-artifacts/tech-specs/2026-02-15-tech-spec-mbe-plm-libraries.md#L1270-L1288),
[retrait du moteur de contraintes historique](https://github.com/Casys-AI/mcp-syson/blob/main/CHANGELOG.md#L25-L39),
[OpenModelica Docker](https://openmodelica.org/download/docker/),
[Modelica Standard Library 4.1.0](https://github.com/modelica/ModelicaStandardLibrary/tree/v4.1.0).
