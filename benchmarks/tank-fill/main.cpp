#include "fluidsim/sim_core.hpp"
#include "fluidsim/windows_console.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <string>

namespace {

fluidsim::SimulationConfig makeCinematicBenchmarkConfig() {
  auto config = fluidsim::makeDefaultSimulationConfig();
  config.seed = 20260418;
  config.fixedTimeStep = 1.0 / 90.0;
  config.particleMass = 0.0025;
  config.maxActiveParticles = 18000;
  config.restDensity = 997.0;
  config.gridResolution = {52, 36, 36};
  config.tankSize = {1.32, 1.15, 0.82};
  config.emitter.origin = {0.0, 1.36, 0.0};
  config.emitter.direction = {0.02, -1.0, 0.04};
  config.emitter.radius = 0.085;
  config.emitter.speed = 6.2;
  config.emitter.massPerSecond = 20.0;
  config.emitter.maxParticlesPerStep = 240;
  return config;
}

}  // namespace

int main(int argc, char** argv) {
  std::size_t stepCount = 900;
  if (argc > 1) {
    stepCount = static_cast<std::size_t>(std::strtoul(argv[1], nullptr, 10));
  }

  std::filesystem::path replayPath = "artifacts/tank-fill-replay.html";
  if (argc > 2 && argv[2] != nullptr && argv[2][0] != '\0') {
    replayPath = argv[2];
  }

  std::filesystem::path csvPath;
  if (argc > 3 && argv[3] != nullptr && argv[3][0] != '\0') {
    csvPath = argv[3];
  }

  const auto config = makeCinematicBenchmarkConfig();
  fluidsim::TankFillSimulation simulation(config);
  const std::size_t captureStride = std::max<std::size_t>(2, stepCount / 300);
  const auto replay = fluidsim::captureReplay(simulation, stepCount, captureStride);
  const auto& snapshot = simulation.snapshot();

  std::cout << std::fixed << std::setprecision(4);
  std::cout << "GPU tank fill v2 benchmark (cinematic offline prototype)\n";
  std::cout << "steps: " << stepCount << '\n';
  std::cout << "captured frames: " << replay.frames.size() << '\n';
  std::cout << "surface grid: " << config.gridResolution[0] << " x " << config.gridResolution[2] << '\n';
  std::cout << "fill height: " << snapshot.metrics.fillHeight << " m\n";
  std::cout << "active particles: " << snapshot.metrics.activeParticleCount << '\n';
  std::cout << "emitted mass: " << snapshot.massLedger.emittedMass << " kg\n";
  std::cout << "mass error: " << snapshot.metrics.massError << " kg\n";

  if (!replayPath.parent_path().empty()) {
    std::filesystem::create_directories(replayPath.parent_path());
  }
  std::ofstream replayHtml(replayPath, std::ios::out | std::ios::trunc);
  if (!replayHtml) {
    std::cerr << "Failed to open replay output path: " << replayPath.string() << '\n';
    fluidsim::waitForExitIfExplorerLaunched();
    return 1;
  }
  fluidsim::writeReplayHtml(replayHtml, replay);
  std::cout << "wrote replay viewer: " << std::filesystem::absolute(replayPath).string() << '\n';

  if (!csvPath.empty()) {
    if (!csvPath.parent_path().empty()) {
      std::filesystem::create_directories(csvPath.parent_path());
    }
    std::ofstream csv(csvPath, std::ios::out | std::ios::trunc);
    if (!csv) {
      std::cerr << "Failed to open CSV output path: " << csvPath.string() << '\n';
      fluidsim::waitForExitIfExplorerLaunched();
      return 1;
    }
    fluidsim::TankFillSimulation metricsSimulation(config);
    const auto metrics = fluidsim::runBenchmark(metricsSimulation, stepCount);
    fluidsim::writeBenchmarkCsv(csv, metrics);
    std::cout << "wrote csv: " << std::filesystem::absolute(csvPath).string() << '\n';
  }

  fluidsim::waitForExitIfExplorerLaunched();
  return 0;
}
