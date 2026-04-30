add_executable(fluidsim-sim-core-tests
  sim_core_tests.cpp
)

target_link_libraries(fluidsim-sim-core-tests
  PRIVATE
    fluidsim::sim-core
)

add_test(NAME fluidsim-sim-core-tests COMMAND fluidsim-sim-core-tests)
