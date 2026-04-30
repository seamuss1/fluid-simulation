#include "fluidsim/sim_core.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <iomanip>
#include <limits>
#include <ostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>

namespace fluidsim {
namespace {

constexpr double kGravity = 9.81;
constexpr double kPi = 3.14159265358979323846;

double clamp(double value, double minimum, double maximum) {
  return std::max(minimum, std::min(value, maximum));
}

double lerp(double left, double right, double amount) {
  return left + (right - left) * amount;
}

double hash01(double value) {
  const double hashed = std::sin(value) * 43758.5453123;
  return hashed - std::floor(hashed);
}

double length(const Vec3& value) {
  return std::sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
}

Vec3 normalize(const Vec3& value) {
  const double magnitude = length(value);
  if (magnitude <= std::numeric_limits<double>::epsilon()) {
    return {0.0, -1.0, 0.0};
  }
  return {value.x / magnitude, value.y / magnitude, value.z / magnitude};
}

Vec3 add(const Vec3& left, const Vec3& right) {
  return {left.x + right.x, left.y + right.y, left.z + right.z};
}

Vec3 scale(const Vec3& value, double amount) {
  return {value.x * amount, value.y * amount, value.z * amount};
}

double tankFootprint(const SimulationConfig& config) {
  return config.tankSize.x * config.tankSize.z;
}

double fillHeightFromMass(const SimulationConfig& config, double inFluidMass) {
  const double footprint = tankFootprint(config);
  if (footprint <= std::numeric_limits<double>::epsilon() || config.restDensity <= std::numeric_limits<double>::epsilon()) {
    return 0.0;
  }

  const double filledVolume = inFluidMass / config.restDensity;
  return clamp(filledVolume / footprint, 0.0, config.tankSize.y);
}

double particleRadius(const SimulationConfig& config) {
  const double particleVolume = config.particleMass / config.restDensity;
  return std::cbrt((3.0 * particleVolume) / (4.0 * kPi));
}

std::uint32_t surfaceWidth(const SimulationConfig& config) {
  return std::max<std::uint32_t>(config.gridResolution[0], 2u);
}

std::uint32_t surfaceDepth(const SimulationConfig& config) {
  return std::max<std::uint32_t>(config.gridResolution[2], 2u);
}

std::size_t surfaceIndex(const SimulationConfig& config, std::uint32_t x, std::uint32_t z) {
  return static_cast<std::size_t>(z) * surfaceWidth(config) + x;
}

std::size_t surfaceCellCount(const SimulationConfig& config) {
  return static_cast<std::size_t>(surfaceWidth(config)) * surfaceDepth(config);
}

void requireNonNegative(double mass, const char* label) {
  if (!std::isfinite(mass) || mass < 0.0) {
    throw std::invalid_argument(std::string(label) + " must be finite and non-negative.");
  }
}

std::size_t findValueStart(std::string_view text, std::string_view key) {
  const std::string token = "\"" + std::string(key) + "\"";
  const std::size_t keyPos = text.find(token);
  if (keyPos == std::string_view::npos) {
    throw std::runtime_error("Missing config key: " + std::string(key));
  }

  const std::size_t colonPos = text.find(':', keyPos + token.size());
  if (colonPos == std::string_view::npos) {
    throw std::runtime_error("Malformed config value for key: " + std::string(key));
  }

  const std::size_t valuePos = text.find_first_not_of(" \t\r\n", colonPos + 1);
  if (valuePos == std::string_view::npos) {
    throw std::runtime_error("Missing config value for key: " + std::string(key));
  }
  return valuePos;
}

double parseNumber(std::string_view text, std::string_view key) {
  const std::size_t begin = findValueStart(text, key);
  std::size_t end = begin;
  while (end < text.size()) {
    const char current = text[end];
    const bool valid = (current >= '0' && current <= '9') || current == '-' || current == '+' || current == '.' || current == 'e' || current == 'E';
    if (!valid) {
      break;
    }
    ++end;
  }

  return std::stod(std::string(text.substr(begin, end - begin)));
}

std::array<double, 3> parseVec3Array(std::string_view text, std::string_view key) {
  const std::size_t begin = findValueStart(text, key);
  if (text[begin] != '[') {
    throw std::runtime_error("Expected array value for key: " + std::string(key));
  }

  std::array<double, 3> values {};
  std::size_t cursor = begin + 1;
  for (std::size_t index = 0; index < values.size(); ++index) {
    cursor = text.find_first_not_of(" \t\r\n", cursor);
    if (cursor == std::string_view::npos) {
      throw std::runtime_error("Unexpected end of array for key: " + std::string(key));
    }

    std::size_t end = cursor;
    while (end < text.size()) {
      const char current = text[end];
      const bool valid = (current >= '0' && current <= '9') || current == '-' || current == '+' || current == '.' || current == 'e' || current == 'E';
      if (!valid) {
        break;
      }
      ++end;
    }

    values[index] = std::stod(std::string(text.substr(cursor, end - cursor)));
    cursor = text.find_first_not_of(" \t\r\n", end);
    if (index + 1 < values.size()) {
      if (cursor == std::string_view::npos || text[cursor] != ',') {
        throw std::runtime_error("Expected comma in array for key: " + std::string(key));
      }
      ++cursor;
    }
  }

  const std::size_t close = text.find(']', cursor);
  if (close == std::string_view::npos) {
    throw std::runtime_error("Expected closing array bracket for key: " + std::string(key));
  }

  return values;
}

std::array<std::uint32_t, 3> parseGridArray(std::string_view text, std::string_view key) {
  const auto values = parseVec3Array(text, key);
  return {
    static_cast<std::uint32_t>(values[0]),
    static_cast<std::uint32_t>(values[1]),
    static_cast<std::uint32_t>(values[2]),
  };
}

Vec3 parseVec3(std::string_view text, std::string_view key) {
  const auto values = parseVec3Array(text, key);
  return {values[0], values[1], values[2]};
}

void writeVec3Json(std::ostream& output, const Vec3& value) {
  output << "{\"x\":" << value.x
         << ",\"y\":" << value.y
         << ",\"z\":" << value.z << '}';
}

void writeMassLedgerJson(std::ostream& output, const MassLedger& ledger) {
  output << "{\"emittedMass\":" << ledger.emittedMass
         << ",\"inFluidMass\":" << ledger.inFluidMass
         << ",\"activeParticleMass\":" << ledger.activeParticleMass
         << ",\"escapedMass\":" << ledger.escapedMass
         << ",\"discardedMass\":" << ledger.discardedMass
         << ",\"error\":" << ledger.error() << '}';
}

void writeSimulationConfigJson(std::ostream& output, const SimulationConfig& config) {
  output << "{"
         << "\"seed\":" << config.seed
         << ",\"fixedTimeStep\":" << config.fixedTimeStep
         << ",\"particleMass\":" << config.particleMass
         << ",\"maxActiveParticles\":" << config.maxActiveParticles
         << ",\"restDensity\":" << config.restDensity
         << ",\"gridResolution\":[" << config.gridResolution[0] << ',' << config.gridResolution[1] << ',' << config.gridResolution[2] << ']'
         << ",\"tankSize\":";
  writeVec3Json(output, config.tankSize);
  output << ",\"emitter\":{\"origin\":";
  writeVec3Json(output, config.emitter.origin);
  output << ",\"direction\":";
  writeVec3Json(output, config.emitter.direction);
  output << ",\"radius\":" << config.emitter.radius
         << ",\"speed\":" << config.emitter.speed
         << ",\"massPerSecond\":" << config.emitter.massPerSecond
         << ",\"maxParticlesPerStep\":" << config.emitter.maxParticlesPerStep
         << "}}";
}

void writeBenchmarkMetricsJson(std::ostream& output, const BenchmarkMetrics& metrics) {
  output << "{\"frameIndex\":" << metrics.frameIndex
         << ",\"simulatedTimeSeconds\":" << metrics.simulatedTimeSeconds
         << ",\"simulationTimeMs\":" << metrics.simulationTimeMs
         << ",\"renderTimeMs\":" << metrics.renderTimeMs
         << ",\"activeParticleCount\":" << metrics.activeParticleCount
         << ",\"fillHeight\":" << metrics.fillHeight
         << ",\"massError\":" << metrics.massError << '}';
}

void writeReplayFrameJson(std::ostream& output, const ReplayFrame& frame) {
  output << "{\"frameIndex\":" << frame.frameIndex
         << ",\"simulatedTimeSeconds\":" << frame.simulatedTimeSeconds
         << ",\"fillHeight\":" << frame.fillHeight
         << ",\"fingerMix\":" << frame.fingerMix
         << ",\"massLedger\":";
  writeMassLedgerJson(output, frame.massLedger);
  output << ",\"surfaceHeights\":[";
  for (std::size_t index = 0; index < frame.surfaceHeights.size(); ++index) {
    if (index > 0) {
      output << ',';
    }
    output << frame.surfaceHeights[index];
  }
  output << "],\"fingerConcentrations\":[";
  for (std::size_t index = 0; index < frame.fingerConcentrations.size(); ++index) {
    if (index > 0) {
      output << ',';
    }
    output << frame.fingerConcentrations[index];
  }
  output << "],\"particles\":[";
  for (std::size_t index = 0; index < frame.particles.size(); ++index) {
    if (index > 0) {
      output << ',';
    }
    output << "{\"position\":";
    writeVec3Json(output, frame.particles[index].position);
    output << ",\"radius\":" << frame.particles[index].radius << '}';
  }
  output << "]}";
}

}  // namespace

double MassLedger::error() const {
  return emittedMass - (inFluidMass + activeParticleMass + escapedMass + discardedMass);
}

void MassLedgerBookkeeper::reset() {
  ledger_ = {};
}

void MassLedgerBookkeeper::recordEmission(double mass) {
  requireNonNegative(mass, "Emission mass");
  ledger_.emittedMass += mass;
}

void MassLedgerBookkeeper::recordSettlement(double mass) {
  requireNonNegative(mass, "Settlement mass");
  ledger_.inFluidMass += mass;
}

void MassLedgerBookkeeper::recordSplashReturn(double mass) {
  requireNonNegative(mass, "Splash return mass");
}

void MassLedgerBookkeeper::recordEscape(double mass) {
  requireNonNegative(mass, "Escape mass");
  ledger_.escapedMass += mass;
}

void MassLedgerBookkeeper::recordDiscard(double mass) {
  requireNonNegative(mass, "Discard mass");
  ledger_.discardedMass += mass;
}

void MassLedgerBookkeeper::setActiveParticleMass(double mass) {
  requireNonNegative(mass, "Active particle mass");
  ledger_.activeParticleMass = mass;
}

const MassLedger& MassLedgerBookkeeper::snapshot() const {
  return ledger_;
}

SimulationConfig makeDefaultSimulationConfig() {
  return {};
}

TankFillSimulation::TankFillSimulation(SimulationConfig config)
    : config_(std::move(config)),
      rng_(config_.seed) {
  reset();
}

void TankFillSimulation::reset() {
  rng_.seed(config_.seed);
  particles_.clear();
  surfaceOffsets_.assign(surfaceCellCount(config_), 0.0);
  surfaceVelocities_.assign(surfaceCellCount(config_), 0.0);
  fingerConcentrations_.assign(surfaceCellCount(config_), 0.0);
  frameIndex_ = 0;
  simulatedTimeSeconds_ = 0.0;
  emissionCarryMass_ = 0.0;
  massBookkeeper_.reset();
  snapshot_ = {};
  snapshot_.config = config_;
  refreshSnapshot(0.0, 0.0);
}

void TankFillSimulation::step(const StepInput& input) {
  using clock = std::chrono::steady_clock;

  const auto start = clock::now();
  const double dt = config_.fixedTimeStep;

  emitParticles(dt, input);
  advanceParticles(dt);
  advanceSurface(dt);
  advanceFingerField(dt);

  ++frameIndex_;
  simulatedTimeSeconds_ += dt;

  const auto end = clock::now();
  const double simulationTimeMs = std::chrono::duration<double, std::milli>(end - start).count();
  refreshSnapshot(simulationTimeMs, input.renderTimeMs);
}

const SimulationConfig& TankFillSimulation::config() const {
  return config_;
}

const SimulationSnapshot& TankFillSimulation::snapshot() const {
  return snapshot_;
}

ReplayFrame TankFillSimulation::makeReplayFrame() const {
  ReplayFrame frame {};
  frame.frameIndex = snapshot_.frameIndex;
  frame.simulatedTimeSeconds = snapshot_.simulatedTimeSeconds;
  frame.fillHeight = snapshot_.metrics.fillHeight;
  frame.fingerMix = snapshot_.fingerMix;
  frame.massLedger = snapshot_.massLedger;
  frame.surfaceHeights = snapshot_.surfaceHeights;
  frame.fingerConcentrations = snapshot_.fingerConcentrations;
  frame.particles.reserve(snapshot_.activeParticles.size());

  const double radius = particleRadius(config_);
  for (const Vec3& position : snapshot_.activeParticles) {
    frame.particles.push_back({position, radius});
  }

  return frame;
}

void TankFillSimulation::emitParticles(double dt, const StepInput& input) {
  if (!input.emit || input.emissionScale <= 0.0) {
    return;
  }

  emissionCarryMass_ += config_.emitter.massPerSecond * input.emissionScale * dt;

  const Vec3 emitterOrigin = animatedEmitterOrigin();
  const Vec3 direction = animatedEmitterDirection();
  std::uniform_real_distribution<double> angleDistribution(0.0, 2.0 * kPi);
  std::uniform_real_distribution<double> radiusDistribution(0.0, 1.0);
  std::uniform_real_distribution<double> jitterDistribution(-0.08, 0.08);

  std::uint32_t spawnedThisStep = 0;
  while (emissionCarryMass_ + 1e-12 >= config_.particleMass && spawnedThisStep < config_.emitter.maxParticlesPerStep) {
    emissionCarryMass_ -= config_.particleMass;
    massBookkeeper_.recordEmission(config_.particleMass);

    if (particles_.size() >= config_.maxActiveParticles) {
      massBookkeeper_.recordDiscard(config_.particleMass);
      continue;
    }

    const double angle = angleDistribution(rng_);
    const double radialOffset = std::sqrt(radiusDistribution(rng_)) * config_.emitter.radius;
    const Vec3 originOffset {std::cos(angle) * radialOffset, 0.0, std::sin(angle) * radialOffset};
    const Vec3 velocityJitter {jitterDistribution(rng_), jitterDistribution(rng_) * 0.35, jitterDistribution(rng_)};

    ParticleState particle {};
    particle.position = add(emitterOrigin, originOffset);
    particle.velocity = add(scale(direction, config_.emitter.speed), velocityJitter);
    particle.mass = config_.particleMass;

    particles_.push_back(particle);
    ++spawnedThisStep;
  }
}

void TankFillSimulation::advanceParticles(double dt) {
  const double halfWidth = config_.tankSize.x * 0.5;
  const double halfDepth = config_.tankSize.z * 0.5;
  const double tankHeight = config_.tankSize.y;

  for (std::size_t index = particles_.size(); index > 0; --index) {
    ParticleState& particle = particles_[index - 1];
    const bool wasInsideFootprint = std::abs(particle.position.x) <= halfWidth && std::abs(particle.position.z) <= halfDepth;
    particle.velocity.x *= clamp(1.0 - dt * 0.6, 0.0, 1.0);
    particle.velocity.z *= clamp(1.0 - dt * 0.6, 0.0, 1.0);
    particle.velocity.y -= kGravity * dt;
    particle.position = add(particle.position, scale(particle.velocity, dt));

    if (wasInsideFootprint && particle.position.y <= tankHeight) {
      if (particle.position.x < -halfWidth) {
        particle.position.x = -halfWidth;
        particle.velocity.x = std::abs(particle.velocity.x) * 0.35;
      } else if (particle.position.x > halfWidth) {
        particle.position.x = halfWidth;
        particle.velocity.x = -std::abs(particle.velocity.x) * 0.35;
      }

      if (particle.position.z < -halfDepth) {
        particle.position.z = -halfDepth;
        particle.velocity.z = std::abs(particle.velocity.z) * 0.35;
      } else if (particle.position.z > halfDepth) {
        particle.position.z = halfDepth;
        particle.velocity.z = -std::abs(particle.velocity.z) * 0.35;
      }
    }

    const bool isInsideFootprint = std::abs(particle.position.x) <= halfWidth && std::abs(particle.position.z) <= halfDepth;
    const double fillSurface = sampleSurfaceHeight(particle.position.x, particle.position.z);
    if (isInsideFootprint && particle.position.y <= std::max(fillSurface, 0.0)) {
      disturbSurface({particle.position.x, fillSurface, particle.position.z}, std::max(0.0, -particle.velocity.y), std::max(0.16, config_.emitter.radius * 2.8));
      depositFingerTracer(particle.position, particle.mass * 3.2, std::max(0.11, config_.emitter.radius * 2.4));
      massBookkeeper_.recordSettlement(particle.mass);
      particles_.erase(particles_.begin() + static_cast<std::ptrdiff_t>(index - 1));
      continue;
    }

    const bool outsideEscapeBounds =
      std::abs(particle.position.x) > halfWidth + 0.75 ||
      std::abs(particle.position.z) > halfDepth + 0.75 ||
      particle.position.y < -0.75 ||
      particle.position.y > tankHeight + 2.0;

    if (outsideEscapeBounds) {
      massBookkeeper_.recordEscape(particle.mass);
      particles_.erase(particles_.begin() + static_cast<std::ptrdiff_t>(index - 1));
    }
  }
}

void TankFillSimulation::advanceSurface(double dt) {
  if (surfaceOffsets_.empty()) {
    return;
  }

  const std::uint32_t width = surfaceWidth(config_);
  const std::uint32_t depth = surfaceDepth(config_);
  const double baseHeight = fillHeightFromMass(config_, massBookkeeper_.snapshot().inFluidMass);
  const double damping = std::pow(0.987, dt * 60.0);
  const double stiffness = 34.0 + baseHeight * 28.0;
  const double propagation = 18.0 + baseHeight * 12.0;
  const double maxWave = clamp(0.03 + baseHeight * 0.4, 0.03, 0.16);

  std::vector<double> nextOffsets(surfaceOffsets_.size(), 0.0);
  std::vector<double> nextVelocities(surfaceVelocities_.size(), 0.0);

  for (std::uint32_t z = 0; z < depth; ++z) {
    for (std::uint32_t x = 0; x < width; ++x) {
      const std::size_t idx = surfaceIndex(config_, x, z);
      double neighborSum = 0.0;
      double neighborCount = 0.0;

      if (x > 0) {
        neighborSum += surfaceOffsets_[surfaceIndex(config_, x - 1, z)];
        neighborCount += 1.0;
      }
      if (x + 1 < width) {
        neighborSum += surfaceOffsets_[surfaceIndex(config_, x + 1, z)];
        neighborCount += 1.0;
      }
      if (z > 0) {
        neighborSum += surfaceOffsets_[surfaceIndex(config_, x, z - 1)];
        neighborCount += 1.0;
      }
      if (z + 1 < depth) {
        neighborSum += surfaceOffsets_[surfaceIndex(config_, x, z + 1)];
        neighborCount += 1.0;
      }

      const double neighborAverage = neighborCount > 0.0 ? neighborSum / neighborCount : 0.0;
      const double laplacian = neighborAverage - surfaceOffsets_[idx];
      const double edgeFactor = (x == 0 || z == 0 || x + 1 == width || z + 1 == depth) ? 0.9 : 1.0;
      nextVelocities[idx] = (surfaceVelocities_[idx] + (laplacian * propagation - surfaceOffsets_[idx] * stiffness) * dt) * damping * edgeFactor;
      nextOffsets[idx] = surfaceOffsets_[idx] + nextVelocities[idx] * dt;
    }
  }

  double averageOffset = 0.0;
  for (double value : nextOffsets) {
    averageOffset += value;
  }
  averageOffset /= static_cast<double>(nextOffsets.size());

  for (std::size_t idx = 0; idx < nextOffsets.size(); ++idx) {
    nextOffsets[idx] = clamp(nextOffsets[idx] - averageOffset, -maxWave, maxWave);
    if (std::abs(nextOffsets[idx]) < 1e-6) {
      nextOffsets[idx] = 0.0;
    }
    if (std::abs(nextVelocities[idx]) < 1e-6) {
      nextVelocities[idx] = 0.0;
    }
  }

  surfaceOffsets_ = std::move(nextOffsets);
  surfaceVelocities_ = std::move(nextVelocities);
}

void TankFillSimulation::advanceFingerField(double dt) {
  if (fingerConcentrations_.empty()) {
    return;
  }

  const std::uint32_t width = surfaceWidth(config_);
  const std::uint32_t depth = surfaceDepth(config_);
  const double dtScale = clamp(dt * 60.0, 0.0, 2.0);
  const double diffusionRate = 0.032 * dtScale;
  const double sharpeningRate = 0.008 * dtScale;
  const double mobility = 0.034 * dtScale;
  const double centerX = 0.5 + 0.16 * std::sin(simulatedTimeSeconds_ * 0.37);
  const double centerZ = 0.5 + 0.12 * std::cos(simulatedTimeSeconds_ * 0.29 + 0.8);

  std::vector<double> delta(fingerConcentrations_.size(), 0.0);

  auto exchangePair = [&](std::size_t leftIndex, std::size_t rightIndex, double noise) {
    const double left = fingerConcentrations_[leftIndex];
    const double right = fingerConcentrations_[rightIndex];
    const double average = (left + right) * 0.5;
    const double gradient = left - right;
    const double front = clamp(average * (1.0 - average) * 4.0, 0.0, 1.0);
    const double smoothFlow = gradient * diffusionRate;
    const double sharpFlow = gradient * sharpeningRate * front * (0.35 + 0.65 * noise);

    delta[leftIndex] -= smoothFlow;
    delta[rightIndex] += smoothFlow;
    delta[leftIndex] += sharpFlow;
    delta[rightIndex] -= sharpFlow;
  };

  for (std::uint32_t z = 0; z < depth; ++z) {
    for (std::uint32_t x = 0; x < width; ++x) {
      const std::size_t idx = surfaceIndex(config_, x, z);
      const double noise = hash01(static_cast<double>(x * 928371u + z * 689287u) + simulatedTimeSeconds_ * 11.0);

      if (x + 1 < width) {
        exchangePair(idx, surfaceIndex(config_, x + 1, z), noise);
      }
      if (z + 1 < depth) {
        exchangePair(idx, surfaceIndex(config_, x, z + 1), 1.0 - noise);
      }

      const double concentration = fingerConcentrations_[idx];
      if (concentration <= 1e-6) {
        continue;
      }

      const double u = width > 1 ? static_cast<double>(x) / static_cast<double>(width - 1) : 0.5;
      const double v = depth > 1 ? static_cast<double>(z) / static_cast<double>(depth - 1) : 0.5;
      double radialX = u - centerX;
      double radialZ = v - centerZ;
      const double radialLength = std::sqrt(radialX * radialX + radialZ * radialZ);
      if (radialLength <= 1e-6) {
        radialX = std::cos(noise * 2.0 * kPi);
        radialZ = std::sin(noise * 2.0 * kPi);
      } else {
        radialX /= radialLength;
        radialZ /= radialLength;
      }

      struct Direction {
        int dx = 0;
        int dz = 0;
        double alignment = 0.0;
      };

      const Direction directions[] = {
        {1, 0, radialX},
        {-1, 0, -radialX},
        {0, 1, radialZ},
        {0, -1, -radialZ},
      };

      double weights[4] {};
      double weightSum = 0.0;
      for (std::size_t directionIndex = 0; directionIndex < 4; ++directionIndex) {
        const int nx = static_cast<int>(x) + directions[directionIndex].dx;
        const int nz = static_cast<int>(z) + directions[directionIndex].dz;
        if (nx < 0 || nz < 0 || nx >= static_cast<int>(width) || nz >= static_cast<int>(depth)) {
          continue;
        }

        const std::size_t neighborIndex = surfaceIndex(config_, static_cast<std::uint32_t>(nx), static_cast<std::uint32_t>(nz));
        const double capacity = std::max(0.0, 1.0 - fingerConcentrations_[neighborIndex]);
        const double branch = 0.65 + 0.35 * hash01(static_cast<double>((x + 11u) * 3571u + (z + 17u) * 7919u + directionIndex * 101u));
        weights[directionIndex] = capacity * branch * std::max(0.0, directions[directionIndex].alignment + 0.18);
        weightSum += weights[directionIndex];
      }

      if (weightSum <= 1e-9) {
        continue;
      }

      const double front = clamp(concentration * (1.0 - concentration) * 4.0, 0.0, 1.0);
      const double totalTransfer = std::min(concentration * 0.22, concentration * mobility * (0.35 + 0.75 * front));
      for (std::size_t directionIndex = 0; directionIndex < 4; ++directionIndex) {
        if (weights[directionIndex] <= 0.0) {
          continue;
        }
        const int nx = static_cast<int>(x) + directions[directionIndex].dx;
        const int nz = static_cast<int>(z) + directions[directionIndex].dz;
        const std::size_t neighborIndex = surfaceIndex(config_, static_cast<std::uint32_t>(nx), static_cast<std::uint32_t>(nz));
        const double moved = totalTransfer * weights[directionIndex] / weightSum;
        delta[idx] -= moved;
        delta[neighborIndex] += moved;
      }
    }
  }

  for (std::size_t index = 0; index < fingerConcentrations_.size(); ++index) {
    fingerConcentrations_[index] = clamp(fingerConcentrations_[index] + delta[index], 0.0, 1.0);
  }
}

void TankFillSimulation::disturbSurface(const Vec3& position, double impulse, double radius) {
  if (surfaceVelocities_.empty()) {
    return;
  }

  const std::uint32_t width = surfaceWidth(config_);
  const std::uint32_t depth = surfaceDepth(config_);
  const double halfWidth = config_.tankSize.x * 0.5;
  const double halfDepth = config_.tankSize.z * 0.5;
  const double u = clamp((position.x + halfWidth) / config_.tankSize.x, 0.0, 1.0) * static_cast<double>(width - 1);
  const double v = clamp((position.z + halfDepth) / config_.tankSize.z, 0.0, 1.0) * static_cast<double>(depth - 1);
  const double radiusX = std::max(1.0, radius / config_.tankSize.x * static_cast<double>(width - 1));
  const double radiusZ = std::max(1.0, radius / config_.tankSize.z * static_cast<double>(depth - 1));
  const double amplitude = -clamp(impulse * 0.18, 0.0, 1.45);

  const std::uint32_t minX = static_cast<std::uint32_t>(std::max(0.0, std::floor(u - radiusX * 2.0)));
  const std::uint32_t maxX = static_cast<std::uint32_t>(std::min(static_cast<double>(width - 1), std::ceil(u + radiusX * 2.0)));
  const std::uint32_t minZ = static_cast<std::uint32_t>(std::max(0.0, std::floor(v - radiusZ * 2.0)));
  const std::uint32_t maxZ = static_cast<std::uint32_t>(std::min(static_cast<double>(depth - 1), std::ceil(v + radiusZ * 2.0)));

  for (std::uint32_t z = minZ; z <= maxZ; ++z) {
    for (std::uint32_t x = minX; x <= maxX; ++x) {
      const double dx = (static_cast<double>(x) - u) / radiusX;
      const double dz = (static_cast<double>(z) - v) / radiusZ;
      const double dist2 = dx * dx + dz * dz;
      if (dist2 > 1.0) {
        continue;
      }

      const double weight = std::exp(-dist2 * 3.2);
      surfaceVelocities_[surfaceIndex(config_, x, z)] += amplitude * weight;
    }
  }
}

void TankFillSimulation::depositFingerTracer(const Vec3& position, double amount, double radius) {
  if (fingerConcentrations_.empty() || amount <= 0.0) {
    return;
  }

  const std::uint32_t width = surfaceWidth(config_);
  const std::uint32_t depth = surfaceDepth(config_);
  const double halfWidth = config_.tankSize.x * 0.5;
  const double halfDepth = config_.tankSize.z * 0.5;
  const double u = clamp((position.x + halfWidth) / config_.tankSize.x, 0.0, 1.0) * static_cast<double>(width - 1);
  const double v = clamp((position.z + halfDepth) / config_.tankSize.z, 0.0, 1.0) * static_cast<double>(depth - 1);
  const double radiusX = std::max(1.0, radius / config_.tankSize.x * static_cast<double>(width - 1));
  const double radiusZ = std::max(1.0, radius / config_.tankSize.z * static_cast<double>(depth - 1));

  const std::uint32_t minX = static_cast<std::uint32_t>(std::max(0.0, std::floor(u - radiusX * 2.0)));
  const std::uint32_t maxX = static_cast<std::uint32_t>(std::min(static_cast<double>(width - 1), std::ceil(u + radiusX * 2.0)));
  const std::uint32_t minZ = static_cast<std::uint32_t>(std::max(0.0, std::floor(v - radiusZ * 2.0)));
  const std::uint32_t maxZ = static_cast<std::uint32_t>(std::min(static_cast<double>(depth - 1), std::ceil(v + radiusZ * 2.0)));

  double weightSum = 0.0;
  for (std::uint32_t z = minZ; z <= maxZ; ++z) {
    for (std::uint32_t x = minX; x <= maxX; ++x) {
      const double dx = (static_cast<double>(x) - u) / radiusX;
      const double dz = (static_cast<double>(z) - v) / radiusZ;
      const double dist2 = dx * dx + dz * dz;
      if (dist2 <= 1.0) {
        weightSum += std::exp(-dist2 * 3.8);
      }
    }
  }

  if (weightSum <= 1e-9) {
    return;
  }

  for (std::uint32_t z = minZ; z <= maxZ; ++z) {
    for (std::uint32_t x = minX; x <= maxX; ++x) {
      const double dx = (static_cast<double>(x) - u) / radiusX;
      const double dz = (static_cast<double>(z) - v) / radiusZ;
      const double dist2 = dx * dx + dz * dz;
      if (dist2 > 1.0) {
        continue;
      }

      const double weight = std::exp(-dist2 * 3.8);
      const std::size_t idx = surfaceIndex(config_, x, z);
      fingerConcentrations_[idx] = clamp(fingerConcentrations_[idx] + amount * weight / weightSum, 0.0, 1.0);
    }
  }
}

double TankFillSimulation::fingerMix() const {
  if (fingerConcentrations_.empty()) {
    return 0.0;
  }

  double total = 0.0;
  for (double concentration : fingerConcentrations_) {
    total += concentration;
  }
  return total / static_cast<double>(fingerConcentrations_.size());
}

double TankFillSimulation::sampleSurfaceHeight(double x, double z) const {
  const double baseHeight = fillHeightFromMass(config_, massBookkeeper_.snapshot().inFluidMass);
  if (surfaceOffsets_.empty()) {
    return baseHeight;
  }

  const std::uint32_t width = surfaceWidth(config_);
  const std::uint32_t depth = surfaceDepth(config_);
  const double halfWidth = config_.tankSize.x * 0.5;
  const double halfDepth = config_.tankSize.z * 0.5;
  const double u = clamp((x + halfWidth) / config_.tankSize.x, 0.0, 1.0) * static_cast<double>(width - 1);
  const double v = clamp((z + halfDepth) / config_.tankSize.z, 0.0, 1.0) * static_cast<double>(depth - 1);
  const std::uint32_t x0 = static_cast<std::uint32_t>(std::floor(u));
  const std::uint32_t z0 = static_cast<std::uint32_t>(std::floor(v));
  const std::uint32_t x1 = std::min<std::uint32_t>(x0 + 1, width - 1);
  const std::uint32_t z1 = std::min<std::uint32_t>(z0 + 1, depth - 1);
  const double tx = u - static_cast<double>(x0);
  const double tz = v - static_cast<double>(z0);

  const double offset00 = surfaceOffsets_[surfaceIndex(config_, x0, z0)];
  const double offset10 = surfaceOffsets_[surfaceIndex(config_, x1, z0)];
  const double offset01 = surfaceOffsets_[surfaceIndex(config_, x0, z1)];
  const double offset11 = surfaceOffsets_[surfaceIndex(config_, x1, z1)];
  const double offset0 = lerp(offset00, offset10, tx);
  const double offset1 = lerp(offset01, offset11, tx);

  return clamp(baseHeight + lerp(offset0, offset1, tz), 0.0, config_.tankSize.y);
}

Vec3 TankFillSimulation::animatedEmitterOrigin() const {
  Vec3 origin = config_.emitter.origin;
  origin.x += std::sin(simulatedTimeSeconds_ * 0.62) * config_.tankSize.x * 0.18;
  origin.z += std::cos(simulatedTimeSeconds_ * 0.41 + 1.2) * config_.tankSize.z * 0.12;
  origin.y += std::sin(simulatedTimeSeconds_ * 0.87 + 0.3) * 0.035;
  return origin;
}

Vec3 TankFillSimulation::animatedEmitterDirection() const {
  Vec3 direction = config_.emitter.direction;
  direction.x += std::sin(simulatedTimeSeconds_ * 0.58) * 0.18;
  direction.z += std::cos(simulatedTimeSeconds_ * 0.73 + 0.9) * 0.15;
  direction.y -= std::sin(simulatedTimeSeconds_ * 0.27 + 1.1) * 0.06;
  return normalize(direction);
}

void TankFillSimulation::refreshSnapshot(double simulationTimeMs, double renderTimeMs) {
  massBookkeeper_.setActiveParticleMass(static_cast<double>(particles_.size()) * config_.particleMass);

  snapshot_.frameIndex = frameIndex_;
  snapshot_.simulatedTimeSeconds = simulatedTimeSeconds_;
  snapshot_.config = config_;
  snapshot_.massLedger = massBookkeeper_.snapshot();
  snapshot_.metrics.frameIndex = frameIndex_;
  snapshot_.metrics.simulatedTimeSeconds = simulatedTimeSeconds_;
  snapshot_.metrics.simulationTimeMs = simulationTimeMs;
  snapshot_.metrics.renderTimeMs = renderTimeMs;
  snapshot_.metrics.activeParticleCount = particles_.size();
  snapshot_.metrics.fillHeight = fillHeightFromMass(config_, snapshot_.massLedger.inFluidMass);
  snapshot_.metrics.massError = snapshot_.massLedger.error();
  snapshot_.fingerMix = fingerMix();

  snapshot_.surfaceHeights.resize(surfaceOffsets_.size());
  for (std::size_t index = 0; index < surfaceOffsets_.size(); ++index) {
    snapshot_.surfaceHeights[index] = clamp(snapshot_.metrics.fillHeight + surfaceOffsets_[index], 0.0, config_.tankSize.y);
  }

  snapshot_.fingerConcentrations = fingerConcentrations_;

  snapshot_.activeParticles.clear();
  snapshot_.activeParticles.reserve(particles_.size());
  for (const ParticleState& particle : particles_) {
    snapshot_.activeParticles.push_back(particle.position);
  }
}

std::string serializeConfig(const SimulationConfig& config) {
  std::ostringstream stream;
  stream << std::fixed << std::setprecision(10);
  stream << "{\n";
  stream << "  \"seed\": " << config.seed << ",\n";
  stream << "  \"fixedTimeStep\": " << config.fixedTimeStep << ",\n";
  stream << "  \"particleMass\": " << config.particleMass << ",\n";
  stream << "  \"maxActiveParticles\": " << config.maxActiveParticles << ",\n";
  stream << "  \"restDensity\": " << config.restDensity << ",\n";
  stream << "  \"gridResolution\": [" << config.gridResolution[0] << ", " << config.gridResolution[1] << ", " << config.gridResolution[2] << "],\n";
  stream << "  \"tankSize\": [" << config.tankSize.x << ", " << config.tankSize.y << ", " << config.tankSize.z << "],\n";
  stream << "  \"emitter\": {\n";
  stream << "    \"origin\": [" << config.emitter.origin.x << ", " << config.emitter.origin.y << ", " << config.emitter.origin.z << "],\n";
  stream << "    \"direction\": [" << config.emitter.direction.x << ", " << config.emitter.direction.y << ", " << config.emitter.direction.z << "],\n";
  stream << "    \"radius\": " << config.emitter.radius << ",\n";
  stream << "    \"speed\": " << config.emitter.speed << ",\n";
  stream << "    \"massPerSecond\": " << config.emitter.massPerSecond << ",\n";
  stream << "    \"maxParticlesPerStep\": " << config.emitter.maxParticlesPerStep << "\n";
  stream << "  }\n";
  stream << "}\n";
  return stream.str();
}

SimulationConfig parseSimulationConfig(std::string_view text) {
  SimulationConfig config = makeDefaultSimulationConfig();
  config.seed = static_cast<std::uint32_t>(parseNumber(text, "seed"));
  config.fixedTimeStep = parseNumber(text, "fixedTimeStep");
  config.particleMass = parseNumber(text, "particleMass");
  config.maxActiveParticles = static_cast<std::uint32_t>(parseNumber(text, "maxActiveParticles"));
  config.restDensity = parseNumber(text, "restDensity");
  config.gridResolution = parseGridArray(text, "gridResolution");
  config.tankSize = parseVec3(text, "tankSize");
  config.emitter.origin = parseVec3(text, "origin");
  config.emitter.direction = parseVec3(text, "direction");
  config.emitter.radius = parseNumber(text, "radius");
  config.emitter.speed = parseNumber(text, "speed");
  config.emitter.massPerSecond = parseNumber(text, "massPerSecond");
  config.emitter.maxParticlesPerStep = static_cast<std::uint32_t>(parseNumber(text, "maxParticlesPerStep"));
  return config;
}

std::vector<BenchmarkMetrics> runBenchmark(TankFillSimulation& simulation, std::size_t stepCount, const StepInput& input) {
  std::vector<BenchmarkMetrics> metrics;
  metrics.reserve(stepCount);

  for (std::size_t step = 0; step < stepCount; ++step) {
    simulation.step(input);
    metrics.push_back(simulation.snapshot().metrics);
  }

  return metrics;
}

ReplayCapture captureReplay(TankFillSimulation& simulation, std::size_t stepCount, std::size_t captureStride, const StepInput& input) {
  ReplayCapture capture {};
  capture.config = simulation.config();
  capture.stepCount = stepCount;
  capture.captureStride = std::max<std::size_t>(1, captureStride);
  capture.frames.reserve(stepCount / capture.captureStride + 2);
  capture.frames.push_back(simulation.makeReplayFrame());

  for (std::size_t step = 0; step < stepCount; ++step) {
    simulation.step(input);
    const bool shouldCapture = ((step + 1) % capture.captureStride) == 0 || (step + 1) == stepCount;
    if (shouldCapture) {
      capture.frames.push_back(simulation.makeReplayFrame());
    }
  }

  capture.finalMetrics = simulation.snapshot().metrics;
  return capture;
}

std::string serializeReplayCapture(const ReplayCapture& capture) {
  std::ostringstream output;
  output << std::setprecision(6);
  output << "{"
         << "\"title\":\"FluidSim Viscous Finger Tank Replay\""
         << ",\"stepCount\":" << capture.stepCount
         << ",\"captureStride\":" << capture.captureStride
         << ",\"config\":";
  writeSimulationConfigJson(output, capture.config);
  output << ",\"finalMetrics\":";
  writeBenchmarkMetricsJson(output, capture.finalMetrics);
  output << ",\"frames\":[";
  for (std::size_t index = 0; index < capture.frames.size(); ++index) {
    if (index > 0) {
      output << ',';
    }
    writeReplayFrameJson(output, capture.frames[index]);
  }
  output << "]}";
  return output.str();
}

void writeBenchmarkCsv(std::ostream& output, const std::vector<BenchmarkMetrics>& metrics) {
  output << "frame,simulated_time_s,simulation_ms,render_ms,active_particles,fill_height,mass_error\n";
  for (const BenchmarkMetrics& metric : metrics) {
    output << metric.frameIndex << ','
           << metric.simulatedTimeSeconds << ','
           << metric.simulationTimeMs << ','
           << metric.renderTimeMs << ','
           << metric.activeParticleCount << ','
           << metric.fillHeight << ','
           << metric.massError << '\n';
  }
}

}  // namespace fluidsim
