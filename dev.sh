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
  readme-image                  Regenerate the README's tracked pictures:
                                 docs/arch-render.png, the rendered half of the
                                 comparison, and docs/gap.png
  playground                    Regenerate docs/index.html, the browser
                                 playground, with the compiled library inlined
                                 into the page. Edit tools/playground.html, not
                                 docs/index.html. Re-run after any source
                                 change, or the hosted page demonstrates an
                                 older version of the language.
  pack                          Build, pack exactly what `npm publish` would
                                 ship, install that tarball into a throwaway
                                 directory and render a diagram with it. The
                                 stranger's-first-command check, run before
                                 every release.
  skill                         Refresh the copy of SYNTAX.md that the agent
                                 skill in .claude/skills/reladraw/ carries as
                                 its reference. Re-run after editing SYNTAX.md,
                                 or the skill teaches an older language than
                                 the tool accepts.
  page [out.png] [WxH] [fragment]
                                 Screenshot the built playground page. `page dom
                                 [fragment]` prints the DOM after its scripts
                                 have run, which is how you check the page
                                 assembled itself without opening a browser.
                                 The optional fragment is a shared link's
                                 base64url source — the way to load a long file
                                 into the editor without clicking. Run
                                 `playground` first — this looks at what is on
                                 disk, not at the template.
  before <file> [ref]           Render one example as <ref> renders it, into
                                 examples/out/<name>-before.png. `regress` says
                                 that something moved; this is how you see what.
  regress [ref]                 Render every example with the working tree and
                                 with the source at <ref> (default HEAD) and
                                 report which ones moved. The check to run after
                                 any renderer or resolver change: what the change
                                 does not concern should be byte-identical.
  pictures [ref]                Render every example as <ref> has it (its own
                                 sources, its own build) and as the working tree
                                 has it, and say which pictures changed. regress
                                 holds the sources fixed to isolate the code, so
                                 it cannot see an edit to an example file; this
                                 is the other half.
  boxes <file>                  Print the solved geometry of every node
  overlaps <file>               List box pairs that share space (exit 1 if any)
  tokens <file>                 Print how the syntax scanner classifies each
                                 line, and check the spans cover it exactly.
                                 The playground draws its coloring behind a
                                 transparent textarea, so a dropped character
                                 slides the whole line out of register.
  screenshot <in.svg> <out.png> [WxH] [bg]
                                 Headless Chrome screenshot of an SVG. Prefer
                                 `look` unless you need a specific size.
                                 WxH defaults to 1600x1200. bg takes a hex
                                 RGB/RGBA with no leading '#', or the words
                                 white / black / transparent.

Reading colors out of a reference image (all take any PNG):
  pixel <img> <x> <y>           Hex color of one pixel
  palette <img> [WxH+X+Y] [n]   The n most common colors in a region, biggest
                                 first. Region defaults to the whole image,
                                 n to 12.
  scan <img> <y> [x0] [w]       Walk left to right along row <y> and print each
                                 x where the color changes. This is how you
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
    # The README's pictures. examples/out/ is gitignored, so anything the front
    # page shows needs a tracked copy of its own. Regenerate them whenever the
    # examples or the renderer change, or the front page stops being a picture
    # of this code.
    mkdir -p docs
    for pair in "arch:docs/arch-render.png" "gap:docs/gap.png"; do
      name="${pair%%:*}"
      out="${pair#*:}"
      svg="$(mktemp -t reladraw-XXXXXX.svg)"
      node dist/cli.js "examples/$name.reladraw" -o "$svg" >/dev/null 2>&1
      screenshot "$svg" "$out" "$(svg_size "$svg")" ffffff
      rm -f "$svg"
      echo "$out"
    done
    ;;
  playground)
    # docs/index.html is generated: the page from tools/playground.html with the
    # whole compiled library inlined, so it needs no server and no bundler.
    node tools/playground.mjs
    ;;
  pack)
    # What `npm publish` would ship, installed into a throwaway directory and
    # run there. The failure this catches is the one that is silent from inside
    # the repository: dist/ is gitignored and listed in `files`, so a package
    # built from a clean clone can ship a `bin` pointing at a file that is not
    # in it. Note that `npm pack` does not run prepublishOnly — only publish
    # does — so this builds first rather than trusting whatever dist/ holds.
    npx tsc
    t="$(mktemp -d)"
    npm pack --pack-destination "$t" >/dev/null 2>&1
    mkdir -p "$t/probe"
    cp examples/names.reladraw "$t/probe/probe.reladraw"
    (
      cd "$t/probe"
      npm init -y >/dev/null 2>&1
      npm install "$t"/reladraw-*.tgz >/dev/null 2>&1
      ./node_modules/.bin/reladraw probe.reladraw -o probe.svg >/dev/null 2>&1
    )
    if [ -s "$t/probe/probe.svg" ]; then
      echo "packed, installed and rendered: $(wc -c < "$t/probe/probe.svg" | tr -d ' ') bytes of SVG"
      npm pack --dry-run 2>&1 | grep -E "npm notice (name|version|total files|package size):"
    else
      echo "the packed tarball installed but rendered nothing" >&2
      exit 1
    fi
    rm -rf "$t"
    ;;
  skill)
    # The agent skill ships as a directory somebody copies into their own
    # ~/.claude/skills, so it cannot reach SYNTAX.md by a relative path — it
    # carries its own copy, generated here rather than edited. Same arrangement
    # as docs/index.html: edit the source, run this, commit the result.
    dest=.claude/skills/reladraw/reference/syntax.md
    mkdir -p "$(dirname "$dest")"
    if [ -f "$dest" ] && cmp -s SYNTAX.md "$dest"; then
      echo "$dest is up to date"
    else
      cp SYNTAX.md "$dest"
      echo "$dest regenerated from SYNTAX.md"
    fi
    ;;
  page)
    # The same headless Chrome the SVG screenshots go through, pointed at the
    # page rather than at a drawing. The DOM mode exists because most of what
    # can go wrong in the playground is a script that never ran: the picture
    # looks plausible and the buttons are simply absent.
    if [ "${1:-}" = "dom" ]; then
      # An optional fragment, so the shared-link path can be exercised too:
      # ./dev.sh page dom "$(printf '%s' "$src" | base64 -w0 | tr '+/' '-_')"
      # A file:// URL, not a path: given a bare path Chrome escapes the '#' to
      # %23 and the fragment is never seen by the page.
      url="file://$PWD/docs/index.html${2:+#$2}"
      "$(chrome_bin)" --headless --disable-gpu --no-sandbox \
        --virtual-time-budget=2000 --dump-dom "$url" 2>/dev/null
    else
      out="${1:-$(mktemp -t reladraw-page-XXXXXX.png)}"
      # A fragment here too, for the same reason the DOM mode takes one, and for
      # one more: the editor's syntax coloring is drawn behind the textarea, so
      # the thing to look at is a long file in a narrow pane, and the fragment is
      # how you get a long file into the page without clicking anything.
      # A file:// URL rather than a path, for the reason the DOM mode gives:
      # given a bare path Chrome escapes the '#' and the fragment never arrives.
      screenshot "file://$PWD/docs/index.html${3:+#$3}" "$out" "${2:-1600x1000}" "0d0d10"
      echo "$out"
    fi
    ;;
  boxes)
    node tools/geometry.mjs boxes "${1:?input .reladraw path required}"
    ;;
  overlaps)
    node tools/geometry.mjs overlaps "${1:?input .reladraw path required}"
    ;;
  tokens)
    node tools/tokens.mjs "${1:?input .reladraw path required}"
    ;;
  regress)
    # Render every example with the working tree and with the source at a git
    # ref, then say which ones moved. Every change to the renderer or resolver
    # is supposed to leave the examples it does not concern byte-identical, and
    # that check needs a baseline built from the old source rather than from
    # whatever happens to be sitting in examples/out.
    ref="${1:-HEAD}"
    work="$(mktemp -d -t reladraw-regress-XXXXXX)"
    trap 'rm -rf "$work"' EXIT
    mkdir -p "$work/base" "$work/head"
    git archive "$ref" | tar -x -C "$work/base"
    ln -s "$PWD/node_modules" "$work/base/node_modules"
    (cd "$work/base" && npx tsc >/dev/null)

    npx tsc >/dev/null
    moved=0
    for in in examples/*.reladraw; do
      name="$(basename "$in" .reladraw)"
      # Both compilers read the working tree's examples, so a difference is
      # always the code and never the file.
      node "$work/base/dist/cli.js" "$in" -o "$work/head/$name.base.svg" >/dev/null 2>&1 || true
      node dist/cli.js "$in" -o "$work/head/$name.head.svg" >/dev/null 2>&1 || true
      if cmp -s "$work/head/$name.base.svg" "$work/head/$name.head.svg"; then
        echo "same  $name"
      else
        echo "MOVED $name"
        moved=$((moved + 1))
      fi
    done
    echo "$moved of $(ls examples/*.reladraw | wc -l | tr -d ' ') examples differ from $ref"
    ;;
  pictures)
    # The end-to-end counterpart to `regress`: each side renders its *own*
    # sources with its *own* build, so an edit to an example file shows up here
    # and a pure code change shows up in both. A baseline that fails to render
    # counts as changed and says so, rather than being swallowed the way a
    # missing file would be.
    ref="${1:-HEAD}"
    work="$(mktemp -d -t reladraw-pictures-XXXXXX)"
    trap 'rm -rf "$work"' EXIT
    mkdir -p "$work/base" "$work/out"
    git archive "$ref" | tar -x -C "$work/base"
    ln -s "$PWD/node_modules" "$work/base/node_modules"
    (cd "$work/base" && npx tsc >/dev/null)

    npx tsc >/dev/null
    moved=0
    for in in examples/*.reladraw; do
      name="$(basename "$in" .reladraw)"
      base_in="$work/base/examples/$name.reladraw"
      if [ ! -f "$base_in" ]; then
        echo "NEW   $name"
        moved=$((moved + 1))
        continue
      fi
      if ! (cd "$work/base" && node dist/cli.js "examples/$name.reladraw" \
              -o "$work/out/$name.base.svg") >/dev/null 2>&1; then
        echo "BROKE $name  (does not render at $ref)"
        moved=$((moved + 1))
        continue
      fi
      node dist/cli.js "$in" -o "$work/out/$name.head.svg" >/dev/null 2>&1 || true
      if cmp -s "$work/out/$name.base.svg" "$work/out/$name.head.svg"; then
        echo "same  $name"
      else
        echo "MOVED $name"
        moved=$((moved + 1))
      fi
    done
    echo "$moved of $(ls examples/*.reladraw | wc -l | tr -d ' ') pictures differ from $ref"
    ;;
  before)
    # One example as a git ref renders it, beside the working tree's own render.
    # `regress` says *that* something moved; this is how you look at what. It
    # goes through the same throwaway build, so the comparison is of the code
    # and never of whatever is stale in examples/out.
    in="${1:?input .reladraw path required}"
    ref="${2:-HEAD}"
    name="$(basename "$in" .reladraw)"
    work="$(mktemp -d -t reladraw-before-XXXXXX)"
    trap 'rm -rf "$work"' EXIT
    git archive "$ref" | tar -x -C "$work"
    ln -s "$PWD/node_modules" "$work/node_modules"
    (cd "$work" && npx tsc >/dev/null)
    mkdir -p examples/out
    node "$work/dist/cli.js" "$in" -o "examples/out/$name-before.svg"
    rm -f "examples/out/$name-before.png"
    screenshot "examples/out/$name-before.svg" "examples/out/$name-before.png" "$(svg_size "examples/out/$name-before.svg")" ffffff
    echo "examples/out/$name-before.png"
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
