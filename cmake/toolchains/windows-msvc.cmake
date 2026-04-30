set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_VERSION 10.0)
set(CMAKE_SYSTEM_PROCESSOR AMD64)

# This toolchain file is intended for use from a Visual Studio developer shell.
# The companion PowerShell scripts load VsDevCmd first so `cl`, `lib`, `link`,
# `rc`, and `mt` are available on PATH with the expected INCLUDE/LIB settings.
set(CMAKE_CXX_COMPILER cl)
set(CMAKE_CXX_COMPILER_ID MSVC)
set(CMAKE_CXX_COMPILER_VERSION 19.44.35225.0)
set(CMAKE_CXX_COMPILER_FORCED TRUE)
set(CMAKE_CXX_COMPILER_WORKS TRUE)
set(CMAKE_CXX_COMPILER_FRONTEND_VARIANT MSVC)

set(CMAKE_C_COMPILER cl)
set(CMAKE_C_COMPILER_ID MSVC)
set(CMAKE_C_COMPILER_VERSION 19.44.35225.0)
set(CMAKE_C_COMPILER_FORCED TRUE)
set(CMAKE_C_COMPILER_WORKS TRUE)
set(CMAKE_C_COMPILER_FRONTEND_VARIANT MSVC)

set(CMAKE_AR lib)
set(CMAKE_LINKER link)
set(CMAKE_MT mt)
set(CMAKE_RC_COMPILER rc)

# Skip the problematic ABI executable probe in this sandboxed Windows setup.
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
