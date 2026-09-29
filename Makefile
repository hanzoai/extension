# Hanzo extensions. Every build lands in dist/.
#
#   make install
#   make build                  every package
#   make build target=chrome    one: chrome, firefox or safari (all three are
#                               packages/browser), or any packages/<name>
#   make test [target=…]
#   make check                  the gate CI and every release run
#   make typecheck
#   make clean                  build output only; node_modules stays

.PHONY: help install browsers build test check typecheck clean dist

target ?= all
pkg    := $(if $(filter chrome firefox safari,$(target)),browser,$(target))
dir    := $(patsubst %/package.json,%,$(firstword $(wildcard packages/$(pkg)/package.json apps/$(pkg)/package.json)))

ifneq ($(target),all)
ifeq ($(dir),)
$(error unknown target '$(target)': use chrome, firefox, safari, or a directory under packages/ or apps/)
endif
endif

# A package builds after the workspace packages it depends on ({dir}...), and
# tests on its own.
build.pnpm := $(if $(dir),--filter "{./$(dir)}...",-r)
test.pnpm  := $(if $(dir),--filter "./$(dir)",-r)

# Playwright's browsers live in the repo, under .cache/: a runner's shared
# browser directory is root's, and a runner cannot sudo, so nothing here asks
# for --with-deps.
export PLAYWRIGHT_BROWSERS_PATH := $(CURDIR)/.cache/ms-playwright

help:
	@sed -n '1,/^$$/p' Makefile | sed 's/^# \{0,1\}//'

install: node_modules/.modules.yaml

node_modules/.modules.yaml: package.json pnpm-lock.yaml pnpm-workspace.yaml
	pnpm install

build: install
	pnpm $(build.pnpm) build
	@$(MAKE) --no-print-directory dist

# Each package builds in its own directory, where its package.json points main
# and files; dist/<name> links there so every artifact is under one root.
# packages/browser writes dist/chrome, dist/firefox and dist/safari itself.
dist:
	@mkdir -p dist
	@for out in packages/*/dist apps/*/dist packages/jupyter/hanzo_jupyter/labextension; do \
	  if [ -d "$$out" ]; then name=$${out#*/}; ln -sfn "../$$out" "dist/$${name%%/*}"; fi; \
	done

# Chromium, which apps/site's suite and the extension e2e drive.
browsers: install
	pnpm --filter @hanzo/browser-extension exec playwright install chromium

test: browsers
	pnpm $(test.pnpm) test

# Every package built and tested, the browser bundles held to budget, and the
# built extension driven in Chromium.
check: build test
	pnpm --filter @hanzo/browser-extension run check:bundle-budget
	pnpm --filter @hanzo/browser-extension run test:e2e

typecheck: install
	pnpm typecheck

clean:
	rm -rf dist packages/*/dist apps/*/dist packages/jupyter/lib packages/jupyter/hanzo_jupyter/labextension packages/vscode/out
