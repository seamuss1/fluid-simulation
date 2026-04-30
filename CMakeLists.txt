cmake_minimum_required(VERSION 3.24)

project(FluidSimulation LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_SUPPRESS_REGENERATION ON)

option(FLUIDSIM_BUILD_BENCHMARKS "Build benchmark executables." ON)
option(FLUIDSIM_BUILD_TESTS "Build unit and integration-style tests." ON)
option(FLUIDSIM_BUILD_VIEWER_NATIVE "Build the native viewer target." ON)

add_subdirectory(sim-core)

if(FLUIDSIM_BUILD_BENCHMARKS)
  add_subdirectory(benchmarks)
endif()

if(FLUIDSIM_BUILD_VIEWER_NATIVE)
  add_subdirectory(viewer-native)
endif()

if(FLUIDSIM_BUILD_TESTS)
  include(CTest)
  enable_testing()
  add_subdirectory(tests)
endif()
