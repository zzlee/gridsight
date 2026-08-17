CXX ?= x86_64-w64-mingw32-g++
CXXFLAGS = -std=c++17 -O3 -Wall -Iinclude -mwindows
LDFLAGS = -static -static-libgcc -static-libstdc++ -lws2_32 -liphlpapi -ld3d11 -ldxgi -lgdi32 -luser32 -lmfplat -lmfuuid -lwmcodecdspuuid -lole32

SRC = $(wildcard src/*.cpp)
OBJ = $(SRC:.cpp=.o)
TARGET = gs-agent.exe

all: $(TARGET)

$(TARGET): $(OBJ)
	$(CXX) -o $@ $^ $(LDFLAGS)

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

clean:
	rm -f src/*.o $(TARGET)

.PHONY: all clean
