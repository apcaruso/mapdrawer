// A name typed right where the thing was placed: a field over the map, prefilled and selected. Enter or clicking
// elsewhere keeps what was typed, Escape keeps the proposed name
import type { Point } from "@/types/global";

const INPUT_ID = "inlineName";

interface InlineNameOptions {
  point: Point; // map coordinates the field appears at
  value: string;
  placeholder?: string;
  onCommit: (name: string) => void; // called once, only with a changed, non-empty name
}

let commitOpen: (() => void) | null = null;

export function editNameInline({ point, value, placeholder, onCommit }: InlineNameOptions): void {
  commitOpen?.(); // one field at a time: a new one keeps what was typed in the last

  const viewbox = document.getElementById("viewbox") as SVGGraphicsElement | null;
  const svg = document.getElementById("map") as SVGSVGElement | null;
  const matrix = viewbox?.getScreenCTM();
  if (!svg || !matrix) return;
  const screen = new DOMPoint(point[0], point[1]).matrixTransform(matrix);

  const input = document.createElement("input");
  input.id = INPUT_ID;
  input.value = value;
  input.placeholder = placeholder ?? "";
  input.spellcheck = false;
  Object.assign(input.style, {
    position: "fixed",
    left: `${screen.x}px`,
    top: `${screen.y - 30}px`,
    transform: "translateX(-50%)",
    zIndex: "2",
    width: `${Math.max(8, value.length + 2)}ch`,
    font: "inherit",
    padding: "0.1em 0.3em",
    border: "1px solid var(--dark-solid)",
    borderRadius: "3px",
    background: "var(--bg-dialogs)"
  });

  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    commitOpen = null;
    const name = input.value.trim();
    input.remove();
    if (keep && name && name !== value) onCommit(name);
  };
  commitOpen = () => finish(true);

  input.addEventListener("input", () => (input.style.width = `${Math.max(8, input.value.length + 2)}ch`));
  input.addEventListener("keydown", event => {
    event.stopPropagation(); // typed letters are a name, not tool shortcuts
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));

  document.body.append(input);
  input.focus();
  input.select();
}

/** keep what was typed in an open field, e.g. when the tool that opened it stops */
export function commitInlineName(): void {
  commitOpen?.();
}
