#!/bin/bash

set -e

echo "=== Hanzo AI JetBrains Plugin Build ==="
echo

# Change to plugin directory
cd "$(dirname "$0")"

# Create build directory if it doesn't exist
mkdir -p build

echo "Building plugin using Docker..."
echo

# Run Gradle build in Docker container
docker run --rm \
  -v "$(pwd)":/home/gradle/project \
  -w /home/gradle/project \
  gradle:8.5-jdk17 \
  gradle build --no-daemon --stacktrace

echo
echo "Build completed successfully!"
echo

# Check for build outputs
if [ -d "build/distributions" ]; then
    echo "Plugin distributions:"
    ls -la build/distributions/
else
    echo "Warning: build/distributions directory not found"
fi

if [ -d "build/libs" ]; then
    echo
    echo "Plugin JARs:"
    ls -la build/libs/
else
    echo "Warning: build/libs directory not found"
fi

echo
echo "To install the plugin in your JetBrains IDE:"
echo "1. Open IDE Settings → Plugins"
echo "2. Click the gear icon → Install Plugin from Disk"
echo "3. Select the .zip file from build/distributions/"