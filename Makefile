# Hanzo extensions. Every build lands in dist/.
#
#   make install
#   make build                  every package
#   make build target=chrome    one: chrome, firefox or safari (all three are
#                               packages/browser), or any packages/<name>
#   make test [target=…]
#   make typecheck
#   make clean                  build output only; node_modules stays

.PHONY: help install build test typecheck clean dist

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

test: install
	pnpm $(test.pnpm) test

typecheck: install
	pnpm typecheck

clean:
	rm -rf dist packages/*/dist apps/*/dist packages/jupyter/lib packages/jupyter/hanzo_jupyter/labextension packages/vscode/out
