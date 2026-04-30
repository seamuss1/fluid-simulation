set(FLUIDSIM_VIEWER_HAS_GLFW 0)
set(FLUIDSIM_VIEWER_HAS_VULKAN 0)
set(FLUIDSIM_GLFW_TARGET "")

find_package(glfw3 QUIET)
if(TARGET glfw)
  set(FLUIDSIM_VIEWER_HAS_GLFW 1)
  set(FLUIDSIM_GLFW_TARGET glfw)
elseif(TARGET glfw3::glfw)
  set(FLUIDSIM_VIEWER_HAS_GLFW 1)
  set(FLUIDSIM_GLFW_TARGET glfw3::glfw)
endif()

find_package(Vulkan QUIET)
if(Vulkan_FOUND)
  set(FLUIDSIM_VIEWER_HAS_VULKAN 1)
endif()

add_executable(fluidsim-viewer-native
  src/main.cpp
)

target_link_libraries(fluidsim-viewer-native
  PRIVATE
    fluidsim::sim-core
)

if(FLUIDSIM_VIEWER_HAS_GLFW)
  target_link_libraries(fluidsim-viewer-native PRIVATE ${FLUIDSIM_GLFW_TARGET})
endif()

if(FLUIDSIM_VIEWER_HAS_VULKAN)
  target_link_libraries(fluidsim-viewer-native PRIVATE Vulkan::Vulkan)
endif()

target_compile_definitions(fluidsim-viewer-native
  PRIVATE
    FLUIDSIM_HAS_GLFW=${FLUIDSIM_VIEWER_HAS_GLFW}
    FLUIDSIM_HAS_VULKAN=${FLUIDSIM_VIEWER_HAS_VULKAN}
)

if(FLUIDSIM_VIEWER_HAS_GLFW AND FLUIDSIM_VIEWER_HAS_VULKAN)
  message(STATUS "viewer-native: GLFW and Vulkan detected; windowed viewer enabled.")
else()
  message(STATUS "viewer-native: GLFW/Vulkan not fully available; building headless fallback.")
endif()
