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
| 2–9 | da fare | |

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
- **Mappe casuali e grafo stabile.** Le mappe casuali usano ancora il grafo classico.
  Gli strumenti dello Step 3 richiedono il grafo stabile, quindi va scelto se convertire una mappa alla prima modifica
  del terreno (via il percorso *Risk*) oppure generare stabili anche le mappe casuali.
- Su una mappa vuota il campo di distanza `cells.t` vale 0 ovunque, perché non c'è costa. Si sistema da solo al primo markup con terra.
- Fino allo Step 3 la terra si disegna solo con il vecchio editor heightmap. In modalità *Erase*,
  all'uscita rigenera ancora culture e stati a caso.

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
