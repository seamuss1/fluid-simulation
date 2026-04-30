#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <iosfwd>
#include <random>
#include <string>
#include <string_view>
#include <vector>

namespace fluidsim {

struct Vec3 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

struct EmitterConfig {
  Vec3 origin {0.0, 1.8, 0.0};
  Vec3 direction {0.0, -1.0, 0.0};
  double radius = 0.045;
  double speed = 2.8;
  double massPerSecond = 1.2;
  std::uint32_t maxParticlesPerStep = 64;
};

struct SimulationConfig {
  std::uint32_t seed = 1337;
  double fixedTimeStep = 1.0 / 60.0;
  double particleMass = 0.0025;
  std::uint32_t maxActiveParticles = 4096;
  double restDensity = 1000.0;
  std::array<std::uint32_t, 3> gridResolution {24, 36, 24};
  Vec3 tankSize {1.4, 2.2, 1.0};
  EmitterConfig emitter {};
};

struct StepInput {
  bool emit = true;
  double emissionScale = 1.0;
  double renderTimeMs = 0.0;
};

struct MassLedger {
  double emittedMass = 0.0;
  double inFluidMass = 0.0;
  double activeParticleMass = 0.0;
  double escapedMass = 0.0;
  double discardedMass = 0.0;

  double error() const;
};

struct BenchmarkMetrics {
  std::uint64_t frameIndex = 0;
  double simulatedTimeSeconds = 0.0;
  double simulationTimeMs = 0.0;
  double renderTimeMs = 0.0;
  std::size_t activeParticleCount = 0;
  double fillHeight = 0.0;
  double massError = 0.0;
};

struct ReplayParticle {
  Vec3 position {};
  double radius = 0.0;
};

struct ReplayFrame {
  std::uint64_t frameIndex = 0;
  double simulatedTimeSeconds = 0.0;
  double fillHeight = 0.0;
  double fingerMix = 0.0;
  MassLedger massLedger {};
  std::vector<double> surfaceHeights;
  std::vector<double> fingerConcentrations;
  std::vector<ReplayParticle> particles;
};

struct ReplayCapture {
  SimulationConfig config {};
  BenchmarkMetrics finalMetrics {};
  std::size_t stepCount = 0;
  std::size_t captureStride = 1;
  std::vector<ReplayFrame> frames;
};

struct SimulationSnapshot {
  std::uint64_t frameIndex = 0;
  double simulatedTimeSeconds = 0.0;
  SimulationConfig config {};
  MassLedger massLedger {};
  BenchmarkMetrics metrics {};
  double fingerMix = 0.0;
  std::vector<double> surfaceHeights;
  std::vector<double> fingerConcentrations;
  std::vector<Vec3> activeParticles;
};

class MassLedgerBookkeeper {
public:
  void reset();
  void recordEmission(double mass);
  void recordSettlement(double mass);
  void recordSplashReturn(double mass);
  void recordEscape(double mass);
  void recordDiscard(double mass);
  void setActiveParticleMass(double mass);
  const MassLedger& snapshot() const;

private:
  MassLedger ledger_ {};
};

class TankFillSimulation {
public:
  explicit TankFillSimulation(SimulationConfig config = {});

  void reset();
  void step(const StepInput& input = {});

  const SimulationConfig& config() const;
  const SimulationSnapshot& snapshot() const;
  ReplayFrame makeReplayFrame() const;

private:
  struct ParticleState {
    Vec3 position {};
    Vec3 velocity {};
    double mass = 0.0;
  };

  void emitParticles(double dt, const StepInput& input);
  void advanceParticles(double dt);
  void advanceSurface(double dt);
  void advanceFingerField(double dt);
  void disturbSurface(const Vec3& position, double impulse, double radius);
  void depositFingerTracer(const Vec3& position, double amount, double radius);
  double fingerMix() const;
  double sampleSurfaceHeight(double x, double z) const;
  Vec3 animatedEmitterOrigin() const;
  Vec3 animatedEmitterDirection() const;
  void refreshSnapshot(double simulationTimeMs, double renderTimeMs);

  SimulationConfig config_ {};
  MassLedgerBookkeeper massBookkeeper_ {};
  SimulationSnapshot snapshot_ {};
  std::vector<ParticleState> particles_ {};
  std::vector<double> surfaceOffsets_ {};
  std::vector<double> surfaceVelocities_ {};
  std::vector<double> fingerConcentrations_ {};
  std::mt19937 rng_ {};
  std::uint64_t frameIndex_ = 0;
  double simulatedTimeSeconds_ = 0.0;
  double emissionCarryMass_ = 0.0;
};

SimulationConfig makeDefaultSimulationConfig();
std::string serializeConfig(const SimulationConfig& config);
SimulationConfig parseSimulationConfig(std::string_view text);
std::vector<BenchmarkMetrics> runBenchmark(TankFillSimulation& simulation, std::size_t stepCount, const StepInput& input = {});
ReplayCapture captureReplay(TankFillSimulation& simulation, std::size_t stepCount, std::size_t captureStride = 1, const StepInput& input = {});
std::string serializeReplayCapture(const ReplayCapture& capture);
void writeReplayHtml(std::ostream& output, const ReplayCapture& capture);
void writeBenchmarkCsv(std::ostream& output, const std::vector<BenchmarkMetrics>& metrics);

}  // namespace fluidsim
