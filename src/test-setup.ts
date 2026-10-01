// Make window === globalThis so module side-effects (window.rn = ...) work in Node
if (typeof window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}

// Stub DOM Node so utils/index.ts can patch its prototype without crashing
if (typeof Node === "undefined") {
  (globalThis as Record<string, unknown>).Node = {
    prototype: {
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  };
}

// Stub document so utils/index.ts DOMContentLoaded guard doesn't crash
if (typeof document === "undefined") {
  (globalThis as Record<string, unknown>).document = {
    readyState: "complete",
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null
  };
}

// Node 25+ defines a global localStorage that is undefined without --localstorage-file and shadows jsdom's
if (typeof localStorage === "undefined" || typeof localStorage?.clear !== "function") {
  // items are own properties and methods live on the prototype, so Object.keys(localStorage) lists items as in a browser
  class MemoryStorage {
    [key: string]: unknown;
    get length(): number {
      return Object.keys(this).length;
    }
    clear(): void {
      for (const key of Object.keys(this)) delete this[key];
    }
    getItem(key: string): string | null {
      return Object.hasOwn(this, key) ? (this[key] as string) : null;
    }
    key(index: number): string | null {
      return Object.keys(this)[index] ?? null;
    }
    removeItem(key: string): void {
      delete this[key];
    }
    setItem(key: string, value: string): void {
      this[key] = String(value);
    }
  }
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true, writable: true });
}

// Stub the tooltip globals (registered by services/tooltips) so the registry's
// lazy-load loading tip doesn't throw outside the browser
if (typeof window.tip === "undefined") {
  window.tip = () => {};
}
if (typeof window.clearMainTip === "undefined") {
  window.clearMainTip = () => {};
}

// jsdom implements no layout, so Range never got getBoundingClientRect/getClientRects; Quill's
// focus/scroll-into-view path calls them, so stub a zero-size DOMRect (jsdom-specific gap, see
// https://github.com/jsdom/jsdom/issues/3729)
if (typeof Range !== "undefined" && typeof Range.prototype.getBoundingClientRect !== "function") {
  const zeroRect = (): DOMRect => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({})
  });
  Range.prototype.getBoundingClientRect = zeroRect;
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {}
    }) as unknown as DOMRectList;
}

// Logging flags owned by services/logging.ts and referenced bare by bundled modules
for (const flag of ["INFO", "TIME", "ERROR", "WARN", "DEBUG"]) {
  if (typeof (globalThis as Record<string, unknown>)[flag] === "undefined") {
    (globalThis as Record<string, unknown>)[flag] = false;
  }
}

// The configuration global the app installs at boot, so a unit test gets the same defaults. The
// model is loaded last and dynamically: it reaches the modules that own each default, and those
// expect the stubs above to be in place
const { Options } = await import("@/components/options-model");

(globalThis as Record<string, unknown>).options ??= Options.getDefaultOptions();

// Those imports pull in the real tooltip module, which needs a DOM node no unit test renders.
// A test that wants the real one imports it itself, and that assignment lands after this
window.tip = () => {};
window.clearMainTip = () => {};
