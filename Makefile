# Hanzo extensions. Every build lands in dist/.
#
#   make install
#   make build                  every package
#   make build target=chrome    one: chrome, firefox or safari (all three are
#                               packages/browser), jetbrains, or any packages/<name>
#   make test [target=…]
#   make check                  the gate CI and every release run
#   make typecheck
#   make clean                  build output only; node_modules stays

.PHONY: help install browsers build test check typecheck clean dist

target ?= all
pkg    := $(if $(filter chrome firefox safari,$(target)),browser,$(target))
dir    := $(patsubst %/package.json,%,$(firstword $(wildcard packages/$(pkg)/package.json apps/$(pkg)/package.json)))

ifeq ($(filter all jetbrains,$(target)),)
ifeq ($(dir),)
$(error unknown target '$(target)': use chrome, firefox, safari, jetbrains, or a directory under packages/ or apps/)
endif
endif

# A package builds after the workspace packages it depends on ({dir}...), and
# tests on its own.
build.pnpm := $(if $(dir),--filter "{./$(dir)}...",-r)
test.pnpm  := $(if $(dir),--filter "./$(dir)",-r)

# packages/jetbrains is a Gradle build outside the pnpm workspace: it runs with
# every package, and alone as target=jetbrains.
js     := $(filter-out jetbrains,$(target))
jvm    := $(filter all jetbrains,$(target))
gradle := cd packages/jetbrains && ./gradlew

# Gradle runs on the JDK on PATH; with none, on Temurin 21 fetched into
# .cache/jdk, because a runner has no JDK and cannot sudo.
jdk := $(CURDIR)/.cache/jdk
ifeq ($(shell command -v javac),)
export JAVA_HOME := $(jdk)
export PATH := $(jdk)/bin:$(PATH)
java := $(jdk)/bin/javac
endif

# Playwright's browsers live in the repo, under .cache/: a runner's shared
# browser directory is root's, and a runner cannot sudo, so nothing here asks
# for --with-deps.
export PLAYWRIGHT_BROWSERS_PATH := $(CURDIR)/.cache/ms-playwright

help:
	@sed -n '1,/^$$/p' Makefile | sed 's/^# \{0,1\}//'

install: node_modules/.modules.yaml

node_modules/.modules.yaml: package.json pnpm-lock.yaml pnpm-workspace.yaml
	pnpm install

$(jdk)/bin/javac:
	mkdir -p $(jdk)
	curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/linux/$(if $(filter x86_64,$(shell uname -m)),x64,aarch64)/jdk/hotspot/normal/eclipse" \
	  | tar -xz -C $(jdk) --strip-components=1

build: $(if $(js),install) $(if $(jvm),$(java))
ifneq ($(js),)
	pnpm $(build.pnpm) build
endif
ifneq ($(jvm),)
	$(gradle) buildPlugin
endif
	@$(MAKE) --no-print-directory dist

# Each package builds in its own directory, where its package.json points main
# and files; dist/<name> links there so every artifact is under one root.
# packages/browser writes dist/chrome, dist/firefox and dist/safari itself;
# packages/jetbrains writes its plugin zip to build/distributions.
dist:
	@mkdir -p dist
	@for out in packages/*/dist apps/*/dist packages/jupyter/hanzo_jupyter/labextension packages/jetbrains/build/distributions; do \
	  if [ -d "$$out" ]; then name=$${out#*/}; ln -sfn "../$$out" "dist/$${name%%/*}"; fi; \
	done

# Chromium, which apps/site's suite and the extension e2e drive.
browsers: install
	pnpm --filter @hanzo/browser-extension exec playwright install chromium

test: $(if $(js),browsers) $(if $(jvm),$(java))
ifneq ($(js),)
	pnpm $(test.pnpm) test
endif
ifneq ($(jvm),)
	$(gradle) test
endif

# Every package built and tested, the browser bundles held to budget, and the
# built extension driven in Chromium.
check: build test
	pnpm --filter @hanzo/browser-extension run check:bundle-budget
	pnpm --filter @hanzo/browser-extension run test:e2e

typecheck: install
	pnpm typecheck

clean:
	rm -rf dist packages/*/dist apps/*/dist packages/jupyter/lib packages/jupyter/tsconfig.tsbuildinfo packages/jupyter/hanzo_jupyter/labextension packages/vscode/out packages/jetbrains/build
