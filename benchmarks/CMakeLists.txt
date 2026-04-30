add_executable(fluidsim-tank-fill-benchmark
  tank-fill/main.cpp
)

target_link_libraries(fluidsim-tank-fill-benchmark
  PRIVATE
    fluidsim::sim-core
)
