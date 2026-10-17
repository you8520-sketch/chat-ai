(() => {
  const real = window.visualViewport;
  const fake = new EventTarget();
  const state = { kb: 0 };
  const define = (k, f) => Object.defineProperty(fake, k, { get: f });
  define("width", () => innerWidth);
  define("height", () => innerHeight - state.kb);
  define("offsetTop", () => 0);
  define("offsetLeft", () => 0);
  define("pageTop", () => scrollY);
  define("pageLeft", () => 0);
  define("scale", () => 1);
  Object.defineProperty(window, "visualViewport", { get: () => fake });
  window.__setKeyboard = (kb) => { state.kb = kb; fake.dispatchEvent(new Event("resize")); };
})();
