#!/bin/bash

echo "Building JetBrains plugin with Docker..."
echo

# Build the Docker image
docker build -f Dockerfile.build -t hanzo-jetbrains-build .

# Run the build
docker run --rm -v "$(pwd)/build:/app/build" hanzo-jetbrains-build

echo
echo "Build complete! Plugin JAR should be in build/distributions/"
ls -la build/distributions/ 2>/dev/null || echo "Build output directory not found yet."