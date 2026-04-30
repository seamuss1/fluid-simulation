#include "fluidsim/sim_core.hpp"
#include "fluidsim/windows_console.hpp"

#include <chrono>
#include <exception>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>

#if FLUIDSIM_HAS_GLFW
#include <GLFW/glfw3.h>
#endif

#if FLUIDSIM_HAS_VULKAN
#include <vulkan/vulkan.h>
#endif

namespace {

std::string makeTitle(const fluidsim::SimulationSnapshot& snapshot, double fps, bool hasVulkan) {
  std::ostringstream title;
  title << std::fixed << std::setprecision(2);
  title << "FluidSim Tank Fill v1";
  title << " | fps " << fps;
  title << " | particles " << snapshot.metrics.activeParticleCount;
  title << " | fill " << snapshot.metrics.fillHeight << " m";
  title << " | mass err " << snapshot.metrics.massError << " kg";
  title << " | " << (hasVulkan ? "Vulkan" : "headless");
  return title.str();
}

#if FLUIDSIM_HAS_VULKAN
VkInstance createVulkanInstance() {
  VkApplicationInfo appInfo {};
  appInfo.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
  appInfo.pApplicationName = "FluidSim Viewer Native";
  appInfo.applicationVersion = VK_MAKE_VERSION(0, 1, 0);
  appInfo.pEngineName = "FluidSim";
  appInfo.engineVersion = VK_MAKE_VERSION(0, 1, 0);
  appInfo.apiVersion = VK_API_VERSION_1_1;

  VkInstanceCreateInfo createInfo {};
  createInfo.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
  createInfo.pApplicationInfo = &appInfo;

#if FLUIDSIM_HAS_GLFW
  std::uint32_t extensionCount = 0;
  const char** extensions = glfwGetRequiredInstanceExtensions(&extensionCount);
  createInfo.enabledExtensionCount = extensionCount;
  createInfo.ppEnabledExtensionNames = extensions;
#endif

  VkInstance instance = VK_NULL_HANDLE;
  if (vkCreateInstance(&createInfo, nullptr, &instance) != VK_SUCCESS) {
    throw std::runtime_error("Failed to create Vulkan instance for viewer-native.");
  }

  return instance;
}
#endif

void runHeadlessViewer() {
  fluidsim::TankFillSimulation simulation;
  for (std::size_t frame = 0; frame < 240; ++frame) {
    simulation.step();
  }

  const auto& snapshot = simulation.snapshot();
  std::cout << makeTitle(snapshot, 0.0, false) << '\n';
  std::cout << "viewer-native built without GLFW/Vulkan window support; ran headless benchmark fallback instead.\n";
  fluidsim::waitForExitIfExplorerLaunched();
}

}  // namespace

int main() {
#if !(FLUIDSIM_HAS_GLFW && FLUIDSIM_HAS_VULKAN)
  runHeadlessViewer();
  return 0;
#else
  if (glfwInit() == GLFW_FALSE) {
    std::cerr << "GLFW initialization failed.\n";
    return 1;
  }

  glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
  GLFWwindow* window = glfwCreateWindow(1280, 720, "FluidSim Tank Fill v1", nullptr, nullptr);
  if (window == nullptr) {
    glfwTerminate();
    std::cerr << "Failed to create native viewer window.\n";
    return 1;
  }

  VkInstance instance = VK_NULL_HANDLE;
  try {
    instance = createVulkanInstance();
  } catch (const std::exception& error) {
    glfwDestroyWindow(window);
    glfwTerminate();
    std::cerr << error.what() << '\n';
    return 1;
  }

  fluidsim::TankFillSimulation simulation;
  auto previousFrame = std::chrono::steady_clock::now();

  while (glfwWindowShouldClose(window) == GLFW_FALSE) {
    const auto frameStart = std::chrono::steady_clock::now();
    const double frameSeconds = std::chrono::duration<double>(frameStart - previousFrame).count();
    previousFrame = frameStart;

    glfwPollEvents();
    simulation.step();

    const double fps = frameSeconds > 0.0 ? 1.0 / frameSeconds : 0.0;
    const std::string title = makeTitle(simulation.snapshot(), fps, true);
    glfwSetWindowTitle(window, title.c_str());

    std::this_thread::sleep_for(std::chrono::milliseconds(16));
  }

  vkDestroyInstance(instance, nullptr);
  glfwDestroyWindow(window);
  glfwTerminate();
  return 0;
#endif
}
