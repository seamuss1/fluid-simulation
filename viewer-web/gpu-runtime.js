// Runtime qualification and telemetry for the WebGL flow solver.
//
// WebGL can request a high-performance GPU, but it cannot select an adapter by
// physical device name. The strict query parameter below turns that limitation
// into a fail-fast check:
//   ?requireGpu=Arc%20Pro%20B70
//
// In strict mode the page starts only when the browser exposes the unmasked
// renderer name, it matches the requested GPU, and asynchronous GPU timing is
// available. The selected renderer and timing samples remain local in
// window.__fluidGpuTelemetry for inspection from DevTools or test automation.
(function (root) {
  "use strict";

  const SOFTWARE_RENDERER_PATTERN = /swiftshader|software|llvmpipe|angle\s*\(.*warp|microsoft basic render driver/i;
  const TELEMETRY_EVENT = "fluidsim:gpu-telemetry";
  const SAMPLE_INTERVAL_FRAMES = 30;
  const MAX_PENDING_QUERIES = 3;
  const STRICT_SAMPLE_TIMEOUT_MS = 5000;

  class GpuRequirementError extends Error {
    constructor(message) {
      super(message);
      this.name = "GpuRequirementError";
    }
  }

  function readRequirement(search) {
    const query = new URLSearchParams(
      typeof search === "string" ? search : root.location?.search || ""
    );
    const isStrict = query.has("requireGpu");
    const expectedRenderer = (query.get("requireGpu") || "").trim();

    if (isStrict && !expectedRenderer) {
      throw new GpuRequirementError("A required GPU name must be provided after ?requireGpu=.");
    }

    return {
      expectedRenderer,
      strict: isStrict,
      requestedPowerPreference: "high-performance",
    };
  }

  function normalizeIdentity(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[®™]/g, "")
      .replace(/\b(?:tm|r)\b/g, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  function identityTokens(value) {
    return normalizeIdentity(value)
      .split(" ")
      .filter((token) => token.length >= 2);
  }

  function rendererMatches(expectedRenderer, actualRenderer) {
    const expected = identityTokens(expectedRenderer);
    const actual = normalizeIdentity(actualRenderer);
    return expected.length > 0 && expected.every((token) => actual.includes(token));
  }

  function shortLabel(value, maximumLength = 54) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > maximumLength ? `${text.slice(0, maximumLength - 1)}…` : text;
  }

  function safeParameter(gl, parameter) {
    try {
      return gl.getParameter(parameter);
    } catch {
      return null;
    }
  }

  function publishTelemetry(telemetry) {
    root.__fluidGpuTelemetry = telemetry;

    if (typeof root.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
      root.dispatchEvent(new root.CustomEvent(TELEMETRY_EVENT, { detail: telemetry }));
    }
  }

  function collectTelemetry(gl, requirement, debugExtension, timerExtension) {
    const renderer = debugExtension
      ? safeParameter(gl, debugExtension.UNMASKED_RENDERER_WEBGL)
      : safeParameter(gl, gl.RENDERER);
    const vendor = debugExtension
      ? safeParameter(gl, debugExtension.UNMASKED_VENDOR_WEBGL)
      : safeParameter(gl, gl.VENDOR);

    return {
      schemaVersion: 1,
      collectedAt: new Date().toISOString(),
      requirement: {
        strict: requirement.strict,
        expectedRenderer: requirement.expectedRenderer || null,
        requestedPowerPreference: requirement.requestedPowerPreference,
      },
      renderer: {
        value: renderer ? String(renderer) : null,
        vendor: vendor ? String(vendor) : null,
        unmaskedAvailable: Boolean(debugExtension),
      },
      context: {
        webglVersion: safeParameter(gl, gl.VERSION),
        shadingLanguageVersion: safeParameter(gl, gl.SHADING_LANGUAGE_VERSION),
        attributes: gl.getContextAttributes(),
      },
      capabilities: {
        maxTextureSize: safeParameter(gl, gl.MAX_TEXTURE_SIZE),
        maxDrawBuffers: safeParameter(gl, gl.MAX_DRAW_BUFFERS),
        maxColorAttachments: safeParameter(gl, gl.MAX_COLOR_ATTACHMENTS),
        supportedExtensions: (gl.getSupportedExtensions() || []).sort(),
      },
      timing: {
        extensionAvailable: Boolean(timerExtension),
        gpuFrameMs: null,
        validSamples: 0,
        disjointSamples: 0,
        pendingQueries: 0,
        firstSampleAt: null,
        lastSampleAt: null,
      },
      state: "initializing",
      error: null,
    };
  }

  function validateRenderer(telemetry, requirement) {
    if (!requirement.strict) {
      return;
    }

    if (!telemetry.renderer.unmaskedAvailable) {
      throw new GpuRequirementError(
        "The browser hides the unmasked WebGL renderer, so the required GPU cannot be verified."
      );
    }

    if (!telemetry.renderer.value) {
      throw new GpuRequirementError("The browser did not report a WebGL renderer.");
    }

    if (SOFTWARE_RENDERER_PATTERN.test(telemetry.renderer.value)) {
      throw new GpuRequirementError(
        `A software renderer was selected (${telemetry.renderer.value}).`
      );
    }

    if (!rendererMatches(requirement.expectedRenderer, telemetry.renderer.value)) {
      throw new GpuRequirementError(
        `Required GPU '${requirement.expectedRenderer}' was not selected; browser reported '${telemetry.renderer.value}'.`
      );
    }
  }

  function createMonitor(gl) {
    const requirement = readRequirement();
    const debugExtension = gl.getExtension("WEBGL_debug_renderer_info");
    const timerExtension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const telemetry = collectTelemetry(gl, requirement, debugExtension, timerExtension);
    let activeQuery = null;
    const pendingQueries = [];
    let frameIndex = 0;
    let firstQueryStartedAt = null;
    let stopped = false;
    let timingEnabled = Boolean(timerExtension);

    try {
      validateRenderer(telemetry, requirement);

      if (requirement.strict && !timerExtension) {
        throw new GpuRequirementError(
          "EXT_disjoint_timer_query_webgl2 is unavailable, so GPU work cannot be timed and verified."
        );
      }
    } catch (error) {
      telemetry.state = "failed";
      telemetry.error = error instanceof Error ? error.message : String(error);
      publishTelemetry(telemetry);
      root.console?.error?.("[Fluid Simulation GPU requirement]", error);
      throw error;
    }

    telemetry.state = requirement.strict ? "verified-renderer-awaiting-timing" : "unverified";
    publishTelemetry(telemetry);
    root.console?.info?.("[Fluid Simulation GPU telemetry]", telemetry);

    function clearTimingQueries() {
      if (activeQuery) {
        try {
          gl.endQuery(timerExtension.TIME_ELAPSED_EXT);
        } catch {
          // The timing query may not have begun or the context may be lost.
        }
        gl.deleteQuery(activeQuery);
        activeQuery = null;
      }

      for (const query of pendingQueries) {
        gl.deleteQuery(query);
      }
      pendingQueries.length = 0;
      telemetry.timing.pendingQueries = 0;
    }

    function handleTimingFailure(message) {
      clearTimingQueries();
      timingEnabled = false;
      telemetry.state = requirement.strict ? "failed" : "degraded";
      telemetry.error = message;
      publishTelemetry(telemetry);

      if (requirement.strict) {
        throw new GpuRequirementError(message);
      }

      root.console?.warn?.("[Fluid Simulation GPU telemetry]", message);
    }

    function recordDisjoint() {
      telemetry.timing.disjointSamples += 1;
      handleTimingFailure("The GPU timing stream became disjoint, so its measurements are inconclusive.");
    }

    function consumeCompletedQueries(now) {
      if (!timingEnabled) {
        return;
      }

      const isDisjoint = Boolean(safeParameter(gl, timerExtension.GPU_DISJOINT_EXT));
      if (isDisjoint) {
        recordDisjoint();
        return;
      }

      while (pendingQueries.length > 0) {
        const query = pendingQueries[0];
        const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
        if (!available) {
          break;
        }

        pendingQueries.shift();
        const completedWithDisjointTimer = Boolean(safeParameter(gl, timerExtension.GPU_DISJOINT_EXT));
        const elapsedNanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT);
        gl.deleteQuery(query);

        if (completedWithDisjointTimer) {
          recordDisjoint();
          return;
        }

        telemetry.timing.gpuFrameMs = Number(elapsedNanoseconds) / 1_000_000;
        telemetry.timing.validSamples += 1;
        telemetry.timing.firstSampleAt ||= now;
        telemetry.timing.lastSampleAt = now;
        telemetry.timing.pendingQueries = pendingQueries.length;
        telemetry.state = requirement.strict ? "verified" : "timing";
        publishTelemetry(telemetry);
      }
    }

    return {
      telemetry,
      isStrict() {
        return requirement.strict;
      },
      beginFrame(now) {
        if (stopped || !timingEnabled || activeQuery || pendingQueries.length >= MAX_PENDING_QUERIES) {
          return;
        }

        if (frameIndex % SAMPLE_INTERVAL_FRAMES !== 0) {
          frameIndex += 1;
          return;
        }

        try {
          activeQuery = gl.createQuery();
          if (!activeQuery) {
            handleTimingFailure("The browser could not create a GPU timing query.");
            return;
          }
          gl.beginQuery(timerExtension.TIME_ELAPSED_EXT, activeQuery);
          firstQueryStartedAt ||= now;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          handleTimingFailure(`GPU timing could not start: ${detail}`);
        } finally {
          frameIndex += 1;
        }
      },
      endFrame() {
        if (!activeQuery) {
          return;
        }

        try {
          gl.endQuery(timerExtension.TIME_ELAPSED_EXT);
          pendingQueries.push(activeQuery);
          telemetry.timing.pendingQueries = pendingQueries.length;
          publishTelemetry(telemetry);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          handleTimingFailure(`GPU timing could not finish: ${detail}`);
        } finally {
          activeQuery = null;
        }
      },
      poll(now) {
        if (stopped || !timingEnabled) {
          return;
        }

        if (gl.isContextLost()) {
          if (requirement.strict) {
            handleTimingFailure("The verified GPU context was lost.");
          }
          return;
        }

        try {
          consumeCompletedQueries(now);
        } catch (error) {
          if (error instanceof GpuRequirementError) {
            throw error;
          }
          const detail = error instanceof Error ? error.message : String(error);
          handleTimingFailure(`GPU telemetry query failed: ${detail}`);
        }

        if (
          requirement.strict &&
          firstQueryStartedAt !== null &&
          telemetry.timing.validSamples === 0 &&
          now - firstQueryStartedAt > STRICT_SAMPLE_TIMEOUT_MS
        ) {
          handleTimingFailure("GPU timing did not return a valid sample within 5 seconds.");
        }
      },
      stop() {
        stopped = true;
        clearTimingQueries();
        publishTelemetry(telemetry);
      },
      statusLabel() {
        const renderer = shortLabel(telemetry.renderer.value || "GPU renderer unavailable");
        const timing = Number.isFinite(telemetry.timing.gpuFrameMs)
          ? `GPU ${telemetry.timing.gpuFrameMs.toFixed(1)} ms`
          : timingEnabled
            ? "GPU timing pending"
            : "GPU timing unavailable";
        return `${renderer} · ${timing}`;
      },
    };
  }

  const api = {
    GpuRequirementError,
    createMonitor,
    readRequirement,
    rendererMatches,
  };

  root.FluidGpuRuntime = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
