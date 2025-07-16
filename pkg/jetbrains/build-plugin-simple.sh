#!/bin/bash

set -e

echo "=== Hanzo AI JetBrains Plugin Build (Simple) ==="
echo

# Change to plugin directory
cd "$(dirname "$0")"

# Create build directory if it doesn't exist
mkdir -p build

echo "Building plugin using Docker (skipping searchable options)..."
echo

# Run Gradle build in Docker container, skipping the problematic task
docker run --rm \
  -v "$(pwd)":/home/gradle/project \
  -w /home/gradle/project \
  gradle:8.5-jdk17 \
  gradle buildPlugin -x buildSearchableOptions --no-daemon --stacktrace

echo
echo "Build completed successfully!"
echo

# Check for build outputs
if [ -d "build/distributions" ]; then
    echo "Plugin distributions:"
    ls -la build/distributions/
    
    # Copy the plugin file to a more accessible location
    if [ -f "build/distributions/Hanzo AI-0.1.0.zip" ]; then
        cp "build/distributions/Hanzo AI-0.1.0.zip" ./hanzo-ai-plugin.zip
        echo
        echo "Plugin file copied to: hanzo-ai-plugin.zip"
    fi
else
    echo "Warning: build/distributions directory not found"
fi

echo
echo "To install the plugin in your JetBrains IDE:"
echo "1. Open IDE Settings → Plugins"
echo "2. Click the gear icon → Install Plugin from Disk"
echo "3. Select hanzo-ai-plugin.zip"