#!/bin/bash

# Hanzo Dev Local Setup Script

set -e

echo "🚀 Setting up Hanzo Dev for local development..."

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is required but not installed.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js found: $(node --version)${NC}"

# Install dependencies
echo -e "\n${BLUE}📦 Installing dependencies...${NC}"
npm install

# Build the project
echo -e "\n${BLUE}🔨 Building Hanzo Dev...${NC}"

# Build VS Code extension
echo "Building VS Code extension..."
npm run compile

# Build CLI tool
echo "Building CLI tool..."
cd packages/dev
npm install
npm run build
cd ../..

# Build MCP server
echo "Building MCP server..."
cd packages/mcp
npm install
npm run build
cd ../..

# Create symlink for local development
echo -e "\n${BLUE}🔗 Creating local development symlink...${NC}"
npm link packages/dev

# Create hanzo-dev command
echo -e "\n${BLUE}🎯 Setting up hanzo-dev command...${NC}"

# Create a wrapper script
cat > /tmp/hanzo-dev-wrapper.js << 'EOF'
#!/usr/bin/env node
require('./packages/dev/dist/cli/hanzo-dev.js');
EOF

chmod +x /tmp/hanzo-dev-wrapper.js
sudo ln -sf "$(pwd)/tmp/hanzo-dev-wrapper.js" /usr/local/bin/hanzo-dev

echo -e "\n${GREEN}✅ Setup complete!${NC}"
echo -e "\n${YELLOW}Quick Start:${NC}"
echo "1. Login to Hanzo AI:"
echo -e "   ${BLUE}hanzo-dev login${NC}"
echo ""
echo "2. Initialize in your project:"
echo -e "   ${BLUE}hanzo-dev init${NC}"
echo ""
echo "3. Run any AI tool:"
echo -e "   ${BLUE}hanzo-dev run claude "your task"${NC}"
echo -e "   ${BLUE}hanzo-dev run aider "fix the tests" --auto-commit${NC}"
echo -e "   ${BLUE}hanzo-dev run openhands "analyze codebase" --worktree${NC}"
echo ""
echo "4. Compare tools:"
echo -e "   ${BLUE}hanzo-dev compare "optimize this function"${NC}"
echo ""
echo "5. Run in background:"
echo -e "   ${BLUE}hanzo-dev run claude "big refactoring task" --async${NC}"
echo ""
echo -e "${GREEN}🎉 Happy coding with Hanzo Dev!${NC}"