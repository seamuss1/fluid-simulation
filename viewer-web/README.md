# Viewer Web

This workspace is reserved for a later replay and inspection viewer.

It is intentionally not the source of truth for simulation state.
The native `sim-core` should emit replay-friendly data first, and the browser viewer should consume that data rather than own the simulation.

For the current prototype, the headless benchmark already emits a standalone HTML replay artifact under `artifacts/`.
That export now includes a WebGL2 offline-style renderer with progressive accumulation, and it is the short-term way to inspect simulation output after a native run.
