add_library(fluidsim-sim-core
  src/sim_core.cpp
  src/replay_html.cpp
)

add_library(fluidsim::sim-core ALIAS fluidsim-sim-core)

target_include_directories(fluidsim-sim-core
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)
