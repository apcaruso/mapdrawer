// The options bar at the top of the map: the active tool puts its controls there and takes them away when it stops
import { showDataTip } from "@/components/tooltips";
import { debounce } from "@/utils";

const BAR_ID = "toolOptions";

const STYLE = /* css */ `
  #${BAR_ID} {
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 1em;
    padding: 0.35em 0.8em;
    font-size: max(1em, 12px);
    background: var(--bg-main);
    border: 1px solid var(--dark-solid);
    border-radius: 4px;
    user-select: none;
    white-space: nowrap;
  }
  #${BAR_ID} .toolOptionsTitle {
    font-weight: bold;
  }
  #${BAR_ID} slider-input {
    display: flex;
    align-items: center;
    gap: 0.4em;
  }
  #${BAR_ID} .toolOptionsChoice button.pressed {
    color: #fff;
    background: var(--header-active);
  }
`;

/** put the active tool's controls on the bar; returns the bar so the tool can wire them */
export function showToolOptions(title: string, controls: string): HTMLElement {
  hideToolOptions();
  if (!document.getElementById(`${BAR_ID}Style`)) {
    document.head.insertAdjacentHTML("beforeend", `<style id="${BAR_ID}Style">${STYLE}</style>`);
  }

  const bar = document.createElement("div");
  bar.id = BAR_ID;
  bar.innerHTML = `<span class="toolOptionsTitle">${title}</span>${controls}`;
  bar.addEventListener("mousemove", debounce(showDataTip, 50));
  document.body.append(bar);
  return bar;
}

export function hideToolOptions(): void {
  document.getElementById(BAR_ID)?.remove();
}
