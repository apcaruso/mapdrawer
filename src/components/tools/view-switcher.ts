// The view switcher: always on screen at the bottom left, one button per map view
import { Layers } from "@/components/layers";
import { MAP_VIEWS, MapViews, VIEW_IDS, type ViewId } from "@/components/map-views";
import { showDataTip } from "@/components/tooltips";
import { debounce } from "@/utils";

const SWITCHER_ID = "viewSwitcher";

const STYLE = /* css */ `
  #${SWITCHER_ID} {
    position: fixed;
    left: calc(var(--tool-palette-right, 50px) + 10px); /* the palette may reach down this far on a short screen */
    bottom: calc(1vw + 30px); /* above the tip line */
    z-index: 1;
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--bg-main);
    border: 1px solid var(--dark-solid);
    border-radius: 4px;
    font-size: max(1em, 12px);
    user-select: none;
  }
  #${SWITCHER_ID} button {
    padding: 0.35em 0.7em;
    font-size: 1em;
    color: #333;
    background: var(--bg-light);
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
  }
  #${SWITCHER_ID} button:hover {
    background: var(--light-solid);
    border-color: var(--dark-solid);
  }
  #${SWITCHER_ID} button.pressed {
    color: #fff;
    background: var(--header-active);
    border-color: var(--dark-solid);
  }
`;

function render(): void {
  const buttons = VIEW_IDS.map(id => {
    const { name, tip } = MAP_VIEWS[id];
    return /* html */ `<button data-view="${id}" data-tip="${name} view: ${tip}">${name}</button>`;
  }).join("");

  document.head.insertAdjacentHTML("beforeend", `<style id="${SWITCHER_ID}Style">${STYLE}</style>`);
  document.body.insertAdjacentHTML("beforeend", `<div id="${SWITCHER_ID}">${buttons}</div>`);

  const switcher = document.getElementById(SWITCHER_ID)!;
  switcher.addEventListener("mousemove", debounce(showDataTip, 50));
  switcher.addEventListener("click", event => {
    const view = (event.target as HTMLElement).closest<HTMLElement>("[data-view]")?.dataset.view;
    if (view) MapViews.show(view as ViewId);
  });
}

function showCurrentView(): void {
  const current = MapViews.current();
  for (const button of document.querySelectorAll<HTMLElement>(`#${SWITCHER_ID} [data-view]`)) {
    button.classList.toggle("pressed", button.dataset.view === current);
  }
}

render();
Layers.subscribe(showCurrentView);
showCurrentView();
