Audience: agent · Diataxis: none · Kind: RFC Status: active Parent:
[ngspice LED-driver vertical](README.md)

# RFC: première verticale électrique ngspice — driver LED de lampe articulée

Backlog exécutable pour un agent de code rapide. Il ouvre une seule verticale Behave
électrique de démonstration : la question bornée du **driver LED** de la lampe
articulée. Il ne crée ni une bibliothèque SPICE générale, ni une promesse de conformité
électronique, ni un parcours de conception de circuit.

Le travail peut être parallélisé par commits indépendants lorsque les dépendances ci-
dessous sont satisfaites. Les numéros `E01…` sont des lots atomiques, pas des jours. Un
lot qui ne peut pas établir son prérequis s'arrête avec son état littéral
(`unavailable`, `unresolved`, `error`, `TRACE GAP` ou `UNLINKED`) ; il ne simule pas le
succès avec une fixture ou un provider de remplacement.

## 1. Résultat visé et frontière

La verticale doit permettre, pour **une révision exacte** de la lampe :

```text
question LED bornée
  -> fiche humaine et méthode revue
  -> circuit fermé attesté + cas électrique scellé
  -> MRTR distinct de l'exécution
  -> ROP2 à une action, outils mcp-spice fixés par le serveur
  -> OP et/ou transient réduit ngspice, capturés et relus
  -> observations V / A / W / s
  -> évaluation L4 sur critères nommés
  -> décision humaine L5 avec portée et limites
```

La question produit est volontairement abstraite, pour ne pas inventer de donnée :

> Pour le circuit de commande LED fermé et la condition d'alimentation explicitement
> revue de cette révision de lampe, les grandeurs électriques nommées et, lorsque
> demandé, leur comportement transitoire réduit respectent-ils les critères déclarés ?

Une fiche humaine ou une source attribuée doit fournir le circuit, les composants et
modèles, la condition d'alimentation, les mesures/critères et la conséquence envisagée.
L'agent peut capturer et analyser cette fiche ; il ne peut pas compléter ses blancs,
choisir une LED, un transistor, une alimentation, une température, un pas de temps, une
durée, une tolérance ou un seuil.

### Livrable L5, et ce qu'il ne signifie pas

Le L5 final est seulement : « une personne responsable accepte/rejette la conséquence
énoncée de cette évaluation du driver LED, pour cette révision et ces limites ». Ce
n'est pas la conformité électrique de la lampe, sa sécurité, son échauffement, sa CEM,
sa fabricabilité, la durée de vie de la LED, ni une décision sur une révision suivante.

`pass` est L4, jamais L5. Une nouvelle source de circuit, fiche, exigence ou révision
canonique de lampe ne réutilise pas silencieusement un run précédent.

## 2. Autorité à conserver

| Rôle                                | Peut faire                                                                                                                                              | Ne peut pas faire                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Agent                               | Proposer une opération enregistrée, capturer une source, demander/rejouer une revue, mettre en queue puis exécuter le run exact                         | Choisir `mcp-spice`, un outil, une enveloppe MCP, un chemin, des options ngspice, des chiffres, ou s'auto-approuver            |
| Humain                              | Fournir/attester la fiche, choisir la conséquence, signer les MRTR de seal, de run et de décision                                                       | Écrire une commande ngspice ou un `.control` pour rendre le système exécutable                                                 |
| Serveur                             | Valider les grammars fermées, sélectionner OP/transient et les outils fixes, rendre/valider le netlist, WAL, capture, replay, projection d'observations | Accepter `latest`, alias mutable, netlist libre après seal, options appelant, ou une deuxième exécution après résultat inconnu |
| ngspice via `mcp-spice`             | Exécuter une analyse bornée et retourner des faits                                                                                                      | Produire un verdict, une approbation, une exigence ou une décision                                                             |
| SysON ou évaluateur simple qualifié | Comparer les observations exactes aux critères revus                                                                                                    | Modifier le circuit, le cas, les observations ou déclencher un solve                                                           |
| Workbench                           | Projeter les révisions, captures, évaluations et décisions en lecture seule                                                                             | Recevoir une commande, une autorité MCP ou des credentials provider                                                            |

`mcp-spice` est un **moteur**, pas un oracle. Le manifest de flotte le décrit seulement
comme état désiré : serveur optionnel, image épinglée, outils attendus
`spice_simulate_op` et `spice_simulate_tran`, netlists circuit-only (les blocs
`.control`, `.include`, `.lib` et shell sont refusés) et statistiques transitoires
réduites. Ni cette déclaration ni un conteneur sain ne prouvent que le provider est
disponible ou que son schéma suffit à la verticale.

## 3. Décisions bloquantes avant code d'exécution

### D1 — représentation du circuit : arbitrage humain requis

Avant `E04`, obtenir et enregistrer une décision de conception. Deux choix seulement :

| Choix | Contrat                                                                                                                        | Avantage                                                                           | Coût / risque                                                                                  | Décision recommandée                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A     | `electrical-proof-case/1.0` contient un IR topologique fermé ; le serveur rend le netlist circuit-only de manière déterministe | L'agent n'écrit jamais de SPICE libre ; les nœuds/branches/mesures sont validables | Il faut définir, maintenir et tester un petit grammar/renderer                                 | **Oui, si la fiche source permet de l'exprimer sans perte**                 |
| B     | La fiche fournit un netlist circuit-only ; le système capture, re-hashe et atteste les octets sans les régénérer               | Plus court pour une démo ayant déjà un netlist revu                                | Un netlist opaque ne donne aucune permission à l'agent de le corriger ni d'ajouter des modèles | Seulement si A ne peut pas représenter la fiche sans une extension générale |

Ne pas implémenter A et B en parallèle. Le choix signé devient une constante de la V1,
est inclus dans le method qualification, le seal et le ROP. Un futur import de netlist,
un éditeur de schéma, un parser SPICE général ou une conversion entre A et B est hors
lot.

Si la fiche ne fournit pas un circuit identifié, une provenance de modèles et une
condition de test compréhensible, la réponse est `unresolved` et le backlog s'arrête
avant toute opération de seal. Une photo, une nomenclature partielle ou une intention «
éclairer la LED » n'est pas un circuit exécutable.

### D2 — contrat provider : préflight technique requis

Avant `E08`, un mainteneur doit confirmer, à partir du contrat de l'image épinglée et,
si elle est disponible, d'une sonde non mutante :

- les schémas réels de `spice_simulate_op` et `spice_simulate_tran` ;
- l'identité/version retournée par le provider et la possibilité de la capturer ;
- ce que chaque réponse retourne exactement (statuts, valeurs, unités, identifiants,
  erreurs) ;
- si le transient réduit peut fournir le temps/événement nécessaire à une observation en
  `s`, sans exporter la série complète ;
- les garanties de rejet du texte interdit et les limites de taille/durée ;
- si une réponse MCP complète peut être capturée et relue comme preuve exacte.

La flotte peut être absente. Dans ce cas, implémenter au plus les validateurs purs et
tests à fake strictement contractuel ; ne pas enregistrer l'opération exécutable, ne pas
déclarer la qualification et marquer l'intégration provider `unavailable`.

**Stop immédiat :** les seuls noms d'outils dans `config/mcp-fleet.json` ne suffisent
pas à écrire l'adapter. Sans contrat versionné ou sonde dont la réponse est conservée,
ne pas deviner les champs MCP.

### D3 — méthode et évaluateur : arbitrage humain requis

Avant le premier L4, l'humain approuve séparément : la portée de la fiche, les
hypothèses, les mesures, les critères, la sémantique de signe des puissances et la
conséquence du résultat. Le choix d'évaluateur est fermé :

1. **SysON** si chaque critère est un attribut/contrainte relu et que son unité est
   admise ; ou
2. un **simple évaluateur déterministe qualifié** exclusivement pour les comparaisons
   qu'il formalise, capturant critères, preuves et résultat.

SysON est le chemin préféré pour `V`, `A`, `W` et `s`, unités déjà admises. Le simple
évaluateur ne devient pas un raccourci pour contourner une exigence SysON non relue. Son
adoption exige une justification explicite et un contrat d'évaluation capturé.

`dB`, gain, marge de phase, impédance complexe, rapport sans dimension, rendement,
facteur de puissance, bruit, AC sweep et phase sont hors V1. L'unité dimensionless `1`
est explicitement refusée par le contrat d'oracle actuel ; aucune conversion locale ne
doit maquiller ce refus.
