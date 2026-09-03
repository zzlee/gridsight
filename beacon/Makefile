CXX ?= x86_64-w64-mingw32-g++
HOST_CXX ?= g++

# Read version from root package.json (single source of truth)
AGENT_VERSION := $(shell node -e "try{console.log(require('../package.json').version)}catch(e){console.log('5.8.10')}" 2>/dev/null || echo 5.8.10)

ifeq ($(findstring mingw,$(CXX)),mingw)
    CXXFLAGS = -std=c++17 -O3 -Wall -Iinclude -mwindows -D_WIN32_WINNT=0x0602 -finput-charset=UTF-8 -fwide-exec-charset=UTF-16LE -DAGENT_VERSION='"$(AGENT_VERSION)"'
    LDFLAGS = -static -static-libgcc -static-libstdc++ -lws2_32 -liphlpapi -ld3d11 -ldxgi -lgdi32 -lgdiplus -luser32 -lmfplat -lmfuuid -lwmcodecdspuuid -lole32 -lwindowscodecs -loleaut32 -lshell32 -lshlwapi -luuid
    TARGET = gs-agent.exe
else
    CXXFLAGS = -std=c++17 -O3 -Wall -Iinclude -pthread -DAGENT_VERSION='"$(AGENT_VERSION)"'
    LDFLAGS = -pthread
    TARGET = gs-agent
endif

SRC = $(wildcard src/*.cpp)
OBJ = $(SRC:.cpp=.o)

all: $(TARGET)

$(TARGET): $(OBJ)
	$(CXX) -o $@ $^ $(LDFLAGS)

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

test-capture:
	mkdir -p build
	$(HOST_CXX) -std=c++17 -O2 -Wall -Wextra -pthread -Iinclude \
		tests/test_capture_lifecycle.cpp src/capture.cpp src/utils.cpp \
		-o build/test_capture_lifecycle
	timeout 30s ./build/test_capture_lifecycle

test-utils:
	mkdir -p build
	$(HOST_CXX) -std=c++17 -O2 -Wall -Wextra -pthread -Iinclude \
		tests/test_security_utils.cpp src/utils.cpp \
		-o build/test_security_utils
	timeout 30s ./build/test_security_utils

test-input-rtp:
	mkdir -p build
	$(HOST_CXX) -std=c++17 -O2 -Wall -Wextra -pthread -Iinclude \
		tests/test_input_rtp_receiver.cpp src/input_rtp_receiver.cpp src/utils.cpp \
		-o build/test_input_rtp_receiver
	timeout 30s ./build/test_input_rtp_receiver

test: test-capture test-utils test-input-rtp

clean:
	rm -f src/*.o $(TARGET) gs-agent.exe gs-agent build/test_capture_lifecycle build/test_security_utils build/test_input_rtp_receiver gs-agent.log

.PHONY: all clean test test-capture test-utils test-input-rtp
