#!/usr/bin/env bash
# Wrapper for the build/render/inspect loop used while developing this project.
#
# One entry point for everything: compiling, rendering a diagram, screenshotting
# it, and reading measurements back out of a render or a reference image. If you
# find yourself typing a raw npx/node/chrome command against this project, add
# it here instead — this file is the record of how the project is worked on.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

usage() {
  cat <<'EOF'
Usage: ./dev.sh <command> [args]

Node is all most of this needs. `look` and `screenshot` also want headless
Chrome, and the image-reading commands at the bottom want ImageMagick.

Commands:
  install                       Install the dev dependencies (npm install).
                                 Needed once per machine before `build`.
  build                         Compile TypeScript (npx tsc)
  clean-build                   rm -rf dist and examples/out, then compile
  render <file> <out.svg>       Run the compiled CLI on a .reladraw file
  out <file>                    Render to examples/out/<basename>.svg and .png,
                                 both regenerated together so the PNG can never
                                 go stale against its SVG. The name comes from
                                 the source, so one .reladraw has exactly one pair
                                 and there is never a question which to open.
  look <file> [out.png]         Render, then screenshot at the SVG's own size.
                                 This is the one to use when you want to see a
                                 diagram; it needs no dimensions from you.
                                 out.png defaults to a temp file, path printed.
  readme-image                  Regenerate docs/arch-render.png, the rendered
                                 half of the README's comparison
  playground                    Regenerate docs/index.html, the browser
                                 playground, with the compiled library inlined
                                 into the page. Edit tools/playground.html, not
                                 docs/index.html. Re-run after any source
                                 change, or the hosted page demonstrates an
                                 older version of the language.
  boxes <file>                  Print the solved geometry of every node
  overlaps <file>               List box pairs that share space (exit 1 if any)
  screenshot <in.svg> <out.png> [WxH] [bg]
                                 Headless Chrome screenshot of an SVG. Prefer
                                 `look` unless you need a specific size.
                                 WxH defaults to 1600x1200. bg takes a hex
                                 RGB/RGBA with no leading '#', or the words
                                 white / black / transparent.

Reading colours out of a reference image (all take any PNG):
  pixel <img> <x> <y>           Hex colour of one pixel
  palette <img> [WxH+X+Y] [n]   The n most common colours in a region, biggest
                                 first. Region defaults to the whole image,
                                 n to 12.
  scan <img> <y> [x0] [w]       Walk left to right along row <y> and print each
                                 x where the colour changes. This is how you
                                 find a border: the fill runs flat for a long
                                 stretch and the edge shows up as a one- or
                                 two-pixel spike. x0 defaults to 0, w to 900.
  crop <img> <WxH+X+Y> [out]    Cut a region out to its own PNG and print the
                                 path, optionally magnified with a trailing
                                 xN (crop img 300x200+100+50 out.png x3). This
                                 is how you look closely at one part of a
                                 render or a reference without squinting at
                                 the whole drawing scaled down.
  textrows <img> <WxH+X+Y>      Ink rows in a region, as ranges. Each run of
                                 consecutive rows carrying a non-background
                                 pixel is one line of text, so the heights give
                                 glyph size and the spacings give baseline to
                                 baseline. This is how a text size is read off
                                 a reference instead of guessed.
EOF
}

# Chrome clips to the window, so take the window from the drawing itself.
svg_size() {
  local size
  size="$(grep -oE 'width="[0-9]+" height="[0-9]+"' "$1" | head -1 |
    grep -oE '[0-9]+' | paste -sd, -)"
  echo "${size:-1600,1200}"
}

# Headless Chrome goes by different names depending on the machine, and on macOS
# it is not on $PATH at all. Resolve it once rather than letting a render fail
# in a way that looks like the diagram is fine.
chrome_bin() {
  local candidate
  for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  echo "no headless Chrome found — install Google Chrome or Chromium" >&2
  return 1
}

screenshot() {
  local in="$1" out="$2" size="${3:-1600x1200}" bg="${4:-ffffff}"
  case "$bg" in
    white) bg=ffffff ;;
    black) bg=000000 ;;
    transparent) bg=00000000 ;;
    '#'*) bg="${bg#\#}" ;;
  esac
  local chrome
  chrome="$(chrome_bin)"
  # Delete first, so a failed render is an error rather than yesterday's picture
  # left sitting beside today's SVG. A stale PNG is the worst outcome here: the
  # whole point of `out` is that the image can be trusted to match the source.
  rm -f "$out"
  "$chrome" --headless --disable-gpu --no-sandbox \
    --screenshot="$out" \
    --window-size="$size" \
    --default-background-color="$bg" \
    "$in" >/dev/null 2>&1 || true
  if [ ! -f "$out" ]; then
    echo "$chrome produced no screenshot for $in" >&2
    return 1
  fi
}

# ImageMagick 7 renamed `convert` to `magick` and warns on every use of the old
# name; ImageMagick 6, which the Linux machine has, only knows `convert`. Resolve
# it once so neither machine has to care.
im() {
  if command -v magick >/dev/null 2>&1; then
    magick "$@"
  elif command -v convert >/dev/null 2>&1; then
    convert "$@"
  else
    echo "no ImageMagick found — brew install imagemagick, or apt install imagemagick" >&2
    return 1
  fi
}

cmd="${1:-}"
shift || true

case "$cmd" in
  install)
    npm install
    ;;
  build)
    npx tsc
    ;;
  clean-build)
    rm -rf dist examples/out
    npx tsc
    ;;
  render)
    in="${1:?input .reladraw path required}"
    out="${2:?output .svg path required}"
    node dist/cli.js "$in" -o "$out"
    ;;
  out)
    in="${1:?input .reladraw path required}"
    base="$(basename "$in" .reladraw)"
    mkdir -p examples/out
    svg="examples/out/$base.svg"
    png="examples/out/$base.png"
    node dist/cli.js "$in" -o "$svg" >/dev/null
    screenshot "$svg" "$png" "$(svg_size "$svg")" ffffff
    echo "$svg"
    echo "$png"
    ;;
  look)
    in="${1:?input .reladraw path required}"
    out="${2:-$(mktemp -t reladraw-XXXXXX.png)}"
    svg="$(mktemp -t reladraw-XXXXXX.svg)"
    node dist/cli.js "$in" -o "$svg" >/dev/null 2>&1
    screenshot "$svg" "$out" "$(svg_size "$svg")" ffffff
    rm -f "$svg"
    echo "$out"
    ;;
  readme-image)
    # The rendered half of the README's comparison. Regenerate it whenever the
    # benchmark or the renderer changes, or the picture on the front page stops
    # being a picture of this code.
    mkdir -p docs
    svg="$(mktemp -t reladraw-XXXXXX.svg)"
    node dist/cli.js examples/arch.reladraw -o "$svg" >/dev/null 2>&1
    screenshot "$svg" docs/arch-render.png "$(svg_size "$svg")" ffffff
    rm -f "$svg"
    echo docs/arch-render.png
    ;;
  playground)
    # docs/index.html is generated: the page from tools/playground.html with the
    # whole compiled library inlined, so it needs no server and no bundler.
    node tools/playground.mjs
    ;;
  boxes)
    node tools/geometry.mjs boxes "${1:?input .reladraw path required}"
    ;;
  overlaps)
    node tools/geometry.mjs overlaps "${1:?input .reladraw path required}"
    ;;
  screenshot)
    in="${1:?input .svg path required}"
    out="${2:?output .png path required}"
    screenshot "$in" "$out" "${3:-1600x1200}" "${4:-ffffff}"
    echo "$out"
    ;;
  pixel)
    img="${1:?image path required}"
    x="${2:?x required}"
    y="${3:?y required}"
    im "$img" -format "%[hex:p{$x,$y}]" info:
    echo
    ;;
  palette)
    img="${1:?image path required}"
    region="${2:-}"
    n="${3:-12}"
    if [ -n "$region" ]; then
      im "$img" -crop "$region" +repage -colors "$n" -format "%c" histogram:info:
    else
      im "$img" -colors "$n" -format "%c" histogram:info:
    fi | sed 's/^ *//' | sort -rn
    ;;
  scan)
    img="${1:?image path required}"
    y="${2:?row required}"
    x0="${3:-0}"
    w="${4:-900}"
    im "$img" -crop "${w}x1+${x0}+${y}" +repage txt: | tail -n +2 |
      awk -v x0="$x0" '{split($1,c,","); print x0+c[1], $3}' |
      awk '$2!=p{print; p=$2}'
    ;;
  crop)
    # A region of an image as its own file, optionally magnified. Comparing a
    # render against the reference is done region by region, and at full-drawing
    # scale the details that differ are exactly the ones too small to see.
    img="${1:?image path required}"
    geom="${2:?geometry WxH+X+Y required}"
    out="${3:-examples/out/crop.png}"
    zoom="${4:-x1}"
    im "$img" -crop "$geom" +repage \
      -filter point -resize "$((${zoom#x} * 100))%" "$out"
    echo "$out"
    ;;
  textrows)
    # Ink rows in a region, as ranges. A run of consecutive rows carrying any
    # non-background pixel is one line of text, so the run heights give glyph
    # size and the gaps between run starts give baseline-to-baseline spacing.
    # This is how a text size is read off a reference rather than guessed.
    img="${1:?image path required}"
    geom="${2:?geometry WxH+X+Y required}"
    im "$img" -crop "$geom" +repage txt: | tail -n +2 |
      awk '{sub(/:$/,"",$1); split($1,c,","); print c[2], $3}' |
      awk '
        { row[NR]=$1; col[NR]=$2; seen[$2]++ }
        END {
          best=""; for (c in seen) if (seen[c] > seen[best]) best=c
          for (i=1; i<=NR; i++) if (col[i] != best) ink[row[i]]=1
          n=0
          for (y=0; y<100000; y++) {
            if (ink[y] && !open) { open=1; start=y }
            else if (!ink[y] && open) {
              open=0; n++
              printf "line %d  rows %d-%d  height %d", n, start, y-1, y-start
              if (prev) printf "  spacing %d", start-prev
              printf "\n"
              prev=start
            }
          }
        }'
    ;;
  *)
    usage
    exit 1
    ;;
esac
