.PHONY: help install setup dev build test clean link login publish release release-minor release-major tag push version-patch version-minor version-major changelog lint format verify update outdated audit new-package run-claude run-aider run-openhands run-gemini run-codex run-grok compare

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
	@echo "  ${CYAN}make install${RESET}       - Install all dependencies"
	@echo "  ${CYAN}make setup${RESET}         - Set up for local development"
	@echo "  ${CYAN}make dev${RESET}           - Start development mode"
	@echo "  ${CYAN}make build${RESET}         - Build all packages"
	@echo "  ${CYAN}make link${RESET}          - Link hanzo-dev globally for development"
	@echo "  ${CYAN}make login${RESET}         - Login to Hanzo AI"
	@echo "  ${CYAN}make test${RESET}          - Run tests"
	@echo "  ${CYAN}make lint${RESET}          - Lint code"
	@echo "  ${CYAN}make format${RESET}        - Format code"
	@echo "  ${CYAN}make clean${RESET}         - Clean build artifacts"
	@echo ""
	@echo "${YELLOW}Release commands:${RESET}"
	@echo "  ${CYAN}make release${RESET}       - Create a patch release (test, build, version, tag, push, publish)"
	@echo "  ${CYAN}make release-minor${RESET} - Create a minor release"
	@echo "  ${CYAN}make release-major${RESET} - Create a major release"
	@echo "  ${CYAN}make publish${RESET}       - Publish packages to npm"
	@echo "  ${CYAN}make tag${RESET}           - Create git tag from package version"
	@echo "  ${CYAN}make push${RESET}          - Push code and tags to origin"
	@echo "  ${CYAN}make changelog${RESET}     - Generate changelog from commits"
	@echo ""
	@echo "${YELLOW}Maintenance commands:${RESET}"
	@echo "  ${CYAN}make verify${RESET}        - Run all checks (clean, install, build, test, lint)"
	@echo "  ${CYAN}make update${RESET}        - Update dependencies interactively"
	@echo "  ${CYAN}make outdated${RESET}      - Check for outdated packages"
	@echo "  ${CYAN}make audit${RESET}         - Run security audit"
	@echo ""
	@echo "${YELLOW}Development tools:${RESET}"
	@echo "  ${CYAN}make run-claude TASK=\"...\"${RESET}     - Run task with Claude"
	@echo "  ${CYAN}make run-aider TASK=\"...\"${RESET}      - Run task with Aider"
	@echo "  ${CYAN}make run-openhands TASK=\"...\"${RESET}  - Run task with OpenHands"
	@echo "  ${CYAN}make run-gemini TASK=\"...\"${RESET}     - Run task with Gemini"
	@echo "  ${CYAN}make run-codex TASK=\"...\"${RESET}      - Run task with Codex"
	@echo "  ${CYAN}make run-grok TASK=\"...\"${RESET}       - Run task with Grok"
	@echo "  ${CYAN}make compare TASK=\"...\"${RESET}        - Compare AI agents on task"
	@echo "  ${CYAN}make new-package NAME=pkg${RESET}      - Create new package"
	@echo ""

# Install all dependencies
install:
	@echo "${GREEN}Installing dependencies...${RESET}"
	@pnpm install
	@echo "${GREEN}✓ Dependencies installed!${RESET}"

# Setup for local development
setup:
	@echo "${GREEN}Setting up Hanzo Dev...${RESET}"
	@make install
	@make build
	@make link
	@echo "${GREEN}✓ Setup complete!${RESET}"
	@echo ""
	@echo "${YELLOW}Next steps:${RESET}"
	@echo "1. Run: ${CYAN}make login${RESET}"
	@echo "2. Run: ${CYAN}hanzo-dev init${RESET}"
	@echo ""

# Development mode
dev:
	@echo "${GREEN}Starting development mode...${RESET}"
	@pnpm run watch &
	@cd packages/dev && pnpm run dev &
	@cd packages/mcp && pnpm run dev &
	@echo "${GREEN}Development servers started!${RESET}"
	@echo "Press Ctrl+C to stop"
	@wait

# Build all packages
build:
	@echo "${GREEN}Building all packages...${RESET}"
	@pnpm run build
	@echo "${GREEN}✓ Build complete!${RESET}"

# Link hanzo-dev command globally for development
link:
	@echo "${GREEN}Linking hanzo-dev globally...${RESET}"
	@cd packages/dev && pnpm link --global
	@echo "${GREEN}✓ hanzo-dev linked!${RESET}"
	@echo "Run '${CYAN}hanzo-dev --help${RESET}' to get started"

# Login to Hanzo AI
login:
	@echo "${GREEN}Logging in to Hanzo AI...${RESET}"
	@hanzo-dev login

# Run tests
test:
	@echo "${GREEN}Running tests...${RESET}"
	@pnpm test
	@echo "${GREEN}✓ Tests complete!${RESET}"

# Clean build artifacts
clean:
	@echo "${YELLOW}Cleaning build artifacts...${RESET}"
	@rm -rf out dist
	@rm -rf packages/*/dist
	@rm -rf node_modules
	@rm -rf packages/*/node_modules
	@rm -rf apps/*/node_modules
	@echo "${GREEN}✓ Clean complete!${RESET}"

# Quick commands for development
run-claude:
	@hanzo-dev run claude "$(TASK)"

run-aider:
	@hanzo-dev run aider "$(TASK)" --auto-commit

run-openhands:
	@hanzo-dev run openhands "$(TASK)" --worktree

run-gemini:
	@hanzo-dev run gemini "$(TASK)"

run-codex:
	@hanzo-dev run codex "$(TASK)"

run-grok:
	@hanzo-dev run grok "$(TASK)"

compare:
	@hanzo-dev compare "$(TASK)"

# Example usage:
# make run-claude TASK="implement a REST API"
# make run-aider TASK="fix the failing tests"
# make run-gemini TASK="analyze this codebase"
# make run-codex TASK="generate unit tests"
# make run-grok TASK="explain this algorithm"
# make compare TASK="optimize this database query"

# Lint code
lint:
	@echo "${GREEN}Linting code...${RESET}"
	@pnpm run lint
	@echo "${GREEN}✓ Linting complete!${RESET}"

# Format code
format:
	@echo "${GREEN}Formatting code...${RESET}"
	@pnpm run format
	@echo "${GREEN}✓ Formatting complete!${RESET}"

# Version commands
version-patch:
	@echo "${GREEN}Bumping patch version...${RESET}"
	@pnpm version patch
	@echo "${GREEN}✓ Version bumped!${RESET}"

version-minor:
	@echo "${GREEN}Bumping minor version...${RESET}"
	@pnpm version minor
	@echo "${GREEN}✓ Version bumped!${RESET}"

version-major:
	@echo "${GREEN}Bumping major version...${RESET}"
	@pnpm version major
	@echo "${GREEN}✓ Version bumped!${RESET}"

# Git operations
tag:
	@echo "${GREEN}Creating git tag...${RESET}"
	@git tag v$$(node -p "require('./package.json').version")
	@echo "${GREEN}✓ Tag created: v$$(node -p "require('./package.json').version")${RESET}"

push:
	@echo "${GREEN}Pushing to origin...${RESET}"
	@git push origin main
	@git push origin --tags
	@echo "${GREEN}✓ Pushed to origin!${RESET}"

# Publish to npm
publish: test build
	@echo "${GREEN}Publishing to npm...${RESET}"
	@pnpm -r publish --access public
	@echo "${GREEN}✓ Published to npm!${RESET}"

# Create a new release (bump version, tag, push, and publish)
release: version-patch tag push publish
	@echo "${GREEN}✓ Release complete!${RESET}"

release-minor: version-minor tag push publish
	@echo "${GREEN}✓ Minor release complete!${RESET}"

release-major: version-major tag push publish
	@echo "${GREEN}✓ Major release complete!${RESET}"

# Generate changelog
changelog:
	@echo "${GREEN}Generating changelog...${RESET}"
	@git log --pretty=format:"* %s (%h)" $$(git describe --tags --abbrev=0)..HEAD > CHANGELOG.md
	@echo "${GREEN}✓ Changelog generated!${RESET}"

# Verify everything is working
verify: clean install build test lint
	@echo "${GREEN}✓ All checks passed!${RESET}"

# Update dependencies
update:
	@echo "${GREEN}Updating dependencies...${RESET}"
	@pnpm update -r --interactive
	@echo "${GREEN}✓ Dependencies updated!${RESET}"

# Check for outdated packages
outdated:
	@echo "${GREEN}Checking for outdated packages...${RESET}"
	@pnpm outdated -r

# Run security audit
audit:
	@echo "${GREEN}Running security audit...${RESET}"
	@pnpm audit
	@echo "${GREEN}✓ Security audit complete!${RESET}"

# Create a new package
new-package:
	@echo "${GREEN}Creating new package: $(NAME)${RESET}"
	@mkdir -p packages/$(NAME)
	@cd packages/$(NAME) && pnpm init
	@echo "${GREEN}✓ Package created at packages/$(NAME)${RESET}"

# Example: make new-package NAME=my-new-package

# Start specific services
start-llm:
	@echo "${GREEN}Starting LLM gateway...${RESET}"
	@cd llm && make dev

start-chat:
	@echo "${GREEN}Starting Chat application...${RESET}"
	@cd chat && make dev

start-search:
	@echo "${GREEN}Starting Search application...${RESET}"
	@cd search && pnpm dev

# Docker operations
docker-up:
	@echo "${GREEN}Starting Docker services...${RESET}"
	@docker compose up -d
	@echo "${GREEN}✓ Docker services started!${RESET}"

docker-down:
	@echo "${YELLOW}Stopping Docker services...${RESET}"
	@docker compose down
	@echo "${GREEN}✓ Docker services stopped!${RESET}"

docker-logs:
	@docker compose logs -f

# Database operations
db-migrate:
	@echo "${GREEN}Running database migrations...${RESET}"
	@cd api && alembic upgrade head
	@echo "${GREEN}✓ Migrations complete!${RESET}"

db-reset:
	@echo "${YELLOW}Resetting database...${RESET}"
	@cd api && alembic downgrade base && alembic upgrade head
	@echo "${GREEN}✓ Database reset complete!${RESET}"

# Quick development shortcuts
dev-full:
	@echo "${GREEN}Starting full development environment...${RESET}"
	@make docker-up
	@make dev
	@echo "${GREEN}✓ Full dev environment started!${RESET}"

# Check project health
health:
	@echo "${GREEN}Checking project health...${RESET}"
	@echo ""
	@echo "📦 Package versions:"
	@node -p "require('./package.json').version"
	@echo ""
	@echo "🔧 Node version:"
	@node --version
	@echo ""
	@echo "📦 pnpm version:"
	@pnpm --version
	@echo ""
	@echo "🐳 Docker version:"
	@docker --version
	@echo ""
	@echo "${GREEN}✓ Health check complete!${RESET}"