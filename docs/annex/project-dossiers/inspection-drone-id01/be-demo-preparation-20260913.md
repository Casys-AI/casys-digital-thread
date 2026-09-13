# ID01 — préparation de la démo BE de bout en bout

Audience: both · Diátaxis: none · Kind: dated preparation dossier

Le cas principal est le drone civil non armé `inspection-drone-id01`. Le but est de
relier le brief approuvé à des réponses explicites, aux preuves de leur domaine
applicable et à un chiffrage sourcé. Ce dossier prépare ce parcours ; il ne déclare ni
une offre terminée ni un drone qualifié.

## Base de travail

- Project r892 : `inspection-drone-id01:project:r892:5d6ef81cf812c6f1`.
- Brief approuvé r7 : `inspection-drone-id01:brief:r7:22fb5d1b598dbd41`, 40 éléments. La
  proposition r8 reste distincte du brief approuvé.
- Thread r119 :
  `project:inspection-drone-id01:r119:industrialize-run-dfm-checks-run:id01-yolo-queue-dfm-r118-authority-retry-jit-20260912`.

Le brief numérique exclut le vol réel, les achats et la fabrication physique.
L'autorisation ultérieure de préparer puis créer des articles ERP de démo ne sélectionne
aucun composant du drone et n'autorise aucune commande d'achat.

## Livrables préparatoires

[La matrice de réponse au brief](brief-response-preparation-20260913.md) reprend les 40
éléments, leurs réponses proposées, leur portée, les références exactes et les actions
manquantes. Les énoncés approuvés restent mot pour mot dans
[le JSON compagnon](brief-response-preparation-20260913.json). Une réponse documentaire
à un contexte ou une exclusion n'est pas un verdict de calcul.

[Le paquet Buy](buy-preparation/README.md) reconstruit les 19 PartDefinitions et les
usages à partir des captures d'architecture courantes. Les propositions de quantités
issues des placements restent proposées. Il prépare cinq articles `DEMO-ID01-…` et deux
prix catalogue publics datés ; trois articles restent sans prix exploitable. Aucune BOM
choisie ni aucun devis fournisseur n'est inventé.

[Le catalogue d'entrée](buy-preparation/erp-demo-catalogue.json) est accepté par le
planner offline du
[dépôt propriétaire ERPNext](https://github.com/Casys-AI/mcp-erpnext/pull/45). Il
produit huit appels proposés : une Price List, cinq Items et deux Item Prices, avec les
UOM et le groupe d'articles requis. Le plan conserve le manifeste des sources. Son
acceptation offline ne prouve aucune création de document ERP.

[L'import local autorisé](erp-local-import-20260913.md) est maintenant exécuté : cinq
articles et deux Item Prices ont été créés et relus sur le port 8080, avec la liste et
le groupe dédiés. Les trois articles sans prix restent sans Item Price. Ce reçu reste
documentaire et ne qualifie pas le binding ERP ni un coût Buy.

[La feuille de production](buy-preparation/production-estimate-worksheet.md) sépare
matière, temps machine, énergie et main-d'œuvre. Les entrées manquantes et les sorties
restent `unresolved`. Le prix d'une bobine ne devient pas le coût d'une pièce. Les bancs
FEA en 6082-T6 théorique ne valident pas une pièce PETG.

## Lecture de l'état des preuves

L'index `project-response/1.0` est disponible en lecture MCP et dans la projection
GET/SSE Workbench. Sur cette base, une correspondance native du banc RadialArm vient du
brief r4 et reste `historical`. Les 39 autres éléments n'ont pas de correspondance
exacte de requirement dans cet index. Cela ne signifie pas que 39 nouveaux calculs sont
requis : contexte, exclusions et décisions réclament souvent une réponse documentaire,
tandis que les exigences techniques réclament une preuve applicable. Le TRACE GAP caméra
reste explicite.

La DFM mesurée couvre son cas caméra et son STEP exact. Elle ne couvre ni toutes les
pièces candidates ni la fabrication du drone complet. Les observations FDM de
printabilité et de temps/matière ne sont pas encore jouées sur ID01.

## Suite mesurable

1. Import catalogue effectué et relu ; conserver les vrais `name` et `modified` du
   [reçu daté](erp-local-import-20260913.md).
2. Préparer et qualifier le binding de ce site par le parcours serveur existant. Tant
   que le binding n'est pas qualifié, aucun Buy ID01 n'est exécuté.
3. Fermer les choix de configuration, occurrences et quantités qui demandent une
   décision humaine, puis capturer et sceller un Buy par les revues/MRTR existantes.
4. Compléter la couverture technique et manufacturière effectivement requise, les coûts
   de production et les réponses documentaires persistées.
5. Assembler le dossier et relever les durées réelles du parcours.

Deux trous d'implémentation sont suivis séparément :
[estimations monétaires de production](https://github.com/Casys-AI/casys-digital-thread/issues/35)
et
[réponses documentaires persistées par élément du brief](https://github.com/Casys-AI/casys-digital-thread/issues/36).
Leur création ne les résout pas.

[Objectif et critères](../../../explanations/product/be-project-response-goal.md) ·
[parcours de préparation](../../../how-to/prepare-project-response.md) ·
[contrat Buy](../../../reference/domains/buy/README.md).
