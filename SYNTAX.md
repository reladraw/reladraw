# Syntax reference — v0

What the language accepts. The parser, resolver and SVG renderer implement all of it; the sections at the end record what is defective, unchecked or undecided.

The worked example is `examples/arch.reladraw`, transcribed from the reference render beside it. Nearly every construct here exists because that diagram demanded it. The exception is non-overlap, which that diagram never triggers, so `examples/separation.reladraw` covers it instead.

## Shape of the file

One statement per line. No multi-line statements, no line continuations, no blocks.

Blank lines and `//` comments are ignored. A comment runs to the end of the line and may trail a statement, so `node a "Docker"  // the one that matters` is fine. Indentation is ignored entirely — a formatter may add it for readability, and stale indentation cannot change what a file means.

A lone `/` is an ordinary character rather than the start of a comment, and `#` is ordinary too — it opens a hex color. Comments were spelled `#` in an earlier version and moved to `//` so that `fill: #14532d` could be written the way every other tool writes a color.

A statement is a positional head followed by optional `key: value` attributes. Attributes begin at the first token ending in a colon, which is the only rule a parser needs to tell the two apart. Everything positional therefore comes first — name, text and placements, in that order — and once an attribute has appeared nothing positional may follow it.

```
node server "Home Server" left of cluster  gap: wide  icon: desktop
     ^      ^             ^                ^
     |      |             |                attributes
     |      |             placements
     |      text
     name
```

Attribute values are a single bare word unless quoted. No commas between attributes.

## Nodes

```
node <name> ["<text>"] [<placement> ...] [attributes]
```

`name` identifies the node and must be unique. `text` is what appears inside it, with ` / ` — a slash with whitespace on both sides — marking a line break.

The text is optional, and a node without it takes its own name as its text:

```
node parser
node resolver  right of parser
```

draws two nodes reading "parser" and "resolver". A dotted name shows its last segment only — `node server.docker` reads "docker", because the containment is already drawn and repeating it in the text says nothing new.

Write `""` for a node that is deliberately blank: an invisible container, a node that is nothing but its icon, a glyph body. The empty string is the way to say a node has no text, and leaving the text out entirely is the way to say the name is the text.

A name written this way is doing two jobs, so renaming such a node changes the picture. That is the trade, and the escape from it is to state the text.

The whitespace is part of the marker, not decoration. A slash inside a word is an ordinary character, so `TCP/IP`, `16/9`, `I/O` and `https://example.com/x` all render as written. An earlier version broke on every `/` and quietly tore those texts in half.

For a text that wants a spaced slash and no break, `\/` escapes it: `"Before \/ After"` is one line. The escapes are `\"`, `\\` and `\/`.

`wrap: <n>` folds the text at word boundaries every `n` characters, on top of whatever ` / ` already breaks. It is how you make a block of text narrow and tall so it can sit snugly beside something, rather than wide and short so it cannot.

It was called `width` until it was renamed, and the old name is now an error naming the new one. `width` was wrong in the way this project's naming rule catches: it says how wide something is, and this says nothing of the sort — `width: 200` meaning units was accepted, folded at two hundred characters, and did nothing visible. The reference had to carry a sentence explaining that the number was not a distance, which is the tell that a name is doing the wrong job.

`size: small | normal | large` sets how big the text is, and works on a node, a note or an edge text. The sizes are named for the reason gaps are named: a number would be typography by coordinate, stale the moment the document is set at another size, and silent about *why* one piece of text is smaller than another. An unrecognized value is an error naming it.

Every kind of text has a default, and `size:` overrides it exactly as `fill:` overrides the theme's color. Only `note` defaults to anything other than `normal`, and it defaults to `small`.

Containment is a dotted name. A node named `server.docker` is inside `server`. The parent must be declared before the child.

```
node server         "Home Server"  left of cluster
node server.mirror  "shared folder / mirror"
node server.deploy  "deploy dir"
```

A container is sized by its contents. Children stack vertically in written order unless a child carries a placement of its own.

A container with empty text and no fill or border takes up no room of its own and draws nothing. It exists so that everything inside it can be placed against as a single shape:

```
style invisible  fill: none  border: none

node cluster ""  style: invisible
node cluster.hub       "Cloud sync"
node cluster.desktop1  "Desktop 1"  above-left of cluster.hub

node server "Home Server"  left of cluster
```

Here the server clears the whole cluster. Placed `left of cluster.hub` instead, it would only clear the hub, and the machines around the hub would be free to grow into it.

A container's text can say where in the node it goes, in brackets on the text itself:

```
node docker "Docker" (at: bottom, align: center)  below deploy
```

`at: top | bottom` says which end of the node the text sits at; the contents take the other end. `align: left | center | right` says how the text sits across it. The defaults are `top` and `left` in a container, and the comma is optional punctuation.

The two are independent and neither implies the other. `(at: bottom)` on its own is an ordinary text that happens to be at the bottom.

They are bracketed onto the text rather than written among the node's attributes for the same reason [a gap is bracketed onto its placement](#a-gap-belongs-to-the-placement): they modify that one thing, and the brackets make the scope visible instead of leaving it to be inferred from what happens to sit nearby.

A leaf has no contents, so there is no band and nothing for `at` to be at either end of; writing it on a childless node is an error. `align` is fine there, and its default is `center` rather than `left`, because a leaf's text is centered in its node. It is worth having: any text of more than one line — from a ` / ` break or from `wrap:` — has lines of unequal length, and how those sit across each other is a real question in a leaf as much as in a container.

Both are refused on a note, which has no node at all.

`align: widths` on a container widens every direct child to match the widest of them, so a stack of nodes with texts of different lengths draws as a column with one edge rather than a ragged one. It is the only value the key accepts; anything else is an error. Widths are the only thing it touches — it never moves a child.

### Icons

`icon: <name>` puts a small glyph beside the node's text. There are seven:

| Name | What it means |
| --- | --- |
| `disk` | A physical drive — the hardware, not the filesystem on it. |
| `desktop` | A workstation. |
| `laptop` | A portable machine. |
| `package` | Something stored as a whole rather than run: an archive, a bucket, a sync root. |
| `cubes` | Several interchangeable units of the same kind. |
| `instance` | One of them. |
| `database` | A store queried rather than read as files. |

`cubes` draws three whatever the number, because it is the symbol for "several" and not a count. Where the number matters — where one of them is the end of an arrow — they are separate nodes, and `shape: instance` is how you draw those.

```
node drive "External HD"  icon: disk
```

A name says what the thing *is*, never what the picture looks like, for the same reason `gap: wide` beats `gap: 110`: naming the meaning is what lets the drawing be improved later without every diagram that uses it changing sense. An unrecognized name is an error listing the whole set, rather than a node that quietly draws no icon — you would go looking for the mistake in the wrong place.

The set is small on purpose, and it is not the same trade a drawing tool makes. There you pick a shape out of a visual palette and hundreds are browsable; here you type the word from memory, which caps the useful vocabulary at what fits in a head. Adding your own is not possible yet — see "Not built yet".

The glyph is two lines of the text tall, so it follows `size:` down and up with the text, and it sits at the top of a container beside the title and centered in a leaf beside the text. There is nothing to write about where it goes or how big it is. It takes a column of its own, so the node grows to hold the text and the icon side by side and one never runs under the other.

`icon` is appearance, so a style can carry one and every store in a diagram then looks alike without the word being written more than once:

```
style store  fill: #142814  border: #486544  icon: database
node records "Records"  style: store
```

A node with no text at all is exactly the icon and its padding, which makes an icon usable as a marker and not only as a title-block ornament. A note cannot take one, and says so: an icon decorates a box, and a note has no box.

Icons are drawn from path data inside the tool, never from a font or a linked file. The output is a standalone SVG and has to stay one — an icon font renders as blank boxes on a machine that does not have it, and a linked image has to travel beside the file.

### Shapes

`shape: <name>` says what a node is drawn as. It answers one question, and the answer is either a different outline for the node or a glyph standing where the node would be.

```
node dump "db dump / (app 1)"  shape: document
node svc  ""                             shape: instance
```

`box` is the plain rectangle and is what you get by saying nothing. `document` is the same node with its top-right corner folded — the flowchart symbol saying *this is an artifact, not a process*.

That distinction is worth having because it is a second channel alongside color, and a stronger one. A fill means whatever you assigned it, and a reader has to learn it from the diagram; a folded corner has meant "a document" for as long as there have been flowcharts, and reads with no legend. Most diagrams lose the difference between a thing that runs and a thing that is produced, because every node is a rectangle.

Any icon name is also a shape, and then the node *is* the glyph: no outline, no fill, no padding, and its size is the picture's rather than its text's. A text goes underneath it.

```
node services ""  fill: none  border: none
node services.web    "web"                            shape: instance
node services.api    "api"  right of services.web  gap: tight  shape: instance
```

**`icon:` decorates a node; `shape:` replaces it.** The test is whether the node still sizes itself from its text — a `document` does, a glyph does not. The same artwork can serve both, as a corner ornament on one node and as another node's whole body.

A glyph body is an ordinary node in every other way. It takes placements, it takes edges and sides, other nodes keep clear of it. That is why it exists rather than being an icon: an icon cannot be the end of an arrow. It cannot contain anything, though, and a glyph with children is an error — a picture is not a node.

Shapes are named for what a node is, never for the geometry: `document`, not `folded-corner`. Same rule as the icon names, and for the same reason. An unrecognized name is an error listing what is available.

The fold is a fixed size rather than a fraction of the node, so it looks the same on a narrow node and a wide one. Sizing it proportionally is what makes it vanish on a long text.

## Placement

A *placement* says one thing about where a node goes. A node carries as many as it needs.

```
above X           below X           left of X         right of X
above-left of X   above-right of X  below-left of X   below-right of X
level with X      top level with X  bottom level with X
                  left level with X  right level with X
```

Any of them may name more than one target — `right of borg and bare`, `level with borg, bare and media`. See [Several targets at once](#several-targets-at-once).

`of` is optional after any direction, so `below X` and `below of X` both parse. Write whichever reads as English.

There are no coordinates and no numeric offsets. Each direction leaves a gap, one of `none`, `tight`, `normal` (the default) and `wide`. Write it in brackets on the placement itself, or as `gap:` on a node to set the default for every relationship that node is in — including the ones named against it. See [A gap belongs to the placement](#a-gap-belongs-to-the-placement).

Exactly one node in the document may be left unplaced. Everything else is positioned, directly or transitively, relative to it.

### How placements combine

**A gap sets a minimum distance rather than an exact one,** so everything ends up as close together as your placements allow.

That single rule is what makes a corridor work. Say two things sit side by side, then put a third between them:

```
node hub    "Hub"
node side   "Side"    left of hub
node wedge  "Wedged"  right of side  left of hub  level with hub
```

Nothing states how far apart `hub` and `side` are. They start one gap apart, and adding `wedge` between them pushes them to exactly `wedge`'s width plus two gaps. Delete `wedge` and they close back up. You never pick a number, and no number goes stale when a text grows.

This is the step you would otherwise do by hand: shove two things apart to make room, then drag everything back together so the diagram isn't full of holes. The file states the relationships and the distances fall out.

**A lone directional placement still sets both axes.** `right of docker` on its own also centers the node vertically on Docker, because walking right from something keeps you on its center line. That half is dropped as soon as another placement binds the axis, so it never fights anything you wrote.

**Two placements on one axis and nothing on the other is an error.** `right of docker  left of macbook` with no vertical placement would have to choose between Docker's center line and the Macbook's, and that choice decides which row of the diagram the node shares. The tool refuses and names the axis you left unstated. Add `level with docker`, or `below` something, and it resolves.

**Placements that cannot all hold are an error naming them,** rather than a picture with one node on top of another. Because gaps are minimums, this only happens when something is pinned exactly — by `level with`, or by a loop of placements that each demand more room than the last.

`level with X` is the one placement that fixes a distance outright: share a center line, no gap involved. It binds the vertical only.

```
node dumps ""  right of server.docker  left of cluster  level with server.docker
```

Horizontally between two different targets, vertically level with a third. No single relation can say that, which is why a node can carry several.

Naming a side in front of it aligns that side instead of the center. `top level with media` puts the node's top side on the media node's top side; `bottom`, `left` and `right` work the same way. `top` and `bottom` bind the vertical, `left` and `right` the horizontal — so `left level with X` and `left of X` are different statements, and the word after `left` is what tells them apart.

### Several targets at once

A placement may name several targets joined by `and`, with optional commas. It then places the node against the box that just bounds them all — a region you never have to declare.

```
note swapped "Swapped weekly …"   left of drive.mirror and drive.clone  gap: tight
note kept    "never rotated …"    right of drive.archive and drive.old  gap: tight
```

Neither note says anything about its own vertical position, and neither needs to. A lone directional placement centers on what it names, and what these name is the region covering two nodes, so each note lands centered on the pair it explains.

This is why it is one placement with two targets rather than two placements. Two separate `level with` statements are two demands that both have to hold, and nodes at different heights cannot both share a center line with the same node, so that combination is a contradiction. One statement naming two targets is a single demand about a single region.

Combined with the rule that a lone directional placement also binds the other axis, this is how you offset one row against another. `below a and b` reads as "under the pair, centered between them", because the direction binds the vertical against the region and the horizontal falls on the region's center line:

```
node a  ""  shape: instance
node b  ""  right of a  gap: tight  shape: instance
node c  ""  right of b  gap: tight  shape: instance
node d  ""  below a and b  gap: tight  shape: instance
node e  ""  below b and c  gap: tight  shape: instance
```

Three above, two below, each sitting in the gap between two of them. Adding a second placement to bind the horizontal is what would left-justify the lower row instead — the centering is dropped as soon as anything else claims that axis.

For a direction the region is a floor, so `right of one and three` clears whichever of them sticks out furthest, and it works wherever the targets sit. For an alignment the region is an exact position, and there is one restriction worth knowing: it must not depend on the node being aligned to it. Aligning a note to the region covering `A` and `B` while `B` is placed relative to that same note is refused by name, because there is no order in which each could wait for the other.

### A gap belongs to the placement

A gap is a fact about a relationship, not about a node, so it is written on the placement that names that relationship:

```
node dumps ""  right of server.docker  left of machines (gap: wide)  level with server.docker
```

The dumps come straight out of Docker, so they sit at the default distance from it; the two curves on the other side need room to fan out before they reach the machines, so that gap is wide. One number could not say both.

`gap:` written as an ordinary attribute still works and is the node's default, used by every placement that does not name its own:

```
node stack "Stack"  below wedge  right of wall (gap: tight)  gap: wide
```

Wide below the wedge, tight to the right of the wall.

**A node's `gap:` reaches every relationship it is in, not only the ones it wrote down.** A relationship exists regardless of which of its two ends happened to name the other, so `gap:` on a node also applies to placements written *against* it:

```
node parser "Parser"  gap: wide
node renderer "Renderer"  right of parser
```

`parser` names nothing, and the gap still opens. Without this, the only way to push those two apart would be to know that `renderer` is the one that mentioned `parser` and to edit that line instead — which is a fact about how the file was typed, not about the picture.

Where both ends state a gap the larger applies, since a gap is a minimum either way. A gap in brackets is not a default and is not overruled: it is the specific statement about that one pair, so it wins outright. If you mean a gap to govern one placement and not the whole node, that is what the brackets are for.

The brackets take `gap:` and nothing else at present; anything else in them is an error naming it. An alignment is an error too — `level with x (gap: tight)` — because sharing a line leaves no distance for a gap to set, and a word that quietly does nothing looks like a fault in the tool.

### Side to side

A zero gap turns an offset into contact. `below docker (gap: none)` puts the node's top side flat against Docker's bottom side, so exact side relations need no vocabulary of their own.

### Targets

The target of a placement may be a child of another container. `right of server.docker` places a top-level node against something nested. Containers scope names; they do not scope placement.

Every axis is solved as one system, so a target does not have to come first. What cannot be satisfied is a loop of placements each demanding more room than the last, and that is an error naming the placements in it.

## Nodes do not overlap

You never have to say that two nodes must not sit on top of each other. Every pair carries that already, and `overlap: allow` on either one is the opt-out for the rare case where one is meant to cover another. A container never counts as overlapping its own contents.

**The tool never picks which way to separate two nodes.** It reads the direction off the arrangement you already stated. Say `A` is left of `B`, put `x` between them, and hang a wide node below `x`: because `x` is right of `A` and the wide node is centered under `x`, the file lets the wide node travel rightward away from `A` and offers no way back. So the only separation it allows is `A` moving further left. Nothing is chosen. Where nothing in the file orders a pair on either axis, the tool refuses and names the pair rather than guessing — which is what happens if you hang two nodes off the same side of the same target and expect them to sort themselves out.

**One place the tool decides something you didn't write.** Sometimes both axes already imply an order. The wide node is rightward of `A` and also below it, so the overlap clears either by pushing `A` and `B` apart or by dropping the wide node lower, and both satisfy everything you wrote. The rule is to **separate along the axis where the two nodes overlap least**, which is also the smallest movement, and which matches what a person does by hand.

If you want that pinned down rather than defaulted, group the nodes: put `x` and the wide node in an invisible container. The container becomes the thing that must not overlap `A` and `B`, and it moves as one.

Separation leaves a tight gap, deliberately small — enough to read as two nodes rather than one, never enough to look like a distance somebody asked for. Say `gap:` if you want breathing room there.

## Edges

```
edge <from> -> <to> ["<text>"] [between <a> and <b> [vertically|horizontally]] [attributes]
edge <to> <- <from> ["<text>"] [between <a> and <b> [vertically|horizontally]] [attributes]
edge <from> <-> <to> ["<text>"] [between <a> and <b> [vertically|horizontally]] [attributes]
```

`a <- b` is exactly `b -> a` — same arrow, same picture. What changes is which name you write first, and that is worth having: the first name reads as the subject of the line, and plenty of edges are about the thing the arrow points at rather than the thing it leaves. `from:` and `to:` follow the arrow, not the writing order, so they still name the tail and the head.

Endpoints may be nested (`desktop1.files`). An edge never says where a node goes and routing is the renderer's problem, with one exception: an edge with text claims room in the gap it crosses, which is the next section.

An edge's text breaks on ` / ` exactly as a node's does, and the block centers on the point the text would otherwise have occupied, so ``"run `deploy` / shell command"`` stacks its two lines around the midpoint of the line rather than running off along it. `wrap:` is a node attribute and does not apply — an edge text folds where you say and nowhere else.

### A text makes room for itself

Putting something between two nodes is what pushes them apart, and a text drawn in a corridor is something in that corridor. So an edge with text widens the gap it crosses by what its text needs — the text, a run of line either side of it, and the arrowhead that covers part of that run — and by no more than that.

```
node parser "Parser"
node resolver "Resolver"  right of parser
edge parser -> resolver  "statements"  from: right  to: left
```

Nothing there says how far apart those two nodes are. The default gap is sized for two nodes to breathe rather than to hold a word, so without this the text would be drawn across both of them. Delete the text and the gap closes back to the default. Write `gap: wide` on that placement and nothing further happens, because the minimum you asked for is already the larger of the two — a gap is a minimum, and a text is one more thing bidding into it.

Which gap the text lands in is derived, never stated. Two nodes clear of each other on exactly one axis have exactly one corridor between them, and that is the one that widens. Two sitting corner to corner have no single corridor, because the line runs diagonally through open space, so nothing is widened for them. The room is measured along the run: an edge traveling horizontally needs the text's width, one traveling vertically needs only its depth, so a long text across a vertical gap opens it by a single line and hangs out either side.

An edge with no text asks for nothing, since every gap is wide enough for an arrowhead. An edge carrying a `between` clause asks for nothing here either — its text rides in the channel it named rather than in the gap between its own two ends, and what that does *not* do yet is at the end of the next section but one.

### Which side an edge leaves and arrives on

`from:` and `to:` name a side of the node at each end — `top`, `bottom`, `left` or `right`.

```
edge desktop1.files <-> hub  from: right  to: top
```

That line leaves the right side of `desktop1.files` heading right, and arrives at the top of `hub` heading down. Naming a side is a statement about how the line should leave or arrive, so the edge is drawn as a curve that actually does. An edge naming neither side stays the straight center-to-center line it has always been. Either end may be named on its own; the unnamed one aims at wherever its partner ended up.

You name a side and never a point on it. Alone on a side, an edge lands at its center. Sharing a side with other edges, the attachments space themselves apart, and which one goes where is derived from where the far ends actually sit — of two edges arriving at one top side, the one coming from further left arrives further left. Move a node and the order follows it. This is the same rule as nodes not overlapping: the tool separates things by default and reads the direction off the solved layout rather than asking you.

The space it leaves is deliberately small, and shrinks further if the side is too short to hold the whole group. On a side short enough, it shrinks to nothing and the attachments coincide. Their texts still come apart, because the lines bow in the middle to make up what the side could not give them, but the arrowheads themselves land on one point and nothing warns you — so a small node with several edges arriving on one side is worth a look.

#### Several edges between the same two sides

Edges that run between the *same* pair of sides are a case of their own, because "where the far ends sit" cannot order them: every one of them goes to the same node.

```
edge gateway -> queue  "publishes messages"  from: bottom  to: left
edge queue -> gateway  "receives messages"   from: left    to: bottom
```

Both of those join the bottom of `gateway` to the left of `queue`, so they run in nested lanes. Whichever lane an edge takes on one side, it takes the matching lane on the other — further left along `gateway`'s bottom is further down `queue`'s left — so the lines never cross each other. Any number of edges between one pair of sides nests the same way.

Which edge takes the outer lane is derived where the diagram says anything: two edges pointing opposite ways each keep to one side of their own run, so a reciprocal pair reads as a circulation and re-ordering the two lines changes nothing. Edges pointing the *same* way give the tool nothing to read, and there the order you wrote them in is what decides.

The lanes are as wide as the texts riding in them, so texts come apart with the lines. Note which way that pushes: on a horizontal run the texts stack, a line apart, but on a vertical run they all sit at the same height and have to clear each other sideways, so each lane is a whole text wide.

A side too short to hold the whole group is squeezed, exactly as above — and the room the ends could not give is then made up in the middle, each line bowing across its run by its own share of the shortfall. The captions come apart even where the attachments are packed together. A group that fits its sides is drawn exactly as it was, because the shortfall is nothing.

#### Several edges with no side named at all

Edges between the same two nodes that name no side anywhere have the same problem in a harder form: an unnamed end has no side to be spread along. It aims at the far node's center and attaches wherever that ray crosses the border, so every edge between one pair produces the same point, and three of them come out as one visible line with three texts stacked on it.

```
node a
node b right of a
edge a -> b "first"
edge a -> b "second"
edge a -> b "third"
```

Where an edge would attach is not changed by there being others. What changes is only that they no longer do it in the same place: each takes the line it would have drawn alone and moves it sideways, across its own run, by a lane. The lines are parallel and a lane apart, and where each end lands falls out of that. With the two nodes level, all three attach further up and down the same two sides. With them on a diagonal — where a single line would leave through a corner — the two lines straddle it, and one end lands on each of the two sides meeting there. Neither of those is a case you have to know about; they are the same rule seen from two positions.

Lane order follows the rule above: opposite-pointing edges keep to their own side of the run, same-pointing ones fall back to the order you wrote them in. A lone edge is in no group and is untouched, and naming a side on either end takes an edge out of the group, since it then has a side of its own to be spread along.

Lanes are as wide as the texts riding in them, as with named sides — so two edges between the same two nodes come apart far enough for their captions to clear.

Past a point they cannot: every line still has to attach on the same two sides, and those are only as tall as the nodes. When the group wants more room than the edges can give, the attachments squeeze evenly to fit and each line makes up the shortfall in the middle, bowing across its own run by exactly what its ends could not give it. The texts ride at the midpoints, so they still come apart even though the arrowheads crowd together. The innermost line has no shortfall and stays straight, which is what every group small enough for its nodes looks like.

The bow is the shortfall, not a style — nothing bends until the side is full, and a group that fits is drawn with straight lines exactly as it always was.

### Passing between two things

`between <a> and <b>` says that the line travels down the gap between two named nodes.

```
edge dumps.db1 -> hub  "rclone"  between desktop1 and laptop1  from: right  to: left
```

It says nothing about the rest of the line. The clause binds only the stretch where the line is actually passing that pair — where it enters the span the two of them occupy, it is in the gap between them, and before and after it goes wherever its ends take it. The line is drawn as a curve into the gap, a straight run along it, and a curve out to its far end.

Which gap is meant is usually derived, not stated. One of the two is above the other, or one is left of the other, and whichever it is says which axis the gap binds — so a channel between something above and something below constrains height, and one between something left and something right constrains width, and in neither case does the file mention an axis at all.

Two nodes sitting diagonally have *two* gaps between them, and there the derivation has nothing to go on. Add `vertically` or `horizontally`:

```
edge c -> d  "threaded"  between a and b vertically
```

`vertically` is the gap you measure with a vertical ruler — under the upper one, over the lower one — so a line running along it travels horizontally. The word describes the gap, not the direction of travel, which is the reading to watch for.

Leave it out on a diagonal pair and the error asks for it, in your own node names. Write it where it was not needed and it is checked rather than quietly dropped, so a pair that is only apart vertically will tell you that `horizontally` is wrong. A pair that touches or overlaps has no gap at all, whatever you write, and naming a pair the edge never actually passes is an error too.

Several edges may share one channel, and they take a lane each. As with attachments on a side, which edge gets which lane is derived from where their ends sit, so lines through a channel come out in the order their ends are in and do not cross. The lanes are spaced by what is actually running along them: a text's depth where an edge with text runs, an arrow's width where none does.

A named channel does not widen. It is measured off the layout you described, so if you name a gap too narrow for the lines you put through it they crowd together rather than pushing the two nodes apart. That is the difference between this and a text making room for itself, above: there, the corridor is the gap between the edge's own two ends, and opening it moves them apart exactly as anything else put between them would. Here the pair is named by an edge merely passing through, and nothing yet lets an edge bid into a gap it is only a visitor in. It is the remaining half and it is not built.

## Notes

```
note <name> "<text>" <placement> ...
```

A note is text with no node, anchored to a node so it travels with it.

Nothing bounds a note the way a border bounds a node, so a sentence-length note without a `wrap` is drawn as one very long line and will cross whatever is beside it. Give every note a wrap.

A note starts one step smaller than a node text, because a note annotates the diagram rather than being part of it and at the same size an aside reads as a statement. That is a default, not a ceiling: say `size:` and it does what you said. The two things a note most often needs saying about it are how big its text is and how wide it runs, and both are attributes of the note rather than something to be inferred from the fact that it is one.

## Decks

```
deck <name> "<text>" ["<text>" ...]
```

Draws the named container with offset copies behind it, one per text, to say "there are several of these and they are the same." Only the front copy shows its contents.

## Attributes

Every attribute, and what takes one. The kinds here are what a statement *draws* rather than which keyword declared it: a node whose `shape:` names an icon is drawn as a glyph body and takes a different set from an ordinary node.

| attribute | node | note | glyph body | edge | says |
|---|---|---|---|---|---|
| `style` | ✓ | ✓ | ✓ | ✓ | the named bundle to take appearance from |
| `size` | ✓ | ✓ | ✓ | ✓ | how big the text is set |
| `gap` | ✓ | ✓ | ✓ | | the default distance to whatever it is placed against |
| `overlap` | ✓ | ✓ | ✓ | | `allow`, to opt out of non-overlap |
| `wrap` | ✓ | ✓ | ✓ | | how many characters fit on a line before the text folds |
| `align` | ✓ | | | | `widths`, to widen every child to the widest of them |
| `icon` | ✓ | | | | the glyph that takes the column beside the text |
| `shape` | ✓ | | ✓ | | what the node is drawn as |
| `from` `to` | | | | ✓ | which side the line leaves and arrives on |
| `fill` | ✓ | | | | color — see "A color names the part it colors" |
| `border` | ✓ | | | | color |
| `text` | ✓ | ✓ | ✓ | ✓ | color |
| `subtext` | ✓ | | ✓ | | color |
| `line` | | | | ✓ | color |

The `diagram` statement has a vocabulary of its own — `background`, and so far nothing else — which is checked the same way. Writing `background:` on a node is an error that points at `fill:`.

**A word this table does not give the kind is an error.** The two ways of being wrong get different answers, because they have different remedies. A word that is an attribute nowhere is a misspelling, and the error lists what the kind does take. A word that is an attribute *somewhere else* is usually a real statement written on the wrong half of the diagram, so the error says where it belongs:

```
"one" is a node and has from: left. `from:` belongs to an edge — a node takes style, size, gap, ...
```

Three of the gaps in the table are worth saying out loud, because each was silent until then and none of them looks like a mistake while you are writing it. A glyph body takes no `icon:` — it is drawn *as* a picture and has no box for a second one to sit in. A note and a glyph body take no `align:`, which widens a node's children, and neither may have any. An edge takes no `gap:` or `overlap:` — those say where a node sits, and an edge is not placed, it joins two things that are.

**Changed 2026-09-09.** Until then a node or edge attribute the tool did not recognize was parsed, stored and never read: `wibble: red` on a node drew nothing and said nothing. This was the last place in the language where a key could silently do nothing, and the rule everywhere else — an unknown `diagram` key, an unknown placement modifier, a color naming a part the kind has not got — has always been that a key which silently does nothing looks like the tool being broken rather than like a typo. A file that rendered with a stray word in it will now stop with an error naming it.

## Styles

```
style <name> <attributes>
```

A named bundle of appearance, applied with `style: <name>` on a node or edge. Color carries meaning through the style name rather than being written per node.

```
style backup  border: #d2904e
node server.mirror "shared folder / mirror"  style: backup
```

The appearance attributes are `fill`, `border`, `text`, `line`, `subtext`, `size`, `icon` and `shape`. The first five each take a color written as the viewer will receive it — `#142814`, or any CSS color, or `none`.

### A color names the part it colors

A color attribute says which part of a thing it colors, and a part exists only on the kinds that have one:

| attribute | colors | on |
|---|---|---|
| `fill` | the area inside the outline | a node |
| `border` | the outline | a node |
| `text` | the text | a node, a note, a glyph body, an edge |
| `line` | the drawn line and its arrowheads | an edge |
| `subtext` | every text line after the first | a node, a glyph body |

A word written on a kind that has no such part is refused by name, and the error lists the parts that kind does have — `border:` on a note is a mistake, not something to ignore, for the same reason an unknown `diagram` key is.

An edge's text takes the line's color unless `text` says otherwise, so an edge that means something by being orange means it in its words too, and there is still a way to say the words are not orange.

A style contributes a part only to the kinds that have it, so a style shared between nodes and edges writes one key for each:

```
style backup  border: #d2904e  line: #d2904e
```

The nodes take the border, the edges take the line, and neither sees the other's word. Writing only `border` there would color the nodes and leave the edges plain.

### A style may carry what a thing cannot use

The table under "Attributes" is checked against what you wrote *on the statement*, never against what a style handed it. That is what makes a bundle spanning kinds possible at all: the benchmark's `style synced` carries a fill, a border and a subtext for five nodes and a `line` for the four edges joining them, and every use of it leaves some of its keys unused. That is the style doing its job, not a mistake, so nothing is said about it.

What is refused is a style that gives a thing **nothing at all**:

```
style boxy  fill: #142814  icon: disk
note n "An aside"  style: boxy
```

A note is bare text, with neither a fill nor an icon, so `boxy` dresses it in nothing whatever and the name is on the wrong sort of thing. Partial overlap is the normal case; zero overlap is never anything else. A style that named every attribute in the language would slip through this, since it contributes to everything by construction — nobody writes one by accident, and the hole is left open rather than closed with a rule that would fire on `synced`.

A style's own keys are checked against the whole vocabulary, since a word that is an attribute of nothing is a misspelling wherever it sits. `style s  wibble: red` is an error; a style was the last place one could hide.

**Removed: `stroke`.** It named no part — it meant the border of a node, the *text* of a note or a glyph body, and the line of an edge, whichever the thing happened to have. That is coherent one kind at a time and ambiguous read across them; it meant no ink attribute could ever be *wrong*; and it left one thing with no way to be said at all, the color of the text on an ordinary node, which is why `subtext` exists in the odd shape it does. An older file carrying it gets an error naming the word to use instead.

A color is never written in quotes, and a quoted one is refused. There is nothing to check a color *against* — the tool keeps no list of color words, as below — so this is the one thing that can be checked, and it is the mistake that actually gets made: `subtext: "medium-fine"` reads as the text that goes underneath, and every attribute that takes a color would otherwise accept the string, find it is not a color, and draw nothing without saying so. The qualifier under a name is a second line of the text, not a `subtext` value.

There is no list of color words the tool knows. An earlier version had one, and it was wrong in the way such lists always are: `dark-green` existed only because somebody added it to a map in the renderer, and the next color a diagram wanted would have needed a code change to say. Writing the color directly removes both the list and the reason to grow it. `green` still works, because it is a CSS color, not because this tool has heard of it.

`subtext` colors every text line after the first, so a node can carry a name and a quieter qualifier under it:

```
style synced  fill: #142814  border: #486544  subtext: muted
node pc.files "shared folder / synced"  style: synced
```

`icon` and `shape` belong in a style for the same reason a color does: they say what kind of thing this is, and a kind wants to look alike everywhere it appears. `style artifact  fill: #460000  shape: document` puts the folded corner on every dump in the diagram, and the use site stays one word.

Bundling `size` into a style is how a size comes to mean something. `style aside  size: small  text: #8b8b8b` applied to several nodes says they are the same kind of remark, which a `size: small` written out at each of them does not.

`muted` is the one reserved word left, and it earns the exception: it means the theme's secondary text color rather than a fixed one, so a qualifier stays readable when the theme changes. Writing `subtext: #8b8b8b` instead would pin it to one theme. Say nothing and every line of a text reads alike, which is what most texts want — `Computer 1 / Ubuntu` is two lines of one name, not a name and a qualifier, and the distinction is the author's to make rather than the renderer's to guess.

## The diagram itself

```
diagram <attributes>
```

Settings that belong to the drawing as a whole rather than to anything in it. There is no name, because a file holds one diagram, and a second `diagram` statement is an error rather than a second opinion.

```
diagram  background: #111111
```

One attribute so far. `background` takes a color the same way `fill` does, and it colors the page behind everything, including the strip an edge text knocks out of whatever it crosses. Say nothing and the theme's own background stands.

An unknown key is refused by name — `diagram has no "backround" — it takes background` — rather than quietly ignored, the same as every other attribute. See "Attributes".

## What the language refuses

Deliberate omissions. What they protect is that the renderer never *chooses* an arrangement — it computes the one you described. Working out coordinates from a stated arrangement is arithmetic and is not what is being refused here; picking between arrangements that all satisfy what you wrote is. There is exactly one narrow exception, and it is named as such under "Nodes do not overlap".

- **Coordinates**, in any form, including as an escape hatch.
- **Guessing an axis nobody constrained.** When two placements bind one axis and nothing binds the other, the tool refuses rather than picking a target to center on. Choosing there would decide which row a node shares, not how far it sits from something.
- **Placements that run in a circle.** A loop where each placement demands more room than the last cannot be satisfied and is an error naming the placements involved. A target does *not* have to be positioned before the node naming it — the whole system is solved at once — so ordinary mutual references are fine.
- **Edge waypoints.** A point a line must pass through is a coordinate wearing a hat. Saying a line goes between two named things is not one — it names things the diagram already contains, and it survives those things moving.
- **Choosing a route.** The tool will not find its own way around an obstacle. A line that crosses something it should not is a line you have not yet said enough about, and `between` is how you say it.
- **Set-level placement.** Four siblings around a hub are four statements today. Whether a durable group that reflows when a member is added is worth the same-axis conflict it introduces is undecided.

Note what is *not* on this list: saying more about where something goes. A statement that lets you be more precise is not a step toward auto-layout, and the first version was short enough of them to render the benchmark wrong.

## Not built yet

Designed, decided, and absent from the code. Written down so the next version has somewhere to start.

**Nothing keeps an edge clear of a node on its own.** Non-overlap applies to nodes only. A line may still cut across a node it has nothing to do with, and an edge text may still land on top of one. `between` is how you say where a line goes when that matters, and nothing checks the ones where you have not said. A check belongs on the diagnostics list, but finding a route by itself does not — see "What the language refuses".

**An icon outside the built-in seven.** The set is closed, and a diagram wanting a glyph that is not in it has nowhere to go. The two shapes this could take are a declaration in the file, `icon <name> "<path data>"` beside `style`, and `icon: ./thing.svg` inlined by the tool at render time. Either keeps the output standalone, which is the constraint any answer has to meet.

**A named channel cannot make room for itself.** Lines through a `between` gap too narrow for them crowd together silently, in exactly the way attachments on a too-short side do. An edge with text *does* now open the gap between its own two ends — see "A text makes room for itself" — and it does so by the measure-then-constrain route that region alignments already use, which is the route this wants too. What is missing is the harder case: several edges sharing a channel between two nodes neither of them is an end of, where the room needed is the whole stack of lanes rather than one text.

## Known to be wrong

Not omissions — defects, left here so nobody rediscovers them. Most were found by rendering the benchmark diagram; the last was not, and that is the interesting one, because the benchmark could never have caught it.

~~A placement written after an attribute reports the wrong mistake.~~ Fixed. Attributes still end the positional part of a statement, so `node q "Q" gap: wide level with p` is still an error, but the message now names the token that starts the stray placement and says to move it in front of the first `key: value`, rather than reporting where the parser had got to. The shape was easy to write by accident because a gap read as though it belonged to the placement it followed — which it now does, in brackets.

**A bracketed node sits against one side of any slack.** When two opposing placements leave more room than the node needs — because something else forced the two targets further apart — the node sits against the side it was pushed from rather than centered between them. In practice the tightest arrangement usually leaves no slack, so this rarely shows. Whether it should center instead is not decided.

~~A node placed only with `left of` or `above` drifted to the canvas edge.~~ Fixed. Every constraint reads "this one is at least so far right of that one", so the solve puts each node at the smallest position its constraints allow — right for anything with something behind it, but `left of X` bounds *X* rather than the node that wrote it, leaving such a node nothing to be pushed by. It settled at the edge of the drawing while its target was carried off by the rest of the diagram. A node with nothing behind it now travels until the first of its own placements binds, which is what "as close together as your placements allow" always said.

~~A note could not be put beside the rows it was about.~~ Fixed by letting a placement name several targets, which places the node against the region bounding them. The workaround before it was to wrap the targets in an invisible container so there was a single thing to name, which made the author declare a node to stand in for an idea the language could have expressed directly — and cost the container's padding on top.

~~One relation cannot say what a real arrangement needs.~~ Fixed by letting a node carry several placements: it takes its horizontal position from one target and its vertical from another, and two opposing placements put it between two more.

~~The unwritten axis is a silent guess.~~ Fixed. A lone placement's centering is now the documented meaning of the direction rather than a fallback, and the case where it would have to choose between two targets is an error.

~~Two nodes can land on the same pixels in silence.~~ Fixed. Every pair of nodes must now clear the other, and where the file does not order them the tool says so instead of drawing one over the other. Edges are still unchecked.

~~Gaps get used as a fixing hack.~~ Fixed by making every gap a minimum. Room for something is made by saying that something goes there, not by widening a number on an unrelated line.

~~A text cannot contain a slash.~~ Fixed in two parts: the line-break marker now needs whitespace on both sides, so `TCP/IP`, `16/9`, `I/O` and every path and URL survive untouched, and `\/` escapes the marker for a text that wants a spaced slash and no break, such as `Before \/ After`.

That one was found by testing the lexer, not by rendering — and it could not have been found by rendering, because every text in the benchmark happens to use spaces around its separator. Worth knowing that the repository's own second test target is an OSI and **TCP/IP** diagram, so a picture the language was meant to be tested against could not have been written in it. A benchmark only exercises the cases it happens to contain.

~~An edge with text between two nodes at the default gap drew its text across both of them.~~ Fixed. The default gap is sized for nodes to breathe and a text is wider than that, so `edge a -> b "statements"` on two adjacent nodes came out unreadable and nothing said so; the authoring workaround was to name a wider gap on a placement that had no reason to be wider. An edge with text now widens the corridor it crosses by what the text needs. Note what this is *not*: no coordinate, no repair of a solved layout, and nothing that finds a route — the corridor is derived from where the nodes landed and then becomes an ordinary minimum distance like any other.

~~Two edges between the same pair of sides were drawn on top of each other.~~ Fixed. Each side was ordered on its own, by where the far ends sat, and for edges that share both ends that signal says nothing — so the two edges were ordered without reference to each other and the lines converged in the middle instead of nesting. The visible damage was to the texts: both landed at the same point and the second knocked a hole through the first, leaving one word of it. A group like this now takes one lane order used at both ends. See "Several edges between the same two sides".

~~Several edges between the same two nodes with no side named were drawn on top of each other.~~ Fixed. This is the same defect as the one above, one step out: a bundle is a statement about two named sides, and an end with no side named has not made one, so nothing saw the group. `edge a -> b` three times drew one visible line carrying one text. Each such edge now takes its own line, parallel to the one it would have drawn alone and a lane away from it. Note what did *not* change: an unnamed end still attaches where the center-to-center ray crosses the border, so no single edge anywhere moved. See "Several edges with no side named at all".

~~An unknown attribute was ignored in silence.~~ Fixed. `wibble: red` on a node parsed, was stored, and was never read again — nothing drew and nothing was said. So did every real attribute written on a kind with no use for it: `icon:` on a node already drawn as a glyph, `gap:` on an edge. This was the same defect the color parts had closed one level down a version earlier, and it is how that migration produced false results from the repository's own regression check, since the older build simply dropped every `border:` it had not heard of. See "Attributes".

~~An edge text ignored the line break.~~ Fixed. ` / ` split a node's text and was never applied to an edge's, so the marker came out as a literal slash on an arrow and the benchmark's two-line captions had to be flattened to one. The measurer had always returned the split lines; the renderer was handing it the raw string and drawing that instead. The block now centers on the point the text already occupied, so a one-line text sits exactly where it did.

## Undecided

Open questions the benchmark raised, recorded so a later session does not rediscover them.

- Named gaps are the first step toward numbers, but making them minimums took most of the pressure off: they now set how much a diagram breathes, never whether something fits. Whether four names is the right number is still open.
- Four machines each holding a `files` child with the same text means writing the same line four times. This is the strongest case for a set-level declaration, for terseness rather than for placement.
- The 2×2 arrangement around a hub is four independent statements, so a fifth machine has no slot to reflow into. There are only eight directions.
- ~~Two notes anchored to the same side of one node will collide.~~ Answered by putting both in an invisible container and placing the container, so they stack instead of stacking on top of each other. Writing it the colliding way is now an error rather than a bad picture, since nothing in the file orders the two. Whether the container idiom is good enough or wants dedicated syntax is open.
- Nothing yet expresses one node spanning several rows of a parallel column, which the OSI reference render needs.
- **How contents sit inside a container that is wider than they are.** A container is as wide as the wider of its title and its contents, and when the title wins, the children sit against the left of the slack — because every member goes at the smallest position its constraints allow, and nothing pushes them right. The column then reads as ragged inside a node whose own text may well be centered. `align: widths` already means "how the contents sit", so the key is the obvious home for a second, independent word; what is not settled is whether centering is one word there, whether it should be sayable per axis, and whether it is the same question as the bracketed node sitting against one side of its slack under "Known to be wrong" — which smells like it is. Automatic centering is ruled out either way: it would move every existing diagram whose container title is wider than its contents.
