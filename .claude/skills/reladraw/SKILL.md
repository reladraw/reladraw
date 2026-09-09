---
name: reladraw
description: Write, render and edit diagrams in reladraw, a text diagram language where placement is stated rather than computed by a layout engine — so the arrangement can be read back out of the source without looking at the picture. Use when asked to draw, diagram, sketch or visualize an architecture, a system, a data flow, a pipeline, a deployment, a directory layout, or the shape of a change or pull request; when reading or editing a .reladraw file; or when the user says "reladraw", "diagram this", "draw the architecture", "show me how these pieces fit". Use it in place of Mermaid, Graphviz, D2 or hand-drawn ASCII boxes whenever a box-and-line diagram is wanted and reladraw is installed. NOT for charts of data — bar, line, pie, scatter — and NOT for pictures that are not boxes and lines.
---

# reladraw

A text language for diagrams. Source in, standalone SVG out, no runtime dependencies.

Every other diagram language hands the arrangement to a layout engine, so where things land is an output you cannot predict from what you wrote. reladraw inverts that: the file states the arrangement in the terms a person would say out loud — `right of api`, `between web and worker`, `level with queue` — and the tool works out only the distances. Nothing is ever chosen for you.

That matters here specifically. You cannot see the SVG you produced. With auto-layout that leaves you guessing; with reladraw the arrangement is in the sentences you just wrote, so re-reading your own source tells you where everything is.

## Check it is installed

```
reladraw --help
```

If that fails, `npx reladraw` works without installing, and `npm install -g reladraw` installs the command.

## The loop

1. Write a `.reladraw` file.
2. `reladraw diagram.reladraw -o diagram.svg` (`-o -` writes to stdout; the default output path is the input with `.svg` in place of its extension).
3. If it fails, the error names the statement and what is wrong with it. Fix and re-run.
4. Re-read your own source to confirm the picture says what you meant.

Errors are the feedback you have. A file that renders is a file whose arrangement you fully stated, because anything left ambiguous is refused rather than guessed:

```
diagram.reladraw:3: "c" does not say where it sits vertically: "right of a" and "left of b" would put it in different places
```

**Be honest about what this does not give you.** Re-reading the source confirms *intent* — that the worker landed under the API, that all four machines hang off the hub. It does not confirm *outcome*: whether a long label overflowed, whether a line crosses four others, whether two independently-anchored clusters collided. A machine-readable diagnostics report is planned and is not built yet, so for a large or dense diagram, say plainly that you have stated the arrangement but not verified the render.

## The one idea

**A gap is a minimum distance, never an exact one.** Everything ends up as close together as your statements allow.

So putting something between two things is what pushes them apart, by exactly what it needs:

```
box hub    "Hub"
box side   "Side"    left of hub
box wedge  "Wedged"  right of side  left of hub  level with hub
```

Nothing says how far apart `hub` and `side` are. Delete `wedge` and they close back up. You never pick a number and no number goes stale when a label grows. There are no coordinates in this language, in any form.

## Writing a file

One statement per line. No blocks, no continuations, no significant indentation. `//` starts a comment and may trail a statement.

A statement is a positional head — name, then text, then placements — followed by `key: value` attributes. **Attributes end the positional part: once one appears, nothing positional may follow.** This is the mistake to expect; `note n "text" width: 30 below worker` is an error, and `note n "text" below worker width: 30` is right.

### Nodes

```
box <name> ["<text>"] [<placement> ...] [attributes]
```

Leave the text out and the box is labeled with its own name (`box parser` draws a box reading "parser"). Write `""` for a deliberately blank box. Inside text, ` / ` — a slash with a space on each side — is a line break; a slash without spaces is an ordinary character, so `TCP/IP` and URLs survive.

Containment is a dotted name and the parent must be declared first. Children stack vertically in written order unless a child carries its own placement.

```
box server   "Server"
box server.api    "API"
box server.worker "Worker"
```

A container with `""` and `fill: none  stroke: none` draws nothing and takes no room of its own, which is how you make a group that can be placed against as one shape.

Node attributes: `style`, `fill` and `stroke` (each a color), `subtext` (**a color, not text** — it colors every label line after the first, so a box carries its qualifier as a second line of its own label and `subtext` only makes that line quieter; `muted` is the usual value), `size` (`small | normal | large`), `icon`, `shape`, `width` (fold the label every n characters), `gap`, `overlap: allow`, and `align: widths` on a container.

A qualifier under a name is written with the line break, not with `subtext`:

```
box grinder "Grinder / medium-fine"  subtext: muted
```

### Placement

```
above X          below X          left of X        right of X
above-left of X  above-right of X below-left of X  below-right of X
level with X     top level with X    bottom level with X
                 left level with X   right level with X
```

`of` is optional after a direction. A node carries as many placements as it needs, and any of them may name several targets joined by `and` — `right of borg and bare` places against the box that just bounds them.

Three rules that decide most of what you write:

- **A lone directional placement binds both axes.** `right of docker` also centers the node vertically on Docker, because walking right from something keeps you on its center line. That half drops away as soon as another placement claims that axis.
- **Two placements on one axis with nothing on the other is an error**, because the tool would have to choose which row the box shares. Add `level with X` or a `below`.
- **Exactly one node in the file may be left unplaced.** Everything else is positioned, directly or transitively, against it.

Gaps are named — `none`, `tight`, `normal` (default), `wide` — and belong to the placement, in brackets:

```
box stack "Stack"  below wedge  right of wall (gap: tight)  gap: wide
```

`gap:` as a plain attribute is the node's default and reaches every relationship the node is in, including placements written *against* it. `(gap: none)` puts two edges flat against each other.

### Links

```
link <from> -> <to> ["<label>"] [between <a> and <b> [vertically|horizontally]] [attributes]
```

`<-` and `<->` also work; `a <- b` is exactly `b -> a` drawn the same way, and lets you write the subject first. Endpoints may be nested (`server.api`).

`from:` and `to:` name a side — `top`, `bottom`, `left`, `right` — and turn the line into a curve that actually leaves and arrives that way. Name them whenever the straight center-to-center line would cut through something.

`between a and b` says the line travels down the gap between two named nodes. Use it instead of hoping: the tool will not route around an obstacle by itself, on purpose.

A labeled link widens the corridor between its own two ends by what the label needs, so labels are safe to add.

### Notes

```
note <name> "<text>" <placement> ...  width: 30
```

Text with no box, anchored to a node. **Always give a note a `width:`** — without one a sentence is drawn as one very long line across whatever is beside it.

### Styles

```
style store  fill: #142814  stroke: #486544  icon: database
box records "Records"  style: store
```

Colors are written directly — any hex or CSS color, or `none`. There is no list of color words the tool knows.

## A complete small file

```
// A request path, left to right.
style store  fill: #142814  stroke: #486544  icon: database

box browser  "Browser"
box api      "API server"  right of browser
box db       "Postgres"    right of api    style: store
box worker   "Worker"      below api

link browser -> api  "HTTP"    from: right  to: left
link api -> db       "SQL"     from: right  to: left
link worker -> db    "writes"  from: right  to: bottom

note aside "The worker shares the database / but takes no HTTP traffic."  below worker (gap: tight)  width: 30
```

## What will bite you

- **A placement written after an attribute.** Positionals first, always.
- **Boxes that nothing orders.** Every pair of boxes must clear the other, and where the file says nothing about which side of what, it is an error naming the pair: `"b" and "c" overlap, and nothing says which side of the other either one sits on`. Hanging two children off the same side of the same target is the usual cause. Place one against the other.
- **A note with no width.**
- **Reaching for a coordinate, an offset, or a waypoint.** None exist. If a line goes somewhere wrong, say more about it with `between` and `from:`/`to:`; if a box is in the wrong place, add a placement.
- **`#` is not a comment.** It opens a hex color. Comments are `//`.
- **Guessing at syntax from another language.** There are no braces, no semicolons, no `-->`, no subgraphs. If you want something not written here, check `reference/syntax.md` before inventing it.

## Reference

[reference/syntax.md](reference/syntax.md) is the full syntax reference — every construct, the icon and shape sets, how links sharing a side or a channel are ordered, what the language deliberately refuses and why, and the known defects. Read it when you need a construct this page does not cover, or when an error message points at behavior you did not expect.
