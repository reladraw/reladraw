---
name: reladraw
description: Write, render and edit diagrams in reladraw, a text diagram language where you say where things go, so the arrangement can be read back out of the source without looking at the picture. Use when asked to draw, diagram, sketch or visualize an architecture, a system, a data flow, a pipeline, a deployment, a directory layout, or the shape of a change or pull request; when reading or editing a .reladraw file; or when the user says "reladraw", "diagram this", "draw the architecture", "show me how these pieces fit". Use it in place of Mermaid, Graphviz, D2 or hand-drawn ASCII boxes whenever a node-and-line diagram is wanted and reladraw is installed. NOT for charts of data — bar, line, pie, scatter — and NOT for pictures that are not nodes and lines.
---

# reladraw

A text language for diagrams. Source in, standalone SVG out, no runtime dependencies.

Every other diagram language hands the arrangement to a layout engine, so where things land is an output you can't predict from what you wrote. reladraw inverts that: the file states the arrangement in the terms a person would say out loud (`right of api`, `below worker (gap: tight)`, `even with queue`), and the tool draws exactly that. It never chooses an arrangement, never moves a box to make room, and never routes a line round anything.

That matters here specifically. You can't see the SVG you produced. With auto-layout that leaves you guessing; with reladraw the arrangement is in the sentences you just wrote, and where the picture may not read as meant, the tool tells you in words.

**Show every diagram as its page.** Whenever the user is to see a diagram, whether one you drew, one you changed, or an existing file they asked to look at, render it with `--page` and open it in the default browser, as step 7 of the loop says. The bare SVG is for putting into something else, such as a README or a document, not for showing.

## Check it is installed, and the same version as this skill

This skill teaches reladraw 0.24.0. Once per session, before the first render, run:

```
reladraw --version
```

- **The same:** say nothing.
- **Older, or `--version` isn't recognized** (it arrived in 0.17.1): the tool is older than this page and will refuse some of what it teaches. Tell the user, and give them `npm install -g reladraw@latest`.
- **Newer:** this skill is out of date. Tell the user, and give them `reladraw install-skill`, which asks which agents to install for and replaces it with the skill that came with their reladraw. Carry on meanwhile; where an error names a replacement spelling, trust the error over this page.

If `reladraw` isn't installed, `npx reladraw` works without installing, and `npm install -g reladraw` installs it.

## The loop

1. Write a `.reladraw` file. Where it goes depends on what it is for. A diagram that belongs to the project, one the user asked to keep or that a README or document will show, goes where they say, or beside what it describes. A diagram drawn only to show the user something, such as an explanation or a sketch of a change, goes in a folder of its own outside the project, such as `~/.cache/reladraw/` or the system's temporary folder, named after what it shows, so the project isn't littered. Nothing is lost if that folder is cleared: the page in step 7 carries its source and saves it.
2. `reladraw check diagram.reladraw`. It prints errors and findings and writes nothing.
3. If it fails, the **error** names the line and what to write instead. Fix and re-run.
4. If it succeeds, read the **findings** it printed. Each is one line saying what may not read as meant, where, and how much:

```
diagram.reladraw:12: warning(text-overlap): text "statements" covers the top-left corner of node resolver; the overlap is 3 units wide and 2 units tall
diagram.reladraw:9: warning(edge-node-overlap): line api -> db crosses node cache, in and out of its top
```

5. Fix each finding in the source, by placing something differently or saying where a line goes, and re-run until there are none.
6. `reladraw format diagram.reladraw` before handing the file over. It lines statements up in columns and evens out spacing, by the project's `.reladraw-format` if there is one, and changes nothing about what the file draws. A file you wrote then reads like one the user's project already has.
7. Finish by showing the user the picture. Give the diagram a title with `diagram  title: "…"`, which heads the page, then run `reladraw render diagram.reladraw --page`. It writes `diagram.html` beside the source, a page in the diagram's own colors that pans, zooms, goes full screen, and saves itself, its source, an SVG or a PNG. For a diagram kept in the project, put the page in the outside folder of step 1 instead, with `-o ~/.cache/reladraw/diagram.html`, so it isn't committed by mistake. Write an SVG only when something will use it, such as a README picture: `reladraw render diagram.reladraw` writes `diagram.svg` beside the source. Open the page in the default browser: `xdg-open diagram.html` on Linux, `open diagram.html` on macOS, `start diagram.html` on Windows. Show the page rather than the bare SVG, and don't build a page of your own around it. Open it once per diagram; after later edits, render the page again and tell the user to reload it. Don't open it when there is no display to open it on, as in a remote or headless session, or when the user has said not to; give them the page's path instead.

A file with no errors and no findings has nothing on top of anything. That is still not the same as a good picture: re-read your source to confirm the arrangement says what you meant, and for a large diagram tell the user you have checked the findings but not seen the render.

## The one idea

**The file says where things go, and the tool draws exactly that.** A gap is the distance you wrote. A box goes where its placements put it and nothing pushes it. A line is straight between its two boxes unless you say it is square or curved or name the places it passes. Anything that overlaps is drawn overlapping and reported.

So the fix for a problem is always more said in the source, never hoping the tool will sort it out. Two boxes on one spot: place one against the other. A line through a box: say where it passes with `via:`. A text crowding a box: widen the gap.

## Writing a file

A statement starts at the beginning of a line. A long one continues onto following lines that are indented; a blank or unindented line ends it. Indentation never puts one thing inside another. `//` starts a comment and may trail a statement.

A statement is a positional head (the keyword, a name, then a text) followed by attributes and placements **in any order**. A word ending in a colon opens an attribute and nothing else does.

### Nodes

```
node <name> ["<text>" [(<text settings>)]] [<placement> | <attribute>] ...
```

Leave the text out and the node shows its name (`node parser` reads "parser"). Write `""` for a deliberately blank node. Inside a text, ` / ` (a slash with a space on each side) is a line break; `TCP/IP` and URLs survive.

The body is `shape: rectangle | document | circle | diamond | pill | parallelogram | hexagon | trapezoid | triangle | cylinder | none` (`none` is bare text, for notes and captions; a flowchart shape with no geometric name is `flow-` and its meaning, such as `flow-subprocess` or `flow-delay`; settings follow in a bracket, `shape: triangle (aim: up)`) or `icon: disk | desktop | laptop | package | cubes | cube | database`, a picture with no box. `badge: <icon>` puts a picture beside the text as part of the label. A picture outside the set is declared with `icon <name>` and SVG between `"""` marks; prefer the built-ins.

```
node dump  "nightly dump"  shape: document
node unit  icon: cube  right of dump
node drive "External HD"  badge: disk  below dump
node aside "a remark that folds" (wrap: 20)  shape: none  right of drive
```

### Placing

```
above X          below X          left of X        right of X
above-left of X  above-right of X below-left of X  below-right of X
even with X      top even with X  bottom even with X  left even with X  right even with X
```

- **Exactly one node in the file is unplaced**, the anchor. Every other is placed against something, directly or through others.
- **A gap is exact**: `none`, `tight`, `normal` (the default) or `wide`, in the placement's bracket, `right of a (gap: tight)`, or a number of the file's unit in front, `2 right of a`. A normal box is about 4 units tall.
- **A lone direction also centers on its target.** `right of a` alone puts the box level with `a`. Another placement on that axis replaces the centering: `right of a  even with b`.
- **Each axis is stated once.** Two placements on one axis are refused. The one exception: `right of a  left of b` centers the box in the space between them, and then something must say how high.
- **Several targets are one region**: `below a and b` sits under the pair, centered between them.
- **Nothing moves a box.** Two boxes placed `right of a` both land on one spot and are reported. Chain them (`b right of a`, `c right of b`) or put them in a container with a layout.

### Containers

A dotted name is a child: `server.api` is inside `server`, and the parent is declared first. A container is the box round its children. Arrange them one of two ways:

```
node server "Server"  layout: column (widths: match)
node server.api    "API"
node server.worker "Worker"

node lab "Lab"  right of server (gap: wide)
node lab.pc   "PC"
node lab.nas  "NAS"  right of lab.pc (gap: tight)
```

`layout: column` or `layout: row` puts the children in written order; its bracket takes `gap:`, `widths: match`, and `align-children: left | center | right`. Without a layout, exactly one child is unplaced and the rest are placed against it. `shape: none` on a container draws no box, which makes a group you can place things against as one shape.

A title goes `(inside top)` by default, centered along it; `(inside top, align: left)` puts it at the top left, and `(on top)` or `(outside top)` sit it on or above the border.

### Text

Everything a text says about itself goes in brackets after it: `color`, `size` (`small | normal | large`), `wrap` (fold every n characters) and `align`.

```
style dim  text: (color: theme-muted)
node grinder "Grinder / [dim]medium-fine[/dim]"
node note "a longer remark that folds" (size: small, wrap: 30)  shape: none  below grinder (gap: tight)
```

`[dim]…[/dim]` borrows a style's look for a stretch of text. A style hangs the bracket off a key: `style aside  text: (size: small, color: theme-muted)`. **Always give bare text a `(wrap: n)`**, or a sentence is one long line across whatever is beside it.

### Lines

```
edge [<name>] <from> -> <to> ["<text>" [(<placement>)]] [attributes]
```

`<-`, `<->` and `--` work too, and each end may carry a mark: `a <|-- b`, `a *--o b`, `a diamond--> b`. `from:` and `to:` name the side of the first and second name written: `from: right  to: left`.

- **Straight by default**, between the two boxes and through anything in between, which is reported. `line: (path: square)` or `line: (path: curved)` for a route read off the line's own two boxes and sides.
- **`via:` lists the places a line passes**: `via: cache top` runs just above `cache`; `via: between a and b` goes through the point between them; `via: proxy` goes through a box's center. This is how to take a line round something.
- **A text sits at the middle of its line.** Place it with `(at: start)`, `(at: 1/4)`, `(above edge)`, `(on: longest level)` or `(above some_box)`. Texts never move boxes, so give a labeled line room: a `normal` gap is too short for a word, so use `(gap: 12)` or so between boxes joined by a labeled line.
- `line: (pattern: dashed, thickness: thick, corners: rounded, color: #d2904e)`; `line: red` alone is the color.

### Against a part of a box

```
node bob      "Bob the builder" (inside top)  height: 7
node bob_role "builder" (size: small)  inside bob bottom-center  shape: none
node count    "3"  on bob top-right  shape: circle
```

A box's parts are its `text`, its sides `top`, `bottom`, `left`, `right`, and nine points (`top-left`, `top-center`, … `center` … `bottom-right`). `inside` tucks a node within the box against that part, `outside` puts it beyond, `on` centers it on the part.

A child `inside` its own parent's corner is placed against the finished box and never grows it, so it can land on the parent's text or other children. `stays above`, `stays below`, `stays left of` or `stays right of` a sibling (or `parent text`) keeps it clear, and the box makes room: `node laptop.mark  icon: laptop  inside laptop top-right  stays above laptop.photos`. A picture beside a box's only text goes against the text instead: `1 right of drive text`.

### Styles and colors

```
style store  fill: theme-primary-subtle  border: theme-primary  badge: database
node records "Records"  style: store
```

`fill` is a box's area, `border` its outline, `line` an edge's line, and a text's color goes in its bracket. `corners: sharp` squares a box's rounded corners, and `border: (color: theme-primary, thickness: thick)` thickens its outline, the box growing to keep its padding. Prefer theme colors, which read in light and dark themes alike: `theme-primary` and `theme-secondary` are the accents, `-subtle` is an accent softened toward the page (the one to fill a box with), `theme-muted` is quieter text. A hex or CSS color stays fixed in every theme.

### Links

```
node docs  "Documentation"  url: "https://example.com/docs"
edge api -> db  "SQL"  url: "https://example.com/schema"
```

**A link goes on the thing it is about, never in a text of its own.** Give the node a `url:`, or give it to a line's text when the link is about the connection. The whole box, or the line's text, becomes clickable. When asked to add links to a diagram, put `url:` on the nodes and lines already there. Don't add nodes to hold links: no column of link texts beside the diagram, and no caption with an address under each box. Add one only when the user asks to see the addresses written out.

```
// Wrong: a new text beside the thing the link belongs to
node api_link "github.com/acme/api"  shape: none  right of api

// Right: the link is on the thing itself
node api "API server"  url: "https://github.com/acme/api"
```

The address is never drawn; a reader follows it by clicking. A line with no text can't carry one, and neither can a style. Quote the value, since an unquoted `//` starts a comment.

**Offer links; don't add them unasked.** When the things in a diagram have real web addresses, such as the files of a pull request on GitHub, end your reply with one line offering to link each node to its file. Never guess an address, and don't link to files on the local machine.

## A complete small file

```
// A request path, left to right.
style store  fill: theme-primary-subtle  border: theme-primary  badge: database

node browser  "Browser"
node api      "API server"  right of browser (gap: 10)
node db       "Postgres"    right of api (gap: 10)  style: store
node worker   "Worker"      below api (gap: wide)

edge browser -> api  "HTTP"
edge api -> db       "SQL"
edge worker -> db    "writes"  to: bottom  line: (path: square)

node aside "The worker shares the database / but takes no HTTP traffic." (wrap: 30)  shape: none  below worker (gap: tight)
```

## What will bite you

- **Two boxes placed the same way.** `node b right of a` and `node c right of a` put `b` and `c` on one spot. Place `c` against `b`, or use a container with `layout:`.
- **A labeled line between close boxes.** The text sits on the line and nothing widens the gap, so it covers the boxes and is reported. Give the placement a larger gap.
- **Two unplaced boxes.** Only one may be. The error names both.
- **Saying an axis twice.** `right of a  even with a` is fine; `below a  even with b` is two statements about height, and refused.
- **Old syntax.** `level with` is `even with`; `gap:` on a node goes in a placement's bracket; edge clauses like `below c` and `between a and b` are `via: c bottom` and `via: between a and b`; `contents:` is `layout: column (…)`; `at:` on a node's text is `(inside top, align: left)` and the like; `deck:` is a container, `layout: deck  cards: "Drive 1" "Drive 2"`. Each is refused with what to write instead.
- **`note`, `box` or `link`.** Not statements: a note is `node … shape: none`, and the keywords are `node` and `edge`.
- **A coordinate.** None exist. Every position is relative to something in the diagram.
- **`#` as a comment.** It opens a hex color; comments are `//`.
- **Guessing from another language.** No braces, no semicolons, no subgraphs. If you want something not written here, check `reference/syntax.md` before inventing it.

## Reference

[reference/syntax.md](reference/syntax.md) is the full syntax reference: every construct, points and regions, waypoints and named legs, bundles, sizes, guides, drawing order, the findings, what the language refuses and why, and what changed in each version. Read it when you need a construct this page doesn't cover, or when an error or a finding points at behavior you didn't expect.
