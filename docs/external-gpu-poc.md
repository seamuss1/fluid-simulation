# External GPU POC

## Scope

The active **Flow Paint** and **Sparks** experience in `viewer-web/index.html` is
already a WebGL2 GPU simulation. It requests a high-performance graphics
context, but browser JavaScript cannot select a particular physical GPU or eGPU.
Windows and the browser choose the adapter. The POC therefore verifies the
adapter that was actually selected instead of treating a high-performance hint
as proof.

**Pour & Spill** (`viewer-web/liquid.html`) is not part of this POC. Its
position-based particle simulation and renderer use JavaScript and Canvas 2D,
so it remains CPU-only.

## Strict Arc Pro B70 run

The launcher starts an isolated Chrome/Edge instance with Chromium's
diagnostic high-performance-GPU switch and makes the strict renderer check:

```powershell
.\scripts\run-web-on-arc.ps1
```

It serves `http://127.0.0.1:4173` when needed and opens
`viewer-web/?requireGpu=Arc%20Pro%20B70`. Pass `-BrowserPath` if the browser
to test is not Chrome or Edge in a standard installation location, and use
`-SkipServer` when an HTTP server is already listening on the chosen port.

The `requireGpu` value is an expected renderer-name substring. In strict mode,
the viewer must stop before running the simulation if renderer identity cannot
be read or does not contain `Arc Pro B70`. A successful page must report
telemetry that includes the selected vendor/renderer, GPU-frame timing, and any
invalid/disjoint timing samples. FPS or the `high-performance` request alone is
not evidence that the Arc Pro B70 executed the work.

## Windows graphics routing

Before launching the strict URL, configure the browser executable—not this
repository—in Windows:

1. Open **Settings > System > Display > Graphics**.
2. Add the desktop browser executable used for the test (for example
   `chrome.exe` or `msedge.exe`).
3. Select **Options**, choose **High performance**, confirm that it names the
   Arc Pro B70, and save.
4. Fully close and restart that browser before loading the POC URL.

This is OS routing policy, not a browser API guarantee. The renderer and timing
telemetry remains the pass/fail authority. The launcher is a proof-of-concept
aid, not a substitute for the Windows Graphics setting; it launches an isolated
browser profile so an already-running browser cannot silently ignore its switch.
If the viewer is opened inside an embedded shell, configure that shell's actual
host executable in the same way; a preference for `chrome.exe` cannot reroute a
WebGL context owned by a different process.

## POC pass/fail conditions

- **Pass:** strict-mode renderer telemetry contains `Arc Pro B70`, the WebGL2
  floating-point framebuffer capability is available, and valid asynchronous
  GPU timing samples are reported.
- **Fail fast:** WebGL2, floating-point framebuffers, renderer identity, the
  expected renderer match, or required timing telemetry is unavailable. The
  viewer should explain the failure and avoid beginning the simulation loop.
- **Fail fast:** a timing query becomes disjoint, because the timing sample is
  inconclusive and strict mode must never reinterpret it as a successful eGPU
  measurement.
