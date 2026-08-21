CXX ?= x86_64-w64-mingw32-g++

ifeq ($(findstring mingw,$(CXX)),mingw)
    CXXFLAGS = -std=c++17 -O3 -Wall -Iinclude -mwindows -D_WIN32_WINNT=0x0602
    LDFLAGS = -static -static-libgcc -static-libstdc++ -lws2_32 -liphlpapi -ld3d11 -ldxgi -lgdi32 -lgdiplus -luser32 -lmfplat -lmfuuid -lwmcodecdspuuid -lole32 -lwindowscodecs -loleaut32 -lshell32 -lshlwapi
    TARGET = gs-agent.exe
else
    CXXFLAGS = -std=c++17 -O3 -Wall -Iinclude -pthread
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

clean:
	rm -f src/*.o $(TARGET) gs-agent.exe gs-agent

.PHONY: all clean
