// Simulation modules that do not serve drawing: their code and data stay, they are kept out of the interface
import type { LayerId } from "@/components/layers";
import { MAP_COMMANDS } from "@/components/map-commands";
import { LAYER_PRESETS, LAYER_TOGGLES } from "@/components/options/tabs/layers-tab";

const HIDDEN_LAYERS: LayerId[] = ["goods", "markets", "trade", "military", "journeys"];
const HIDDEN_PRESETS = ["goods", "trade", "military"];

// ids of the Tools tab buttons, which are also the ids of the commands they run
const HIDDEN_CONTROLS = [
  "editGoods",
  "overviewMarketsButton",
  "productionChains",
  "editTradeAnimationButton",
  "overviewMilitaryButton",
  "regiments",
  "overviewJourneysButton",
  "transports",
  "regenerateEconomy",
  "regenerateGoods",
  "regenerateMarkets",
  "regenerateMilitary",
  "regenerateProduction",
  "exportCsvGoods",
  "exportCsvMarkets",
  "exportCsvMilitary",
  "exportCsvRegiments",
  "getApp", // the desktop app it offers is the original program, not this one
  "getAppButton"
];

for (const layer of HIDDEN_LAYERS) LAYER_TOGGLES.delete(layer);
for (const preset of HIDDEN_PRESETS) {
  delete LAYER_PRESETS[preset];
  document.querySelector(`#layersPreset option[value="${preset}"]`)?.remove(); // the Layers tab is already rendered
}

for (let index = MAP_COMMANDS.length - 1; index >= 0; index--) {
  const { id, layer } = MAP_COMMANDS[index];
  if (HIDDEN_CONTROLS.includes(id) || (layer && HIDDEN_LAYERS.includes(layer))) MAP_COMMANDS.splice(index, 1);
}

const style = document.createElement("style");
style.id = "hiddenModules";
style.textContent = `${HIDDEN_CONTROLS.map(id => `#${id}`).join(", ")} { display: none !important; }`;
document.head.append(style);
