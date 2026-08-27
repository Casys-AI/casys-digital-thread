# Explanation: oracle market study — raw output (2026-08-05)

Audience: both · Diátaxis: explanation · Kind: dated-study

This page is dated research (2026-08-05), not a product contract.

> Provenance: this is the preserved raw output of the multi-agent web study that
> produced the conclusions in [oracle-coverage-roadmap](verification-coverage-roadmap.md).
> Figures are estimates from public signals (Printables category volumes, forums,
> simulation-service tiers) gathered on 2026-08-05 — evidence of demand patterns, not
> measurements. Kept verbatim so the roadmap's numbers stay auditable; the roadmap page
> remains the page the strategy acts on.

---

## Agent output 1

{ "findings": [ { "fact": "SimScale (Community/gratuit) : 10 simulations puis résultats
qualitatifs seulement. Types inclus : statique linéaire, fréquentiel/modal, transfert
thermique, thermoméanique, CFD incompressible, CHT. Nonlinéaire (Marc) et Physics AI
réservés aux plans payants.", "source": "https://www.simscale.com/product/pricing/" }, {
"fact": "Fusion 360 : l'analyse statique linéaire est incluse dans TOUS les abonnements
(y compris gratuit hobbyiste). Tout le reste (nonlinéaire, buckling, thermique, modal,
injection molding, électronique cooling, event simulation) nécessite l'extension
Simulation à $85/mois.", "source":
"https://www.autodesk.com/products/fusion-360/simulation-extension" }, { "fact":
"SolidWorks SimulationXpress (bundlé gratuit dans toutes les versions SW) : uniquement
statique linéaire sur pièces seules. 3 sorties : contrainte, déplacement, facteur de
sécurité. Zéro assemblage, zéro fatigue, zéro modal, zéro thermique.", "source":
"https://help.solidworks.com/2025/english/SolidWorks/cosmosxpresshelp/c_overview_of_solidworks_simulationxpress.htm"
}, { "fact": "Onshape (intégré à l'abonnement) : statique linéaire + analyse modale sur
assemblages. Pas de thermique ni de CFD. Partenariat avec SimScale pour l'avancé.",
"source": "https://www.onshape.com/en/features/simulation" }, { "fact": "Protolabs,
Fictiv, Xometry, JLC3DP : DFM automatique gratuit à l'upload. Contrôles couverts :
épaisseur de paroi, angles de dépouille, contre-dépouilles, diamètre minimal de trou,
lignes de joint, emplacements gate/éjecteur. Ce n'est PAS de la vérification
structurelle.", "source":
"https://www.protolabs.com/resources/design-tips/navigating-protoquote/" }, { "fact":
"DFM Studio : 100+ règles CNC sur upload STEP, retour instantané, rapport PDF. Idem pour
injection molding en cours de développement.", "source": "https://www.dfmanalysis.com/"
}, { "fact": "Au moins 6 calculateurs snap-fit dédiés et indépendants (Fictiv, ETS Inc,
3DDFM, RD8, Engineers Edge, SABIC, StudioRed). Le calculateur Fictiv calcule :
déformation au pied, facteur de sécurité vs limite élastique, force d'insertion,
recommandation PASS/FAIL automatique.", "source":
"https://www.fictiv.com/tools/snap-fit-calculator" }, { "fact": "Calculateurs
poutre/déflexion/contrainte : Engineers Edge, SkyCiv (free beam calculator),
Omnicalculator — parmi les ressources les plus consultées en ingénierie mécanique en
ligne. Couvrent : SFD, BMD, déflexion, contrainte sur géométries standard (poutres
simples, cantilever).", "source": "https://skyciv.com/free-beam-calculator/" }, {
"fact": "3DPrintCalcs.uk propose des calculateurs gratuits spécialisés pour le maker :
engrenages droits, snap-fit cantilever, ressorts hélicoïdaux et à lames — preuve d'une
demande dans le segment impression 3D fonctionnelle.", "source":
"https://3dprintcalcs.uk/mechanical/" }, { "fact": "SimScale affirme explicitement dans
sa documentation que 'l'analyse statique est le type de FEA le plus courant et est
appropriée pour la plupart des problèmes de résistance, rigidité et contrainte où les
charges ne changent pas rapidement'.", "source":
"https://www.simscale.com/blog/faqs-about-structural-analysis-fea/" }, { "fact":
"r/functionalprint : 436 000 membres (communauté impression 3D fonctionnelle).
Thingiverse : 4M+ modèles, ~11% seulement sont effectivement imprimés. Catégories
fonctionnelles (brackets, outils, supports) arrivent en 2e position derrière
jouets/jeux.", "source": "https://thehiveindex.com/communities/r-functionalprint/" }, {
"fact": "Barrières SME à la simulation (littérature 2026) : contraintes budgétaires +
manque de main d'œuvre qualifiée + manque de connaissance marché. Les PME n'ont pas
accès aux outils professionnels mais ont besoin de vérifications quantitatives.",
"source":
"https://vocal.media/futurism/simulation-software-market-sme-accessibility-trends-low-code-no-code-simulation-platforms-and-market-forecast"
}, { "fact": "Analyse fatigue : outils analytiques S-N gratuits existent
(simulations4all, FIRGELLI) mais nettement moins nombreux que pour la statique. Gated
derrière les plans payants sur SimScale. Absent de tous les tiers de base CAO.",
"source": "https://simulations4all.com/simulations/fatigue-life-sn-curve" } ], "answer":
"## Étude B — Ce qui se vend déjà en vérification\n\n### 1. Services de simulation cloud
— lecture des tiers comme signal de demande\n\n**SimScale** est le baromètre le plus
lisible : ce qu'ils mettent dans le tier gratuit (Community), c'est ce qu'ils jugent
trop commun pour en faire un différenciateur.\n\n| Analyse | Gratuit SimScale | Fusion
360 base | Onshape base | SW SimXpress |\n|---|---|---|---|---|\n| Statique linéaire
(contrainte + déplacement + FoS) | ✓ | ✓ | ✓ | ✓ |\n| Modal / fréquentiel | ✓ |
Extension | ✓ | ✗ |\n| Transfert thermique | ✓ | Extension | ✗ | ✗ |\n| Thermoméanique |
✓ | Extension | ✗ | ✗ |\n| CFD | ✓ | ✗ | ✗ | ✗ |\n| Nonlinéaire | **Payant** | Extension
| ✗ | ✗ |\n| Fatigue | **Payant** | Extension | ✗ | ✗ |\n| Buckling | **Payant** |
Extension | ✗ | ✗ |\n| Injection molding sim | **Payant** | Extension | ✗ | ✗
|\n\n**Signal stratégique (observé) :** La statique linéaire est devenue une commodité
absolue — les quatre plateformes majeures la donnent gratuitement. Autodesk a jugé
qu'elle devait être dans chaque abonnement, y compris le tier hobbyiste gratuit.
SolidWorks la bundle dans la boîte de base de chaque licence depuis des
années.\n\n**Limites du gratuit (observé) :** SimScale plafonne à 10 simulations puis
les résultats deviennent qualitatifs uniquement (pas de chiffres). Fusion 360 gratuit
couvre la statique mais sans les cas non-linéaires qui importent pour les plastiques
(grande déformation, contact). Onshape built-in ne couvre ni la thermique ni le
CFD.\n\n**Ce qui est systématiquement payant (donc différenciateur perçu) :**
nonlinéaire, fatigue, buckling, simulation procédé (injection molding, électronique
cooling). SimScale ajoute aussi la confidentialité des projets comme
gate.\n\n---\n\n### 2. Simulation intégrée aux CAO grand public — choix
révélateurs\n\n**Fusion 360** a mis la statique linéaire dans le tier de base hobbyiste
et tout le reste derrière l'extension payante ($85/mois). La liste de l'extension est
révélatrice : nonlinéaire, buckling, **thermique**, **modal**, electronics cooling,
injection molding. Ce sont les analyses pour lesquelles les utilisateurs ont clairement
exprimé un besoin au-delà du simple \"est-ce que ça tient ?\".\n\n**SolidWorks
SimulationXpress** (bundlé gratuit dans toutes les versions SW) ne fait qu'un seul truc
: statique linéaire sur une pièce seule. Pas d'assemblage, pas de thermique, pas de
fatigue, pas de modal. Sorties fixes : contrainte Von Mises, déplacement, facteur de
sécurité. C'est exactement ce que le concepteur non-spécialiste demande en
premier.\n\n**Onshape** a fait un choix différent : il a inclus le **modal** en plus de
la statique. Signal : vérifier les fréquences propres (risque de résonance sur une pièce
mobile) est jugé assez courant pour être bundlé. Il a en revanche choisi de ne pas
inclure la thermique de base, renvoyant vers SimScale.\n\n**Inference (estimée) :**
L'ordre de priorité révélé par ces choix de produit est : (1) statique linéaire, (2)
modal/vibration, (3) thermique, (4) tout le reste.\n\n---\n\n### 3.
Générateurs/vérificateurs spécialisés — ceux qui ont trouvé leur marché\n\n**DFM
automatique à l'upload (observé) — c'est désormais du standard :**\nProtolabs, Fictiv,
Xometry, JLC3DP offrent tous un DFM gratuit immédiat à l'upload. Les contrôles couverts
: épaisseur de paroi, angles de dépouille, contre-dépouilles, diamètre de trou minimum,
overhangs. **Ce ne sont PAS des vérifications structurelles** — ce sont des
vérifications de faisabilité procédé. Le gap entre \"ça va se mouler\" et \"ça va
tenir\" n'est couvert par aucun de ces services.\n\n**Calculateurs snap-fit — segment
très actif :**\nAu moins 7 outils indépendants (Fictiv, ETS Inc, 3DDFM, RD8, Engineers
Edge, SABIC, StudioRed). Fictiv calcule : déformation au pied, hoop strain, FoS vs
élasticité, force d'insertion, verdict PASS/FAIL. SABIC (fabricant de matériaux
plastiques) a construit ses propres outils pour aider ses clients à concevoir des
snap-fits — signal fort que la demande existe à la frontière plastique +
assemblage.\n\n**Calculateurs poutre/déflexion — traffic énorme :**\nEngineers Edge,
SkyCiv (free beam calculator), Omnicalculator. Ces sites reçoivent des millions de
visites d'ingénieurs et de makers. SkyCiv a buildé une app mobile. Ces outils couvrent
les géométries standard (poutre simplement appuyée, cantilever, charge
distribuée/ponctuelle). Ils ne couvrent pas les géométries complexes ou les
assemblages.\n\n**3DPrintCalcs.uk — signal maker :**\nSite dédié au calcul pour le FDM :
engrenages droits, snap-fits, ressorts hélicoïdaux, ressorts à lames. L'existence même
d'un tel site montre une demande spécifique de la communauté impression 3D fonctionnelle
pour des outils analytiques accessibles.\n\n**Analyse fatigue — demande présente,
couverture faible :**\nDes outils gratuits de courbes S-N existent (simulations4all,
FIRGELLI) mais beaucoup moins nombreux que pour la statique. La fatigue reste un cas
avancé, gated chez SimScale, absent des CAO de base. Dans le segment maker/PME, la
demande est présente pour les pièces cycliques (clips, ressorts, mécanismes) mais pas
adressée.\n\n---\n\n### 4. Ce que les gens demandent et n'obtiennent pas\n\n**Signal
forum (Eng-Tips) :** De petits bureaux d'ingénierie (pression vessel, framework,
structural) cherchent activement des alternatives abordables à SolidWorks Simulation et
ANSYS. La discussion recommande CalculiX, Code Aster, Elmer — mais ces outils exigent
une expertise significative de setup. SimScale gratuit est cité mais la limite de 10
simulations et la perte de chiffres après quota est bloquante.\n\n**Pattern récurrent
(observé indirectement) :** La stratégie de survie sans FEA dans les PME est : (a)
overbuild par sécurité empirique, (b) utiliser les calculateurs analytiques pour les
géométries simples, (c) confier à un prestataire externe pour les cas critiques. Il n'y
a pas de solution \"upload ta pièce, obtiens une réponse quantitative vérifiée\" entre
le calculateur de poutre et le service à 500€.\n\n**Gap structurel identifié (estimé
mais cohérent avec toutes les sources) :**\n- DFM à l'upload = résolu par toutes les
plateformes, gratuitement\n- Calculateurs analytiques pour géométries standard = bien
couverts\n- FEA statique guidée (bon sens des BC, matériaux, interprétation) = absent du
marché accessible\n- Vérification croisée exigence ↔ résultat FEA avec traçabilité =
totalement absent\n\n---\n\n### Synthèse — Priorisation pour les oracles Casys\n\n**Ce
qui est le plus demandé, par fréquence décroissante (estimé par triangulation) :**\n\n1.
**Statique linéaire avec verdict clair** : \"est-ce que ma pièce tient ?\" avec FoS et
unités. C'est la demande n°1, universelle. Le marché la donne gratuitement mais le
setup + interprétation est la barrière réelle. L'oracle CalculiX de Casys est exactement
ici.\n\n2. **Snap-fit / assemblage plastique** : demande prouvée par 7+ outils
concurrents. Les outils existants sont analytiques (formules fermées), pas
géométrie-aware. Un oracle qui prend la géométrie réelle serait un saut.\n\n3.
**Thermique composant / dissipation** : inclus dans SimScale gratuit mais pas dans les
CAO. Forte demande chez les concepteurs d'électronique / boîtiers embarqués. Oracle
OpenModelica thermique pertinent ici.\n\n4. **DFM + structural combiné** : le marché
sépare les deux (DFM chez le fab, FEA chez le sim). Aucun acteur ne combine \"ça va se
mouler + ça va tenir\". C'est un gap réel.\n\n5. **Modal / vibration** : deuxième type
bundlé par Onshape. Demande émergente chez les concepteurs de pièces mécaniques en
mouvement. Non couvert par CalculiX statique seul.\n\n6. **Fatigue** : demande présente
mais segment plus petit dans le maker/PME initial. Outils existants analytiques (S-N),
pas liés à la géométrie. À adresser en deuxième vague.\n\n**Ce qui n'est pas prioritaire
pour le segment cible :**\n- CFD (SimScale le donne gratuit, barrière d'expertise trop
haute pour maker non-spécialiste)\n- Nonlinéaire (cas avancé, SimScale le gate à
raison)\n- Injection molding simulation complète (procédé très spécialisé)\n\n**Signal
fort pour la feuille de route :** Le calculateur statique linéaire est saturé en outils
gratuits — mais aucun ne produit un résultat haché, traçable, lié à une exigence signée.
C'est là que la garantie Casys se différencie de SimScale : pas le type d'analyse, mais
la chaîne de preuve.", "sources": [ "https://www.simscale.com/product/pricing/",
"https://www.simscale.com/docs/analysis-types/",
"https://www.simscale.com/blog/faqs-about-structural-analysis-fea/",
"https://www.autodesk.com/products/fusion-360/simulation-extension",
"https://www.autodesk.com/products/fusion-360/blog/fusion-subscription-types/",
"https://help.solidworks.com/2025/english/SolidWorks/cosmosxpresshelp/c_overview_of_solidworks_simulationxpress.htm",
"https://hawkridgesys.com/blog/solidworks-simulation-simulationxpress-enough",
"https://www.onshape.com/en/features/simulation",
"https://www.onshape.com/en/blog/fea-design-engineers-cad-integrated-linear-static-analysis",
"https://www.protolabs.com/resources/design-tips/navigating-protoquote/",
"https://www.hubs.com/knowledge-base/dfm-tips-for-3d-printed-parts-with-thin-calls/",
"https://www.fictiv.com/tools/snap-fit-calculator", "https://www.dfmanalysis.com/",
"https://www.xometry.com/how-xometry-works/",
"https://skyciv.com/free-beam-calculator/",
"https://www.engineersedge.com/beam_calc_menu.shtml",
"https://3dprintcalcs.uk/mechanical/",
"https://www.3ddfm.com/snap-fit-design-calculator/",
"https://www.sabic.com/en/products/services/engineering-tools",
"https://simulations4all.com/simulations/fatigue-life-sn-curve",
"https://vocal.media/futurism/simulation-software-market-sme-accessibility-trends-low-code-no-code-simulation-platforms-and-market-forecast",
"https://www.eng-tips.com/threads/need-assistance-finding-the-right-fea-cae-package.378607/",
"https://thehiveindex.com/communities/r-functionalprint/",
"https://www.3d-printed.org/what-are-the-most-popular-things-to-3d-print-on-thingiverse/",
"https://blog.prusa3d.com/printables-awards-2025-celebrating-the-best-in-3d-printable-design_126519/"
] }

---

## Agent output 2

{ "findings": [ { "fact": "TAXONOMIE GRANDE FAMILLE 1 — Supports / brackets / mounts.
Catégorie la plus structurellement critique. Sur Printables, les modèles de ce type sont
répartis dans plusieurs catégories : Household > Other House Equipment (56 155 modèles),
Hobby & Makers > Tools (71 550). Sur r/functionalprint et Bambu Forum, les wall
brackets, shelf mounts, under-desk mounts et equipment holders dominent les questions de
résistance mécanique. Un modèle Printables 'Printed Shelf Mounting Brackets' cumule des
centaines de commentaires sur la résistance. Variantes fréquentes : support moniteur,
support enceinte, montage projecteur, fixation étagère, mount pour caméra/capteur.",
"source": "Printables.com catégorie counts (search result) ; Bambu forum ; Printables
model pages" }, { "fact": "TAXONOMIE GRANDE FAMILLE 2 — Boîtiers / enclosures
électroniques. Sur Printables, la catégorie Electronics (Hobby & Makers) compte 43 858
modèles. MakerWorld identifie 'electronics accessories' comme l'une des catégories les
plus populaires. GrabCAD et Hubs/Protolabs confirment que les enclosures sont un
use-case structurant pour les startups hardware et les makers Raspberry Pi / Arduino.
Inclut : boîtier Raspberry Pi, boîtier Arduino, coffret relais, enclosure driver moteur,
boîtier capteur IoT, cover panneau de contrôle.", "source": "Printables Electronics
count (43 858) ; MakerWorld catégories Bambu Lab 2025 ; Hubs 3D printing knowledge base"
}, { "fact": "TAXONOMIE GRANDE FAMILLE 3 — Organisateurs / storage. Plus grand volume
sur Printables : Organizers (69 567 modèles) + Tools (71 550) = >140 000 modèles.
Gridfinity est le système de référence, cumule des centaines de milliers de downloads.
Inclut : boîtes empilables, rails de tiroir, porte-outils, porte-visserie, organisateur
câbles, porte-bobines. Structurellement peu critiques mais les organisateurs de charge
(porte-outils muraux, rail visseuses) rejoignent la famille brackets.", "source":
"Printables model counts par catégorie (research result) ; r/3Dprinting survey data
2024" }, { "fact": "TAXONOMIE GRANDE FAMILLE 4 — Pièces de remplacement (repair parts).
Explicitement identifiée comme l'un des uses cases les plus fréquents par Protolabs
2024, r/3Dprinting, et les concours Printables (concours 'Repairs' = record de
soumissions avec 1 104 modèles). Exemples concrets mentionnés dans les forums : clips de
fenêtre, pieds de meubles, broches de charnière, boutons d'appareils ménagers, clips
d'aspirateur, agrafes de tableau de bord auto. L'ajustement dimensionnel (tolérance vs
pièce d'origine) est la préoccupation #1 devant la résistance.", "source": "Prusa blog
sur les Flash Contests Printables ; Protolabs 2024 report ; r/3Dprinting survey" }, {
"fact": "TAXONOMIE GRANDE FAMILLE 5 — Mécanismes (snap-fits, charnières, engrenages,
liaisons). Part de Printables > Mechanical Parts : 21 280 modèles. Sous-catégorie
distincte mais les snap-fits infiltrent toutes les autres familles (enclosures,
boîtiers, remplacement). Les snap-fits cantilever sont les plus communs. Les engrenages
sont un segment niche mais très présent sur GrabCAD et Thingiverse (robotique éducative,
hobby). Les charnières flexibles (print-in-place) sont virales sur les forums makers.",
"source": "Printables Mechanical Parts count (21 280) ; GrabCAD library ; Hubs snap-fit
design guide" }, { "fact": "TAXONOMIE GRANDE FAMILLE 6 — RC / Robotique. Sur Printables,
Hobby & Makers > RC & Robotics : 28 042 modèles. Inclut : châssis RC, bras de
suspension, support moteur, roues, racks servo, cadres de drones, pièces FPV.
Structurellement critiques car soumis aux chocs d'impact et aux vibrations. La
communauté RC est explicite sur les modes de rupture (suspensions arm craquent aux
pivots, motor mounts sous vibration).", "source": "Printables RC & Robotics count
(28 042) ; rccarsguide.com ; rctalk.com forum" }, { "fact": "TAXONOMIE GRANDE FAMILLE 7
— Pièces automobiles / adaptation. Printables > Automotive : 35 499 modèles. Inclut :
clips de garniture intérieure, supports de câbles, adaptateurs de phares, doublures de
coffre, supports de caméra de recul, masques pour peinture. Préoccupation principale :
fit exact sur une géométrie existante + résistance thermique (habitacle en été :
60-80°C). Catégorie très active sur les forums avec des photos de remplacement de clips
OEM cassés.", "source": "Printables Automotive count (35 499) ; forums auto 3D print" },
{ "fact": "TAXONOMIE GRANDE FAMILLE 8 — Outillage / gabarits / fixtures. Outils
Printables : 71 550 modèles (la plus grande catégorie Hobby & Makers). Inclut : gabarits
de perçage, butées de scie, moules de moulage silicone, calibres de soudure, jigs
d'assemblage, fixtures d'usinage. Peu critiques structurellement (charges faibles, usage
ponctuel) mais la précision dimensionnelle prime. Le CNC joinery et les jigs de pliage
tôle entrent dans ce segment pour les petites séries.", "source": "Printables Tools
count (71 550) ; Hubs CNC machining guides" }, { "fact": "TAXONOMIE GRANDE FAMILLE 9 —
Structures portantes (châssis, cadres). Segment plus niche, visible surtout sur GrabCAD
(profil industriel) et Thingiverse robotique. Inclut : châssis imprimante 3D DIY, cadres
de machines CNC, racks serveur ou rack électronique, structures de robots. Les modes de
défaillance impliquent flambement, rigidité insuffisante, fatigue des liaisons
boulonnées.", "source": "GrabCAD library ; r/AskEngineers ; SimScale public projects
(beams, large structures)" }, { "fact": "TAXONOMIE GRANDE FAMILLE 10 — Pièces fluidiques
(buses, conduits, raccords). Présents dans Household > Other House Equipment et Hobby
Makers. Inclut : buses d'impression (non-structurel), durites de refroidissement
imprimante, raccords de plomberie temporaires, diffuseurs d'air. Segment encore niche
chez les makers mais croissant avec l'impression SLA résine et le FDM haute température.
Les contraintes sont : tenue en pression, compatibility chimique matière/fluide.",
"source": "Printables Other House Equipment ; maker forums ; SimScale analysis types
doc" }, { "fact": "MODES DE DÉFAILLANCE — Brackets / supports. Documentés dans Bambu
forum, Printables comments, r/3Dprinting, r/AskEngineers. (1) Rupture par cisaillement
inter-couches (Z-axis weakness) : la résistance en Z est 4-5x inférieure à XY en FDM —
critique quand la charge est perpendiculaire aux couches. (2) Fluage PLA : une bracket
PLA supportant 1.2 kg dans une enclosure à 62°C interne affiche 2.5 mm de déflexion en 4
semaines (cas documenté). Le Tg PLA est 55-60°C, seuil critique pour les enclosures
électroniques. (3) Concentration de contraintes aux angles vifs sans congé. (4)
Délamination sous charge de flexion cyclique (vibrations machines).", "source": "XDA
Developers article sur les prints ratés ; ScienceDirect PLA creep study ; Bambu forum
Z-layer failures ; Hubs orientation guide" }, { "fact": "MODES DE DÉFAILLANCE —
Snap-fits. Trois modes principaux documentés par Hubs, Formlabs et Hackaday : (1) Fluage
: le crochet sous tension de rétention permanente se déforme lentement sur des semaines
— très spécifique aux polymères (PLA, ABS, nylon), absent des métaux. (2) Fatigue :
rupture après N cycles d'ouverture/fermeture, accélérée par les coins vifs à la base du
cantilever. (3) Rupture fragile immédiate : PLA trop rigide + orientation impression
défavorable. Solution confirmée par terrain : imprimer les bras de snap 'à plat' sur le
plateau pour que la flexion se fasse dans le plan XY — augmente drastiquement la durée
de vie. FDM < SLA < SLS pour la fiabilité des snap-fits.", "source": "Hubs knowledge
base snap-fit design ; Formlabs snap-fit blog ; Hackaday 2022 ; Siraya Tech blog" }, {
"fact": "MODES DE DÉFAILLANCE — Enclosures électroniques. (1) Déformation thermique PLA
si des composants dégagent de la chaleur (régulateurs LDO, drivers stepper) :
température interne peut dépasser Tg PLA même à température ambiante. Problème
systématique pour les boîtiers imprimés avec des composants de puissance. (2) Tolérances
/ fit : le snapping ou l'assemblage à vis entre deux pièces imprimées échoue si les
tolérances ne compensent pas le retrait FDM (0.2-0.5mm typique). (3) Étanchéité :
absence d'IP rating possible en FDM standard (couches poreuses).", "source": "SimScale
electronics enclosure thermal management blog ; Clearview Plastics blog ; Hubs FDM
tolerance guide" }, { "fact": "MODES DE DÉFAILLANCE — Pièces de remplacement. (1)
Désajustement dimensionnel : c'est le problème #1 signalé. La pièce d'origine a des
tolérances injection molding (±0.1mm) que le FDM ne reproduit pas sans calibration. (2)
Résistance matériau inadéquate : PLA remplaçant un clip nylon OEM casse au premier choc
thermique (voiture). (3) Fatigue sur les broches de charnière : les hinges subissent des
milliers de cycles, PLA fragile claque rapidement.", "source": "r/3Dprinting forum posts
; XDA developers real-world failure article ; Bambu forum PETG vs PLA structural" }, {
"fact": "MODES DE DÉFAILLANCE — RC/Robotique. (1) Bras de suspension : craquent aux
pivots sous chocs d'impact. Passage PLA → PETG → CoPA (co-polyamide nylon) documenté
comme nécessaire pour les suspensions. (2) Supports moteur sous vibration : fatigue par
résonance. (3) Dépôt de particules d'usure en PLA dans les engrenages. Recommandation
forum RC : jamais PLA pour pièces sous stress ; nylon pour les bras ; inserts filetés
thermiques pour tous les assemblages boulonnés sous contrainte répétée.", "source":
"Medium article 'Why My 3D Printed RC Cars Kept Failing' ; rccarsguide.com 2026 ;
rctech.net forum" }, { "fact": "PROCÉDÉ FDM — Vérifications spécifiques. FDM = 59% des
usages selon Protolabs 2024. Contraintes design à vérifier : (1) Anisotropie
directionnelle — résistance Z 4-5x inférieure, à quantifier selon orientation de
l'impression prévue. (2) Épaisseur de paroi minimum : 0.4mm (1 périmètre) typique,
structurellement au moins 2-3 périmètres (0.8-1.2mm). (3) Pontage (bridging) : overhang

> 45° sans support = surface dégradée → tolérances affectées. (4) Creep PLA : limite
> pratique ~45-50°C en continu sous charge. (5) Tolérances : ±0.2-0.5mm selon
> imprimante, critique pour les assemblages snap-fit (besoin de 0.2-0.3mm de jeu par
> face).", "source": "Protolabs 2024 trend report ; Hubs FDM design guide ; 3DSPRO
> anisotropy article ; SV-JME creep polymer study" }, { "fact": "PROCÉDÉ SLA/MSLA
> (résine). SLA = 20% des usages (Protolabs 2024). Vérifications spécifiques : (1)
> Meilleures tolérances que FDM (±0.1-0.2mm), adapté aux snap-fits fonctionnels. (2)
> Résine standard fragile — mode de rupture cassant ; résines engineering (Tough,
> ABS-Like) nécessaires pour les snap-fits cycliques. (3) Post-curing obligatoire sinon
> propriétés mécaniques non atteintes. (4) Tenue thermique similaire à PLA pour les
> résines standard.", "source": "Hubs snap-fit guide ; Formlabs material guide ;
> Protolabs 2024 report" }, { "fact": "PROCÉDÉ SLS / MJF. SLS = 11%, MJF = 7% (Protolabs
> 2024). Avantages confirmés : (1) Isotropie quasi-complète — pas d'anisotropie Z, c'est
> la référence pour les snap-fits fonctionnels (Hubs : 'SLS nylon produces the best
> functional snap fit prototypes'). (2) Pas de supports → géométries complexes sans
> compromis d'orientation. (3) Nylon PA12 : excellent fluage resistance par rapport au
> PLA. Usage dominant : pièces end-use petite série, automotive, robotique.", "source":
> "Hubs snap-fit knowledge base ; Protolabs 2024 FDM/SLA/SLS breakdown" }, { "fact":
> "PROCÉDÉ CNC / Tôlerie. Pour les buyers PME et startups hardware : les brackets et
> fixations métalliques (acier, alu) sont commandés via Hubs/Protolabs. Les
> vérifications spécifiques tôle : (1) Rayon de pliage minimum (fonction épaisseur +
> matière, springback). (2) Tolérances ISO 2768 standard CNC vs injection molding. (3)
> Zones de soudure / découpe laser. (4) Épaisseurs 0.5-10mm pour tôlerie standard. Les
> brackets métalliques remplacent les imprimés quand les charges ou températures
> dépassent les capacités polymères.", "source": "Hubs CNC machining guide ; factorem.co
> sheet metal vs CNC comparison ; jlccnc.com" }, { "fact": "PROCÉDÉ Injection molding
> (petite série). Vérifications spécifiques à valider en amont : (1) Dépouilles (draft
> angles) — 0.5-1° minimum pour démoulage, souvent oublié par les makers. (2) Épaisseurs
> uniformes pour éviter retrait différentiel et gauchissement (shrinkage plastics). (3)
> Tolérance stack-up dans les assemblages multi-pièces : chaque pièce OK
> individuellement mais ensemble hors tolérance. (4) Coefficient de dilatation thermique
> : un assemblage parfait à 20°C peut bloquer ou se desserrer à 110°C (entrepôt été).
> Sources : Fictiv, Protolabs, Ensinger guides.", "source": "Fictiv injection molding
> tolerances guide ; Protolabs blog injection molding tolerances ; Ensinger PC
> resources" }, { "fact": "BARRIÈRES À LA SIMULATION chez le segment cible. Cetim
> (France) : 'la barrière principale n'est pas le coût logiciel mais l'absence
> d'expertise interne — quand l'usage est peu fréquent, les PME ne justifient pas un
> spécialiste à plein temps'. SimScale : 69% de ses utilisateurs sont des petites
> entreprises, 12% en mécanique/ingénierie industrielle. Cetim : 80% des besoins PMI =
> calcul structurel statique simple, accessible dès 5 000 €. Protolabs 2024 : 47% citent
> le délai (lead time) comme critère #1, pas la précision technique.", "source": "Cetim
> article sur la simulation PMI ; SimScale Capterra review data ; Protolabs 2024 trend
> report" }, { "fact": "DONNÉES CHIFFRÉES AGRÉGÉES Printables par taille de catégorie
> (mesurées au moment des recherches). Hobby & Makers : Tools 71 550, Organizers 69 567,
> Other Ideas 45 231, Electronics 43 858, Automotive 35 499, RC & Robotics 28 042,
> Mechanical Parts 21 280, Music 8 011. Household : Kitchen 56 073, Other House
> Equipment 56 155, Home Decor 50 974, Office 35 007, Outdoor & Garden 33 440, Bathroom
> 21 753, Pets 9 275, Living Room 8 725, Bedroom 6 235, Garage 5 185. Le segment
> fonctionnel/structurel se concentre dans : Mechanical Parts, RC & Robotics,
> Electronics, Automotive, Tools (pour les jigs/fixtures).", "source": "Recherches
> Printables.com catégories (Google search results avec counts)" }, { "fact": "DONNÉES
> CHIFFRÉES MakerWorld (Bambu Lab, 2025). 10 millions d'utilisateurs actifs mensuels,
> 2.6 millions de modèles originaux, 7 000 nouveaux modèles/jour, 280 000 designers.
> Catégories déclarées populaires : storage tools, decorations, toys and games,
> miniatures, electronics accessories, vehicles, sculptures, office items, sports
> equipment, printer accessories. 83% des acheteurs d'imprimante continuent à
> télécharger et imprimer 1 an après l'achat.", "source": "3DPrint.com article Bambu Lab
> 2025 results ; 3DPrintingIndustry.com Bambu data article" }, { "fact": "DONNÉES
> CHIFFRÉES Protolabs 2024. 67% prototypage, 21% end-use parts (hausse vs 20% en 2022).
> FDM 59%, SLA 20%, SLS 11%, MJF 7%. End-use parts par industrie : transport 33%,
> robotique 30%, automatisation industrielle 27%. Croissance du volume imprimé : 70% des
> entreprises ont imprimé plus qu'en 2022. Barrières à la production : 47%
> volume/scalabilité, 40% qualité/consistance, 27% post-processing.", "source":
> "Protolabs 3D Printing Trend Report 2024" } ], "answer": "## ÉTUDE A — Taxonomie des
> projets de conception mécanique réels\n\n### Sources et méthode\nDonnées collectées
> sur Printables.com (counts de modèles par catégorie), MakerWorld/Bambu Lab (rapport
> 2025), Protolabs Trend Report 2024, Thingiverse analytics (makerluis.com), forums
> Bambu Lab / rctalk.com / r/3Dprinting, SimScale, Cetim, Hubs/Protolabs knowledge base,
> études ScienceDirect sur le fluage PLA et l'anisotropie FDM.\n\n---\n\n### 1. Grandes
> familles — volumes observés\n\n| Famille | Proxy de volume | Source
> |\n|---|---|---|\n| **Organisateurs / storage** | 141 117 modèles (Tools 71 550 +
> Organizers 69 567 Printables) | Printables counts |\n| **Pièces de remplacement** |
> Concours Printables 'Repairs' = 1 104 soumissions (record) | Prusa blog |\n|
> **Boîtiers / enclosures électroniques** | 43 858 modèles (Printables Electronics) |
> Printables counts |\n| **Automotive** | 35 499 modèles (Printables) | Printables
> counts |\n| **RC / Robotique** | 28 042 modèles (Printables) | Printables counts |\n|
> **Mécanismes** (snap-fits, engrenages, charnières) | 21 280 modèles (Printables
> Mechanical Parts) | Printables counts |\n| **Supports / brackets / mounts** |
> Dispersés dans Household (56 155 Other House Equip) + Tools | Printables + forums
> |\n\nMakerWorld (10M users/mois, 2025) identifie comme populaires : storage tools,
> electronics accessories, vehicles — cohérent avec Printables.\n\nSur Thingiverse
> (2.5M+ modèles), Toys & Games domine les likes (moy. 182) mais la catégorie Hobby
> croît le plus vite ; les prints fonctionnels les plus fréquents = upgrades imprimante,
> pièces de remplacement, organisateurs ménagers.\n\n**Observation structurelle** : les
> organisateurs et storage sont les plus nombreux en volume absolu, mais
> structurellement peu critiques (charges faibles, statiques). Les familles où la
> mécanique et la résistance comptent réellement sont — par ordre de préoccupation
> exprimée dans les forums :\n\n1. Supports/brackets (masse suspendue, bras de
> levier)\n2. Snap-fits (fatigue, fluage)\n3. Enclosures (thermique + fit)\n4. Pièces de
> remplacement (tolérance dimensionnelle)\n5. RC/Robotique (chocs,
> vibrations)\n\n---\n\n### 2. Modes de défaillance par famille\n\n**Supports / brackets
> / wall mounts**\n- Rupture par cisaillement inter-couches FDM (charge perpendiculaire
> aux couches = Z-weakness 4-5× inférieure à XY)\n- Fluage PLA : bracket PLA à 62°C
> interne affiche 2.5 mm de déflexion en 4 semaines (cas documenté ScienceDirect). Tg
> PLA = 55-60°C — seuil franchi dans les enclosures électroniques\n- Concentration de
> contraintes aux angles vifs (congé absent)\n- Délamination sous flexion cyclique
> (vibrations)\n\n**Snap-fits**\n- Fluage : le crochet sous tension de rétention
> permanente se déforme lentement (semaines à mois) — spécifique aux polymères, absent
> des métaux\n- Fatigue : rupture après N cycles ouverture/fermeture, accélérée par
> coins vifs à la base du cantilever\n- Rupture fragile immédiate : PLA trop rigide +
> mauvaise orientation (bras imprimé en Z au lieu de XY → casse au 1er cycle)\n-
> Hiérarchie de fiabilité : FDM < SLA < SLS nylon (Hubs knowledge base)\n\n**Boîtiers /
> enclosures électroniques**\n- Déformation thermique : composants de puissance
> (régulateurs, drivers stepper) portent l'air interne > Tg PLA en usage normal\n-
> Tolérances / fit : retrait FDM (0.2-0.5 mm) → snap-fits trop serrés ou trop lâches
> sans compensation de tolérance\n- Étanchéité : couches FDM poreuses = pas d'IP rating
> sans traitement\n\n**Pièces de remplacement**\n- Désajustement dimensionnel (#1) :
> injection molding OEM à ±0.1 mm vs FDM ±0.2-0.5 mm — besoin de calibration ou de
> sur-dimensionnement compensé\n- Matériau inadéquat : PLA remplaçant un clip nylon auto
> à 80°C habitacle casse au premier cycle thermique\n- Fatigue sur broches de charnière
> (milliers de cycles)\n\n**Mécanismes (engrenages, charnières)**\n- Usure : PLA trop
> mou pour engrenages sous charge continue (passage obligé nylon ou Delrin)\n- Précision
> dimensionnelle : jeu/backlash fonction directe de la tolérance procédé\n- Absence de
> lubrification pensée à la conception\n\n**RC / Robotique**\n- Bras de suspension :
> craquent aux pivots sous chocs d'impact — matériau critique (PLA → PETG → CoPA nylon
> documenté sur les forums RC)\n- Supports moteur sous vibration : fatigue résonance\n-
> Insertions filetées non prévues → filetages plastique arrachés au 2e-3e
> montage\n\n---\n\n### 3. Procédés dominants et vérifications spécifiques\n\n**FDM (59%
> du marché, Protolabs 2024)**\n- Anisotropie directionnelle : résistance Z 4-5×
> inférieure à XY — l'orientation d'impression est une décision de conception, pas un
> détail de fabrication\n- Épaisseur de paroi minimum : structurellement au moins 2-3
> périmètres (0.8-1.2 mm sur buse 0.4)\n- Creep PLA : limite pratique ~45-50°C en
> continu sous charge ; au-dessus → PETG, ASA, ABS, nylon\n- Tolérances assemblage : jeu
> 0.2-0.3 mm par face pour les snap-fits, 0.1-0.2 mm pour les press-fits\n\n**SLA/MSLA
> (20%)**\n- Tolérances ±0.1-0.2 mm → meilleur que FDM pour snap-fits et assemblages\n-
> Résine standard fragile (mode cassant) ; résines Tough/Engineering nécessaires pour
> snap-fits cycliques\n- Post-curing obligatoire (propriétés non atteintes
> sinon)\n\n**SLS/MJF (11%+7%)**\n- Quasi-isotrope → référence pour snap-fits
> fonctionnels fiables\n- Nylon PA12 : fluage résistance bien supérieure à PLA\n- Usage
> dominant : end-use petite série, pièces structurelles, automotive\n\n**CNC /
> Tôlerie**\n- Rayon de pliage minimum (fonction épaisseur + matière + springback)\n-
> Tolérances ISO 2768 : métal CNC supérieur à tout polymère imprimé\n- Remplace les
> imprimés quand charges ou températures dépassent les capacités polymère\n\n**Injection
> petite série**\n- Dépouilles (draft angles 0.5-1° minimum) — erreur systématique chez
> les makers qui convertissent un modèle FDM\n- Épaisseurs uniformes : retrait
> différentiel → gauchissement si parois inégales\n- Tolérance stack-up : assemblage
> multi-pièces correct individuellement mais hors tolérance combiné\n- Dilatation
> thermique : assemblage à 20°C peut bloquer à 110°C (entrepôt été)\n\n---\n\n### Ce qui
> est mesuré vs estimé\n\n**Mesuré / observé directement** :\n- Counts de modèles
> Printables par catégorie (données live dans les résultats de recherche)\n- Protolabs
> 2024 : 67% proto / 21% end-use ; FDM 59% / SLA 20% / SLS 11% / MJF 7%\n- MakerWorld
> 2025 : 10M users, 2.6M modèles, 7 000/jour\n- Cetim : expertise absente = barrière #1
> (pas le coût logiciel)\n- Formlabs : résistance Z FDM 4-5× inférieure à XY (études
> peer-reviewed ScienceDirect)\n\n**Estimé / inféré depuis proxies** :\n- La hiérarchie
> de criticité structurelle (brackets > snap-fits > enclosures thermique) est inférée
> depuis la fréquence des questions dans les forums, pas mesurée directement\n- Les
> volumes de téléchargement Printables ne sont pas publics — les counts de modèles sont
> le proxy disponible (corrélation volume de création ≠ volume de consommation
> directe)\n- GrabCAD (11.6M membres, 5.5M modèles) : aucune statistique de catégorie
> publiée récemment — données 2011 non exploitables\n\n---\n\n### Implication pour la
> priorisation des oracles\n\nPar fréquence de demande réelle croisée avec criticité
> structurelle :\n\n1. **Statique linéaire (FEA)** : couvre brackets, supports, pièces
> de remplacement métalliques → demande la plus large, cas le plus simple à emballer\n2.
> **Fluage / viscoélasticité polymère** : couvre snap-fits (rétention permanente) +
> brackets PLA en environnement chaud → demande forte, souvent ignorée car invisible
> avant 4 semaines\n3. **Analyse thermique enclosures** : déformation PLA par chaleur
> interne → problème systématique pour les makers électronique\n4. **Fatigue** :
> snap-fits cycliques, suspensions RC → niche mais demande explicite dans les forums\n5.
> **Tolérances / assemblage** : fit dimensional des pièces de remplacement et snap-fits
> → pas un oracle FEA mais une vérification dimensionnelle paramétrée", "sources": [
> "https://www.printables.com/model?category=48",
> "https://www.printables.com/model?category=51",
> "https://blog.prusa3d.com/printables-awards-2025-celebrating-the-best-in-3d-printable-design_126519/",
> "https://www.protolabs.com/resources/guides-and-trend-reports/3d-printing-trend-report/",
> "https://www.makerluis.com/statistics-from-thingiverse-and-popular-3d-printing-models/",
> "https://3dprint.com/324181/bambu-lab-says-2025-was-a-breakout-year-10-million-monthly-users-and-real-business-growth/",
> "https://3dprintingindustry.com/news/bambu-lab-data-highlights-sustained-3d-printing-activity-and-creator-growth-on-makerworld-249474/",
> "https://www.cetim.fr/actualites/La-simulation-un-outil-de-competitivite-a-portee-des-PMI/",
> "https://www.hubs.com/knowledge-base/how-design-snap-fit-joints-3d-printing/",
> "https://formlabs.com/blog/designing-3d-printed-snap-fit-enclosures/",
> "https://www.simscale.com/blog/heat-dissipation-electronics/",
> "https://gektor650.medium.com/why-my-3d-printed-rc-cars-kept-failing-until-this-4wd-4runner-build-182d6b83f210",
> "https://rccarsguide.com/blog/3d-printed-rc-cars",
> "https://www.sciencedirect.com/science/article/pii/S0997753825002475",
> "https://3dspro.com/resources/3dspro-lab/3d-printing-designs-impact-on-mechanical-properties-anisotropy",
> "https://www.hubs.com/knowledge-base/how-does-part-orientation-affect-3d-print/",
> "https://www.fictiv.com/articles/injection-molding-tolerances-an-in-depth-look",
> "https://www.simscale.com/product/pricing/",
> "https://hackadd.com/2022/03/14/3d-printing-snap-fit-joints/",
> "https://www.xda-developers.com/3d-prints-failed-ways-couldnt-have-predicted/" ] }

---

## Agent output 3

{ "findings": [ { "fact": "CalculiX couvre nativement 10 types d'analyse distincts
(version 2.23, source officielle dhondt.de) : *STATIC linéaire ET nonlinéaire (grandes
déformations, plasticité, contact, *CREEP loi puissance), *FREQUENCY (modal, extraction
d'eigenmodes), *BUCKLE (flambage linéaire), *DYNAMIC (transitoire modal et nonlinéaire,
steady-state harmonique), *HEAT TRANSFER (stationnaire et transitoire pur), *COUPLED
TEMPERATURE-DISPLACEMENT (thermo-mécanique couplée), CFD interne (laminaire/turbulent,
compressible/incompressible), Steady-State Networks (hydraulique/aéro),
Electromagnétique, Sensitivité. La FATIGUE n'est PAS un type d'analyse natif CalculiX —
elle nécessite un post-traitement externe (comptage Rainflow + S-N) ou code_aster.",
"source": "http://www.dhondt.de/ov_calcu.htm (WebFetch direct de la page officielle
CalculiX 2.23)" }, { "fact": "CalculiX *CREEP est natif : loi de Norton (puissance), loi
de Garofalo (hyperbolic sine). Ce type couvre le fluage PLA sous charge soutenue à T >
45°C — le mode de défaillance #1 des brackets et snap-fits en environnement chaud. Le
moteur est déjà branché dans ce repo (mcp-calculix), seuls un nouveau case et un checker
de seuil de déformation sont à écrire.", "source": "http://www.dhondt.de/ov_calcu.htm ;
CalculiX CrunchiX User Manual v2.22 (https://www.dhondt.de/ccx_2.22.pdf)" }, { "fact":
"code_aster (EDF, GPL) couvre nativement la fatigue : courbes S-N, critère de Dang Van
(multiaxial), mécanique de la rupture, fluage avancé (200+ lois de comportement, 400+
types d'éléments), analyse sismique. ~4400 tests de vérification. Interface via fichiers
.comm Python. Coût d'emballage : nouveau-moteur-à-brancher — significatif (parsing de
format .comm, output résultats fatigue, image Docker à construire et maintenir).",
"source":
"https://www.simscale.com/blog/fea-online-structural-analysis-code_aster-simscale/ ;
https://cloudhpc.cloud/2025/03/13/cracking-the-code-using-code-aster-for-creep-and-fatigue-assessment-in-api-579-1-asme-ffs/
; https://www.opennovation.org/profiles/aster.html" }, { "fact": "Elmer FEM (CSC
Finland, GPL v2/LGPL) : multiphysique natif — mécanique des structures, thermique,
fluides, électromagnétisme, acoustique, couplages multi-domaines. Scalabilité HPC.
Releases annuelles. Coût d'emballage : nouveau-moteur-à-brancher (image Docker, format
.sif, output parsing). Pertinent pour les cas multi-physiques avancés
(thermo-électro-mécanique) mais redondant avec CalculiX pour les cas maker/PME cibles.",
"source": "https://en.wikipedia.org/wiki/Elmer_FEM_solver ;
https://research.csc.fi/service/elmer/" }, { "fact": "OpenModelica (déjà branché) couvre
le thermique d'enclosure électronique via MSL.Thermal.HeatTransfer : modèle
lumped-parameter RC thermique, sources de chaleur, dissipateurs, boîtiers. C'est le bon
niveau d'abstraction pour 'T interne > Tg PLA ?' sur un boîtier avec composants de
puissance — sans avoir besoin d'un maillage FEA. Coût : réutilise-moteur-branché,
nouveau kit MSL.Thermal.", "source": "https://grokipedia.com/page/OpenModelica ;
https://sourceforge.net/software/product/OpenModelica/" }, { "fact": "ngspice (GPL,
simulation SPICE) : simulation électrothermique via réseau de résistances thermiques
analogiques (Rth_junction-case, Rth_case-ambient, capacités thermiques Cth). Couvre les
températures de jonction des composants semi-conducteurs (MOSFET, régulateurs LDO,
drivers stepper). Un tutoriel officiel dédié électrothermique existe sur le site
ngspice. Coût : nouveau-moteur-à-brancher. MAIS OpenModelica MSL.Electrical peut
modéliser le même problème — éviter la duplication de moteur.", "source":
"https://ngspice.sourceforge.io/ngspice-electrothermal-tutorial.html ;
https://www.ias-research.com/electrical/power-electronics/ngspice-in-power-electronics-design-and-power-electronics-control-systems-a-comprehensive-white-paper"
}, { "fact": "OCCT (déjà dans la chaîne via build123d) fournit nativement : propriétés
de masse (volume, CG, inertie), détection de collision/proximity
(Voxel_CollisionDetection, BRepAlgoAPI_Check), analyse d'épaisseur de paroi, calcul
d'angle de face. Tout oracle DFM géométrique (overhang FDM, draft angle injection,
épaisseur paroi CNC) peut être implémenté comme des règles OCCT sur la géométrie déjà
traitée. Coût : réutilise-moteur-branché (OCCT) — les règles sont à écrire mais aucun
moteur externe n'est nécessaire.", "source":
"https://old.opencascade.com/content/collision-detection ;
https://dev.opencascade.org/doc/overview/html/" }, { "fact": "La fatigue peut être
approximée sans code_aster via post-traitement analytique sur la sortie CalculiX : (1)
extraire l'amplitude de contrainte Von Mises du *STATIC cyclic, (2) appliquer une courbe
S-N matériau (table revue, ex. ASME ou formulaire Basquin), (3) calculer le dommage
cumulé Palmgren-Miner en Python. Précision suffisante pour le segment maker/PME
(go/no-go). Coût : réutilise-moteur-branché CalculiX + analytique Python — sans ajouter
code_aster.", "source":
"https://sdcverifier.com/structural-engineering-101/rainflow-counting-approach/ ;
https://simulations4all.com/simulations/fatigue-life-sn-curve" }, { "fact": "Le
tolérancements / stack-up d'assemblage n'a pas de moteur open-source dominant identifié.
Les méthodes (Worst-Case, RSS, Monte Carlo) sont purement analytiques — implémentables
en Python pur sans dépendance externe. Des outils web existent (sigmaexacta.com,
firgelli, tolanalysis.com) mais aucun ne produit de résultat haché/traçable. C'est un
oracle non-physique : règles à écrire, pas de moteur à brancher.", "source":
"https://sigmaexacta.com/stack_up_analysis ;
https://www.firgelliauto.com/blogs/engineering-calculators/tolerance-stack-up-calculator-worst-case-and-rss
; https://sheridantech.io/2026/03/19/tolerance-stack-up-analysis/" }, { "fact": "DFM
automatique à l'upload est une commodité résolue par toutes les plateformes fabricant
(Protolabs, Fictiv, Xometry, JLC3DP). Ces outils couvrent : épaisseur de paroi, angles
de dépouille, contre-dépouilles, diamètre de trou minimum. Aucun ne produit de verdict
haché lié à une exigence signée. Il n'existe pas d'outil open-source DFM complet et
scriptable en 2025-2026 — PrusaSlicer (AGPL3) a une analyse d'overhang mais comme
slicer, non exposable en API de vérification. Les règles sont à coder sur OCCT.",
"source": "https://www.protolabs.com/resources/design-tips/navigating-protoquote/ ;
https://www.dfmanalysis.com/ ;
https://www.simplemachining.com/blogs/dfm-for-3d-printing-a-practical-design-guide" }, {
"fact": "OpenFOAM (GPL v3) : référence pour le CFD open-source (BMW, BASF, Intel en
production). Couvre fluides incompressibles/compressibles, turbulence, thermique
couplée. Coût d'emballage : nouveau-moteur-à-brancher — courbe d'apprentissage élevée,
setup de maillage complexe. Pertinent uniquement pour la famille 'pièces fluidiques'
(buses, raccords sous pression, refroidissement actif) — niche parmi le segment maker
cible. À différer au profit de moteurs couvrant des familles plus larges.", "source":
"https://gaugehow.com/simulation/best-cfd-software-2026-commercial-vs-open-source ;
https://cfd.university/blog/learn-openfoam-the-good-the-bad-and-the-evil/" }, { "fact":
"Signal stratégique de priorisation issu de l'analyse du marché concurrent : Fusion 360,
SimScale, Onshape et SolidWorks SimulationXpress bundlent tous la STATIQUE LINÉAIRE
gratuitement — c'est une commodité. Le différenciateur réel est (1) modal/flambage en
tier de base (Onshape l'a bundlé), (2) thermique (SimScale le bundle, Fusion le gate),
(3) couplé thermo-mécanique et fatigue restent systématiquement payants chez tous les
concurrents. L'avantage Casys n'est pas le type d'analyse mais la CHAÎNE DE PREUVE :
résultat haché + lié à une exigence signée = totalement absent du marché.", "source":
"https://www.autodesk.com/products/fusion-360/simulation-extension ;
https://www.simscale.com/product/pricing/ ;
https://www.onshape.com/en/features/simulation ;
https://help.solidworks.com/2025/english/SolidWorks/cosmosxpresshelp/c_overview_of_solidworks_simulationxpress.htm"
} ], "answer": "## ÉTUDE C — Carte Vérifications → Moteurs open-source\n\n###
Méthode\nDonnées issues de la page officielle CalculiX 2.23 (dhondt.de, WebFetch
direct), manuels utilisateur CalculiX 2.22, documentation code_aster/EDF, Elmer FEM
(CSC), ngspice, OCCT, OpenModelica MSL, et triangulation avec les données concurrentes
des études A et B.\n\n---\n\n## 1. CalculiX — inventaire complet des types d'analyse
natifs\n\nCe point est structurellement critique : le moteur est déjà branché dans
`mcp-calculix`, donc tout type d'analyse natif CalculiX a un coût marginal minimal
(nouveau case + checker, pas de nouveau moteur).\n\n| Type d'analyse | Mot-clé CalculiX
| Linéaire | Non-linéaire | Stationnaire | Transitoire
|\n|---|---|:---:|:---:|:---:|:---:|\n| Statique | `*STATIC` | ✓ | ✓ (grandes déf.,
plasticité, contact) | — | — |\n| Modal / Fréquentiel | `*FREQUENCY` | ✓ | — | — | —
|\n| Flambage | `*BUCKLE` | ✓ (linéaire) | — | — | — |\n| Dynamique | `*DYNAMIC` | ✓ | ✓
(implicite/explicite) | ✓ (SSdynamics) | ✓ |\n| Thermique pur | `*HEAT TRANSFER` | — | —
| ✓ | ✓ |\n| Thermo-mécanique couplé | `*COUPLED TEMPERATURE-DISPLACEMENT` | — | ✓ | ✓ |
✓ |\n| Fluage | `*CREEP` (dans *STATIC) | — | ✓ (Norton, Garofalo) | — | — |\n| CFD |
interne CalculiX | ✓ | — | ✓ | ✓ |\n| Réseaux hydrauliques/aéro |
`*STEADY STATE TRANSPORT` | ✓ | — | ✓ | — |\n| Électromagnétique | intégré | ✓ | — | ✓ |
— |\n| **Fatigue** | **NON NATIF** | — | — | — | — |\n\n**La fatigue est le seul gap
majeur de CalculiX** par rapport aux besoins identifiés.\n\n---\n\n## 2. Carte complète
: Famille → Mode → Vérification → Moteur → Coût\n\n### Légende des coûts\n- **[A]**
réutilise-moteur-branché : case + checker seulement (moteur déjà wired)\n- **[B]**
nouveau-moteur-à-brancher : image Docker + wrapping + parsing output\n- **[C]**
pas-de-moteur-mûr : règles analytiques ou catalogue à écrire en
Python/OCCT\n\n---\n\n### FAMILLE 1 — Supports / brackets / mounts\n\n| Mode de
défaillance | Vérification | Moteur | Coût |\n|---|---|---|---|\n| Rupture statique
(flexion, cisaillement) | Statique linéaire — Von Mises + déflexion + FoS | CalculiX
`*STATIC` — **DÉJÀ EXPOSÉ** | [A] déjà fait |\n| Concentration de contraintes (angles
vifs) | Statique linéaire + hot-spot identifier | CalculiX `*STATIC` — nouveau checker
de gradient | [A] |\n| Fluage PLA sous charge soutenue (T > 45°C) | Creep /
viscoélastique stationnaire | CalculiX `*CREEP` (Norton law) — nouveau case | [A] |\n|
Délamination inter-couches FDM (cisaillement Z) | Statique linéaire avec matériau
orthotrope (Ex, Ez différents) | CalculiX `*STATIC` + propriétés orthotropes — nouveau
case matériau | [A] |\n\n---\n\n### FAMILLE 2 — Snap-fits (cantilever, annulaire)\n\n|
Mode de défaillance | Vérification | Moteur | Coût |\n|---|---|---|---|\n| Rupture
fragile à l'insertion (1er cycle, mauvaise orientation impression) | Statique linéaire +
matériau orthotrope FDM | CalculiX `*STATIC` — nouveau case matériau orthotrope | [A]
|\n| Fluage du crochet (tension permanente, semaines) | Creep / viscoélastique |
CalculiX `*CREEP` — OU analytique (formule cantilever + E_creep) | [A] ou [C] |\n|
Fatigue cyclique (N cycles ouverture/fermeture) | Fatigue S-N + Miner | **Option 1 :**
post-traitement analytique Python sur σ extrait de `*STATIC` + table S-N matériau
(Basquin) → [A] + [C] | [A]+[C] |\n| | | **Option 2 :** code_aster (fatigue native, Dang
Van multiaxial) → nouveau moteur | [B] |\n| Force d'insertion (dimensionnement) |
Analytique cantilever (formule fermée) | Pas de FEA — calculateur Python pur (formule
Snap-fit Fictiv) | [C] |\n\n---\n\n### FAMILLE 3 — Boîtiers / enclosures
électroniques\n\n| Mode de défaillance | Vérification | Moteur | Coût
|\n|---|---|---|---|\n| T interne > Tg PLA (composants de puissance) | Thermique
stationnaire — distribution T dans l'enceinte + verdict T < Tg | OpenModelica
MSL.Thermal.HeatTransfer (lumped RC) — **DÉJÀ BRANCHÉ**, nouveau kit thermique enclosure
| [A] |\n| T jonction composants semi-conducteurs (LDO, stepper) | Électrothermique —
réseau Rth junction-case-ambient | OpenModelica MSL.Thermal (même approche que
ci-dessus) — éviter ngspice pour réduire la surface de moteurs | [A] |\n| Déformation
structurelle des parois sous T | Thermo-mécanique couplée | CalculiX
`*COUPLED TEMPERATURE-DISPLACEMENT` — nouveau case | [A] |\n| Tolérances FDM / fit
snap-fit assemblage | Stack-up de tolérances (worst-case / RSS) | Analytique Python pur
— pas de moteur FEA | [C] |\n| Étanchéité IP (couches FDM poreuses) | Règle DFM procédé
— déclaratif (FDM FFF ≠ IP rating) | Oracle catalogue : règle fixe, pas de calcul | [C]
|\n\n---\n\n### FAMILLE 4 — Pièces de remplacement\n\n| Mode de défaillance |
Vérification | Moteur | Coût |\n|---|---|---|---|\n| Désajustement dimensionnel (FDM
±0.2-0.5 mm vs OEM ±0.1 mm) | Stack-up de tolérances + DFM procédé (table de
compensation FDM) | Analytique Python + catalogue de tolérances procédé | [C] |\n|
Matériau inadéquat (PLA en environnement > 55°C ou impact) | Sélection matériau —
comparaison Tg, résistance impact, coeff. de dilatation vs exigences | Oracle catalogue
matériau (table revue : PLA, PETG, ABS, ASA, Nylon, CoPA) | [C] |\n| Fatigue sur broches
de charnière (milliers de cycles) | Fatigue S-N (même chemin que snap-fits) |
Post-traitement analytique sur σ CalculiX + table S-N | [A]+[C] |\n\n---\n\n### FAMILLE
5 — Mécanismes (engrenages, charnières, liaisons)\n\n| Mode de défaillance |
Vérification | Moteur | Coût |\n|---|---|---|---|\n| Usure engrenages (pression de
contact) | Contact Hertz — statique nonlinéaire avec contact | CalculiX `*STATIC` +
contact nonlinéaire — nouveau case | [A] |\n| Usure engrenages (géométries standard) |
Analytique Hertz (formule fermée — σ_H, module, nb dents) | Python pur — pas de FEA |
[C] |\n| Jeu / backlash (précision dimensionnelle) | Géométrique OCCT + DFM procédé |
OCCT (déjà dans la chaîne via build123d) | [A] |\n| Print-in-place (charnières
flexibles) : rupture | Statique nonlinéaire grandes déformations | CalculiX `*STATIC`
nonlinéaire | [A] |\n\n---\n\n### FAMILLE 6 — RC / Robotique\n\n| Mode de défaillance |
Vérification | Moteur | Coût |\n|---|---|---|---|\n| Rupture bras de suspension (choc
d'impact) | Dynamique nonlinéaire (impact) OU statique équivalente avec facteur de choc
déclaré | CalculiX `*DYNAMIC` nonlinéaire — OU `*STATIC` avec charge choc empirique
(plus pragmatique pour le segment cible) | [A] |\n| Fatigue vibration / résonance |
Modal — fréquences propres vs fréquences d'excitation | CalculiX `*FREQUENCY` — nouveau
case (PRIORITÉ : non encore exposé) | [A] |\n| Arrachement filetages plastique |
Statique nonlinéaire — contact fileté | CalculiX `*STATIC` nonlinéaire + géométrie
filetée OU analytique (formule résistance à l'arrachement VDI 2230 simplifié) | [A] ou
[C] |\n\n---\n\n### FAMILLE 7 — Automotive\n\n| Mode de défaillance | Vérification |
Moteur | Coût |\n|---|---|---|---|\n| Fluage thermique (habitacle 60-80°C) |
Thermo-mécanique couplée (T uniforme + déformation) | CalculiX
`*COUPLED TEMPERATURE-DISPLACEMENT` | [A] |\n| Fit précis (clips OEM, retrait thermique
différentiel) | Stack-up + DFM + coefficient de dilatation thermique | Analytique +
catalogue | [C] |\n\n---\n\n### FAMILLE 8 — Outillage / gabarits\n\n| Mode de
défaillance | Vérification | Moteur | Coût |\n|---|---|---|---|\n| Déflexion du gabarit
sous effort outil | Statique linéaire | CalculiX `*STATIC` | [A] déjà disponible |\n|
Précision dimensionnelle du jig | Géométrique OCCT + DFM | OCCT | [A] |\n\n---\n\n###
FAMILLE 9 — Structures portantes (châssis, cadres)\n\n| Mode de défaillance |
Vérification | Moteur | Coût |\n|---|---|---|---|\n| Flambage (instabilité globale) |
Flambage linéaire — charge critique + mode | CalculiX `*BUCKLE` — nouveau case (non
encore exposé) | [A] |\n| Rigidité insuffisante | Statique linéaire (déflexion max) |
CalculiX `*STATIC` | [A] déjà disponible |\n| Fatigue sur liaisons boulonnées | Fatigue
S-N | Post-traitement analytique sur σ CalculiX | [A]+[C] |\n\n---\n\n### FAMILLE 10 —
Pièces fluidiques (buses, raccords, conduits)\n\n| Mode de défaillance | Vérification |
Moteur | Coût |\n|---|---|---|---|\n| Tenue en pression interne | Statique linéaire
(pression vessel, thin-wall formula) OU FEA si géométrie complexe | CalculiX `*STATIC`
OU analytique (formule de Barlow) | [A] ou [C] |\n| Écoulement / pertes de charge | CFD
incompressible | OpenFOAM (GPL v3) — nouveau moteur, complexité élevée | [B] |\n|
Compatibilité chimique matière/fluide | Oracle catalogue (table chimique
matériau/fluide) | Pas de moteur — catalogue revue | [C] |\n\n---\n\n## 3. Oracles
non-physiques\n\n| Oracle | Vérification | Moteur | Coût |\n|---|---|---|---|\n| **Masse
analytique** | Volume × densité explicite | OCCT (déjà via build123d) — **DÉJÀ
DISPONIBLE** | [A] déjà fait |\n| **Encombrement / collision** | Interférence
géométrique entre pièces | OCCT `BRepAlgoAPI_Check` / `BRepExtrema_DistShapeShape` —
déjà dans la chaîne | [A] |\n| **DFM FDM — imprimabilité** | Overhang > 45° (angle
normale de face vs vecteur construction), épaisseur de paroi (rayon inscrit OCCT),
bridges non soutenus, surfaces en contact plateau | OCCT + règles seuil procédé
(PrusaSlicer AGPL3 = référence de règles, non utilisé comme moteur) | [C] sur OCCT |\n|
**DFM injection molding** | Draft angles ≥ 0.5° (OCCT : angle face vs axe démoulage),
épaisseurs uniformes (max/min ratio < 3:1), contre-dépouilles (surfaces bloquant le
démoulage) | OCCT + catalogue standard (Fictiv, Protolabs comme sources revues) | [C]
sur OCCT |\n| **DFM CNC / tôlerie** | Rayon de pliage min (table matériau × épaisseur),
accès outil (angle de face vs direction d'usinage), diamètre trou minimum (fonction
profondeur) | OCCT + catalogue standard ISO 2768 | [C] sur OCCT |\n| **Conformité
filetages** | Diamètre nominal + pas vs ISO metric / UNC — vérification paramétrique |
Table revue (ISO 261 / ASME B1.13M) — Python pur, pas de moteur | [C] |\n| **Conformité
roulements** | D_alésage, D_extérieur, largeur vs ISO 15 / catalogue SKF | Table
catalogue — Python pur | [C] |\n| **Stack-up de tolérances** | Worst-case, RSS, Monte
Carlo sur chaîne de cotes | Python pur (scipy.stats.norm pour Monte Carlo) — pas de
moteur externe | [C] |\n| **Sélection / vérification matériau** | Tg, résistance à la
traction, module, coeff. dilatation, résistance chimique vs exigences déclarées | Table
revue (base matériaux FDM/SLS/injection — MatWeb ou équivalent) | [C] |\n\n---\n\n## 4.
Synthèse stratégique — Priorisation par valeur/effort\n\n### Tier 1 — Coût [A], CalculiX
déjà branché, impact large\nCes cas ne nécessitent que de nouveaux cases + checkers.
Aucun nouveau moteur.\n\n| Priorité | Vérification | Familles couvertes
|\n|---|---|---|\n| **1** | Modal / fréquentiel (`*FREQUENCY`) — fréquences propres |
RC/Robotique, Structures, Mécanismes |\n| **2** | Flambage (`*BUCKLE`) — charge critique
| Structures, Châssis, Profils |\n| **3** | Thermo-mécanique couplée
(`*COUPLED TEMP-DISP`) | Brackets thermiques, Automotive, Enclosures |\n| **4** | Fluage
(`*CREEP`) — déformation lente sous charge | Brackets PLA, Snap-fits en rétention |\n|
**5** | Statique nonlinéaire avec matériau orthotrope | Snap-fits FDM, Imprimes
anisotropes |\n\n### Tier 2 — Coût [A]+[C], moteur branché + analytique Python\n|
Priorité | Vérification | Familles couvertes |\n|---|---|---|\n| **6** | Fatigue S-N
analytique (post-σ CalculiX + Miner) | Snap-fits cycliques, Charnières, Boulonnages |\n|
**7** | DFM FDM sur OCCT (overhang, wall thickness) | Toutes les familles FDM |\n| **8**
| Stack-up de tolérances (worst-case/RSS Python) | Pièces de remplacement, Fit
assemblage |\n\n### Tier 3 — Coût [C], règles + catalogues purs (pas de FEA)\n| Priorité
| Vérification | Familles couvertes |\n|---|---|---|\n| **9** | Sélection matériau
(table Tg / résistance / T service) | Pièces de remplacement, Automotive, RC |\n| **10**
| DFM injection molding (draft angles OCCT + règles) | Makers passant au plastic
injection |\n| **11** | Conformité filetages / roulements (tables ISO) | Mécanismes,
Assemblages boulonnés |\n\n### Tier 4 — Coût [B], nouveau moteur à brancher
(différer)\n| Vérification | Moteur candidat | Justification du différé
|\n|---|---|---|\n| Fatigue avancée multiaxiale (Dang Van) | code_aster (GPL, EDF) |
Coût élevé ; analytique Tier 2 couvre 80% du segment cible |\n| CFD (écoulement, pertes
de charge) | OpenFOAM (GPL v3) | Niche parmi le segment maker ; barrière d'expertise
utilisateur élevée |\n| Électrothermique PCB (Rth jonction précis) | ngspice | Redondant
avec OpenModelica MSL.Thermal pour le segment cible |\n\n---\n\n## 5. L'insight
structurel clé\n\n**Le moteur CalculiX couvre déjà l'ensemble du spectre
structurel-thermique-dynamique dont le segment cible a besoin.** La valeur à débloquer
n'est pas dans l'ajout de nouveaux moteurs mais dans l'exposition des types d'analyse
CalculiX déjà natifs qui ne sont pas encore wrappés en opérations enregistrées :
`*FREQUENCY` (modal), `*BUCKLE` (flambage), `*COUPLED TEMPERATURE-DISPLACEMENT`
(thermo-mécanique), `*CREEP` (fluage).\n\n**Le vrai différenciateur Casys sur tous ces
cas — y compris ceux couverts gratuitement par SimScale / Fusion 360 — reste la chaîne
de preuve** : résultat haché + lié à une exigence signée dans un `ThreadSnapshot`
immuable. Aucun concurrent ne produit cela.", "sources": [
"http://www.dhondt.de/ov_calcu.htm", "https://www.dhondt.de/ccx_2.22.pdf",
"https://web.mit.edu/calculix_v2.7/CalculiX/ccx_2.7/doc/ccx/node129.html",
"https://web.mit.edu/calculix_v2.7/CalculiX/ccx_2.7/doc/ccx/node128.html",
"https://www.feacluster.com/CalculiX/ccx_2.18/doc/ccx/node285.html",
"https://www.calculix.de/",
"https://www.simscale.com/blog/fea-online-structural-analysis-code_aster-simscale/",
"https://cloudhpc.cloud/2025/03/13/cracking-the-code-using-code-aster-for-creep-and-fatigue-assessment-in-api-579-1-asme-ffs/",
"https://www.opennovation.org/profiles/aster.html",
"https://engineeringdownloads.com/what-is-the-best-fea-software-in-2025/",
"https://en.wikipedia.org/wiki/Elmer_FEM_solver",
"https://research.csc.fi/service/elmer/", "https://www.elmerfem.org/blog/",
"https://ngspice.sourceforge.io/ngspice-electrothermal-tutorial.html",
"https://ngspice.sourceforge.io/",
"https://old.opencascade.com/content/collision-detection",
"https://dev.opencascade.org/project/pythonocc",
"https://grokipedia.com/page/OpenModelica",
"https://gaugehow.com/simulation/best-cfd-software-2026-commercial-vs-open-source",
"https://www.resolvedanalytics.com/theflux/comparing-cfd-software-part-2-open-source-cfd-software-packages",
"https://sigmaexacta.com/stack_up_analysis",
"https://www.firgelliauto.com/blogs/engineering-calculators/tolerance-stack-up-calculator-worst-case-and-rss",
"https://www.tolanalysis.com/",
"https://sdcverifier.com/structural-engineering-101/rainflow-counting-approach/",
"https://simulations4all.com/simulations/fatigue-life-sn-curve",
"https://www.autodesk.com/products/fusion-360/simulation-extension",
"https://www.simscale.com/product/pricing/",
"https://www.onshape.com/en/features/simulation",
"https://help.solidworks.com/2025/english/SolidWorks/cosmosxpresshelp/c_overview_of_solidworks_simulationxpress.htm",
"https://www.protolabs.com/resources/design-tips/navigating-protoquote/",
"https://www.dfmanalysis.com/", "https://caeflow.com/fea/free-fea-program/",
"https://www.epsilonforge.com/post/best-open-source-finite-elements/" ] }

---

## Agent output 4

Voici la synthèse complète, conservée directement ci-dessous.

---

Les points clés à retenir :

**Chiffre principal : 30 % → 55 % → 80 %**

Le saut de 30 à 55 est quasi gratuit — quatre nouveaux cases CalculiX (`*FREQUENCY`,
`*BUCKLE`, `*CREEP`, `*COUPLED TEMPERATURE-DISPLACEMENT`), zéro nouveau moteur. CalculiX
les supporte nativement, le wrapping est déjà en place. Ce sont les cas structurellement
les plus critiques du segment : bras RC sous vibration, brackets PLA qui fluent en été,
boîtiers avec drivers stepper.

**Les trois quick wins à prioriser dans l'ordre :**

1. **Modal** — débloque RC/Robotique et Structures (+12 pts), demande forum la plus
   explicite
2. **Fluage** — mode de défaillance n°1 non couvert pour brackets et snap-fits (+9 pts),
   paramètres Norton PLA disponibles dans la littérature
3. **Thermo-mécanique couplée** — débloque Automotive et enclosures électroniques sous
   charge thermique (+8 pts)

**Le plafond à 80 % est honnête.** Les 20 % restants butent sur trois trous sans moteur
mûr : anisotropie FDM (paramètres Ex/Ez non catalogués), fluage long terme polymère
(constantes Norton incomplètes pour PETG/ASA/CoPA), et retrait dimensionnel FDM
(stochastique, non calculable par FEA). La réponse produit est de déclarer ces limites —
pas de les estimer silencieusement.

**Ce qui différencie Casys de SimScale/Fusion/Onshape** n'est pas le type d'analyse (ils
donnent la statique gratuitement depuis des années) mais la chaîne de preuve : résultat
haché + lié à une exigence signée dans un `ThreadSnapshot` immuable. Aucun concurrent ne
produit cela.
