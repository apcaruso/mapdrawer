// The tool palette: always on screen at the left edge, one button per tool, plus undo and redo
import { MAP_COMMANDS } from "@/components/map-commands";
import { DRAWING_TOOLS } from "@/components/tools/drawing-tools";
import { ToolManager } from "@/components/tools/tool-manager";
import { showDataTip } from "@/components/tooltips";
import { UndoHistory } from "@/components/undo-history";
import { debounce } from "@/utils";

const PALETTE_ID = "toolPalette";

const STYLE = /* css */ `
  #${PALETTE_ID} {
    position: fixed;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    max-height: calc(100vh - 100px); /* clear of the options button; a short screen scrolls the palette */
    overflow-y: auto;
    scrollbar-width: none;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 3px;
    background: var(--bg-main);
    border: 1px solid var(--dark-solid);
    border-radius: 4px;
    font-size: max(1em, 12px);
    user-select: none;
  }
  #${PALETTE_ID} button {
    flex-shrink: 0;
    width: 2.5em;
    height: 2.5em;
    display: grid;
    place-items: center;
    padding: 0;
    font-size: 1em;
    color: #333;
    background: var(--bg-light);
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
  }
  #${PALETTE_ID} button > * {
    pointer-events: none; /* the button is the hover target, so its tip shows the shortcut */
  }
  #${PALETTE_ID} button:hover:not(:disabled) {
    background: var(--light-solid);
    border-color: var(--dark-solid);
  }
  #${PALETTE_ID} button.pressed {
    color: #fff;
    background: var(--header-active);
    border-color: var(--dark-solid);
  }
  #${PALETTE_ID} button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  #${PALETTE_ID} hr {
    flex-shrink: 0;
    width: 80%;
    margin: 2px auto;
    border: 0;
    border-top: 1px solid var(--dark-solid);
    opacity: 0.5;
  }
`;

const shortcutOf = (code?: string) => code?.replace("Key", "");

function render(): void {
  const groups = [...new Set(DRAWING_TOOLS.map(tool => tool.group))];
  const toolButtons = groups
    .map(group =>
      DRAWING_TOOLS.filter(tool => tool.group === group)
        .map(
          tool =>
            /* html */ `<button data-tool="${tool.id}" data-tip="${tool.name}: ${tool.hint}" ${
              tool.key ? `data-shortcut="${shortcutOf(tool.key)}"` : ""
            }>${tool.icon}</button>`
        )
        .join("")
    )
    .join("<hr />");

  document.head.insertAdjacentHTML("beforeend", `<style id="${PALETTE_ID}Style">${STYLE}</style>`);
  document.body.insertAdjacentHTML(
    "beforeend",
    /* html */ `<div id="${PALETTE_ID}">
      ${toolButtons}
      <hr />
      <button id="toolUndo" class="icon-ccw" data-tip="Undo" data-shortcut="Ctrl + Z" disabled></button>
      <button id="toolRedo" class="icon-cw" data-tip="Redo" data-shortcut="Ctrl + Shift + Z" disabled></button>
    </div>`
  );

  const palette = document.getElementById(PALETTE_ID)!;
  palette.addEventListener("mousemove", debounce(showDataTip, 50));
  palette.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest("button");
    if (!button) return;
    if (button.id === "toolUndo") UndoHistory.undo();
    else if (button.id === "toolRedo") UndoHistory.redo();
    else if (button.dataset.tool) void ToolManager.activate(button.dataset.tool);
  });
}

function showActiveTool(): void {
  const active = ToolManager.getCurrent()?.id;
  for (const button of document.querySelectorAll<HTMLElement>(`#${PALETTE_ID} [data-tool]`)) {
    button.classList.toggle("pressed", button.dataset.tool === active);
  }
}

function showHistory(): void {
  const { undo, redo } = UndoHistory.peek();
  const undoButton = document.getElementById("toolUndo") as HTMLButtonElement;
  const redoButton = document.getElementById("toolRedo") as HTMLButtonElement;
  undoButton.disabled = !undo;
  redoButton.disabled = !redo;
  undoButton.dataset.tip = undo ? `Undo: ${undo}` : "Nothing to undo";
  redoButton.dataset.tip = redo ? `Redo: ${redo}` : "Nothing to redo";
}

// the commands that used to start a creator now pick the matching tool, so every entry point shares one state
const COMMAND_TOOLS: Record<string, string> = {
  addBurgTool: "burg",
  addLabel: "label",
  addMarker: "marker",
  drawRiver: "river",
  addRoute: "route"
};
for (const command of MAP_COMMANDS) {
  const tool = COMMAND_TOOLS[command.id];
  if (tool) command.run = () => ToolManager.activate(tool);
}

render();
ToolManager.register(...DRAWING_TOOLS);
ToolManager.subscribe(showActiveTool);
UndoHistory.subscribe(showHistory);
showActiveTool();
showHistory();
