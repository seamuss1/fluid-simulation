# FluidX3D Research Notes

FluidX3D is preserved here as research material, not as part of the top-level product build.

## Location

- benchmark helper: `benchmarks/research/fluidx3d/run-fluidx3d-benchmark.ps1`
- vendored reference checkout: `benchmarks/research/fluidx3d/FluidX3D/`
- Visual Studio component profile: `benchmarks/research/fluidx3d/vsconfig-fluidx3d.vsconfig`

## Why It Is Isolated

- it is a separate solver family and codebase from the new native tank-fill scaffold
- it carries its own build system, binaries, and hardware assumptions
- keeping it in `benchmarks/research/` makes the dependency boundary explicit

Use it for benchmarking, comparison, and engineering reference only.
