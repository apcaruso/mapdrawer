// New map: a blank ocean to draw on, or a complete random world
import {
  type BlankMapRequest,
  CLIMATE_ZONES,
  type ClimateZone,
  DEFAULT_BLANK_REQUEST,
  newBlankMap
} from "@/components/blank-map";
import { confirmationDialog, destroyDialog } from "@/components/dialog/dialog-helpers";
import { regenerateMap } from "@/components/lifecycle";
import { showLoadPane } from "@/components/options/io-panes";
import { tip } from "@/components/tooltips";
import { POINTS_BY_DENSITY } from "@/data/graph-density";
import { ensureEl } from "@/utils";

const DIALOG_ID = "newMapDialog";
const DENSITY_CHOICES = [4, 5, 6, 8];

let lastRequest: BlankMapRequest = { ...DEFAULT_BLANK_REQUEST };
let lastKind: "blank" | "random" = "blank";

function open(): void {
  if (customization) {
    tip("A new map cannot be created while an edit mode is active, please exit the mode and retry", false, "error");
    return;
  }

  destroyDialog(DIALOG_ID);
  ensureEl("dialogs").insertAdjacentHTML("beforeend", render());

  $(`#${DIALOG_ID}`).dialog({
    title: "New Map",
    resizable: false,
    width: "26em",
    position: { my: "center", at: "center", of: "svg" },
    buttons: {
      Create: () => confirmLoss(create),
      "Load map…": () => {
        close();
        showLoadPane();
      },
      Cancel: close
    },
    close: () => destroyDialog(DIALOG_ID)
  });
}

function render(): string {
  const densities = DENSITY_CHOICES.map(
    step => /* html */ `<option value="${step}" ${step === lastRequest.density ? "selected" : ""}>
      ${POINTS_BY_DENSITY[step].toLocaleString("en-US")} cells</option>`
  ).join("");
  const zones = Object.entries(CLIMATE_ZONES)
    .map(([id, { name }]) => `<option value="${id}" ${id === lastRequest.zone ? "selected" : ""}>${name}</option>`)
    .join("");

  return /* html */ `<div id="${DIALOG_ID}" class="dialog">
    <label style="display: block; margin-bottom: 0.3em">
      <input type="radio" name="newMapKind" value="blank" ${lastKind === "blank" ? "checked" : ""} />
      <b>Blank ocean</b>: an empty map to draw on
    </label>
    <div style="margin: 0 0 0.8em 1.6em; display: grid; grid-template-columns: auto 1fr; gap: 0.3em 0.6em">
      <span data-tip="More cells give finer coastlines and borders, but every edit costs more">Detail</span>
      <select id="newMapDensity">${densities}</select>
      <span data-tip="Where on the globe the map lies: it sets temperatures and the biomes new land gets">Climate</span>
      <select id="newMapZone">${zones}</select>
    </div>
    <label style="display: block">
      <input type="radio" name="newMapKind" value="random" ${lastKind === "random" ? "checked" : ""} />
      <b>Random world</b>: a complete generated map, from the Options tab settings
    </label>
  </div>`;
}

function close(): void {
  $(`#${DIALOG_ID}`).dialog("close");
}

/** ask before throwing away a map the user has been working on for a while */
function confirmLoss(proceed: () => void): void {
  const current = mapHistory.at(-1);
  const workingMinutes = current ? (Date.now() - current.registeredAt) / 60000 : 0;
  if (workingMinutes < 1) {
    proceed();
    return;
  }

  confirmationDialog({
    title: "New map",
    message: "Are you sure you want to create a new map?<br />All unsaved changes made to the current map will be lost",
    confirm: "Create",
    onConfirm: proceed
  });
}

function create(): void {
  const dialog = ensureEl(DIALOG_ID);
  lastKind =
    dialog.querySelector<HTMLInputElement>("input[name=newMapKind]:checked")?.value === "random" ? "random" : "blank";
  lastRequest = {
    density: Number(ensureEl<HTMLSelectElement>("newMapDensity").value),
    zone: ensureEl<HTMLSelectElement>("newMapZone").value as ClimateZone
  };
  close();

  if (lastKind === "random") regenerateMap();
  else newBlankMap(lastRequest);
}

export const NewMapDialog = { open };
