/*
 * STOS public frontend dependency loader
 * xterm.js 6.0.0 — MIT licensed upstream project
 *
 * This file contains no STOS credentials or gateway configuration.
 * It synchronously loads the pinned browser distribution so that
 * window.Terminal is available to the STOS interface.
 *
 * Final hardened deployment may replace this file with the actual
 * @xterm/xterm 6.0.0 lib/xterm.js distribution file.
 */
(function () {
  "use strict";
  var src = "https://unpkg.com/@xterm/xterm@6.0.0/lib/xterm.js";
  document.write(
    '<script src="' +
      src.replace(/&/g, "&amp;").replace(/"/g, "&quot;") +
      '"><\/script>'
  );
})();
