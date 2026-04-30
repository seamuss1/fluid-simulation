#include "fluidsim/sim_core.hpp"
#include "fluidsim/windows_console.hpp"

#include <cmath>
#include <exception>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>

namespace {

bool approx(double left, double right, double tolerance = 1e-9) {
  return std::abs(left - right) <= tolerance;
}

void require(bool condition, const std::string& message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

void testMassLedgerBookkeeping() {
  fluidsim::MassLedgerBookkeeper bookkeeper;
  bookkeeper.recordEmission(1.0);
  bookkeeper.recordSettlement(0.6);
  bookkeeper.recordSplashReturn(0.2);
  bookkeeper.setActiveParticleMass(0.4);

  auto snapshot = bookkeeper.snapshot();
  require(approx(snapshot.inFluidMass, 0.6), "Expected settled mass to be tracked.");
  require(approx(snapshot.activeParticleMass, 0.4), "Expected active mass to be tracked.");
  require(approx(snapshot.error(), 0.0), "Splash return should not double count mass.");

  bookkeeper.recordEscape(0.25);
  bookkeeper.setActiveParticleMass(0.15);
  snapshot = bookkeeper.snapshot();
  require(approx(snapshot.error(), 0.0), "Escaped mass should remain conserved.");

  bookkeeper.recordDiscard(0.1);
  bookkeeper.setActiveParticleMass(0.05);
  snapshot = bookkeeper.snapshot();
  require(approx(snapshot.error(), 0.0), "Discarded mass should be explicitly accounted for.");
}

void testConfigRoundTrip() {
  auto config = fluidsim::makeDefaultSimulationConfig();
  config.seed = 20260418;
  config.fixedTimeStep = 1.0 / 120.0;
  config.particleMass = 0.003;
  config.maxActiveParticles = 2048;
  config.restDensity = 998.2;
  config.gridResolution = {32, 40, 28};
  config.tankSize = {1.8, 2.5, 1.1};
  config.emitter.origin = {0.1, 2.1, -0.05};
  config.emitter.direction = {0.0, -1.0, 0.15};
  config.emitter.radius = 0.05;
  config.emitter.speed = 3.25;
  config.emitter.massPerSecond = 1.6;
  config.emitter.maxParticlesPerStep = 96;

  const std::string serialized = fluidsim::serializeConfig(config);
  const auto parsed = fluidsim::parseSimulationConfig(serialized);

  require(parsed.seed == config.seed, "Seed did not survive config round-trip.");
  require(approx(parsed.fixedTimeStep, config.fixedTimeStep), "Fixed timestep did not survive config round-trip.");
  require(approx(parsed.particleMass, config.particleMass), "Particle mass did not survive config round-trip.");
  require(parsed.maxActiveParticles == config.maxActiveParticles, "Particle cap did not survive config round-trip.");
  require(approx(parsed.restDensity, config.restDensity), "Rest density did not survive config round-trip.");
  require(parsed.gridResolution == config.gridResolution, "Grid resolution did not survive config round-trip.");
  require(approx(parsed.tankSize.x, config.tankSize.x), "Tank width did not survive config round-trip.");
  require(approx(parsed.tankSize.y, config.tankSize.y), "Tank height did not survive config round-trip.");
  require(approx(parsed.tankSize.z, config.tankSize.z), "Tank depth did not survive config round-trip.");
  require(approx(parsed.emitter.origin.x, config.emitter.origin.x), "Emitter origin x did not survive config round-trip.");
  require(approx(parsed.emitter.direction.z, config.emitter.direction.z), "Emitter direction z did not survive config round-trip.");
  require(parsed.emitter.maxParticlesPerStep == config.emitter.maxParticlesPerStep, "Emitter rate cap did not survive config round-trip.");
}

void testDeterministicReplay() {
  const auto config = fluidsim::makeDefaultSimulationConfig();
  fluidsim::TankFillSimulation left(config);
  fluidsim::TankFillSimulation right(config);

  for (std::size_t step = 0; step < 180; ++step) {
    left.step();
    right.step();
  }

  const auto leftReplay = left.makeReplayFrame();
  const auto rightReplay = right.makeReplayFrame();

  require(leftReplay.frameIndex == rightReplay.frameIndex, "Deterministic replay frame indices diverged.");
  require(approx(leftReplay.fillHeight, rightReplay.fillHeight), "Deterministic replay fill heights diverged.");
  require(leftReplay.particles.size() == rightReplay.particles.size(), "Deterministic replay particle counts diverged.");

  for (std::size_t index = 0; index < leftReplay.particles.size(); ++index) {
    require(approx(leftReplay.particles[index].position.x, rightReplay.particles[index].position.x), "Deterministic replay x positions diverged.");
    require(approx(leftReplay.particles[index].position.y, rightReplay.particles[index].position.y), "Deterministic replay y positions diverged.");
    require(approx(leftReplay.particles[index].position.z, rightReplay.particles[index].position.z), "Deterministic replay z positions diverged.");
  }
}

void testEscapeAndRetirementPaths() {
  auto escapeConfig = fluidsim::makeDefaultSimulationConfig();
  escapeConfig.emitter.origin = {escapeConfig.tankSize.x, 0.4, 0.0};
  escapeConfig.emitter.direction = {1.0, -0.2, 0.0};
  escapeConfig.emitter.massPerSecond = 0.3;
  escapeConfig.emitter.maxParticlesPerStep = 24;

  fluidsim::TankFillSimulation escapeSimulation(escapeConfig);
  for (std::size_t step = 0; step < 240; ++step) {
    escapeSimulation.step();
  }
  require(escapeSimulation.snapshot().massLedger.escapedMass > 0.0, "Expected escaped mass when emitting outside the tank.");
  require(approx(escapeSimulation.snapshot().massLedger.error(), 0.0, 1e-8), "Escaped mass should remain conserved.");

  auto retirementConfig = fluidsim::makeDefaultSimulationConfig();
  retirementConfig.emitter.massPerSecond = 0.45;
  retirementConfig.emitter.maxParticlesPerStep = 16;
  fluidsim::TankFillSimulation retirementSimulation(retirementConfig);

  for (std::size_t step = 0; step < 120; ++step) {
    retirementSimulation.step();
  }
  for (std::size_t step = 0; step < 360; ++step) {
    retirementSimulation.step({false, 0.0, 0.0});
  }

  require(retirementSimulation.snapshot().metrics.activeParticleCount == 0, "Particles should retire once emission stops.");
  require(approx(retirementSimulation.snapshot().massLedger.activeParticleMass, 0.0), "Active particle mass should retire to zero.");
  require(retirementSimulation.snapshot().massLedger.inFluidMass > 0.0, "Retired particles should contribute to in-fluid mass.");
  require(approx(retirementSimulation.snapshot().massLedger.error(), 0.0, 1e-8), "Retirement path should conserve mass.");
}

void testTankFillBenchmark() {
  fluidsim::TankFillSimulation simulation;
  const auto metrics = fluidsim::runBenchmark(simulation, 240);

  double previousFillHeight = 0.0;
  for (const auto& metric : metrics) {
    require(std::isfinite(metric.fillHeight), "Benchmark fill height must stay finite.");
    require(std::isfinite(metric.massError), "Benchmark mass error must stay finite.");
    require(metric.fillHeight + 1e-9 >= previousFillHeight, "Tank-fill benchmark should produce a monotonic fill curve.");
    previousFillHeight = metric.fillHeight;
  }

  const auto& snapshot = simulation.snapshot();
  require(snapshot.massLedger.emittedMass >= 0.0, "Emitted mass must stay non-negative.");
  require(snapshot.massLedger.inFluidMass >= 0.0, "In-fluid mass must stay non-negative.");
  require(snapshot.massLedger.activeParticleMass >= 0.0, "Active particle mass must stay non-negative.");
  const double relativeError = snapshot.massLedger.emittedMass > 0.0
    ? std::abs(snapshot.metrics.massError) / snapshot.massLedger.emittedMass
    : 0.0;
  require(relativeError < 0.01, "Benchmark mass error must stay under 1%.");
}

void testReplayCaptureExport() {
  fluidsim::TankFillSimulation simulation;
  const auto capture = fluidsim::captureReplay(simulation, 60, 4);

  require(capture.stepCount == 60, "Replay capture should remember the requested step count.");
  require(capture.captureStride == 4, "Replay capture should remember the requested stride.");
  require(capture.frames.size() >= 2, "Replay capture should include the initial and final frame.");
  require(capture.frames.front().frameIndex == 0, "Replay capture should start from frame zero.");
  require(capture.frames.back().frameIndex == 60, "Replay capture should include the final frame.");
  require(capture.finalMetrics.frameIndex == 60, "Replay capture final metrics should match the simulated step count.");
  require(!capture.frames.back().surfaceHeights.empty(), "Replay capture should include surface heights for rendering.");

  const std::string serialized = fluidsim::serializeReplayCapture(capture);
  require(serialized.find("\"stepCount\":60") != std::string::npos, "Replay JSON should include the step count.");
  require(serialized.find("\"frames\":[") != std::string::npos, "Replay JSON should include captured frames.");
  require(serialized.find("\"surfaceHeights\":[") != std::string::npos, "Replay JSON should include surface height data.");

  std::ostringstream html;
  fluidsim::writeReplayHtml(html, capture);
  const std::string htmlText = html.str();
  require(htmlText.find("const replayData =") != std::string::npos, "Replay HTML should embed replay data.");
  require(htmlText.find("Offline Replay Artifact") != std::string::npos, "Replay HTML should render the generated viewer shell.");
  require(htmlText.find("progressive accumulation") != std::string::npos, "Replay HTML should describe the higher-quality renderer.");
}

}  // namespace

int main() {
  struct Case {
    const char* name;
    void (*fn)();
  };

  const Case cases[] = {
    {"mass-ledger-bookkeeping", testMassLedgerBookkeeping},
    {"config-round-trip", testConfigRoundTrip},
    {"deterministic-replay", testDeterministicReplay},
    {"escape-and-retirement", testEscapeAndRetirementPaths},
    {"replay-capture-export", testReplayCaptureExport},
    {"tank-fill-benchmark", testTankFillBenchmark},
  };

  for (const Case& testCase : cases) {
    try {
      testCase.fn();
      std::cout << "[PASS] " << testCase.name << '\n';
    } catch (const std::exception& error) {
      std::cerr << "[FAIL] " << testCase.name << ": " << error.what() << '\n';
      fluidsim::waitForExitIfExplorerLaunched();
      return 1;
    }
  }

  fluidsim::waitForExitIfExplorerLaunched();
  return 0;
}
