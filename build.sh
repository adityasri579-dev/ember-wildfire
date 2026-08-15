#!/bin/bash
set -e
cd "$(dirname "$0")"
{
  cat src/00_head.html
  cat src/10_core.js src/20_fire.js src/30_roads.js src/40_evac.js src/50_render.js src/60_ui.js
  cat src/99_tail.html
} > ember-wildfire.html
echo "built $(wc -c < ember-wildfire.html) bytes, $(wc -l < ember-wildfire.html) lines"
