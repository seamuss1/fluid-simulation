"use strict";

const assert = require("node:assert/strict");
const runtime = require("./gpu-runtime.js");

assert.equal(
  runtime.rendererMatches("Arc Pro B70", "Intel(R) Arc(TM) Pro B70 Graphics"),
  true,
  "matches Intel's branded Arc renderer name"
);
assert.equal(
  runtime.rendererMatches("Arc Pro B70", "Intel(R) Iris(R) Xe Graphics"),
  false,
  "rejects the integrated Intel renderer"
);
assert.equal(
  runtime.rendererMatches("Arc Pro B70", "ANGLE (Intel, Arc Pro B70, D3D11)"),
  true,
  "matches the common ANGLE renderer wrapper"
);
assert.equal(
  runtime.rendererMatches("Arc Pro B70", "Google SwiftShader"),
  false,
  "does not mistake a software renderer for the Arc"
);

assert.deepEqual(runtime.readRequirement("?requireGpu=Arc%20Pro%20B70"), {
  expectedRenderer: "Arc Pro B70",
  strict: true,
  requestedPowerPreference: "high-performance",
});
assert.throws(
  () => runtime.readRequirement("?requireGpu="),
  /required GPU name/i,
  "strict mode refuses an empty target"
);

function createTimingFailureGl({ strictRenderer = false } = {}) {
  const timerExtension = {
    TIME_ELAPSED_EXT: 0x88bf,
    GPU_DISJOINT_EXT: 0x8fbb,
  };
  const debugExtension = {
    UNMASKED_RENDERER_WEBGL: 0x9246,
    UNMASKED_VENDOR_WEBGL: 0x9245,
  };

  return {
    RENDERER: 0x1f01,
    VENDOR: 0x1f00,
    VERSION: 0x1f02,
    SHADING_LANGUAGE_VERSION: 0x8b8c,
    MAX_TEXTURE_SIZE: 0x0d33,
    MAX_DRAW_BUFFERS: 0x8824,
    MAX_COLOR_ATTACHMENTS: 0x8cdf,
    QUERY_RESULT_AVAILABLE: 0x8867,
    QUERY_RESULT: 0x8866,
    getExtension(name) {
      if (name === "EXT_disjoint_timer_query_webgl2") return timerExtension;
      if (name === "WEBGL_debug_renderer_info" && strictRenderer) return debugExtension;
      return null;
    },
    getParameter(parameter) {
      if (parameter === debugExtension.UNMASKED_RENDERER_WEBGL) return "Intel(R) Arc(TM) Pro B70 Graphics";
      if (parameter === debugExtension.UNMASKED_VENDOR_WEBGL) return "Intel";
      if (parameter === this.RENDERER) return "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, D3D11)";
      if (parameter === this.VENDOR) return "WebKit";
      if (parameter === this.VERSION) return "WebGL 2.0";
      if (parameter === this.SHADING_LANGUAGE_VERSION) return "WebGL GLSL ES 3.00";
      if (parameter === this.MAX_TEXTURE_SIZE) return 4096;
      if (parameter === this.MAX_DRAW_BUFFERS) return 4;
      if (parameter === this.MAX_COLOR_ATTACHMENTS) return 4;
      if (parameter === timerExtension.GPU_DISJOINT_EXT) return false;
      return null;
    },
    getContextAttributes() {
      return { powerPreference: "high-performance" };
    },
    getSupportedExtensions() {
      return ["EXT_disjoint_timer_query_webgl2"];
    },
    createQuery() {
      return {};
    },
    beginQuery() {
      throw new Error("synthetic timer failure");
    },
    endQuery() {},
    deleteQuery() {},
    getQueryParameter() {
      return false;
    },
    isContextLost() {
      return false;
    },
  };
}

const originalLocation = globalThis.location;
const normalMonitor = runtime.createMonitor(createTimingFailureGl());
assert.doesNotThrow(
  () => normalMonitor.beginFrame(0),
  "normal mode continues when optional GPU timing fails"
);
assert.equal(normalMonitor.telemetry.state, "degraded");
assert.match(normalMonitor.statusLabel(), /GPU timing unavailable/);

globalThis.location = { search: "?requireGpu=Arc%20Pro%20B70" };
const strictMonitor = runtime.createMonitor(createTimingFailureGl({ strictRenderer: true }));
assert.throws(
  () => strictMonitor.beginFrame(0),
  /GPU timing could not start: synthetic timer failure/,
  "strict mode stops when GPU timing cannot be verified"
);

if (originalLocation === undefined) {
  delete globalThis.location;
} else {
  globalThis.location = originalLocation;
}

console.log("GPU runtime tests passed.");
