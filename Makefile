.PHONY: help setup dev build test clean install-local login

# Colors
GREEN := $(shell tput -Txterm setaf 2)
YELLOW := $(shell tput -Txterm setaf 3)
WHITE := $(shell tput -Txterm setaf 7)
CYAN := $(shell tput -Txterm setaf 6)
RESET := $(shell tput -Txterm sgr0)

# Default target
help:
	@echo ""
	@echo "${GREEN}Hanzo Dev - Local Development${RESET}"
	@echo ""
	@echo "${YELLOW}Available commands:${RESET}"
	@echo "  ${CYAN}make setup${RESET}         - Set up for local development"
	@echo "  ${CYAN}make dev${RESET}           - Start development mode"
	@echo "  ${CYAN}make build${RESET}         - Build all packages"
	@echo "  ${CYAN}make install-local${RESET} - Install hanzo-dev locally"
	@echo "  ${CYAN}make login${RESET}         - Login to Hanzo AI"
	@echo "  ${CYAN}make test${RESET}          - Run tests"
	@echo "  ${CYAN}make clean${RESET}         - Clean build artifacts"
	@echo ""

# Setup for local development
setup:
	@echo "${GREEN}Setting up Hanzo Dev...${RESET}"
	@npm install
	@make build
	@make install-local
	@echo "${GREEN}✓ Setup complete!${RESET}"
	@echo ""
	@echo "${YELLOW}Next steps:${RESET}"
	@echo "1. Run: ${CYAN}make login${RESET}"
	@echo "2. Run: ${CYAN}hanzo-dev init${RESET}"
	@echo ""

# Development mode
dev:
	@echo "${GREEN}Starting development mode...${RESET}"
	@npm run watch &
	@cd packages/dev && npm run dev &
	@cd packages/mcp && npm run dev &
	@echo "${GREEN}Development servers started!${RESET}"
	@echo "Press Ctrl+C to stop"
	@wait

# Build all packages
build:
	@echo "${GREEN}Building VS Code extension...${RESET}"
	@npm run compile
	@echo "${GREEN}Building CLI (@hanzo/dev)...${RESET}"
	@cd packages/dev && npm install && npm run build
	@echo "${GREEN}Building MCP (@hanzo/mcp)...${RESET}"
	@cd packages/mcp && npm install && npm run build
	@echo "${GREEN}✓ Build complete!${RESET}"

# Install hanzo-dev command locally
install-local:
	@echo "${GREEN}Installing hanzo-dev locally...${RESET}"
	@cd packages/dev && npm link
	@echo "${GREEN}✓ hanzo-dev installed!${RESET}"
	@echo "Run '${CYAN}hanzo-dev --help${RESET}' to get started"

# Login to Hanzo AI
login:
	@echo "${GREEN}Logging in to Hanzo AI...${RESET}"
	@hanzo-dev login

# Run tests
test:
	@echo "${GREEN}Running tests...${RESET}"
	@npm test
	@cd packages/dev && npm test
	@cd packages/mcp && npm test

# Clean build artifacts
clean:
	@echo "${YELLOW}Cleaning build artifacts...${RESET}"
	@rm -rf out dist
	@rm -rf packages/dev/dist
	@rm -rf packages/mcp/dist
	@rm -rf node_modules
	@rm -rf packages/dev/node_modules
	@rm -rf packages/mcp/node_modules
	@echo "${GREEN}✓ Clean complete!${RESET}"

# Quick commands for development
run-claude:
	@hanzo-dev run claude "$(TASK)"

run-aider:
	@hanzo-dev run aider "$(TASK)" --auto-commit

run-openhands:
	@hanzo-dev run openhands "$(TASK)" --worktree

compare:
	@hanzo-dev compare "$(TASK)"

# Example usage:
# make run-claude TASK="implement a REST API"
# make run-aider TASK="fix the failing tests"
# make compare TASK="optimize this database query"