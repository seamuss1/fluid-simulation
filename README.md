# Fluid Simulation

Browser-based WebGL2 fluid simulation.

The product now leads with the client-side WebGL2 experience in `viewer-web/`. The C++ simulation code remains useful as a deterministic physics reference and benchmark suite, but it is no longer the main way people are expected to experience the project.

## Play locally

No application build or server-side simulation is required. Serve the repository over HTTP and open the viewer:

```powershell
.\scripts\serve-web.ps1
```

Then visit `http://127.0.0.1:4173/viewer-web/` in a WebGL2-capable browser.

## External-GPU proof of concept (Windows)

The live flow solver already runs on WebGL2, but browser code cannot directly
select a particular physical adapter. To route and verify an Intel Arc Pro B70,
use the fail-fast launcher:

```powershell
.\scripts\run-web-on-arc.ps1
```

It starts an isolated high-performance browser instance and requires the
WebGL renderer to match the Arc before the simulation can continue. See
[`docs/external-gpu-poc.md`](docs/external-gpu-poc.md) for Windows Graphics
settings, telemetry, and pass/fail criteria. This applies to **Flow Paint** and
**Sparks**; **Pour & Spill** remains a CPU/Canvas 2D simulation.

## What runs in the browser

- Ripple Tank, a damped 2D height-field solver where taps make waves that interfere and reflect from solid obstacles
- Flow Paint and Sparks scenes driven by velocity, dye, curl, divergence, and pressure fields stored in floating-point GPU textures
- fixed 60 Hz simulation stepping with bounded catch-up for stable behavior across display refresh rates
- semi-Lagrangian advection, pressure projection, vorticity confinement, dissipation, and boundary containment
- a separate particle-based liquid scenario with volume-conserving particles and bowl collisions
- all interaction, physics stepping, and rendering on the client; the local server only serves static files
- responsive pointer controls for mouse, pen, and multi-touch input

The main controls select the simulation mode, add fluid, toggle automatic input, and change color. Additional parameters are under **Settings**.

## Repository layout

- `viewer-web/`: primary product and client-side GPU simulation
- `sim-core/`: deterministic native reference solver, mass accounting, and replay data model
- `tests/`: native physics and conservation checks
- `benchmarks/`: headless comparison and replay tooling
- `viewer-native/`: optional native reference viewer
- `prototypes/`: earlier visual experiments and captured reference images
- `docs/`: architecture and research notes

## Native reference checks

The native code still provides regression coverage for deterministic stepping and mass conservation:

```powershell
.\scripts\configure-native.ps1
.\scripts\build-native.ps1
.\scripts\test-native.ps1
```

These checks support the browser experience; they are not required to run it.
