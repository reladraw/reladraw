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
  build                         Compile TypeScript: the library, then the browser element
  clean-build                   rm -rf dist and examples/out, then compile
  render <file> <out.svg>       Run the compiled CLI on a .reladraw file
  try '<statements>'            Parse and render source given on the command
                                 line, printing whatever the tool says about it.
                                 For checking one statement, and especially for
                                 reading an error message back in full.
  out <file>                    Render to examples/out/<basename>.svg and .png,
                                 both regenerated together so the PNG can never
                                 go stale against its SVG. The name comes from
                                 the source, so one .reladraw has exactly one pair
                                 and there is never a question which to open.
  themes <file>                 Render one file in every theme, into
                                 examples/out/themes/<basename>-<theme>.png,
                                 plus <basename>-all.png: every theme side by
                                 side and labelled, for judging the palettes
                                 against each other. Wants ImageMagick.
  look <file> [out.png]         Render, then screenshot at the SVG's own size.
                                 This is the one to use when you want to see a
                                 diagram; it needs no dimensions from you.
                                 out.png defaults to a temp file, path printed.
  look-svg <file.svg> [out.png] Screenshot an SVG already on disk, as look
                                 does, for one rendered by another build (such
                                 as compare's old/ half). ImageMagick drops
                                 dashed lines, so this goes through the browser.
  findings <file> [png]         Print every finding for one file, then a count
                                 of each kind. With png, also render beside it
                                 and screenshot there. For working a large
                                 diagram down to no findings.
  readme-image                 Regenerate the README's tracked pictures:
                                 docs/arch-render.png, the rendered half of the
                                 comparison, and docs/gap.png. Redraws only a
                                 picture whose SVG changed, judged by the
                                 fingerprints in docs/readme-images.sum, so
                                 another machine's rasterizer never churns them.
  playground                    Regenerate docs/index.html, the browser
                                 playground, with the compiled library inlined
                                 into the page. Edit tools/playground.html, not
                                 docs/index.html. Re-run after any source
                                 change, or the hosted page demonstrates an
                                 older version of the language.
  open                          Regenerate docs/index.html and open it in the
                                 default browser. The page is self-contained,
                                 so it needs no server.
  pack                          Build, pack exactly what `npm publish` would
                                 ship, install that tarball into a throwaway
                                 directory and render a diagram with it. The
                                 stranger's-first-command check, run before
                                 every release.
  check-version <version>       Refuse unless README.md, SYNTAX.md's title and
                                 changelog, the skill's SKILL.md and its copy
                                 of SYNTAX.md all say <version>. Run by `npm version` as the
                                 preversion script, so a release whose docs
                                 name the old number stops before anything is
                                 bumped, committed or tagged.
  skill                         Refresh the copy of SYNTAX.md that the agent
                                 skill in .claude/skills/reladraw/ carries as
                                 its reference. Re-run after editing SYNTAX.md,
                                 or the skill teaches an older language than
                                 the tool accepts.
  llms                          Regenerate docs/llms-full.txt, the skill's guide
                                 and SYNTAX.md joined into one page for a
                                 language model to read at one URL. Re-run after
                                 editing either. docs/llms.txt, the short index
                                 that points at it, is written by hand.
  format-examples ["setting: value" ...]
                                 Format a scratch copy of every example under the
                                 settings given (the defaults when none are), and
                                 check a second pass changes nothing. format
                                 itself refuses a result that draws differently,
                                 so a clean run means no example's picture moved.
                                 Prints where the copies are, to read them.
  pipe                           Check that output past 64 KB survives a pipe:
                                 format - and render -o - on a large generated
                                 diagram, piped and written to a file, must match.
  snippets [file.md ...]        Parse every reladraw snippet in the hand-written
                                 docs and name the ones the parser now refuses.
                                 Defaults to README.md, SYNTAX.md, CONTRIBUTING.md,
                                 the skill and docs/llms.txt.
  stale                         Rebuild every generated copy into a scratch
                                 directory and name each committed one that
                                 differs — the skill's syntax, llms-full.txt, the
                                 playground, the README pictures — then check the
                                 version numbers and snippets, and end with the
                                 questions only a reader can answer. Run before
                                 committing a change to the language or the
                                 examples; the local pre-commit hook runs it too.
  page [out.png] [WxH]
                                 Screenshot the built playground page. `page dom`
                                 prints the DOM after its scripts have run,
                                 which is how you check the page assembled
                                 itself without opening a browser. Run
                                 `playground` first — this looks at what is on
                                 disk, not at the template. To load a file into
                                 the editor, use page-run.
  page-run '<js>' [out.png] [WxH]
                                 Screenshot a copy of the playground that runs
                                 <js> once its own scripts have. A headless
                                 browser cannot click or drag, so this is how an
                                 interaction is checked: the script does it with
                                 .click() or a dispatched event. docs/ is
                                 untouched. Chrome will not lay a window out
                                 much narrower than 500 pixels, so a narrower
                                 WxH is cropped rather than reflowed.
  viewer <file> [out.png] [WxH] ['<js>']
                                 Render one file with --page and screenshot the
                                 page, after running <js> if given, as page-run
                                 does for the playground. The page is written
                                 to a temp file beside the PNG, path printed.
  page-examples [out.png] [WxH] [n]
                                 page-run with the Examples picker open and the
                                 nth example (default 1, counting from 0)
                                 previewed.
  element [out.png] [WxH]       Screenshot tools/element.html, the check page
                                 for <reladraw-diagram>: each case on it says
                                 what should appear. `element dom` prints the
                                 DOM after the element has drawn. Run `build`
                                 first — it loads dist/element.js.
  before <file> [ref]           Render one example as <ref> renders it, into
                                 examples/out/<name>-before.png. `regress` says
                                 that something moved; this is how you see what.
  pictures [ref]                Which pictures did this change move? The check to
                                 run after changing the code or an example file.
                                 Renders every example as <ref> (default HEAD)
                                 has it, its own sources with its own build, and
                                 as the working tree has it, and lists the ones
                                 that differ. Anything listed that the change
                                 was not meant to touch is a regression. It
                                 compares SVG bytes, so a `url:` shows as moved
                                 with no visible change; compare the PNGs.
  compare [ref]                 One page with every example as <ref> (default
                                 v0.16.0) drew it, its own source with its own
                                 build, beside the working tree's render, each
                                 source under its picture, with line counts and
                                 whatever the tool reported. For judging a change
                                 that moves every picture, such as a rewrite of
                                 the examples. Writes examples/out/compare/
                                 index.html; the old renders are kept there and
                                 reused while <ref> is the same.
  regress [ref]                 Like `pictures`, but renders the working tree's
                                 example files with both builds, to isolate a
                                 code change. Only for when no example file
                                 changed: an edited example shows as moved.
  snapshot <dir>                Render every example with the working tree into
                                 <dir>, as a baseline for `against`. For a long
                                 change built in steps on top of uncommitted
                                 work, where HEAD is not the baseline you mean.
  against <dir>                 Render every example with the working tree and
                                 say which differ from the SVGs `snapshot` put
                                 in <dir>.
  stress [full]                 Is routing lines still fast? Times the library on
                                 made-up diagrams of 45 boxes and 5, 10 and 20
                                 lines, stopping at the first over its limit, in
                                 a few seconds. `full` goes on to 30 and 48 lines.
                                 First, 150 copies of one line, which must
                                 draw in under half a second.
                                 Run after changing how lines are routed; it
                                 builds first. Each run adds a row to
                                 stress-history.tsv (untracked): when, commit
                                 (+ for uncommitted changes), machine, times.
  clicks <file.svg> <x> <y> ... What a browser would follow at each point, or
                                 "nothing". A `url:` is the one thing in the
                                 output a picture cannot show, and the obvious
                                 way to nest one link inside another is dropped
                                 silently by Chrome, so it is checked here.
  nodes <file>                  Print the solved geometry of every node
  overlaps <file>               List node pairs that share space (exit 1 if any)
  tokens <file>                 Print how the syntax scanner classifies each
  blocks <file.md ...>          Parse every fenced diagram in a Markdown file
                                 and report the ones the language will not
                                 accept. SYNTAX.md, README.md and the skill are
                                 the files this is for.
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
  imgdiff <a.png> <b.png> [out] How many pixels differ between two images, and
                                 each one's size. With out, also writes a picture
                                 of the difference there. For telling whether a
                                 PNG that is not byte-identical actually moved.
  sidebyside <a> <b> <out.png>  Put two pictures next to each other, each trimmed
                                 to its drawing, a strip between. Either may be an
                                 SVG, which is screenshotted first. For judging
                                 a MOVED example: the snapshot's SVG against the
                                 new render.
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

# A fresh temp path ending in the given extension. BSD mktemp only replaces
# trailing X's, so `mktemp -t name-XXXXXX.svg` on macOS yields a name that does
# not end in .svg, and Chrome shows such a file as source text. GNU mktemp, for
# its part, refuses a template without X's. So the template is a full path that
# ends in X's, and the extension goes on after mktemp returns.
tmp_path() {
  local dir="${TMPDIR:-/tmp}" base
  base="$(mktemp "${dir%/}/reladraw-$1.XXXXXX")"
  rm -f "$base"
  echo "$base.$2"
}

# The working tree's build: the library and command-line tool, then the browser
# element on its own, so only the element sees the DOM's types. A throwaway
# build of an old ref runs plain `npx tsc`, since it only needs dist/cli.js.
compile() {
  npx tsc && npx tsc -p tsconfig.element.json
}

# The node_modules this checkout uses: its own, or the nearest one above it,
# as Node itself would find. A copy built in a scratch folder links to it.
modules_dir() {
  local dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -d "$dir/node_modules" ]; then echo "$dir/node_modules"; return; fi
    dir="$(dirname "$dir")"
  done
  echo "$PWD/node_modules"
}

# Two SVGs that differ only in their ids' per-drawing prefix. Any change to a
# drawing changes its prefix, so this only tells a change to how ids are named
# apart from a change to what is drawn.
same_but_ids() {
  cmp -s <(strip_ids "$1") <(strip_ids "$2")
}

strip_ids() {
  sed -E 's/(id="|url\(#)r[0-9a-f]{8}-/\1/g' "$1"
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
  # A fifth argument waits that many milliseconds of the page's own time
  # before the shot, for a page whose scripts run late (`page-run`).
  local wait=()
  [ -n "${5:-}" ] && wait=(--virtual-time-budget="$5")
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
  # Gray text smoothing and no hinting, whatever this machine's font settings
  # say: a PNG is viewed on other screens, where subpixel color fringes show as
  # halos, and two machines with different settings otherwise draw the same
  # diagram differently and `stale` calls the tracked pictures out of date.
  "$chrome" --headless --disable-gpu --no-sandbox \
    --disable-lcd-text --font-render-hinting=none \
    --screenshot="$out" \
    --window-size="$size" \
    --default-background-color="$bg" \
    "${wait[@]}" \
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


# Run a build's CLI to render: `cli <path/to/cli.js> <in> -o <out> [options]`.
# From 0.17 the CLI takes a command first and refuses the bare file; builds of
# older refs take only the bare file. Which one a build is comes from its own
# usage text, so a comparison against any ref still runs.
cli() {
  local js="$1"
  shift
  if grep -q 'reladraw render' "$js"; then
    node "$js" render "$@"
  else
    node "$js" "$@"
  fi
}

# Render a file to an SVG, saying nothing unless it fails — then everything the
# CLI said, since that is the error. Exits with the CLI's status.
render_quietly() {
  local said
  if ! said="$(cli dist/cli.js "$1" -o "$2" 2>&1)"; then
    echo "$said" >&2
    exit 1
  fi
}

# The README's pictures, rendered into the given directory. examples/out/ is
# gitignored, so anything the front page shows needs a tracked copy of its own.
#
# Two machines rasterize the same SVG a few thousand pixels apart, so whether a
# picture is current is judged by the SVG it was made from, never by its pixels:
# docs/readme-images.sum holds a fingerprint of each picture's SVG, and a PNG is
# redrawn only when its drawing changed. `readme_images write` redraws what
# changed; `readme_images check` prints `ok` or `stale` and each picture's name.
README_IMAGES=("arch:arch-render.png" "gap:gap.png")
README_SUMS=docs/readme-images.sum
readme_images() {
  local mode="$1" pair name png svg sum recorded
  for pair in "${README_IMAGES[@]}"; do
    name="${pair%%:*}"
    png="${pair#*:}"
    svg="$(tmp_path readme svg)"
    render_quietly "examples/$name.reladraw" "$svg"
    sum="$(strip_ids "$svg" | node -e "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(0)).digest('hex'))")"
    recorded="$(awk -v png="$png" '$2 == png { print $1 }' "$README_SUMS" 2>/dev/null || true)"
    if [ "$mode" = check ]; then
      if [ "$sum" = "$recorded" ] && [ -f "docs/$png" ]; then echo "ok $png"; else echo "stale $png"; fi
    elif [ "$sum" != "$recorded" ] || [ ! -f "docs/$png" ]; then
      screenshot "$svg" "docs/$png" "$(svg_size "$svg")" ffffff
      { grep -v "  $png\$" "$README_SUMS" 2>/dev/null || true; echo "$sum  $png"; } > "$README_SUMS.new"
      mv "$README_SUMS.new" "$README_SUMS"
      echo "docs/$png"
    else
      echo "docs/$png unchanged"
    fi
    rm -f "$svg"
  done
}

# docs/llms-full.txt: the skill's guide and SYNTAX.md as one page, written to the
# given path. The skill's frontmatter is for skill loaders and is dropped.
llms_full() {
  {
    cat <<'EOF'
# reladraw — the full documentation, for language models

Generated from the repository's agent skill and SYNTAX.md; do not edit by hand.
It describes the language on the main branch, which can run ahead of the release
on npm.

Part 1 is the guide to writing reladraw. Where it says `reference/syntax.md`, it
means Part 2, the complete syntax reference.

# Part 1 — writing reladraw

EOF
    awk 'n >= 2 { print } /^---$/ && n < 2 { n++ }' .claude/skills/reladraw/SKILL.md
    printf '\n# Part 2 — the syntax reference\n\n'
    cat SYNTAX.md
  } > "$1"
}

SNIPPET_DOCS=(README.md SYNTAX.md CONTRIBUTING.md .claude/skills/reladraw/SKILL.md docs/llms.txt)

case "$cmd" in
  install)
    npm install
    ;;
  build)
    compile
    ;;
  clean-build)
    rm -rf dist examples/out
    compile
    ;;
  render)
    in="${1:?input .reladraw path required}"
    out="${2:?output .svg path required}"
    cli dist/cli.js "$in" -o "$out"
    ;;
  try)
    src="${1:?source text required}"
    tmp="$(tmp_path try reladraw)"
    printf '%s\n' "$src" > "$tmp"
    if said="$(cli dist/cli.js "$tmp" -o "${tmp%.reladraw}.svg" 2>&1)"; then
      if grep -q 'warning(' <<<"$said"; then
        grep 'warning(' <<<"$said"
      else
        echo "parsed, no complaint"
      fi
    else
      echo "$said"
    fi
    rm -f "$tmp" "${tmp%.reladraw}.svg"
    ;;
  out)
    in="${1:?input .reladraw path required}"
    base="$(basename "$in" .reladraw)"
    mkdir -p examples/out
    svg="examples/out/$base.svg"
    png="examples/out/$base.png"
    cli dist/cli.js "$in" -o "$svg" >/dev/null
    screenshot "$svg" "$png" "$(svg_size "$svg")" ffffff
    echo "$svg"
    echo "$png"
    ;;
  themes)
    in="${1:?input .reladraw path required}"
    base="$(basename "$in" .reladraw)"
    dir="examples/out/themes"
    mkdir -p "$dir"
    tiles=()
    for theme in $(node -e "import('./dist/themes.js').then((m) => console.log(m.THEME_NAMES.join(' ')))"); do
      svg="$dir/$base-$theme.svg"
      png="$dir/$base-$theme.png"
      cli dist/cli.js "$in" -o "$svg" --theme "$theme" >/dev/null
      screenshot "$svg" "$png" "$(svg_size "$svg")" ffffff
      tiles+=(-label "$theme" "$png")
    done
    # montage is its own binary in ImageMagick 6 and a subcommand in 7.
    if command -v magick >/dev/null 2>&1; then montage=(magick montage); else montage=(montage); fi
    # ImageMagick finds no default font on a Mac, so the labels need one named.
    font=()
    for f in /System/Library/Fonts/Supplemental/Arial.ttf /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf; do
      if [ -f "$f" ]; then font=(-font "$f"); break; fi
    done
    "${montage[@]}" "${tiles[@]}" "${font[@]}" -tile 2x -geometry +12+12 -pointsize 22 -background '#808080' "$dir/$base-all.png"
    echo "$dir/$base-all.png"
    ;;
  look)
    in="${1:?input .reladraw path required}"
    out="${2:-$(tmp_path look png)}"
    svg="$(tmp_path look svg)"
    # The CLI reports the path it wrote on stderr, which is noise here — but a
    # refused file's error goes there too and has to reach the terminal, so
    # the output is kept and shown only when the render fails.
    render_quietly "$in" "$svg"
    screenshot "$svg" "$out" "$(svg_size "$svg")" ffffff
    rm -f "$svg"
    echo "$out"
    ;;
  look-svg)
    svg="${1:?input .svg path required}"
    out="${2:-$(tmp_path look png)}"
    screenshot "$svg" "$out" "$(svg_size "$svg")" ffffff
    echo "$out"
    ;;
  findings)
    in="${1:?input .reladraw path required}"
    found="$(node dist/cli.js check "$in" 2>&1)" || { echo "$found"; exit 1; }
    echo "$found"
    echo "---"
    kinds="$(echo "$found" | grep -oE 'warning\([a-z-]+\)' | sort | uniq -c || true)"
    echo "${kinds:-no findings}"
    if [[ -n "${2:-}" ]]; then
      svg="$(tmp_path findings svg)"
      render_quietly "$in" "$svg"
      screenshot "$svg" "$2" "$(svg_size "$svg")" ffffff
      rm -f "$svg"
      echo "$2"
    fi
    ;;
  readme-image)
    # The README's pictures. examples/out/ is gitignored, so anything the front
    # page shows needs a tracked copy of its own. Regenerate them whenever the
    # examples or the renderer change, or the front page stops being a picture
    # of this code.
    readme_images write
    ;;
  playground)
    # docs/index.html is generated: the page from tools/playground.html with the
    # whole compiled library inlined, so it needs no server and no bundler.
    node tools/playground.mjs
    ;;
  open)
    # The page has the library inlined, so file:// is enough — that is the whole
    # reason tools/playground.mjs concatenates instead of leaving ES modules to
    # be fetched, which file:// refuses.
    node tools/playground.mjs
    page="$PWD/docs/index.html"
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$page" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then
      open "$page"
    else
      echo "No xdg-open or open on this machine. The page is at:"
    fi
    echo "$page"
    ;;
  pack)
    # What `npm publish` would ship, installed into a throwaway directory and
    # run there. The failure this catches is the one that is silent from inside
    # the repository: dist/ is gitignored and listed in `files`, so a package
    # built from a clean clone can ship a `bin` pointing at a file that is not
    # in it. Note that `npm pack` does not run prepublishOnly — only publish
    # does — so this builds first rather than trusting whatever dist/ holds.
    compile
    t="$(mktemp -d)"
    npm pack --pack-destination "$t" >/dev/null 2>&1
    mkdir -p "$t/probe"
    cp examples/names.reladraw "$t/probe/probe.reladraw"
    (
      cd "$t/probe"
      npm init -y >/dev/null 2>&1
      # No audit: the package has no dependencies to audit, and the audit's
      # request once hung for minutes with the registry otherwise answering.
      npm install --no-audit --no-fund "$t"/reladraw-*.tgz >/dev/null 2>&1
      ./node_modules/.bin/reladraw render probe.reladraw -o probe.svg >/dev/null 2>&1
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
  check-version)
    # `npm version` bumps package.json and nothing else, and the prose that
    # names the version ships in the tarball — README.md is the npm page. 0.8.0
    # went out saying 0.7.1 because these edits were skipped, so the check sits
    # where it cannot be skipped: in the command that makes the release.
    v="${1:?usage: ./dev.sh check-version <version>}"
    bad=0
    grep -q "^Version $v\. " README.md \
      || { echo "README.md: the Status line does not say \"Version $v.\"" >&2; bad=1; }
    head -1 SYNTAX.md | grep -q "— $v\$" \
      || { echo "SYNTAX.md: the title does not end \"— $v\"" >&2; bad=1; }
    grep -q "^\*\*$v\*\*\$" SYNTAX.md \
      || { echo "SYNTAX.md: the changelog has no **$v** entry" >&2; bad=1; }
    ! grep -q '^\*\*Unreleased\*\*$' SYNTAX.md \
      || { echo "SYNTAX.md: the changelog still has an **Unreleased** entry" >&2; bad=1; }
    cmp -s SYNTAX.md .claude/skills/reladraw/reference/syntax.md \
      || { echo "the skill's copy of SYNTAX.md is stale: run ./dev.sh skill" >&2; bad=1; }
    # The skill compares this number with `reladraw --version` to tell the
    # user which of the two is out of date.
    grep -q "^This skill teaches reladraw $v\. " .claude/skills/reladraw/SKILL.md \
      || { echo "the skill's SKILL.md does not say \"This skill teaches reladraw $v.\"" >&2; bad=1; }
    llms="$(tmp_path llms txt)"
    llms_full "$llms"
    cmp -s "$llms" docs/llms-full.txt \
      || { echo "docs/llms-full.txt is stale: run ./dev.sh llms" >&2; bad=1; }
    rm -f "$llms"
    if [ "$bad" = 1 ]; then
      echo "not releasing $v — update these, commit, then run npm version again" >&2
      exit 1
    fi
    echo "README.md, SYNTAX.md and the skill all say $v"
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
  llms)
    # The llms.txt convention: a site says what it is at /llms.txt, and a model
    # given that one URL can learn the tool without crawling. llms.txt is the
    # short hand-written index; this is the everything-in-one-file companion it
    # links to, generated so it cannot drift from the two documents it joins.
    llms_full docs/llms-full.txt
    echo "docs/llms-full.txt regenerated from the skill and SYNTAX.md"
    ;;
  format-examples)
    [ -f dist/cli.js ] || compile
    dir="$(mktemp -d "${TMPDIR:-/tmp}/reladraw-format.XXXXXX")"
    cp examples/*.reladraw "$dir/"
    for setting in "$@"; do echo "$setting" >> "$dir/.reladraw-format"; done
    out="$(node dist/cli.js format "$dir"/*.reladraw 2>&1)" || { echo "$out" | grep -v '^formatted '; exit 1; }
    node dist/cli.js format --check "$dir"/*.reladraw || exit 1
    echo "$(ls "$dir"/*.reladraw | wc -l | tr -d ' ') examples formatted, a second pass changes nothing: $dir"
    ;;
  pipe)
    # A pipe holds 64 KB at a time; output past that used to be lost when the
    # CLI ended with process.exit before the write had drained. So each command
    # that prints its result is run on a diagram whose output is well past
    # 64 KB, once into a pipe and once into a file, and the two must match.
    [ -f dist/cli.js ] || compile
    dir="$(mktemp -d "${TMPDIR:-/tmp}/reladraw-pipe.XXXXXX")"
    big="$dir/big.reladraw"
    {
      echo 'node  n1  "Node 1 with a fairly long label"'
      for i in $(seq 2 1500); do echo "node  n$i  \"Node $i with a fairly long label\"  below n$((i - 1))"; done
    } > "$big"
    small="$dir/render.reladraw"
    head -n 400 "$big" > "$small"
    failed=0
    # Each run reads its own copy of the input: the first would use it up.
    pipe_check() {
      local name="$1" input="$2"; shift 2
      "$@" < "$input" > "$dir/$name.file"
      "$@" < "$input" | cat > "$dir/$name.piped"
      local want got
      want="$(wc -c < "$dir/$name.file" | tr -d ' ')"
      got="$(wc -c < "$dir/$name.piped" | tr -d ' ')"
      if [ "$want" -lt 70000 ]; then
        echo "  ??    $name: only $want bytes, too small to test a pipe"; failed=1
      elif cmp -s "$dir/$name.file" "$dir/$name.piped"; then
        echo "  ok    $name: $got bytes through a pipe"
      else
        echo "  FAIL  $name: $want bytes to a file, $got through a pipe"; failed=1
      fi
    }
    pipe_check format "$big" node dist/cli.js format -
    pipe_check render /dev/null node dist/cli.js render "$small" -o -
    exit "$failed"
    ;;
  snippets)
    [ -f dist/index.js ] || compile
    if [ "$#" -gt 0 ]; then
      node tools/snippets.mjs "$@"
    else
      node tools/snippets.mjs "${SNIPPET_DOCS[@]}"
    fi
    ;;
  stale)
    # Every generated file the repository tracks, rebuilt from the working tree
    # and compared with what is there. Each of these went stale silently at least
    # once, because regenerating it was a separate step nobody was prompted for.
    # Reports and never rewrites: the fix is the named command, run on purpose.
    compile
    t="$(mktemp -d)"
    found=0
    stale() { echo "  STALE  $1 — run ./dev.sh $2"; found=1; }
    fresh() { echo "  ok     $1"; }

    cmp -s SYNTAX.md .claude/skills/reladraw/reference/syntax.md \
      && fresh "skill's copy of SYNTAX.md" || stale "skill's copy of SYNTAX.md" skill
    llms_full "$t/llms-full.txt"
    cmp -s "$t/llms-full.txt" docs/llms-full.txt \
      && fresh docs/llms-full.txt || stale docs/llms-full.txt llms
    node tools/playground.mjs "$t/index.html" >/dev/null
    cmp -s "$t/index.html" docs/index.html \
      && fresh docs/index.html || stale "docs/index.html (the playground)" playground
    while read -r verdict png; do
      [ "$verdict" = ok ] && fresh "docs/$png" || stale "docs/$png (a README picture)" readme-image
    done < <(readme_images check)

    # Between releases every one of these names the last release; mid-release,
    # README and SYNTAX.md name the next one until `npm version` catches up.
    v="$(node -p 'require("./package.json").version')"
    readme_v="$(grep -oE '^Version [0-9.]+' README.md | cut -d' ' -f2 | sed 's/\.$//')"
    syntax_v="$(head -1 SYNTAX.md | grep -oE '[0-9]+\.[0-9]+\.[0-9]+$')"
    skill_v="$(grep -oE '^This skill teaches reladraw [0-9]+\.[0-9]+\.[0-9]+' .claude/skills/reladraw/SKILL.md | grep -oE '[0-9.]+$')"
    if [ "$readme_v" = "$v" ] && [ "$syntax_v" = "$v" ] && [ "$skill_v" = "$v" ]; then
      fresh "version $v in package.json, README.md, SYNTAX.md and the skill"
    else
      echo "  DIFFER package.json $v, README.md ${readme_v:-none}, SYNTAX.md ${syntax_v:-none}, skill ${skill_v:-none} — expected only mid-release"
      found=1
    fi

    if said="$(node tools/snippets.mjs "${SNIPPET_DOCS[@]}")"; then
      fresh "snippets in the hand-written docs ($(tail -1 <<< "$said" | cut -d' ' -f1) parsed)"
    else
      echo "  REFUSED snippets the parser no longer accepts:"
      sed '$d; s/^/           /' <<< "$said"
      found=1
    fi
    rm -rf "$t"

    cat <<'EOF'

  What no script can check:
    - Does the skill's SKILL.md still describe the language, in its prose as
      well as its examples?
    - Does the README still describe what the tool does, and its example still
      show the idiomatic way to say it?
    - Does docs/llms.txt still point at the right pages and summarize the
      language truthfully?
    - Does SYNTAX.md's changelog have an Unreleased entry for this change?
EOF
    [ "$found" = 0 ]
    ;;
  page)
    # The same headless Chrome the SVG screenshots go through, pointed at the
    # page rather than at a drawing. The DOM mode exists because most of what
    # can go wrong in the playground is a script that never ran: the picture
    # looks plausible and the buttons are simply absent.
    if [ "${1:-}" = "dom" ]; then
      "$(chrome_bin)" --headless --disable-gpu --no-sandbox \
        --virtual-time-budget=2000 --dump-dom "file://$PWD/docs/index.html" 2>/dev/null
    else
      out="${1:-$(tmp_path page png)}"
      screenshot "file://$PWD/docs/index.html" "$out" "${2:-1600x1000}" "0d0d10"
      echo "$out"
    fi
    ;;
  page-run)
    js="${1:?script required}"
    out="${2:-$(tmp_path page png)}"
    copy="$(tmp_path page html)"
    # The page is self-contained, so a copy anywhere works. The script goes in
    # last, after the page's own, so everything it reaches for already exists,
    # and it waits a moment: headless Chrome runs scripts while the window is
    # still narrow and only then resizes it to WxH, so anything measured
    # straight away is measured in the page's narrow, stacked layout.
    { sed '/<\/body>/,$d' docs/index.html; printf '<script>setTimeout(function () { %s }, 300);</script>\n</body>\n</html>\n' "$js"; } >"$copy"
    # Without the time budget the shot is taken before the delayed script
    # runs, once the page is as heavy as the redesign's (2026-10-17).
    screenshot "file://$copy" "$out" "${3:-1400x900}" "0d0d10" 2000
    rm -f "$copy"
    echo "$out"
    ;;
  viewer)
    file="${1:?.reladraw file required}"
    out="${2:-$(tmp_path viewer png)}"
    html="${out%.png}.html"
    node dist/cli.js render "$file" --page -o "$html" >/dev/null
    shot="$html"
    if [ -n "${4:-}" ]; then
      # The script runs once the page's own has, and a moment after the window
      # reaches WxH, for the reason page-run gives.
      shot="$(tmp_path viewer html)"
      { sed '/<\/body>/,$d' "$html"; printf '<script>setTimeout(function () { %s }, 300);</script>\n</body>\n</html>\n' "$4"; } >"$shot"
    fi
    screenshot "file://$shot" "$out" "${3:-1400x900}" "0d0d10" 2000
    [ "$shot" != "$html" ] && rm -f "$shot"
    echo "$out"
    ;;
  page-examples)
    # Opens the picker and steps down the list the way the arrow key would.
    "$0" page-run "document.getElementById('browse').click();for(var i=0;i<${3:-1};i++)document.getElementById('catalog').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));" \
      "${1:-$(tmp_path examples png)}" "${2:-1400x900}"
    ;;
  element)
    # Chrome refuses a module script from a file:// page, whose origin is null,
    # unless told file pages may read files. The page imports dist/ as a
    # module because that is how a stranger's page will load it.
    url="file://$PWD/tools/element.html"
    if [ "${1:-}" = "dom" ]; then
      "$(chrome_bin)" --headless --disable-gpu --no-sandbox --allow-file-access-from-files \
        --virtual-time-budget=2000 --dump-dom "$url" 2>/dev/null
    else
      out="${1:-$(tmp_path element png)}"
      rm -f "$out"
      "$(chrome_bin)" --headless --disable-gpu --no-sandbox --allow-file-access-from-files \
        --disable-lcd-text --font-render-hinting=none --virtual-time-budget=2000 \
        --screenshot="$out" --window-size="${2:-900x1400}" "$url" >/dev/null 2>&1 || true
      [ -f "$out" ] || { echo "no screenshot of $url" >&2; exit 1; }
      echo "$out"
    fi
    ;;
  clicks)
    # What a browser would actually follow, at each point named. A destination
    # is the one thing in the output that cannot be seen in a picture, and the
    # obvious way to write it — an <a> inside another <a> — is dropped silently
    # by Chrome, which is why this is a command and not a thing to reason about.
    svg="${1:?input .svg path required}"
    shift
    points="$*"
    "$(chrome_bin)" --headless --disable-gpu --no-sandbox \
      --virtual-time-budget=2000 --dump-dom \
      "data:text/html,<body style='margin:0'>$(python3 - "$svg" <<'PY'
import sys, urllib.parse
print(urllib.parse.quote(open(sys.argv[1]).read()), end='')
PY
)<script>
      const pts = '$points'.split(' ').filter(Boolean);
      const out = [];
      for (let i = 0; i < pts.length; i += 2) {
        const el = document.elementFromPoint(+pts[i], +pts[i + 1]);
        const a = el && el.closest('a');
        out.push(pts[i] + ',' + pts[i + 1] + ' -> ' + (a ? a.getAttribute('href') : 'nothing'));
      }
      document.title = out.join(' | ');
    </script>" 2>/dev/null | grep -oE '<title>[^<]*' | cut -c8-
    ;;
  nodes)
    node tools/geometry.mjs nodes "${1:?input .reladraw path required}"
    ;;
  overlaps)
    node tools/geometry.mjs overlaps "${1:?input .reladraw path required}"
    ;;
  blocks)
    node tools/blocks.mjs "$@"
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
    ln -s "$(modules_dir)" "$work/base/node_modules"
    (cd "$work/base" && npx tsc >/dev/null)

    compile
    moved=0
    for in in examples/*.reladraw; do
      name="$(basename "$in" .reladraw)"
      # Both compilers read the working tree's examples, so a difference is
      # always the code and never the file.
      # A baseline that cannot read the working tree's source is not a moved
      # picture, and reporting it as one is how three sessions have been misled:
      # rename an attribute and every example using it "moves", because the old
      # build drops the word it has never heard of. Say what actually happened
      # and point at the command that answers the question instead.
      if ! cli "$work/base/dist/cli.js" "$in" -o "$work/head/$name.base.svg" >/dev/null 2>&1; then
        echo "OLDER $name  (source does not render at $ref — use ./dev.sh pictures)"
        moved=$((moved + 1))
        continue
      fi
      cli dist/cli.js "$in" -o "$work/head/$name.head.svg" >/dev/null 2>&1 || true
      if cmp -s "$work/head/$name.base.svg" "$work/head/$name.head.svg"; then
        echo "same  $name"
      elif same_but_ids "$work/head/$name.base.svg" "$work/head/$name.head.svg"; then
        echo "ids   $name  (only the id prefix differs)"
      else
        echo "MOVED $name"
        moved=$((moved + 1))
      fi
    done
    echo "$moved of $(ls examples/*.reladraw | wc -l | tr -d ' ') examples differ from $ref"
    ;;
  snapshot)
    dir="${1:?output directory required}"
    mkdir -p "$dir"
    compile
    for in in examples/*.reladraw; do
      name="$(basename "$in" .reladraw)"
      cli dist/cli.js "$in" -o "$dir/$name.svg" >/dev/null 2>&1 || echo "FAILS $name"
    done
    echo "$(ls "$dir"/*.svg | wc -l | tr -d ' ') examples rendered into $dir"
    ;;
  against)
    # `regress` with a baseline taken by `snapshot` rather than built from a
    # git ref, so a change made in steps can be checked against the step
    # before it rather than against the last commit.
    dir="${1:?baseline directory required}"
    work="$(mktemp -d -t reladraw-against-XXXXXX)"
    trap 'rm -rf "$work"' EXIT
    compile
    moved=0
    for in in examples/*.reladraw; do
      name="$(basename "$in" .reladraw)"
      if ! cli dist/cli.js "$in" -o "$work/$name.svg" >"$work/$name.err" 2>&1; then
        echo "FAILS $name: $(tail -1 "$work/$name.err")"
        moved=$((moved + 1))
      elif ! cmp -s "$dir/$name.svg" "$work/$name.svg"; then
        echo "MOVED $name"
        moved=$((moved + 1))
      else
        echo "same  $name"
      fi
    done
    echo "$moved of $(ls examples/*.reladraw | wc -l | tr -d ' ') examples differ from $dir"
    ;;
  stress)
    compile
    node tools/stress.mjs "$@"
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
    ln -s "$(modules_dir)" "$work/base/node_modules"
    (cd "$work/base" && npx tsc >/dev/null)

    compile
    moved=0
    for in in examples/*.reladraw; do
      name="$(basename "$in" .reladraw)"
      base_in="$work/base/examples/$name.reladraw"
      if [ ! -f "$base_in" ]; then
        echo "NEW   $name"
        moved=$((moved + 1))
        continue
      fi
      if ! (cd "$work/base" && cli dist/cli.js "examples/$name.reladraw" \
              -o "$work/out/$name.base.svg") >/dev/null 2>&1; then
        echo "BROKE $name  (does not render at $ref)"
        moved=$((moved + 1))
        continue
      fi
      cli dist/cli.js "$in" -o "$work/out/$name.head.svg" >/dev/null 2>&1 || true
      if cmp -s "$work/out/$name.base.svg" "$work/out/$name.head.svg"; then
        echo "same  $name"
      elif same_but_ids "$work/out/$name.base.svg" "$work/out/$name.head.svg"; then
        echo "ids   $name  (only the id prefix differs)"
      else
        echo "MOVED $name"
        moved=$((moved + 1))
      fi
    done
    echo "$moved of $(ls examples/*.reladraw | wc -l | tr -d ' ') pictures differ from $ref"
    ;;
  compare)
    ref="${1:-v0.16.0}"
    page=examples/out/compare
    mkdir -p "$page/new"
    if [ "$(cat "$page/old/.ref" 2>/dev/null)" != "$(git rev-parse "$ref")" ]; then
      rm -rf "$page/old"
      mkdir -p "$page/old"
      work="$(mktemp -d -t reladraw-compare-XXXXXX)"
      trap 'rm -rf "$work"' EXIT
      git archive "$ref" | tar -x -C "$work"
      ln -s "$(modules_dir)" "$work/node_modules"
      (cd "$work" && npx tsc >/dev/null)
      for in in "$work"/examples/*.reladraw; do
        name="$(basename "$in" .reladraw)"
        cp "$in" "$page/old/"
        # An old build printed the output path to stderr; keep only what it said.
        cli "$work/dist/cli.js" "$in" -o "$PWD/$page/old/$name.svg" 2>&1 >/dev/null |
          grep -vF "$PWD/$page/old/$name.svg" | sed "s|^$work/||" > "$page/old/$name.said" || true
      done
      git rev-parse "$ref" > "$page/old/.ref"
    fi
    compile
    rm -f "$page"/new/*
    for in in examples/*.reladraw; do
      name="$(basename "$in" .reladraw)"
      cp "$in" "$page/new/"
      cli dist/cli.js "$in" -o "$page/new/$name.svg" 2>"$page/new/$name.said" >/dev/null || rm -f "$page/new/$name.svg"
    done
    node tools/compare.mjs "$page" "$ref"
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
    ln -s "$(modules_dir)" "$work/node_modules"
    (cd "$work" && npx tsc >/dev/null)
    mkdir -p examples/out
    cli "$work/dist/cli.js" "$in" -o "examples/out/$name-before.svg"
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
  imgdiff)
    a="${1:?first image required}"
    b="${2:?second image required}"
    echo "sizes: $(im "$a" -format '%wx%h' info:) and $(im "$b" -format '%wx%h' info:)"
    echo "pixels differing: $(im "$a" "$b" -metric AE -compare -format '%[distortion]' info: 2>&1)"
    if [ -n "${3:-}" ]; then
      im "$a" "$b" -compose difference -composite -negate "$3"
      echo "$3"
    fi
    ;;
  sidebyside)
    a="${1:?first picture required}"
    b="${2:?second picture required}"
    out="${3:?output path required}"
    work="$(mktemp -d)"
    n=0
    for pic in "$a" "$b"; do
      n=$((n + 1))
      case "$pic" in
        *.svg)
          size="$(grep -oE '<svg[^>]* width="[0-9]+" height="[0-9]+"' "$pic" | head -1 | sed -E 's/.*width="([0-9]+)" height="([0-9]+)"/\1x\2/')"
          "$0" screenshot "$pic" "$work/$n.png" "$size" >/dev/null
          ;;
        *) cp "$pic" "$work/$n.png" ;;
      esac
      im "$work/$n.png" -trim +repage "$work/$n.png"
    done
    im "$work/1.png" "$work/2.png" -background '#333333' -splice 12x0 +append "$out"
    rm -rf "$work"
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
