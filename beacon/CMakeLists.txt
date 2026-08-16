cmake_minimum_required(VERSION 3.15)
project(gs-agent CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(include)

file(GLOB_RECURSE SOURCES "src/*.cpp")

add_executable(gs-agent )

if (WIN32)
    # Background execution without console window
    set_target_properties(gs-agent PROPERTIES WIN32_EXECUTABLE TRUE)
    target_link_libraries(gs-agent ws2_32 iphlpapi d3d11 dxgi gdi32 user32)
endif()

# Static linking for zero-dependency deployment
if (MINGW)
    target_link_options(gs-agent PRIVATE -static -static-libgcc -static-libstdc++)
endif()
