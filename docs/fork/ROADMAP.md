# Roadmap del fork: da generatore a strumento di disegno

## Visione

- L'app si apre su una mappa **vuota, solo oceano**.
- Si **disegna** tutto: terra, rilievi, laghi, fiumi, biomi, stati e province, città, strade, etichette, marker.
- Lo strumento attivo è sempre visibile, si cambia con un tasto, il risultato si vede subito, ogni azione si annulla con Ctrl+Z.
  Nessuna "modalità" che spegne i layer o rigenera dati.
- I generatori procedurali restano, ma come **assistenti**: si lanciano su richiesta, su un'area o una selezione
  ("genera fiumi qui", "riempi di villaggi questo stato", "suggerisci un nome"), e rispettano ciò che è stato disegnato.

---

## Avanzamento

| Step | Stato | Note |
| --- | --- | --- |
| 0 — Setup e baseline | ✅ | Niente repo GitHub (scelta dell'utente). Baseline in `perf-baseline.json`, sonda in `scripts/perf-probe.mjs` |
| 1 — Mondo vuoto | ✅ | Vedi sotto |
| 2 — ToolManager, palette, storia globale | ✅ | Vedi sotto. Barra opzioni contestuale rinviata allo Step 3, ispettore allo Step 6 |
| 3 — Terreno live | ✅ | Vedi sotto |
| 4 — Mappa fisica | ✅ | Vedi sotto |
| 5 — Mappa politica | ✅ | Vedi sotto |
| 6 — Città, strade, etichette, marker | ✅ | Vedi sotto |
| 7 — Fluidità | ✅ | Vedi sotto |
| 7.1 — Correzioni dalla prova d'uso | ✅ | Disegnare le nazioni e cambiare vista. Vedi sotto |
| 8–9 | da fare | |

Lingua dell'interfaccia: **inglese**. Moduli nascosti: economia (beni, mercati, produzione, commercio), militare, journeys.

### Cosa fa lo Step 1

- `options.map.graph.stable` (opzionale, salvato nel `.map`): `Pack.generate()` tiene ogni cella della griglia 1:1.
- `src/generators/blank-world.ts`: `BlankWorldPipeline` (oceano piatto a `h = 10`, clima, biomi, collezioni vuote,
  catalogo dei beni conservato).
- `src/components/blank-map.ts`: `newBlankMap(request)` e l'avvio `blankMapOnLoad()`.
  Default: 30.000 celle, zona "Northern temperate".
- `options.app.onLoad` accetta `"blank"` (nuovo default). `"lastSaved"` senza mappa salvata ripiega sulla mappa vuota.
- `src/controllers/new-map-dialog.ts`: F2, i pulsanti "New Map" e l'omnibar aprono un dialog Blank ocean / Random world / Load.
  Il link con `?seed=` genera ancora la mappa casuale.
- `src/components/hidden-modules.ts`: toglie layer, preset, pulsanti, comandi e scorciatoie dei moduli nascosti.
  Il codice e i dati restano, quindi le mappe casuali e i file `.map` sono invariati.
- Test: `blank-world.test.ts` (grafo stabile e pipeline). `test-setup.ts` ha uno storage in memoria per Node ≥ 25.
- Fix: Charts Overview non disegna più grafici NaN quando non ci sono dati.

### Cosa fa lo Step 2

- **`src/components/undo-history.ts` (`UndoHistory`)**: storia globale.
  - Ogni azione dichiara i domini che tocca: array per cella come `cells.state`, oppure collezioni come `states`
    o `burgs` nello stesso JSON del `.map`.
  - La storia conserva solo le differenze, fino a 100 passi o 64 MB.
  - Prima di annullare controlla che la mappa sia ancora quella lasciata dal passo. Se nel frattempo qualcosa l'ha
    modificata fuori dalla storia (un editor, una rigenerazione), rifiuta l'annullamento e lo dice, invece di
    corrompere i dati.
  - Si azzera quando cambia il mondo (nuova mappa o caricamento).
- **`src/components/tools/tool-manager.ts` (`ToolManager`)**: un solo strumento attivo, con Select come base.
  I cambi avvengono in fila, e uno strumento che si chiude da solo (dialog chiuso) torna a Select.
- **`src/components/tools/drawing-tools.ts`**: gli strumenti, come adattatori sugli editor esistenti.

  | Gruppo | Strumenti |
  | --- | --- |
  | Selezione | Select |
  | Politica | States, Provinces, Cultures, Religions (pittura) |
  | Natura | Biomes, River |
  | Luoghi | Burg, Route, Label, Marker |

  Gli strumenti di piazzamento restano attivi finché non se ne sceglie un altro.
- **`src/components/tools/tool-palette.ts`**: la palette fissa a sinistra, con Annulla e Ripeti.
  I comandi Tools/omnibar "Add burg/label/marker/route" e "Draw river" ora attivano lo strumento corrispondente.
- **PaintEditor**: chiudere il dialog o cambiare strumento **applica** (Cancel scarta). L'applicazione diventa un passo
  della storia. Gli editor espongono `paint(onClose)`, così la pittura si apre anche senza il loro dialog.
- **Creatori** di città, etichette e marker: `addAt(point)` riusabile. Città, etichette, marker, rotte e fiumi creati
  finiscono nella storia.
- **Tastiera**:

  | Tasti | Azione |
  | --- | --- |
  | V S P C R G W U O T K | Strumenti |
  | Alt + lettera | Mostra o nasconde un layer (prima bastava la lettera) |
  | Ctrl/Cmd + Z | Annulla: prima il passo interno dello strumento (l'ultima pennellata), poi la storia globale |
  | Ctrl/Cmd + Shift + Z, Ctrl + Y | Ripeti |
  | Esc | Select |
- **Test**: `undo-history.test.ts` e `tool-manager.test.ts`.
  L'e2e `lakes-layer` è stato aggiornato ad Alt + Q.

**Limiti noti dello Step 2**
- Le modifiche fatte negli editor (rinomina, cancella, rigenera) non entrano ancora nella storia. Dopo una di queste
  modifiche, Annulla rifiuta i passi precedenti invece di romperli.
- (Risolto nello Step 5: su una mappa vuota gli stati si creano al volo dal pannello di pittura.)
- Il tipo di marker è quello già scelto nel Markers Overview.

### Cosa fa lo Step 3

- **`src/generators/terrain.ts` (`Terrain`)**: cambia le altezze sul posto, sul grafo stabile.
  - Le celle "ancorate" non possono finire sott'acqua: città e centri di stati, province, culture e religioni.
  - Ricostruisce isole, laghi e oceani conservandone nomi e note. Ogni nuova feature riceve un nome dal proprio seme.
  - Rimappa gli id delle feature in città (`feature`, `port`) e rotte.
  - Ricalcola temperatura e precipitazioni, e i biomi delle **sole celle toccate**: i biomi dipinti altrove restano.
  - Toglie stato, provincia, cultura, religione e popolazione alla terra sommersa.
  - `resync()` ricostruisce i dati derivati dopo un Annulla.
- **`src/controllers/terrain-tools.ts` (`TerrainTools`)**: gli strumenti.

  | Tasto | Strumento | Cosa fa |
  | --- | --- | --- |
  | B | Pennello terra | Trasforma l'acqua in pianura con una leggera variazione d'altezza |
  | E | Pennello mare | Sommerge la terra; dentro un continente crea laghi |
  | L | Lazo | Riempie di terra la forma chiusa disegnata; con Alt, o scegliendo Sea, la scava in mare |
  | H | Alza | Crea colline e montagne |
  | D | Abbassa | Abbassa il terreno |
  | F | Leviga | Ammorbidisce i pendii |

  - Durante il tratto c'è un'anteprima colorata per altezza. A fine tratto si ha un commit e **un passo di Annulla**.
  - Il bordo dei pennelli terra e mare ha un'irregolarità regolabile (rumore legato alle coordinate, quindi tratti
    vicini combaciano).
  - Alza, Abbassa e Leviga accendono il layer heightmap.
- **`src/components/tools/tool-options.ts`**: la barra opzioni in alto (dimensione, forza, irregolarità, terra/mare
  per il lazo). I tasti `[` `]` `+` `−` e Shift+trascina cambiano la dimensione del pennello.
- **Mappe casuali**: al primo strumento di terreno compare la proposta di conversione.
  - La conversione è un ricampionamento identico (`Resample.process`) sul grafo stabile, ad almeno 20k celle.
  - Stati, città, rotte, fiumi e il resto vengono portati sopra.
  - Non è annullabile, e il dialog lo dice.
- **Fix al ricampionamento**, utile anche per Transform e Submap: due città che finiscono nella stessa cella non vengono
  più cancellate, la seconda va nella cella di terra libera più vicina. Su una mappa casuale di prova si perdevano
  26 città su 736; ora nessuna.
- Il popup di aggiornamento dell'originale (novità, Discord, Patreon) è disattivato. Palette e barra opzioni si
  nascondono durante lo splash di caricamento.
- **Test**: `terrain.test.ts` (6 casi).

**Misure dello Step 3** (prova in Chromium headless: continente, 2 isole, lago, crinale e isola col lazo in 13 passi,
13 Annulla fino all'oceano vuoto, 13 Ripeti fino alla mappa identica)

| Celle | Commit di un tratto, frame incluso |
| --- | --- |
| 30k | 32–100 ms |
| 50k | 47–125 ms |

| Altro | Valore |
| --- | --- |
| Conversione di una mappa casuale da 10k | ~1,4 s |

I limiti dello Step 3 (fiumi che non seguono il terreno, rilievo fermo, nessuna catena montuosa) sono risolti nello
Step 4.

### Cosa fa lo Step 4

- **Fiume (W)**: si trascina dalla sorgente alla foce.
  - **`src/generators/drawn-rivers.ts` (`DrawnRivers`)** trasforma il tratto in una catena di celle adiacenti. Ogni cella
    è ancorata al passaggio del tratto, quindi il fiume segue la mano.
  - Il fiume parte sulla terra, si ferma alla prima cella d'acqua (la foce) o al primo fiume incontrato (diventa
    affluente) e taglia i cappi.
  - Un tratto rilasciato fino a 3 celle prima di un fiume o della costa viene **agganciato** e arriva fin lì.
  - La portata cresce verso valle, quindi il fiume si allarga. La larghezza è regolabile dalla barra opzioni.
  - Gli ancoraggi diventano i punti di controllo dell'editor dei fiumi già esistente.
- **Fiumi che seguono il terreno**: `DrawnRivers.trimDrowned()` gira a ogni modifica della costa.
  - Un fiume finisce alla prima cella sommersa e parte dalla prima cella di terra, se la sorgente è affondata.
  - Se gli restano meno di 2 celle di terra viene rimosso.
  - Una modifica lontana non lo tocca.
  - Fiumi e `cells.r` sono nei domini della storia, quindi Annulla li rimette com'erano.
- **Catena montuosa (M)**: si disegna la linea del crinale.
  - Il rilievo è massimo sulla linea, decresce lungo la larghezza, ha profilo frastagliato e si assottiglia alle
    estremità.
  - Forza = altezza, larghezza dalla barra opzioni. Sopra il mare crea un arco di isole.
- **Rilievo**: `Relief.regenerateCells(cells)` rigenera le icone **solo nelle celle modificate** dal terreno o
  attraversate da un nuovo fiume. Altrove le icone, anche quelle messe a mano, restano.
- **Icone di rilievo (I)**: apre l'editor del rilievo direttamente nel pennello di piazzamento.
- **`src/components/map-freehand.ts`**: il tratto a mano libera condiviso da lazo, catena montuosa e fiume, con
  Space+trascina per spostare la mappa.
- Icone della palette: Alza → freccia su, Catena montuosa → montagna.
- **Test**: `drawn-rivers.test.ts` (9 casi: tracciato, cappi, sorgente in mare, affluenti, aggancio, accorciamento,
  rimozione).

**Prova nel browser** su mappa vuota: continente, catena montuosa fino ad altezza 98, fiume dalle montagne al mare,
affluente agganciato. Risultati:
- 7600 icone di rilievo generate, nessuna sopra un fiume;
- una modifica lontana lascia i fiumi intatti;
- una baia scavata attraverso il fiume lo accorcia da 60 a 18 celle, e Annulla lo riporta a 60;
- l'editor dei fiumi si apre con i 60 punti di controllo.

Tempi di commit: catena montuosa 65 ms, fiume 15 ms.

**Limiti noti dello Step 4**
- Le icone piazzate a mano con l'editor del rilievo non entrano nella storia.
- I biomi "automatici da clima" su un'area sono rinviati agli assistenti (Step 8); i biomi si possono già dipingere.
- I ghiacci restano nell'editor esistente, senza uno strumento nella palette.

### Cosa fa lo Step 5

- **Pittura live**: per stati, province, culture, religioni e biomi ogni tratto viene applicato quando finisce ed è
  **un passo di Annulla**. Confini, etichette e statistiche si aggiornano a fine tratto. Non c'è più Apply/Cancel, solo
  Done.
- **Secchiello (Fill)**: un clic riempie l'area contigua dello stesso colore sulla stessa terra, per esempio un'isola
  intera. Alt+clic fa lo stesso con il pennello.
- **"+" (nuovo)** nel pannello: si clicca sulla mappa e si continua a dipingere con il nuovo elemento.
  - **stato**: la capitale è un borgo esistente o uno nuovo;
  - **provincia**: su terra di uno stato;
  - **cultura** e **religione**: il centro.
  - La creazione riusa la logica degli editor, estratta in `createStateAt` e `createProvinceAt`, oppure i generatori
    (`Cultures.add`, `Religions.add`). Ogni creazione è un passo di Annulla.
- **Rinomina inline** dell'elemento selezionato (per uno stato è il nome breve: la forma si aggiunge da sola).
- **Espandi**: ogni regione cresce nella terra libera che raggiunge prima, per la via più economica (bioma, rilievo).
  - Gli stati vanno nella terra neutrale, le culture nelle wildlands, le religioni nella terra senza religione, le
    province nella terra del proprio stato.
  - Non attraversa il mare. L'algoritmo è un Dijkstra multi-sorgente in `src/generators/region-growth.ts`.
- **Colori distinti**: i nuovi stati, culture e religioni ricevono il pastello della tavolozza più lontano da quelli in
  uso (`getDistinctColor`).
- **PaintEditor** ha nuove opzioni: `live`, `fill`, `create`, `rename`, `actions`. Senza di esse si comporta come
  prima, e i suoi 16 test restano validi.
- **Test**: `region-growth.test.ts` (3) e `colorUtils.test.ts` (3).

**Prova nel browser** su mappa vuota (continente e isola, 3 stati creati col "+", un tratto ciascuno, isola col
secchiello, poi Espandi):

| Azione | Tempo |
| --- | --- |
| Creare uno stato | 45–68 ms |
| Un tratto, confini ed etichette compresi | 31–48 ms |
| Secchiello sull'isola | 30 ms |
| Espandi su tutto il continente | ~135 ms |

- Nessuna cella neutrale rimasta.
- Rinomina e Annulla/Ripeti funzionano.
- Nessun errore.

**Limiti noti dello Step 5**
- Lo stato si crea dalla capitale; non c'è uno stato "senza capitale".
- "Genera province per uno stato" resta agli assistenti dello Step 8.
- La pittura delle zone resta nel vecchio modo (Apply/Cancel).

### Cosa fa lo Step 6

- **Città (U)**: un clic piazza la città, poi compare un **campo nome sulla mappa** con il nome proposto già
  selezionato. Invio o un altro clic confermano, Esc tiene la proposta.
  - Il tipo (town di default, oppure Auto, city, village…) si sceglie dalla barra opzioni.
  - Le strade automatiche verso la nuova città sono **spente** di default; "Roads" le riaccende.
- **Strada (O)**: si trascina lungo il percorso (`src/generators/drawn-routes.ts`).
  - Strade e sentieri restano sulla terra, le rotte marittime sull'acqua.
  - Un estremo disegnato vicino a una città (fino a 3 celle) la raggiunge.
  - Il tipo si sceglie tra i gruppi di strada.
- **Etichetta (T)**: un clic crea un'etichetta dritta, un trascinamento un'etichetta che **segue la curva** disegnata.
  - Il testo si scrive subito nel campo sulla mappa.
  - L'arco di un'etichetta dritta si adatta al testo.
- **Marker (K)**: il tipo si sceglie dal menu della barra opzioni, con l'icona.
- **Trascina per spostare**, nell'interazione di default (Select). Città, etichette di città, etichette libere e marker
  seguono il puntatore. Ogni spostamento è un passo di Annulla; un clic senza movimento apre ancora l'editor.
  `Burgs.relocate()` è ora condiviso con l'editor della città.
- **Rendering incrementale**: aggiungere o rinominare ridisegna la sola etichetta (`getLabelData` e `redrawLabel`),
  non tutte. `removeLabel` è disponibile.
- **Test**: `drawn-routes.test.ts` (4).

**Misure** (20 città di fila con clic reali, mappa casuale da circa 700 città)

| | Prima | Dopo |
| --- | --- | --- |
| Mediana per clic, frame incluso | 128 ms | 50 ms |
| Massimo per clic | 168 ms | 81 ms |

Del tempo JavaScript che resta, circa 16 ms sono la copia delle città per Annulla e 5 ms il ridisegno delle icone.

**Limiti noti dello Step 6**
- Nello stile di default una "town" è un puntino e il suo nome compare solo da zoom 2.
- Le città disegnate partono con popolazione minima, perché la terra disegnata non ha popolazione. Il calcolo della
  popolazione spetta agli assistenti (Step 8).
- Le etichette degli stati si spostano ancora dal loro editor.
- I nomi dei marker non si scrivono inline.

### Cosa fa lo Step 7

**Metodo.** Le misure vanno fatte con rasterizzazione GPU: `node scripts/perf-probe.mjs --gpu`, con Chrome for Testing in
`CHROMIUM_PATH`.
- La rasterizzazione software di Chromium headless gonfia i costi di disegno di molte volte e porta a conclusioni
  sbagliate.
- La fluidità si misura in **ms per aggiornamento della vista** (durata del gesto / passi) più i task lunghi. Gli fps
  ingannano, perché una pagina occupata mostra molti frame in cui non si è mosso nulla.

**Risultato di partenza (con GPU).**
- Una mappa con i layer di default si muove già a 60 fps.
- Lo scatto viene da due layer specifici, trovati spegnendone uno alla volta:
  - **Rilievo**: le ~7600 icone erano `<use>` di `<symbol>`, ognuna con la propria trasformazione e il proprio
    ritaglio. A **ogni** aggiornamento della pagina, anche un suggerimento al passaggio del mouse, Chrome doveva
    riorganizzarle tutte in livelli (*Layerize*): 180 ms per volta.
  - **Coordinate**: a ogni frame di spostamento il reticolo veniva ricalcolato per l'intera mappa e ricreato da zero
    (percorso e circa 190 etichette).

**Correzioni.**
- `draw-relief-icons.ts`: sullo schermo le icone visibili sono **un'unica immagine SVG**, nitida perché vettoriale.
  - Con l'editor del rilievo aperto (`setReliefEditing`) e nelle esportazioni (`renderTo`) restano elementi singoli.
  - La nuova immagine sostituisce la vecchia solo dopo il caricamento, quindi niente sfarfallii.
- `draw-coordinates.ts`: il reticolo si ricostruisce solo quando cambiano zoom, mappa o stile. Durante lo spostamento
  si muovono solo le due righe di etichette, con due trasformazioni.
- `scripts/perf-probe.mjs`: opzione `--gpu` e misura del movimento della mappa.
- Test: caso nuovo in `draw-coordinates.dom.test.ts`; quel file ora importa il modello delle opzioni e passa anche da
  solo.

**Misure** (ms per aggiornamento, GPU, mappa da 10k celle)

| Scenario | Prima | Dopo |
| --- | --- | --- |
| Mouse o spostamento a vista intera, con rilievo | 199 ms (187 task lunghi) | **17 ms (0)** |
| Spostamento a vista intera, 18 layer accesi | 57 ms | **17 ms** |
| Spostamento da zoomati, con coordinate | 80 ms (20 task lunghi) | **59 ms (0)** |
| Layer di default, tutti i gesti | 17–67 ms | invariato (già fluido) |

**Provato e scartato.**
- *Trasformazione CSS composta durante i gesti*: è un grande guadagno solo con rasterizzazione software. Con la GPU
  lo zoom diventa più lento (62 contro 23 ms), perché Chrome ridisegna comunque il layer quando la scala cambia.
- *Nascondere il rilievo durante i movimenti* (visibility o display): il costo non era il disegno durante il gesto
  ma la riorganizzazione dei livelli a ogni aggiornamento, risolta con l'immagine unica.
- *Rimandare i ridisegni a una pausa del gesto*: con frame lenti il timer scattava a metà gesto e innescava un circolo
  vizioso.

**Limiti noti dello Step 7**
- Su mappe pesanti (texture, heightmap e biomi con maschere, emblemi) lo spostamento da zoomati resta limitato dalla
  GPU, intorno ai 60 ms per aggiornamento. Il preset Performance "Speed" aiuta lo zoom indietro (102 → 67 ms).
- Un tratto di terreno su mappe da 50k celle costa ancora 50–125 ms. Servirebbe una marcatura incrementale delle
  feature, al posto di quella completa a ogni modifica della costa.
- I test DOM `draw-texture` e `label-groups` falliscono anche sul master originale in questo ambiente (manca il globale
  `options`): non sono stati toccati.

### Cosa fa lo Step 7.1 (correzioni dalla prova d'uso)

**Problemi segnalati.**
- *Disegnare le nazioni non funziona.* Con S e un trascinamento non succedeva nulla. La lista conteneva solo
  "Neutrals", già selezionato, e dipingere con Neutrals su terra neutrale non cambia nulla. Per creare uno stato
  bisognava trovare un piccolo "+" senza etichetta.
- *Non si capisce come passare dalla mappa fisica a quella politica.* Le viste esistevano solo come preset nella
  scheda Layers delle opzioni. La mappa vuota partiva con il preset politico, quindi la terra appena disegnata
  restava bianca.

**Correzioni nell'editor di pittura** (`paint-editor.ts`), valide per stati, province, culture e religioni.
- Se non esiste ancora nulla, l'editor parte in modalità **New**, con il suggerimento "No state yet: click on land…".
  - Un clic fonda lo stato.
  - Un **trascinamento** lo fonda dove inizia e dipinge subito la sua terra.
  - Se il fondatore rifiuta (ad esempio si parte dal mare), il tratto non dipinge.
- Il pulsante "+" è diventato **"+ New state"** (o province, culture, religion), accanto a Brush e Fill.
- All'apertura è selezionato un elemento vero, mai l'elemento che cancella (Neutrals, No zone…).
  - L'editor ricorda l'ultimo elemento usato per ciascun tipo, finché non si crea o carica un'altra mappa.
- La lista si rilegge dopo ogni annulla/ripeti: uno stato tolto da un annulla non resta selezionabile.
- Al passaggio del mouse:
  - sopra un elemento si vede il suo nome;
  - sopra terra libera, o in modalità New, resta visibile cosa fare, invece di "No assignment".

**Viste della mappa** (`map-views.ts`, `tools/view-switcher.ts`).
- In basso a sinistra c'è sempre la barra **Physical · Political · Provinces · Cultures · Religions · Biomes**.
  - Ogni vista è un insieme di layer.
  - Fiumi, laghi, città, strade, etichette e marker restano in tutte le viste.
- **La vista segue lo strumento.**
  - Gli strumenti del terreno portano a Physical.
  - States porta a Political, Provinces a Provinces, e così via.
  - Durante l'uso di uno strumento si può cambiare vista a mano: la scelta resta finché non si prende un altro
    strumento.
- La mappa vuota parte in vista Physical: la terra disegnata si vede subito colorata per altitudine.
- La vista politica non include il rilievo: le icone generate su tutta la terra coprivano i colori degli stati.

**Altre correzioni.**
- **Religioni.** Fondare una religione animista o non teista mandava in errore il generatore di nomi: la religione
  non ha divinità, ma il codice chiamava comunque `deity.split`. Era un bug del codice originale.
- **Religioni con lo strumento.** Dipingere religioni dalla palette disegnava i centri delle religioni, che
  appartengono all'editor, e andava in errore senza l'editor aperto.
- **Palette su schermi bassi.** La palette non esce più dallo schermo e non copre il pulsante delle opzioni: scorre
  invece di tagliarsi.
- **Test.** Nuovi `map-views.test.ts`, più cinque casi in `paint-editor.test.ts`. Due casi vecchi si aspettavano
  "Neutrals" selezionato all'apertura e sono stati aggiornati.

### Misure dopo lo Step 1

Dev server, Chromium headless.

| | Prima | Dopo |
| --- | --- | --- |
| Prima mappa a schermo | 3,5 s (casuale) | 1,1 s (vuota) |
| Creazione della mappa | ~0,8–1,3 s (casuale, 10k) | 0,19 s (vuota, 30k) |

Commit di una grossa pennellata di terra sul grafo stabile (ricalcolo di features, clima e biomi, più il ridisegno di
ocean, landmass, lakes e coastline):

| Celle | Commit |
| --- | --- |
| 10k | 35 ms |
| 20k | 41 ms |
| 30k | 43 ms |
| 50k | 69 ms |

I budget dello Step 3 sono già rispettati.

### Lasciato aperto

- **Test e2e non eseguiti**, come chiede la regola del progetto.
  - `controller-launchers` e `states` sono stati adattati, perché cliccavano pulsanti ora nascosti.
  - Le spec che usano la mappa di `/` senza `?seed=` ora ricevono la mappa vuota: alcune andranno adattate.
- Su una mappa vuota il campo di distanza `cells.t` vale 0 ovunque, perché non c'è costa. Si sistema da solo al primo markup con terra.
- Il vecchio editor heightmap resta nella tab Tools. In modalità *Erase*, all'uscita rigenera ancora culture e stati a caso.

---

## Stato attuale: cosa rende l'app macchinosa

### Misure

Rilevate su dev server con Chromium headless, mappa di default da circa 10k celle:

| Operazione                                                | Costo             |
| --------------------------------------------------------- | ----------------- |
| Generazione completa                                      | ~1.0–1.2 s        |
| `Layers.drawAll()`                                        | ~170–215 ms       |
| Ridisegno etichette (`labels`)                            | **85–190 ms**     |
| `Features.markupGrid` / temperature / precipitazioni      | 1–7 / ~1 / 1–6 ms |
| `Biomes.define`                                           | 3–5 ms            |
| Ridisegno `ocean` + `landmass` + `lakes` + `coastline`    | 26–39 ms          |
| **Mappa tutta oceano**                                    | **crash**         |

- Il crash avviene allo step `defaultRuler`, con l'errore *"Cannot read properties of undefined (reading 'map')"*.
  `Pack.generate()` scarta ogni cella d'oceano profondo ([pack-generator.ts:31](../../src/generators/pack-generator.ts)),
  quindi senza terra `pack` resta con 0 celle.
- I passi legati al terreno costano poco, quindi un editing del terreno **live** (ricalcolo a fine pennellata) è fattibile.
- Le etichette sono il layer più caro e vengono ridisegnate per intero a ogni città, stato o etichetta aggiunta.
  Da qui lo scatto a ogni click.

### Cause strutturali

1. **Doppio grafo `grid`/`pack`.** `pack` dipende dalla linea di costa: scarta l'oceano profondo e infittisce la costa.
   Ogni modifica alla costa rigenera il grafo e cambia gli id delle celle. A quel punto stati, culture, città e rotte
   vanno rimappati (modalità *Risk*, con perdita di dati) oppure rigenerati a caso (modalità *Erase*).
2. **Editor heightmap modale e distruttivo** ([heightmap-editor.ts](../../src/controllers/heightmap-editor.ts)).
   - Spegne tutti i layer e disegna un poligono per cella con un join d3.
   - All'uscita lancia `ErasePipeline`, che **rigenera casualmente** culture, città, stati, religioni, province ed economia.
   - Pretende almeno 200 celle di terra.
3. **Le entità create pescano dal caso e ridisegnano tutto.**
   - `Burgs.add` assegna nome e stemma casuali e chiama `Routes.connect` (rotte automatiche),
     poi esegue `Layers.draw("burgIcons", "labels", "routes")`.
   - `addState` fa lo stesso con nome, colore e stemma.
4. **Strumenti sepolti.** Si passa dalla tab Tools del pannello Options a una griglia di bottoni e poi a dialog jQuery UI.
   Le modalità sono numeri nella globale `customization` (1 heightmap, 2 paint, 3 add state…),
   più toggle sparsi in `map-placement`.
5. **Nessun undo globale.** Ctrl+Z clicca il `#undo` del dialog aperto ([hotkeys.ts:50](../../src/components/hotkeys.ts)).
   Una storia esiste solo nell'editor heightmap (snapshot completi) e nel PaintEditor (diff).
6. **Il caso è il default.** All'avvio viene generata una mappa casuale (`checkLoadParameters`) e F2 ne rigenera un'altra.

### Mattoni già pronti da riusare

- **`MapBrush`** ([map-brush.ts](../../src/components/map-brush.ts)): pennello con throttling a rAF;
  Shift+drag cambia la dimensione, Space+drag sposta la mappa.
- **`PaintEditor`** ([paint-editor.ts](../../src/controllers/paint-editor.ts)): pittura per cella con overlay, diff e undo.
  Già usato da stati, province, culture, religioni, biomi, zone e mercati.
- **Operazioni heightmap**: `addRange`, `addTrough`, `smooth`, `modify`, il riempimento a cono e la linea.
- **`restoreRiskedData`**: riferimento per rimappare entità su un grafo nuovo.
- **`Pipeline` dichiarativa** ([generation-pipeline.ts](../../src/generators/generation-pipeline.ts)):
  definire una pipeline "mondo vuoto" è semplice.
- **Registry dei layer** con `Layers.draw(id)` per il singolo layer.
- **Creatori esistenti**: città, etichette, fiumi, rotte, marker, rilievi (pennello bulk), ghiacci, laghi, costa.

---

## Decisioni architetturali

**D1. Grafo stabile per le mappe disegnate.**
Nelle mappe create per il disegno `pack` corrisponde 1:1 a `grid`: niente scarto dell'oceano, niente infittimento costiero.
- Gli id di cella non cambiano più quando cambia la costa. Si modifica `cells.h` sul posto e si ricalcolano solo i dati derivati.
- Il flag sta in `options.map.graph` (es. `stable: true`) e viaggia nel `.map`. Le mappe esistenti restano come sono.
- Costi: più celle in `pack` (l'oceano) e una costa meno fine. Si compensano con una densità di default più alta (20–30k)
  e con lo smoothing della costa già esistente. Da validare con misure nello Step 1.
- Alternativa scartata: regraph e rimappatura *Risk* a ogni pennellata. Richiederebbe secondi e perderebbe dati.

**D2. Nessuna operazione distruttiva implicita.**
Un'azione dell'utente corrisponde a una mutazione esplicita più il ridisegno dei soli layer toccati.
Nessuno strumento spegne layer o rigenera ciò che non gli è stato chiesto.

**D3. Un solo strumento attivo, con un gestore.**
Un `ToolManager` con ciclo di vita `activate`/`deactivate` sostituisce `customization` e i toggle sparsi.
Esc riporta sempre a *Seleziona*.

**D4. Storia globale a comandi.**
Una `History` registra comandi con delta (diff degli array per cella, snapshot prima/dopo delle entità) e ha un limite di memoria.
Ctrl+Z e Ctrl+Shift+Z funzionano ovunque.

**D5. Generatori come assistenti.**
Ogni generatore usato dal disegno espone una variante "su area/selezione" che rispetta lock e contenuti dipinti a mano.

**D6. Restare allineabili con upstream.**
- Il codice nuovo va in file nuovi (`src/controllers/draw/`, `src/components/tools/`…).
- Le modifiche ai file upstream restano minime e mirate.
- La compatibilità dei `.map` è preservata.

Così si possono continuare a importare i fix da `upstream`.

---

## Step

Percorso critico: **0 → 1 → 2 → 3**. Gli step 4, 5 e 6 si possono fare in qualsiasi ordine dopo il 3.
La fluidità (step 7) ha un budget in ogni step e una passata dedicata. Gli step 8 e 9 chiudono.

### Step 0 — Setup del fork e baseline *(piccolo)*

- Remote `upstream` già configurato. Va creato il repo del fork (`origin`).
- Branding minimo: nome e base path in `vite.config.ts` (oggi `/Fantasy-Map-Generator/`).
- Trasformare la sonda di misura usata per questo piano in `scripts/perf-probe.mjs`.
  Misura generazione, `drawAll`, costo dei singoli layer e nodi SVG, così ogni step si può confrontare con la baseline.

**Fatto quando:** `npm run dev`, `npm test` e `npm run build` passano e i numeri di baseline sono salvati.

### Step 1 — Mondo vuoto (tela oceanica)

- Opzione "grafo stabile" in `Pack.generate()` (D1).
- `BlankWorldPipeline`, in quest'ordine:
  1. `grid`
  2. altezze oceano piatte, con profondità configurabile
  3. `markupGrid`
  4. `mapSize`
  5. temperature e precipitazioni
  6. regraph stabile
  7. `markupPack`
  8. `defaultRuler`
  9. biomi
  10. `featureGroups`
  11. entità vuote: culture con Wildlands più una cultura "default" per i nomi, stati con i soli neutrali, nessuna religione;
      province, città, rotte, zone e marker vuoti
- Economia, militare, marker, zone e journeys sono spenti sulle mappe disegnate: diventano moduli eseguibili dopo.
- Avvio: `options.app.onLoad` accetta `"blank"`, che diventa il default.
  Un dialog "Nuova mappa" propone Vuota (dimensioni, densità, posizione nel mondo), Casuale (comportamento originale) e Carica.
- F2 e "nuova mappa" chiedono conferma e propongono la mappa vuota.
- Sistemare generatori e renderer che presuppongono la presenza di terra (es. `createDefaultRuler`, l'alert di `Cultures.generate`).

**Fatto quando:**
- l'app si apre sull'oceano senza errori in console;
- ogni layer si accende senza errori;
- un salvataggio ricaricato è identico all'originale;
- c'è uno unit test per la pipeline vuota.

**Rischi:** editor e renderer che fanno `pack.burgs[1]` o `states.find(...)` senza guardie.
Per scovarli si estende `tests/e2e/controller-launchers.spec.ts` facendogli aprire ogni editor sulla mappa vuota.

### Step 2 — Fondamenta: ToolManager, palette, storia globale

- `ToolManager` (D3) e `History` (D4). Primo cliente: il PaintEditor, che ha già i diff.
- UI:
  - **barra strumenti verticale a sinistra**, a gruppi: Seleziona, Terreno, Acque, Natura, Politica, Insediamenti, Testo;
  - **barra opzioni contestuale in alto**: dimensione e forza del pennello, elemento corrente;
  - **ispettore a destra**: proprietà dell'elemento selezionato, con accesso agli editor esistenti.
- Scorciatoie a un tasto (V, B, E, L, M, R, C, T, S…), `[` e `]` per la dimensione del pennello, Space+drag per il pan, Esc.
  Vanno conciliate con [hotkeys.ts](../../src/components/hotkeys.ts): oggi Space apre l'omnibar e Shift+lettera apre gli editor.
- Il pannello Options resta per Layers, Style e Options. La tab Tools diventa "Avanzate".

**Fatto quando:** dalla palette si passa tra 2–3 strumenti esistenti, e Ctrl+Z annulla una pittura di stato
anche dopo aver chiuso lo strumento.

### Step 3 — Terreno live *(il cuore del fork)*

- Strumenti:
  - **Pennello terra** e **pennello mare**: logica binaria terra/acqua, con altezza base sensata e bordo morbido;
  - **Lazo terra** e **lazo mare**: forma libera chiusa, poi riempimento;
  - **Rilievo**: alza, abbassa, leviga e catena montuosa (tracciata come linea), riusando le operazioni di `HeightmapGenerator`;
  - **Lago**: acqua dentro la terra, classificata come lago dal markup.
- `Terrain.commit(changedCells)`:
  - aggiorna `pack.cells.h` e `grid.cells.h`;
  - ricalcola le features (isole, laghi, oceano) e il clima;
  - ricalcola i biomi solo sulle celle cambiate che non sono state dipinte a mano;
  - gestisce le entità su celle diventate acqua: per una città blocca la modifica o chiede conferma;
  - ridisegna `ocean`, `landmass`, `lakes` e `coastline`, più `heightmap` e `relief` se sono visibili.
  - **Budget: < 50 ms a 10k celle, < 150 ms a 50k.**
- Durante il tratto, feedback leggero (overlay canvas oppure solo le celle toccate). Il commit avviene a fine tratto.
- Ogni tratto è un comando della `History`.
- Il vecchio editor heightmap resta in "Avanzate": template e import da immagine servono per ricalcare uno schizzo.

**Fatto quando:** si disegna un continente con isole e un lago in meno di un minuto,
senza entrare in nessuna "modalità" e con l'undo funzionante.

**Rischi:** fiumi su celle modificate (vanno invalidati solo quelli toccati) e resa della costa ad alta densità.

### Step 4 — Mappa fisica

- **Biomi**: pennello dalla palette (il PaintEditor è già pronto) e "auto da clima" su un'area.
  I biomi dipinti a mano non vengono sovrascritti.
- **Fiumi**:
  - disegno a mano libera, con un tratto continuo agganciato alle celle e larghezza crescente verso la foce;
  - modifica per trascinamento;
  - "genera fiumi qui" come assistente.
- **Rilievi**: pennello di icone (il bulk del relief-editor) e "auto da altezza" su un'area.
- **Ghiacci** e marker naturali.

**Fatto quando:** un fiume si disegna con un solo trascinamento e non si sposta quando il terreno cambia lontano da lui.

### Step 5 — Mappa politica

- Stati, province, culture e religioni diventano strumenti di pittura di prima classe:
  - si sceglie un elemento esistente o se ne crea uno al volo, con nome inline e colore;
  - si dipinge con pennello o **secchiello** (riempie un'isola o un'area chiusa da confini o fiumi).
- Uno stato si può creare senza capitale, da assegnare dopo. Va verificato contro le invarianti (`state.capital`, `center`).
- Confini, etichette di stato e statistiche si aggiornano in modo incrementale a fine tratto.
- Assistenti:
  - "espandi stati dalle capitali", solo nelle celle non dipinte;
  - "genera province" per uno stato.

**Fatto quando:** si dipingono 3 regni su un continente e i confini si aggiornano a fine tratto senza scatti.

### Step 6 — Città, strade, etichette, marker

- **Città**:
  - un click crea la città con un campo nome inline, precompilato con un suggerimento e modificabile subito;
  - il tipo (capitale, città, villaggio) si sceglie dalla barra opzioni;
  - si sposta trascinandola e si elimina con Canc;
  - niente rotte automatiche, salvo opzione.
- **Strade**: a mano libera, oppure città→città con un percorso suggerito (route-creator esistente).
  Tipi: strada, sentiero, rotta marittima.
- **Etichette**: click per un testo dritto, trascinamento per un'etichetta curva lungo il tratto.
  Si scrive subito e si sposta direttamente.
- **Marker**: palette di icone.
- **Rendering incrementale**: aggiungere, aggiornare o rimuovere una singola etichetta o icona,
  senza il `Layers.draw("labels")` completo (oggi 85–190 ms).
  Il solver di posizionamento delle etichette va eseguito in idle.

**Fatto quando:** si piazzano 20 città di fila senza scatti percepibili.

### Step 7 — Fluidità

- Profilare pan e zoom con la sonda: filtri SVG, aloni, texture, `ViewportLayers`.
- Durante gli strumenti si usa uno stile "editing" leggero, senza filtri pesanti.
  Lo stile completo serve per la visualizzazione e l'export.
- Spostare il lavoro pesante fuori dall'interazione, con `requestIdleCallback` o un worker
  (solver delle etichette, fiumi).
- Verificare i budget dello Step 3 su mappe da 50–100k celle.

**Fatto quando:** pan e zoom girano a 60 fps sulla mappa demo e nessun task supera i 50 ms durante il disegno.

### Step 8 — Generatori come assistenti

- Azioni "Genera…" contestuali alla selezione o all'area: nomi, fiumi, biomi, rilievi, villaggi, rotte, province,
  culture e religioni, stemmi, popolazione. Tutte rispettano i lock e ciò che è dipinto a mano.
- La "mappa casuale" completa resta come punto di partenza opzionale.
- I moduli di simulazione (economia, militare, journeys) si attivano su richiesta.

### Step 9 — Rifinitura

- Onboarding: il tour `driver.js` esistente va adattato al nuovo flusso.
- Documentazione del fork.
- Test e2e del flusso completo: mappa vuota → continente → stati → città → salva/carica.

---

## Domande aperte

- Repo GitHub del fork: pubblico o privato, e con quale nome?
- Lingua dell'interfaccia: oggi è inglese. Restiamo in inglese o aggiungiamo l'italiano?
- Densità di default delle mappe disegnate, da decidere con le misure dello Step 1.
- Quali moduli nascondere di default (economia, militare, journeys, battle screen…)?
