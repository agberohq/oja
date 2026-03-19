# oja/Makefile
#
# Requirements:
#   npm install --save-dev esbuild clean-css-cli
#   npm install --save-dev google-closure-compiler  # optional, for advanced builds
#
# Usage:
#   make            → build core + full (esbuild, fast)
#   make core       → core build only  (oja.core.min.js + oja.core.esm.js)
#   make full       → full build only  (oja.full.min.js + oja.full.esm.js)
#   make css        → CSS only
#   make watch      → rebuild on save (dev, core IIFE)
#   make clean      → remove build/
#   make check      → show output sizes
#   make simple     → Closure Compiler SIMPLE mode (smaller)
#   make advanced   → Closure Compiler ADVANCED mode (smallest)
#   make compare    → build all and compare sizes

SRC_DIR    = src
JS_DIR     = $(SRC_DIR)/js
CSS_DIR    = $(SRC_DIR)/css
BUILD_DIR  = build
EXTERN_DIR = externs

# Entry points
CORE_ENTRY = $(SRC_DIR)/oja.js
FULL_ENTRY = $(SRC_DIR)/oja.full.js

# esbuild outputs — IIFE (for <script> tags) and ESM (for bundlers / import maps)
CORE_IIFE  = $(BUILD_DIR)/oja.core.min.js
CORE_ESM   = $(BUILD_DIR)/oja.core.esm.js
FULL_IIFE  = $(BUILD_DIR)/oja.full.min.js
FULL_ESM   = $(BUILD_DIR)/oja.full.esm.js

# Closure Compiler outputs (optional — maximum compression)
CORE_SIMPLE   = $(BUILD_DIR)/oja.core.simple.js
CORE_ADVANCED = $(BUILD_DIR)/oja.core.advanced.js

# CSS
CSS_OUT = $(BUILD_DIR)/oja.min.css

# Cross-platform size display (macOS + Linux)
SIZE = $(shell if command -v numfmt >/dev/null 2>&1; then echo "numfmt --to=iec"; else echo "echo"; fi)

# ─── Default — build everything ───────────────────────────────────────────────

all: core full $(CSS_OUT)

# ─── Core build ───────────────────────────────────────────────────────────────
# reactive, template, events, router, out, component, modal, notify, ui,
# form, auth, api, store, animate, channel, adapter, logger, debug,
# history, validate, codecs — no plugins

core: $(CORE_IIFE) $(CORE_ESM)

$(CORE_IIFE): $(CORE_ENTRY)
	@mkdir -p $(BUILD_DIR)
	@echo "› Building core IIFE (esbuild)..."
	@npx esbuild $(CORE_ENTRY) \
		--bundle \
		--minify \
		--format=iife \
		--global-name=Oja \
		--outfile=$@ \
		--log-level=warning
	@echo "✓ $@ ($$(wc -c < $@ | $(SIZE)))"

$(CORE_ESM): $(CORE_ENTRY)
	@mkdir -p $(BUILD_DIR)
	@echo "› Building core ESM (esbuild)..."
	@npx esbuild $(CORE_ENTRY) \
		--bundle \
		--minify \
		--format=esm \
		--outfile=$@ \
		--log-level=warning
	@echo "✓ $@ ($$(wc -c < $@ | $(SIZE)))"

# ─── Full build ───────────────────────────────────────────────────────────────
# Everything in core + all plugins:
# socket, wasm, worker, cssvars, lazy, clipboard, dragdrop,
# canvas, export, infinitescroll, pulltorefresh, webrtc

full: $(FULL_IIFE) $(FULL_ESM)

$(FULL_IIFE): $(FULL_ENTRY)
	@mkdir -p $(BUILD_DIR)
	@echo "› Building full IIFE (esbuild)..."
	@npx esbuild $(FULL_ENTRY) \
		--bundle \
		--minify \
		--format=iife \
		--global-name=OjaFull \
		--outfile=$@ \
		--log-level=warning
	@echo "✓ $@ ($$(wc -c < $@ | $(SIZE)))"

$(FULL_ESM): $(FULL_ENTRY)
	@mkdir -p $(BUILD_DIR)
	@echo "› Building full ESM (esbuild)..."
	@npx esbuild $(FULL_ENTRY) \
		--bundle \
		--minify \
		--format=esm \
		--outfile=$@ \
		--log-level=warning
	@echo "✓ $@ ($$(wc -c < $@ | $(SIZE)))"

# ─── CSS ──────────────────────────────────────────────────────────────────────

$(CSS_OUT): $(wildcard $(CSS_DIR)/*.css)
	@mkdir -p $(BUILD_DIR)
	@echo "› Minifying CSS..."
	@npx clean-css-cli $(CSS_DIR)/oja.css -o $@
	@echo "✓ $@ ($$(wc -c < $@ | $(SIZE)))"

css: $(CSS_OUT)

# ─── Closure Compiler (optimal production — core only) ────────────────────────

$(EXTERN_DIR):
	@mkdir -p $(EXTERN_DIR)
	@echo "/** @externs */" > $(EXTERN_DIR)/oja.externs.js
	@echo "var Oja = {};" >> $(EXTERN_DIR)/oja.externs.js

$(CORE_SIMPLE): $(CORE_ENTRY)
	@mkdir -p $(BUILD_DIR)
	@echo "› Building core IIFE (Closure SIMPLE)..."
	@npx google-closure-compiler \
		--entry_point=$(CORE_ENTRY) \
		--dependency_mode=PRUNE \
		--compilation_level=SIMPLE \
		--language_in=ECMASCRIPT_NEXT \
		--language_out=ECMASCRIPT_NEXT \
		--js $(CORE_ENTRY) \
		--js_output_file=$@ \
		--warning_level=QUIET \
		--output_wrapper="var Oja={};(function(Oja){%output%}).call(this,Oja);"
	@echo "✓ $@ ($$(wc -c < $@ | $(SIZE)))"

$(CORE_ADVANCED): $(CORE_ENTRY) $(EXTERN_DIR)/oja.externs.js
	@mkdir -p $(BUILD_DIR)
	@echo "› Building core IIFE (Closure ADVANCED)..."
	@npx google-closure-compiler \
		--entry_point=$(CORE_ENTRY) \
		--dependency_mode=PRUNE \
		--compilation_level=ADVANCED \
		--language_in=ECMASCRIPT_NEXT \
		--language_out=ECMASCRIPT_NEXT \
		--js $(CORE_ENTRY) \
		--externs $(EXTERN_DIR)/oja.externs.js \
		--js_output_file=$@ \
		--warning_level=QUIET \
		--assume_function_wrapper \
		--output_wrapper="(function(){%output%}).call(this);"
	@echo "✓ $@ ($$(wc -c < $@ | $(SIZE)))"

simple:   $(CORE_SIMPLE) $(CSS_OUT)
advanced: $(CORE_ADVANCED) $(CSS_OUT)

# ─── Development watch ────────────────────────────────────────────────────────

watch:
	@echo "› Watching $(SRC_DIR)/ for changes (core build)..."
	@npx esbuild $(CORE_ENTRY) \
		--bundle \
		--format=iife \
		--global-name=Oja \
		--outfile=$(CORE_IIFE) \
		--watch \
		--log-level=info

# ─── Size comparison ──────────────────────────────────────────────────────────

compare: clean all $(CORE_SIMPLE) $(CORE_ADVANCED)
	@echo ""
	@echo "  Build size comparison"
	@echo "  ─────────────────────────────────────────────────"
	@printf "  %-28s %10s\n" "Output" "Size"
	@echo "  ─────────────────────────────────────────────────"
	@[ -f $(CORE_IIFE) ] \
		&& printf "  %-28s %10s\n" "core IIFE (esbuild):" "$$(wc -c < $(CORE_IIFE) | $(SIZE))" \
		|| echo "  core IIFE not built"
	@[ -f $(CORE_ESM) ] \
		&& printf "  %-28s %10s\n" "core ESM (esbuild):" "$$(wc -c < $(CORE_ESM) | $(SIZE))" \
		|| echo "  core ESM not built"
	@[ -f $(FULL_IIFE) ] \
		&& printf "  %-28s %10s\n" "full IIFE (esbuild):" "$$(wc -c < $(FULL_IIFE) | $(SIZE))" \
		|| echo "  full IIFE not built"
	@[ -f $(FULL_ESM) ] \
		&& printf "  %-28s %10s\n" "full ESM (esbuild):" "$$(wc -c < $(FULL_ESM) | $(SIZE))" \
		|| echo "  full ESM not built"
	@[ -f $(CORE_SIMPLE) ] \
		&& printf "  %-28s %10s\n" "core IIFE (Closure SIMPLE):" "$$(wc -c < $(CORE_SIMPLE) | $(SIZE))" \
		|| echo "  Closure SIMPLE not built"
	@[ -f $(CORE_ADVANCED) ] \
		&& printf "  %-28s %10s\n" "core IIFE (Closure ADVANCED):" "$$(wc -c < $(CORE_ADVANCED) | $(SIZE))" \
		|| echo "  Closure ADVANCED not built"
	@echo "  ─────────────────────────────────────────────────"

# ─── Status ───────────────────────────────────────────────────────────────────

check:
	@echo ""
	@echo "  Build status"
	@echo "  ─────────────────────────────────────────────────────────────"
	@[ -f $(CORE_IIFE) ] \
		&& printf "  %-14s %-30s %s\n" "core IIFE" "$(CORE_IIFE)" "$$(wc -c < $(CORE_IIFE) | $(SIZE))" \
		|| echo "  core IIFE        not built — run: make core"
	@[ -f $(CORE_ESM) ] \
		&& printf "  %-14s %-30s %s\n" "core ESM" "$(CORE_ESM)" "$$(wc -c < $(CORE_ESM) | $(SIZE))" \
		|| echo "  core ESM         not built — run: make core"
	@[ -f $(FULL_IIFE) ] \
		&& printf "  %-14s %-30s %s\n" "full IIFE" "$(FULL_IIFE)" "$$(wc -c < $(FULL_IIFE) | $(SIZE))" \
		|| echo "  full IIFE        not built — run: make full"
	@[ -f $(FULL_ESM) ] \
		&& printf "  %-14s %-30s %s\n" "full ESM" "$(FULL_ESM)" "$$(wc -c < $(FULL_ESM) | $(SIZE))" \
		|| echo "  full ESM         not built — run: make full"
	@[ -f $(CSS_OUT) ] \
		&& printf "  %-14s %-30s %s\n" "CSS" "$(CSS_OUT)" "$$(wc -c < $(CSS_OUT) | $(SIZE))" \
		|| echo "  CSS              not built — run: make css"
	@echo "  ─────────────────────────────────────────────────────────────"
	@echo "  Source files"
	@echo "  ─────────────────────────────────────────────────────────────"
	@printf "  JS core     %3d files\n" "$$(ls $(JS_DIR)/*.js 2>/dev/null | wc -l | tr -d ' ')"
	@printf "  JS plugins  %3d files\n" "$$(ls $(JS_DIR)/plugin/*.js 2>/dev/null | wc -l | tr -d ' ')"
	@printf "  CSS         %3d files\n" "$$(ls $(CSS_DIR)/*.css 2>/dev/null | wc -l | tr -d ' ')"
	@echo ""

# ─── Clean ────────────────────────────────────────────────────────────────────

clean:
	@rm -rf $(BUILD_DIR) $(EXTERN_DIR)
	@echo "✓ Cleaned"

.PHONY: all core full css watch check clean simple advanced compare