---
name: reladraw
description: Write, render and edit diagrams in reladraw, a text diagram language where you say where things go, so the arrangement can be read back out of the source without looking at the picture. Use when asked to draw, diagram, sketch or visualize an architecture, a system, a data flow, a pipeline, a deployment, a directory layout, or the shape of a change or pull request; when reading or editing a .reladraw file; or when the user says "reladraw", "diagram this", "draw the architecture", "show me how these pieces fit". Use it in place of Mermaid, Graphviz, D2 or hand-drawn ASCII boxes whenever a node-and-line diagram is wanted and reladraw is installed. NOT for charts of data — bar, line, pie, scatter — and NOT for pictures that are not nodes and lines.
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

**Be honest about what this does not give you.** Re-reading the source confirms *intent* — that the worker landed under the API, that all four machines hang off the hub. It does not confirm *outcome*: whether a long text overflowed, whether a line crosses four others, whether two independently-anchored clusters collided. A machine-readable diagnostics report is planned and is not built yet, so for a large or dense diagram, say plainly that you have stated the arrangement but not verified the render.

## The one idea

**A gap is a minimum distance, never an exact one.** Everything ends up as close together as your statements allow.

So putting something between two things is what pushes them apart, by exactly what it needs:

```
node hub    "Hub"
node side   "Side"    left of hub
node wedge  "Wedged"  right of side  left of hub  level with hub
```

Nothing says how far apart `hub` and `side` are. Delete `wedge` and they close back up. You never pick a number and no number goes stale when a text grows. There are no coordinates in this language, in any form.

## Writing a file

One statement per line. No blocks, no continuations, no significant indentation. `//` starts a comment and may trail a statement.

A statement is a positional head — the keyword, a name, then a text — followed by attributes and placements **in any order**. A token ending in a colon opens an attribute and nothing else does, so `node n "text" gap: wide below worker` and `node n "text" below worker gap: wide` are the same statement.

### Nodes

```
node <name> ["<text>" [(<text properties>)]] [<placement> | <attribute>] ...
```

Leave the text out and the node takes its own name as its text (`node parser` draws a node reading "parser"). Write `""` for a deliberately blank node. Inside text, ` / ` — a slash with a space on each side — is a line break; a slash without spaces is an ordinary character, so `TCP/IP` and URLs survive.

Containment is a dotted name and the parent must be declared first. Children stack vertically in written order unless a child carries its own placement.

```
node server   "Server"
node server.api    "API"
node server.worker "Worker"
```

A container with `""` and `fill: none  border: none` draws nothing and takes no room of its own, which is how you make a group that can be placed against as one shape.

Node attributes: `style`, `fill` and `border` (each a color), `shape`, `icon`, `badge`, `gap`, `overlap: allow`, `url` (a quoted destination), and `contents:` on a container.

`contents: (widths: match, align: center)` says how a container's children sit when its title is wider than they are. `widths:` takes `natural`, `match` (all as wide as the widest) or `fill` (all as wide as the band); `align:` takes `left`, `center` or `right`.

### The text and its brackets

Everything a text says about *itself* goes in brackets after it, never among the node's attributes: `color`, `size` (`small | normal | large`), `wrap` (fold every n characters), `align` (`left | center | right`, how the lines range against each other) and `at` (where the block sits, named from the nine positions — `top-left`, `bottom-center`, `center` and the rest).

```
node docker "Docker" (at: bottom-center, align: center)  below deploy
node aside  "a longer remark that folds" (size: small, wrap: 30)  shape: none
edge a -> b "rclone" (color: muted)
```

An edge's text takes the same keys less `at`. A **style** has no text of its own, so it hangs the bracket off a key: `style aside  text: (size: small, color: muted)`.

A stretch of a text can borrow a style's text color, which is how a node carries a quieter qualifier:

```
style dim  text: (color: muted)
node grinder "Grinder / [dim]medium-fine[/dim]"
```

The mark names a style and never a color; the closer repeats the name; `\[` is a literal bracket. There is no `subtext` attribute — it was removed, and an older file carrying it gets an error naming the mark to write instead.

### The body

Every node has one body and two keys can name it. `shape: rectangle | document | none` is the outline it is drawn with — `rectangle` is the default and `none` is text with no box at all, which is what an annotation is. `icon: <name>` draws the node **as** a picture, with no box: `disk`, `desktop`, `laptop`, `package`, `cubes`, `cube`, `database`. Writing both is an error.

`badge: <name>` is different again: it puts one of those pictures *beside* a node's text, and the node keeps its own body and grows to hold both.

```
node dump  "nightly dump"  shape: document
node aside "a remark" (wrap: 30)  shape: none
node unit  icon: cube
node drive "External HD"   badge: disk
```

A node drawn as a picture and given no text shows none — everywhere else a node with no text takes its name, but a picture usually is the statement.

A color attribute names the part it colors: `fill` is the area, `border` the outline, `text` the text, and `line` the drawn line of an edge. A word is refused on a kind that has no such part, so `border:` on a `shape: none` node is an error — with no body there is no outline, and `text:` is its only color.

A style contributes a part only to the kinds that have it, so a style shared between nodes and edges writes one key for each — `style backup  border: #d2904e  line: #d2904e` colors the nodes' borders and the edges' lines from one name.

There is no `stroke` attribute. It was removed because it named no part; if you have seen it in an older file, it is `border` on a node, `text` on one with no body or a picture body, and `line` on an edge.

**Every attribute is checked by name, so do not invent one.** A word the tool does not know is an error, and so is a real word on a kind that has no use for it — `fill:` on a node with no body, `gap:` or `overlap:` on an edge, `contents:` on a node that can have no children. The error says either what the kind takes or where the word does belong. A key handed over by a style is exempt, which is what lets one style dress both nodes and edges.

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
- **Two placements on one axis with nothing on the other is an error**, because the tool would have to choose which row the node shares. Add `level with X` or a `below`.
- **Exactly one node in the file may be left unplaced.** Everything else is positioned, directly or transitively, against it.

Gaps are named — `none`, `tight`, `normal` (default), `wide` — and belong to the placement, in brackets:

```
node stack "Stack"  below wedge  right of wall (gap: tight)  gap: wide
```

`gap:` as a plain attribute is the node's default and reaches every relationship the node is in, including placements written *against* it. `(gap: none)` puts two sides flat against each other.

### Edges

```
edge <from> -> <to> ["<text>"] [between <a> and <b> [vertically|horizontally]] [attributes]
```

`<-` and `<->` also work; `a <- b` is exactly `b -> a` drawn the same way, and lets you write the subject first. Endpoints may be nested (`server.api`).

`from:` and `to:` name a side — `top`, `bottom`, `left`, `right` — and turn the line into a curve that actually leaves and arrives that way. Name them whenever the straight center-to-center line would cut through something.

`between a and b` says the line travels down the gap between two named nodes. Use it instead of hoping: the tool will not route around an obstacle by itself, on purpose.

An edge with text widens the corridor between its own two ends by what the text needs, so texts are safe to add.

### Annotations

```
node <name> "<text>" (wrap: 30)  shape: none  <placement> ...
```

There is no `note` statement — an annotation is a node with no body, anchored to a node so it travels with it. **Always give one a `(wrap: n)`** — without one a sentence is drawn as one very long line across whatever is beside it.

### On a box

```
node <name> "<text>"  on <node> at <position>
```

Holds a node on another's box at one of nine named points — `top-left`, `top-center`, `top-right`, `left-center`, `center`, `right-center`, `bottom-left`, `bottom-center`, `bottom-right` — inset from that corner or edge and overlapping it on purpose. `(gap: none)` puts it hard against the edge.

This is not containment: a dotted name puts something *inside* a box and widens it, an overlay is stamped *on* it and changes nothing. Use it for a mark, a count, or a link line at the bottom of a box.

### Styles

```
style store  fill: #142814  border: #486544  badge: database
node records "Records"  style: store
```

Colors are written directly — any hex or CSS color, or `none`. There is no list of color words the tool knows.

## A complete small file

```
// A request path, left to right.
style store  fill: #142814  border: #486544  badge: database

node browser  "Browser"
node api      "API server"  right of browser
node db       "Postgres"    right of api    style: store
node worker   "Worker"      below api

edge browser -> api  "HTTP"    from: right  to: left
edge api -> db       "SQL"     from: right  to: left
edge worker -> db    "writes"  from: right  to: bottom

node aside "The worker shares the database / but takes no HTTP traffic." (wrap: 30)  shape: none  below worker (gap: tight)
```

## What will bite you

- **Reaching for `note`, `box` or `link`.** They are not statements. A note is `node … shape: none`; the keywords are `node` and `edge`. Each gets an error naming the replacement.
- **Nodes that nothing orders.** Every pair of nodes must clear the other, and where the file says nothing about which side of what, it is an error naming the pair: `"b" and "c" overlap, and nothing says which side of the other either one sits on`. Hanging two children off the same side of the same target is the usual cause. Place one against the other.
- **An annotation with no wrap.**
- **Reaching for a coordinate, an offset, or a waypoint.** None exist. If a line goes somewhere wrong, say more about it with `between` and `from:`/`to:`; if a node is in the wrong place, add a placement.
- **`#` is not a comment.** It opens a hex color. Comments are `//`.
- **Guessing at syntax from another language.** There are no braces, no semicolons, no `-->`, no subgraphs. If you want something not written here, check `reference/syntax.md` before inventing it.

## Reference

[reference/syntax.md](reference/syntax.md) is the full syntax reference — every construct, the shape, icon and position sets, how edges sharing a side or a channel are ordered, what the language deliberately refuses and why, and the known defects. Read it when you need a construct this page does not cover, or when an error message points at behavior you did not expect.
