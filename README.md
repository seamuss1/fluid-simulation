# Fluid Simulation

This repository is being rebased from browser-first prototypes into a native 3D tank-fill simulation platform.
The new source of truth lives in `sim-core/`, with a native viewer and benchmark harness around it.

## Current Direction

- authoritative simulation core: C++ `sim-core`
- target compute backend: Vulkan-first architecture
- first visible milestone: native tank-fill viewer with fixed timestep, deterministic replay, and mass accounting
- web: reserved for replay and inspection later, not the simulation source of truth

## Repository Layout

- `sim-core/`: standalone simulation library and public interfaces
- `viewer-native/`: GLFW + Vulkan viewer shell for the tank-fill benchmark
- `viewer-web/`: reserved replay-viewer workspace
- `benchmarks/`: tank-fill benchmark executable plus research-only references
- `prototypes/`: archived browser experiments kept runnable for comparison
- `docs/`: architecture and research notes
- `tests/`: unit and integration-style checks for `sim-core`

## Archived Prototypes

- `prototypes/canvas-fill/index.html`
- `prototypes/webgl2-fluid/index.html`

They stay runnable, but they are explicitly non-authoritative.

## Native Build

The native code uses CMake and standard C++17.
On this Windows machine, the most reliable path is to use the repo scripts so the Visual Studio toolchain is loaded and the duplicate `Path`/`PATH` environment quirk is normalized before CMake runs.

```powershell
.\scripts\configure-native.ps1
.\scripts\build-native.ps1
.\scripts\test-native.ps1
```

These scripts configure with `NMake Makefiles` through `cmake/toolchains/windows-msvc.cmake`, which avoids the broken MSBuild environment handling in this setup and skips the hanging ABI try-compile executable probe.

If you already have a sanitized Visual Studio developer shell, the equivalent raw commands are:

```powershell
cmake -S . -B build -G "NMake Makefiles" -DCMAKE_TOOLCHAIN_FILE=cmake/toolchains/windows-msvc.cmake
cmake --build build
ctest --test-dir build --output-on-failure
```

`viewer-native/` detects GLFW and Vulkan when they are installed. If they are missing, the target still builds a headless fallback so the rest of the native platform can be exercised.

## Headless Replay Artifact

The tank-fill benchmark can now run headlessly and emit a standalone HTML replay artifact you can open afterward in any browser.
The current `v2` path is tuned for a denser tank-fill scene and a WebGL2 replay that starts on a paused hero frame, then progressively refines the liquid with GPU accumulation.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-headless-replay.ps1 -BuildDir build-fixed -OutputPath artifacts\tank-fill-replay.html
```

The benchmark executable also supports direct export:

```powershell
.\build-fixed\fluidsim-tank-fill-benchmark.exe 900 artifacts\tank-fill-replay.html artifacts\tank-fill-metrics.csv
```

The generated HTML contains captured replay frames, benchmark summary metrics, a surface-height field, and a standalone WebGL2 renderer so the prototype can be inspected without rerunning the simulation.

## Research References

FluidX3D and its benchmark helper are kept under `benchmarks/research/fluidx3d/` as external research material.
They are not wired into the top-level build.
