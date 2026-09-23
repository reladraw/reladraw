# Syntax reference — 0.3.0

What the language accepts. The parser, resolver and SVG renderer implement all of it; the sections at the end record what is defective, unchecked or undecided.

The worked example is `examples/arch.reladraw`, transcribed from the reference render beside it. Nearly every construct here exists because that diagram demanded it. The exception is non-overlap, which that diagram never triggers, so `examples/separation.reladraw` covers it instead.

## Shape of the file

One statement per line. No multi-line statements, no line continuations, no blocks.

Blank lines and `//` comments are ignored. A comment runs to the end of the line and may trail a statement, so `node a "Docker"  // the one that matters` is fine. Indentation is ignored entirely — a formatter may add it for readability, and stale indentation cannot change what a file means.

A lone `/` is an ordinary character rather than the start of a comment, and `#` is ordinary too — it opens a hex color. Comments were spelled `#` in an earlier version and moved to `//` so that `fill: #14532d` could be written the way every other tool writes a color.

A statement is a positional head — the keyword, a name and a text — followed by attributes and placements in any order. A token ending in a colon opens an attribute and nothing else does, so the two never have to be told apart by position.

```
node server "Home Server" left of cluster  gap: wide  badge: desktop
     ^      ^             ^                ^
     |      |             |                attributes
     |      |             a placement
     |      text
     name
```

`node aside "…"  shape: none  below dumps (gap: tight)  overlap: allow` is one statement with a placement in the middle of its attributes, and reads the same as any other arrangement of those three. Until 0.3.0 placements had to come first; that rule existed only because a bare `gap:` between two placements could not be told from the node-wide default, and [bracketing a gap onto its placement](#a-gap-belongs-to-the-placement) removed the ambiguity that made it necessary.

Attribute values are a single bare word unless quoted. No commas between attributes.

## Nodes

```
node <name> ["<text>" [(<text properties>)]] [<placement> | <attribute>] ...
```

`name` identifies the node and must be unique. `text` is what appears inside it, with ` / ` — a slash with whitespace on both sides — marking a line break.

The text is optional, and a node without it takes its own name as its text:

```
node parser
node resolver  right of parser
```

draws two nodes reading "parser" and "resolver". A dotted name shows its last segment only — `node server.docker` reads "docker", because the containment is already drawn and repeating it in the text says nothing new.

Write `""` for a node that is deliberately blank: an invisible container, a node that is nothing but its badge. The empty string is the way to say a node has no text, and leaving the text out entirely is the way to say the name is the text. A node drawn as a picture is the one exception — there, leaving the text out means no text, and `""` says the same thing.

A name written this way is doing two jobs, so renaming such a node changes the picture. That is the trade, and the escape from it is to state the text.

The whitespace is part of the marker, not decoration. A slash inside a word is an ordinary character, so `TCP/IP`, `16/9`, `I/O` and `https://example.com/x` all render as written. An earlier version broke on every `/` and quietly tore those texts in half.

For a text that wants a spaced slash and no break, `\/` escapes it: `"Before \/ After"` is one line. The escapes are `\"`, `\\`, `\/` and `\[`.

Everything else a text has to say about itself it says in brackets after it — see "The text and its brackets" below.

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

A container's text can say where in the node it goes — see "The text and its brackets" below.

### How the contents sit

A container is as wide as the wider of its title and its contents. When the title wins there is slack, and every child sits at the smallest position its constraints allow — so all of it ends up on the right and the column reads as ragged inside a node whose own text may well be centered. `contents:` is what says otherwise:

```
node svc "Ingestion and enrichment pipeline"  contents: (widths: match, align: center)
```

`widths:` sizes the children and `align:` positions the block of them. They are independent, and the bracket is what keeps the levels apart: `contents:` is a property of the node, `widths:` a property of the contents.

| written | means |
|---|---|
| nothing | natural widths, ranged left |
| `contents: (widths: match)` | every child as wide as the widest, ranged left |
| `contents: (widths: fill)` | every child spans the whole content band; `align` then has no slack to work in |
| `contents: (align: center)` | natural widths, the block of them centered |
| `contents: (widths: match, align: center)` | the tidy centered column |

`align:` takes `left`, `center` and `right` here, the same three words it takes in a text's brackets. Widths are the only thing `widths:` touches and position the only thing `align:` touches; neither reaches a child's own contents.

**Changed 2026-09-20.** This replaced `align: widths`, which is now an error naming its substitution. That key was a size operation wearing an alignment's name, and its value set had one member — a flag in a property's clothes. With it gone, `align` means one thing everywhere in the language: how a block's lines or children range against each other.

### The text and its brackets

Everything a text says about itself rides in brackets after it. The keys are `color`, `size`, `wrap`, `align` and `at`, in any order, with the comma optional punctuation:

```
node docker "Docker" (at: bottom-center, align: center)  below deploy
node aside "Written by a nightly cron job." (size: small, wrap: 30)  shape: none
```

They are bracketed onto the text rather than written among the node's attributes for the same reason [a gap is bracketed onto its placement](#a-gap-belongs-to-the-placement): they modify that one thing, and the brackets make the scope visible instead of leaving it to be inferred from what happens to sit nearby. What is left at the top level is then about the node — its body, its color, where it goes.

An edge's text takes the same brackets, less `at`: a node's text sits somewhere in a box and an edge's rides at the middle of its line, so there is no position to name.

```
edge a -> b  "rclone" (color: muted, size: small)
```

A **style** has no text of its own for a bracket to hang off, so it hangs the bracket off a key instead:

```
style aside  text: (size: small, color: muted)
```

Bundling a text's properties into a style is how they come to mean something: `style aside` applied to several nodes says those are the same kind of remark, which `(size: small)` written out at each of them does not.

`color` takes a color written as the viewer will receive it — `#8b8b8b`, or any CSS color — or the one reserved word `muted`, which means the theme's secondary text color and so survives a change of theme.

`size: small | normal | large` sets how big the text is set. The sizes are named for the reason gaps are named: a number would be typography by coordinate, stale the moment the document is set at another size, and silent about *why* one piece of text is smaller than another. Every kind of text has a default and `size` overrides it, exactly as `fill:` overrides the theme's color; only `shape: none` defaults to anything but `normal`, and it defaults to `small`.

`wrap: <n>` folds the text at word boundaries every `n` characters, on top of whatever ` / ` already breaks. It is how you make a block of text narrow and tall so it can sit snugly beside something, rather than wide and short so it cannot. The number is a count of characters and not a distance: it says how much fits on a line and nothing about where anything sits.

`at: <position>` is where the block of text sits in the node, named from [the nine positions](#against-a-part-of-a-node) — `top-left`, `bottom-center`, `center` and the rest. In a container the vertical half of the word says which end of the node the text's band is at, and the contents take the other end; a container whose text names neither end is an error, since there would be no other end left for the contents. The default is `top-left` in a container and `center` in a leaf.

`align: left | center | right` is a different question and stays one: it says how the block's own *lines* range against each other, which matters whenever they are of unequal length and is not the same as where the block is. Its default is `left` in a container and `center` in a leaf.

Where the node is exactly the size of what it holds — which is most leaves, since a leaf is sized from its own text — there is no slack and `at` changes nothing. It bites where there is some: a badge is two lines tall, so a one-line text beside one has room to sit at either end of.

#### Markup in a text

A word or a stretch of a text can borrow the look of a style:

```
style dim  text: (color: muted)

node pc.files "shared folder / [dim]synced[/dim]"
```

The opener names a **style**, never a color, so the marked words borrow a meaning the file already has instead of restating a value that goes stale the day the thing it means is recolored. A style that says nothing about text is an error naming the missing part, and so is a name no style answers to.

The closer repeats the name. `[/dim]`, not `[/]` — a reader should never have to count openers, and a mismatched close is then refused by name. Marks do not nest.

A mark may cross a line break or a fold, so `"[dim]placement is / an output[/dim]"` quiets both lines. That is what it buys over the `subtext:` it replaced, which could only quiet everything after the first line and did it by counting, in a style somewhere else in the file, where a reader of the text could not see it.

`[` opens a mark, so a literal one is written `\[`:

```
node sizes "sizes \[small, normal, large]"  shape: none
```

### The body

Every node has a *body*: the thing that is drawn where the node is. Two keys name it, and each names one part.

`shape: <name>` is the outline the node is drawn with.

| Value | What it draws |
| --- | --- |
| `rectangle` | The plain rounded box. The default, so nothing has to say it. |
| `document` | The same box with its top-right corner folded — the flowchart symbol saying *this is an artifact, not a process*. |
| `none` | No outline, no fill, no padding. The node is its text and nothing else. |

`icon: <name>` is a picture the node is drawn **as**, with no box at all.

| Name | What it means |
| --- | --- |
| `disk` | A physical drive — the hardware, not the filesystem on it. |
| `desktop` | A workstation. |
| `laptop` | A portable machine. |
| `package` | Something stored as a whole rather than run: an archive, a bucket, a sync root. |
| `cubes` | Several interchangeable units of the same kind. |
| `cube` | One of them. |
| `database` | A store queried rather than read as files. |

```
node dump "db dump / (app 1)"  shape: document
node aside "Written by a nightly cron job." (wrap: 30)  shape: none
node svc  icon: cube
```

A node has one body, so writing both keys is an error naming both.

The `document` fold is worth having because a shape is a second channel alongside color, and a stronger one. A fill means whatever you assigned it and a reader has to learn it from the diagram; a folded corner has meant "a document" for as long as there have been flowcharts, and reads with no legend. Most diagrams lose the difference between a thing that runs and a thing that is produced, because every node is a rectangle. `circle` and `diamond` will join these when a diagram asks for them.

A name says what the thing *is*, never what the picture looks like: naming the meaning is what lets the drawing be improved later without every diagram that uses it changing sense. `document`, not `folded-corner`. The one place that rule stops is a picture with no single meaning — the cube stands for a container in one diagram, a VM in another, a service in a third — which is why it is called `cube` and not `instance`. An unrecognized name is an error listing the whole set, rather than a node that quietly draws nothing.

The icon set is small on purpose, and it is not the trade a drawing tool makes. There you pick a shape out of a visual palette and hundreds are browsable; here you type the word from memory, which caps the useful vocabulary at what fits in a head. Adding your own is not possible yet — see "Not built yet".

`cubes` draws three whatever the number, because it is the symbol for "several" and not a count. Where the number matters — where one of them is the end of an arrow — they are separate nodes, each with `icon: cube`.

A node drawn as a picture is an ordinary node in every other way. It takes placements, it takes edges and sides, other nodes keep clear of it. That is what it buys over a badge: a badge cannot be the end of an arrow. It cannot contain anything, though, and a picture with children is an error, as is a `shape: none` node with children — neither has a box for anything to go inside.

**A picture with no text of its own shows none.** Everywhere else a node with no text is labelled with its name, because `node a` and `node b right of a` mean the two boxes to read "a" and "b". A picture usually *is* the statement, so the default flips: `node svc icon: cube` draws the cube and no caption, and a row of five of them does not come out reading a, b, c, d, e. Write the text if you want one.

Icons are drawn from path data inside the tool, never from a font or a linked file. The output is a standalone SVG and has to stay one — an icon font renders as blank boxes on a machine that does not have it, and a linked image has to travel beside the file.

### Badges

`badge: <name>` puts one of the same pictures beside the node's text, as a small mark on a node that keeps its own body.

```
node drive "External HD"  badge: disk
```

**A badge decorates a node; `icon:` replaces its body.** The test is whether the node still sizes itself from its text: a badged node does, a picture does not. The same artwork serves both.

The badge is two lines of the text tall, so it follows `(size: …)` down and up with the text, and it follows the text to whichever end of the node `at` puts it — the top of a container beside the title, the middle of a leaf beside its words. There is nothing to write about where it goes or how big it is. It takes a column of its own, so the node grows to hold the text and the badge side by side and one never runs under the other.

`badge` is appearance, so a style can carry one and every store in a diagram then looks alike without the word being written more than once:

```
style store  fill: #142814  border: #486544  badge: database
node records "Records"  style: store
```

A node with no text at all is exactly the badge and its padding, which makes a badge usable as a marker and not only as a title-block ornament.

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

There are no coordinates. Each direction leaves a gap, one of `none`, `tight`, `normal` (the default) and `wide`, or a plain number of pixels — `gap: 12`. Prefer the names: change what `tight` means and every tight gap follows. A number is for the distance you actually mean, and it is no less relative than a name, since it is still measured from the target. Write it in brackets on the placement itself, or as `gap:` on a node to set the default for every relationship that node is in — including the ones named against it. See [A gap belongs to the placement](#a-gap-belongs-to-the-placement).

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
node swapped "Swapped weekly …"  shape: none  left of drive.mirror and drive.clone  gap: tight
node kept    "never rotated …"   shape: none  right of drive.archive and drive.old  gap: tight
```

Neither annotation says anything about its own vertical position, and neither needs to. A lone directional placement centers on what it names, and what these name is the region covering two nodes, so each one lands centered on the pair it explains.

This is why it is one placement with two targets rather than two placements. Two separate `level with` statements are two demands that both have to hold, and nodes at different heights cannot both share a center line with the same node, so that combination is a contradiction. One statement naming two targets is a single demand about a single region.

Combined with the rule that a lone directional placement also binds the other axis, this is how you offset one row against another. `below a and b` reads as "under the pair, centered between them", because the direction binds the vertical against the region and the horizontal falls on the region's center line:

```
node a  icon: cube
node b  right of a  gap: tight  icon: cube
node c  right of b  gap: tight  icon: cube
node d  below a and b  gap: tight  icon: cube
node e  below b and c  gap: tight  icon: cube
```

Three above, two below, each sitting in the gap between two of them. Adding a second placement to bind the horizontal is what would left-justify the lower row instead — the centering is dropped as soon as anything else claims that axis.

For a direction the region is a floor, so `right of one and three` clears whichever of them sticks out furthest, and it works wherever the targets sit. For an alignment the region is an exact position, and there is one restriction worth knowing: it must not depend on the node being aligned to it. Aligning a node to the region covering `A` and `B` while `B` is placed relative to that same node is refused by name, because there is no order in which each could wait for the other.

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

### On a box

A placement's target may be a *part* of a node rather than the whole of it — `inside hub top-right`, `right of hub text`, `on hub bottom-left`. That is where `inside`, `outside` and `on` come in, and it has a section of its own: [Against a part of a node](#against-a-part-of-a-node).

### Side to side

A zero gap turns an offset into contact. `below docker (gap: none)` puts the node's top side flat against Docker's bottom side, so exact side relations need no vocabulary of their own.

### Targets

The target of a placement may be a child of another container. `right of server.docker` places a top-level node against something nested. Containers scope names; they do not scope placement.

Every axis is solved as one system, so a target does not have to come first. What cannot be satisfied is a loop of placements each demanding more room than the last, and that is an error naming the placements in it.

## Nodes do not overlap

You never have to say that two nodes must not sit on top of each other. Every pair carries that already, and `overlap: allow` on either one is the opt-out for the rare case where one is meant to cover another. A container never counts as overlapping its own contents, and neither does a node placed `inside` or `on` a part of another and the box it is stamped on — naming a part and saying `inside` is the author stating the overlap, so there is nothing to report. That exemption is for the pair and nothing else, so the node is still kept clear of everything else in the drawing.

**The tool never picks which way to separate two nodes.** It reads the direction off the arrangement you already stated. Say `A` is left of `B`, put `x` between them, and hang a wide node below `x`: because `x` is right of `A` and the wide node is centered under `x`, the file lets the wide node travel rightward away from `A` and offers no way back. So the only separation it allows is `A` moving further left. Nothing is chosen. Where nothing in the file orders a pair on either axis, the tool refuses and names the pair rather than guessing — which is what happens if you hang two nodes off the same side of the same target and expect them to sort themselves out.

**One place the tool decides something you didn't write.** Sometimes both axes already imply an order. The wide node is rightward of `A` and also below it, so the overlap clears either by pushing `A` and `B` apart or by dropping the wide node lower, and both satisfy everything you wrote. The rule is to **separate along the axis where the two nodes overlap least**, which is also the smallest movement, and which matches what a person does by hand.

If you want that pinned down rather than defaulted, group the nodes: put `x` and the wide node in an invisible container. The container becomes the thing that must not overlap `A` and `B`, and it moves as one.

Separation leaves a tight gap, deliberately small — enough to read as two nodes rather than one, never enough to look like a distance somebody asked for. Say `gap:` if you want breathing room there. Between two things inside one box it leaves the step the box's contents are stacked by instead, since that is the spacing everything else in there has.

## Edges

```
edge <from> -> <to> ["<text>"] [between <a> and <b> [vertically|horizontally]] [attributes]
edge <to> <- <from> ["<text>"] [between <a> and <b> [vertically|horizontally]] [attributes]
edge <from> <-> <to> ["<text>"] [between <a> and <b> [vertically|horizontally]] [attributes]
```

`a <- b` is exactly `b -> a` — same arrow, same picture. What changes is which name you write first, and that is worth having: the first name reads as the subject of the line, and plenty of edges are about the thing the arrow points at rather than the thing it leaves. `from:` and `to:` follow the arrow, not the writing order, so they still name the tail and the head.

Endpoints may be nested (`desktop1.files`). An edge never says where a node goes and routing is the renderer's problem, with one exception: an edge with text claims room in the gap it crosses, which is the next section.

An edge's text breaks on ` / ` exactly as a node's does, and the block centers on the point the text would otherwise have occupied, so ``"run `deploy` / shell command"`` stacks its two lines around the midpoint of the line rather than running off along it. An edge's text takes the same brackets a node's does, less `at`, so `(wrap: 20)` folds it and `(color: muted)` quiets it.

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

## Against a part of a node

```
<direction> of <node> <part>
inside <node> <part>
outside <node> <part>
on <node> <part>
```

A placement's target may be a node, as everywhere else, or **a part of a node** — written as the node's name and the part as a separate word. The parts are a node's `text`, its four sides `top`, `bottom`, `left` and `right`, and its nine points:

```
top-left      top-center      top-right
left-center   center          right-center
bottom-left   bottom-center   bottom-right
```

Those nine are the whole set, and every part of the language that has a position accepts all of them. They are words anybody can point at without measuring, which is what makes them allowed where `x: 140` is not — and a diagram written in them still moves correctly when a box moves, which is the property that refusal exists to protect.

**A side is a segment and a point is a point,** and the spelling is what says which. Bare `top`, `bottom`, `left` and `right` name a side, which is why every midpoint carries `-center`: `right` is the whole right edge, `right-center` is the one point halfway down it. Naming a side leaves the other axis free, so `inside plate right` sits against that edge and centers down it; `inside plate right-center` pins it to the midpoint.

Three direction words go with a part target:

| | |
|---|---|
| `inside` | wholly within, against that part |
| `outside` | wholly beyond it |
| `on` | centered on it, so a node on a corner straddles it |

```
node bob "Bob the builder"
node bob_link "bob.example.com"  inside bob bottom-center
```

**`inside` and `outside` are shorthands, and their long form is derived rather than listed.** *Inside* is the direction from the named part toward the box's center and *outside* is away from it, so `inside right` is `left of`, `inside top-right` is `below-left of`, and one rule covers every part. `inside <node> center` and `inside <node> text` are errors: neither part is on the boundary, so there is no direction toward the interior from them.

**`on` is the one that is not a shorthand.** It is a center alignment on both axes at once, which the language did not otherwise have — `level with` gives the vertical and the edge alignments give whichever axis their edge belongs to, and there is no horizontal center alignment at all. It takes no gap: a center sits on a point rather than a distance from it.

The inset for `inside` is a gap on the placement. If nothing says, it is `tight` against another node's box and the box's own padding against the node's own parent — see [Against its own parent](#against-its-own-parent). `(gap: none)` puts the node hard against the edge. It is deliberately *not* the node's own `gap:`, which says how the node stands off its neighbours — a node marked `gap: wide` so its siblings keep clear should not thereby wear its mark 110 pixels in from the corner.

**Saying `inside` or `on` is saying the overlap,** so there is nothing for the overlap error to report about that pair. Everything else in the drawing still keeps clear in the ordinary way.

`inside`, `outside` and `on` take one target. A direction may name several — `right of a and b` means "clear of the box bounding both", which is a floor and decomposes into one demand per target — but these three read a direction off one part of one box.

### Against its own parent

A child may name a part of the node it is inside. **The dotted name is what decides what happens:** a child grows its parent to hold it, and a stranger does not.

```
node server "Server"
node server.web "web"
node server.db "database"
node server.mark "!"  inside server right level with server.db
node stamp "!"  on server top-right
```

`server` widens so `server.mark` sits against its right edge, held in by the padding, on the database's row. A side word straight after `inside`, `outside` or `on <node>` is always the part, so `right level with` here is not read as the right-edge alignment. `stamp` is not part of `server`, so nothing moves for it: it lies over the corner, half in and half out.

The title band is not something a node has; it is what happens when things stack below the text. Children that say nothing about where they go stack below the text in written order, as they always have, and that is what makes the band. A node whose children all sit beside its text or against its frame has nothing below its text, so it has no band and draws as a leaf — its text centered, and whatever is placed against the text centered with it as one group:

```
node hub "Cloud sync"
node hub.star "★"  right of hub text
```

**A child against its own parent is spaced as that parent spaces what it holds.** `inside` insets it by the padding, a placement against the parent's text stands off by the step the contents are stacked by, and the parent's own `gap:` — which says how the parent stands off its neighbours — does not reach it. A gap written on the placement still wins.

To give a node a band on purpose, place things below its text. The band is the same one the contents would have made — title at the top, what was placed beneath it one step below:

```
node q "Deployment"
node q.a "north-west"  below q text  inside q left
node q.b "north-east"  below q text  inside q right
node q.c "south-west"  inside q bottom-left
node q.d "south-east"  inside q bottom-right
```

A text given an `at:` in a node with no band ranges in the room its own row and column leave it — between whatever sits beside, above or below it — not across the whole box, so a `top-right` title stops short of a child in the top-right corner rather than pushing it out.

A child placed against one of its parent's sides stands beside the rest of the box, not above or below it: if it would cover the title or the contents, the box grows across for a left or right side and down for a top or bottom one. `overlap: allow` on the child is the other answer — "I am inside my parent, do not grow for me" — and it lies over whatever is there.

**A child placed `outside` its parent is still part of it.** The parent does not grow for it, but everything that keeps clear of the parent keeps clear of the child too: `right of router` lands beyond the note hanging off Router's right side, not on top of it, and a container holding Router widens to hold the note. An alignment still reads the parent's own box, so `below router` centers under Router and not under Router and its note together.

### Several nodes saying the same thing

```
node hub "hub"
node a "one"    right of hub
node b "two"    right of hub
node c "three"  right of hub
```

Three nodes that say the identical thing are one list, not three boxes on one spot. It runs down the page in the order they were written, and is centered on `hub` as a whole — the balanced picture that "hub points at three things" means, which no chain of placements can draw. The same goes for a part: three children `inside p right` are a column against that edge, and three at `inside p top-right` stack into the corner and grow down. The list runs down the page whatever the direction, so three nodes `below hub` are a column under it.

Only the identical placement makes a list; add `level with x` to one of them and it places itself. `overlap: allow` asks for the literal pile instead.

**A direction and a position are two vocabularies and stay two.** A *direction* is a relation between two nodes and puts this one outside the other, clear of it by a gap: `above-left of hub`. A *position* is a point of one box: `inside hub top-left`. They reach the same corner with different words on purpose, because `above hub` could never become `top of hub` — "the top of the hub" is unambiguously its edge.

## Notes and other bare text

There is no `note` statement. A note is a node with no body:

```
node aside "Written by a nightly cron job." (wrap: 30)  shape: none  below dumps  gap: tight
```

A keyword names a picture, and "note" names a use. The picture is *text with no box*, and that serves plenty of uses which are not asides — a caption on a brace, a title over a diagram. So the keyword went and the picture stayed. An older file writing `note` gets an error quoting the replacement.

Nothing bounds bare text the way a border bounds a node, so a sentence-length one without a `wrap` is drawn as one very long line and will cross whatever is beside it. Give every one a wrap.

`shape: none` starts one step smaller than a node's text, because an aside at the same size reads as a statement. That is a default, not a ceiling: say `(size: …)` and it does what you said.

## Decks

```
deck <name> "<text>" ["<text>" ...]
```

Draws the named container with offset copies behind it, one per text, to say "there are several of these and they are the same." Only the front copy shows its contents.

## Attributes

Every attribute, and what takes one. The kinds here are what a node's **body** is rather than which keyword declared it — every one of the three is written `node`, and each takes a different set.

| attribute | `shape:` | `icon:` | `shape: none` | edge | says |
|---|---|---|---|---|---|
| `style` | ✓ | ✓ | ✓ | ✓ | the named bundle to take appearance from |
| `gap` | ✓ | ✓ | ✓ | | the default distance to whatever it is placed against |
| `overlap` | ✓ | ✓ | ✓ | | `allow`, to opt out of non-overlap |
| `contents` | ✓ | | | | how the children are sized and where the block of them sits, in brackets |
| `badge` | ✓ | | | | the picture beside the text |
| `shape` | ✓ | | ✓ | | the outline the node is drawn with, `none` included |
| `icon` | | ✓ | | | the picture the node is drawn as |
| `from` `to` | | | | ✓ | which side the line leaves and arrives on |
| `fill` | ✓ | | | | color — see "A color names the part it colors" |
| `border` | ✓ | | | | color |
| `text` | ✓ | ✓ | ✓ | ✓ | the text's properties, in brackets — a style's form of what a node or an edge writes after its own words |
| `line` | | | | ✓ | color |
| `url` | ✓ | ✓ | ✓ | ✓ | a destination to open when the thing is clicked |

The `diagram` statement has a vocabulary of its own — `background`, and so far nothing else — which is checked the same way. Writing `background:` on a node is an error that points at `fill:`.

**A word this table does not give the kind is an error.** The two ways of being wrong get different answers, because they have different remedies. A word that is an attribute nowhere is a misspelling, and the error lists what the kind does take. A word that is an attribute *somewhere else* is usually a real statement written on the wrong half of the diagram, so the error says where it belongs:

```
"one" is a node and has from: left. `from:` belongs to an edge — a node takes style, gap, ...
```

Some of the gaps in the table are worth saying out loud, because none of them looks like a mistake while you are writing it. A picture and a bodiless node take no `fill:` or `border:` — there is no outline for either to reach. Neither takes `contents:` either, which says how a node's children sit, and neither may have any. `shape:` and `icon:` each appear only on the kind they make, and writing both is an error naming both. An edge takes no `gap:` or `overlap:` — those say where a node sits, and an edge is not placed, it joins two things that are.

**Changed 2026-09-09.** Until then a node or edge attribute the tool did not recognize was parsed, stored and never read: `wibble: red` on a node drew nothing and said nothing. This was the last place in the language where a key could silently do nothing, and the rule everywhere else — an unknown `diagram` key, an unknown placement modifier, a color naming a part the kind has not got — has always been that a key which silently does nothing looks like the tool being broken rather than like a typo. A file that rendered with a stray word in it will now stop with an error naming it.

## Destinations

```
node docs "Documentation"  url: "https://example.com/docs"
edge docs -> store "read first"  url: "https://example.com/order"
```

`url:` makes the thing clickable in a viewer that follows links — a browser showing the SVG, or a page it is embedded in. The whole thing is the target: a node's box and everything drawn in it, an edge's text. A rasteriser ignores it, so a PNG is unaffected.

**The value is quoted.** Without the quotes everything from the `//` onwards is a comment, so `url: https://example.com` would set the destination to `https:`. The error for the unquoted form says so rather than reporting a missing value.

**Nothing about a destination is visible.** A clickable node looks like any other. Color was considered and dropped: an edge with no text and a node that is nothing but a picture have nothing to color, so it would be a decoration that sometimes applies — and a destination is *content*, while color is appearance, and nothing else in the language lets one reach the other. An author who wants a destination to look like one writes the color themselves.

**A style may not carry one**, for the same reason: a style is a bundle worn by many things, and one `url:` in it would point every one of them at the same place.

**A container's destination reaches its children.** A child that names none of its own is clickable with its container's, and one that names its own overrules it inside its own box — so a container catches every click its children do not.

**An edge with no text is refused one.** The line is a pixel and a half wide, which is a target nobody can hit; a destination that technically works and practically does not is the silent defect this language refuses everywhere else.

## Styles

```
style <name> <attributes>
```

A named bundle of appearance, applied with `style: <name>` on a node or edge. Color carries meaning through the style name rather than being written per node.

```
style backup  border: #d2904e
node server.mirror "shared folder / mirror"  style: backup
```

The appearance attributes are `fill`, `border`, `line`, `text`, `badge`, `icon` and `shape`. The first three each take a color written as the viewer will receive it — `#142814`, or any CSS color, or `none`; `text` takes the bracket described under "The text and its brackets".

### A color names the part it colors

A color attribute says which part of a thing it colors, and a part exists only on the kinds that have one:

| attribute | colors | on |
|---|---|---|
| `fill` | the area inside the outline | a node |
| `border` | the outline | a node |
| `text: (color: …)` | the text | every node, and an edge |
| `line` | the drawn line and its arrowheads | an edge |

A word written on a kind that has no such part is refused by name, and the error lists the parts that kind does have — `border:` on a node with no body is a mistake, not something to ignore, for the same reason an unknown `diagram` key is.

An edge's text takes the line's color unless its own brackets say otherwise, so an edge that means something by being orange means it in its words too, and there is still a way to say the words are not orange.

A style contributes a part only to the kinds that have it, so a style shared between nodes and edges writes one key for each:

```
style backup  border: #d2904e  line: #d2904e
```

The nodes take the border, the edges take the line, and neither sees the other's word. Writing only `border` there would color the nodes and leave the edges plain.

### A style may carry what a thing cannot use

The table under "Attributes" is checked against what you wrote *on the statement*, never against what a style handed it. That is what makes a bundle spanning kinds possible at all: the benchmark's `style synced` carries a fill and a border for five nodes and a `line` for the four edges joining them, and every use of it leaves some of its keys unused. That is the style doing its job, not a mistake, so nothing is said about it.

What is refused is a style that gives a thing **nothing at all**:

```
style boxy  fill: #142814  badge: disk
node n "An aside"  shape: none  style: boxy
```

A node with no body is bare text, with neither a fill nor a badge, so `boxy` dresses it in nothing whatever and the name is on the wrong sort of thing. Partial overlap is the normal case; zero overlap is never anything else. A style that named every attribute in the language would slip through this, since it contributes to everything by construction — nobody writes one by accident, and the hole is left open rather than closed with a rule that would fire on `synced`.

A style's own keys are checked against the whole vocabulary, since a word that is an attribute of nothing is a misspelling wherever it sits. `style s  wibble: red` is an error; a style was the last place one could hide.

**Removed: `stroke`.** It named no part — it meant the border of a node, the *text* of one drawn as a picture or with no body at all, and the line of an edge, whichever the thing happened to have. That is coherent one kind at a time and ambiguous read across them; it meant no ink attribute could ever be *wrong*; and it left one thing with no way to be said at all, the color of the text on an ordinary node. An older file carrying it gets an error naming the word to use instead.

A color is never written in quotes, and a quoted one is refused. There is nothing to check a color *against* — the tool keeps no list of color words, as below — so this is the one thing that can be checked, and it is the mistake that actually gets made: every attribute that takes a color would otherwise accept a quoted string, find it is not a color, and draw nothing without saying so.

There is no list of color words the tool knows. An earlier version had one, and it was wrong in the way such lists always are: `dark-green` existed only because somebody added it to a map in the renderer, and the next color a diagram wanted would have needed a code change to say. Writing the color directly removes both the list and the reason to grow it. `green` still works, because it is a CSS color, not because this tool has heard of it.

A style carrying `text: (color: muted)` is what a marked-up word borrows from, which is how a node carries a name with a quieter qualifier under it:

```
style synced  fill: #142814  border: #486544
style dim     text: (color: muted)
node pc.files "shared folder / [dim]synced[/dim]"  style: synced
```

**Removed: `subtext`.** It colored every text line after the first, which is a positional slice: the rule lived in a style elsewhere in the file and was applied by counting, so a reader of `"shared folder / synced"` could not see that the second line was quiet. The mark says what is quiet where it is quiet, and reaches a word in the middle of a line, which the slice never could. An older file carrying it gets an error naming the mark to write instead.

`badge`, `icon` and `shape` belong in a style for the same reason a color does: they say what kind of thing this is, and a kind wants to look alike everywhere it appears. `style artifact  fill: #460000  shape: document` puts the folded corner on every dump in the diagram, and the use site stays one word.

`muted` is the one reserved word left, and it earns the exception: it means the theme's secondary text color rather than a fixed one, so a quiet line stays readable when the theme changes. Writing `#8b8b8b` instead would pin it to one theme. Say nothing and every line of a text reads alike, which is what most texts want — `Computer 1 / Ubuntu` is two lines of one name, not a name and a qualifier, and the distinction is the author's to make rather than the renderer's to guess.

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

**An icon outside the built-in seven.** The set is closed, and a diagram wanting a picture that is not in it has nowhere to go. The two shapes this could take are a declaration in the file, `icon <name> "<path data>"` beside `style`, and `icon: ./thing.svg` inlined by the tool at render time. Either keeps the output standalone, which is the constraint any answer has to meet.

**A named channel cannot make room for itself.** Lines through a `between` gap too narrow for them crowd together silently, in exactly the way attachments on a too-short side do. An edge with text *does* now open the gap between its own two ends — see "A text makes room for itself" — and it does so by the measure-then-constrain route that region alignments already use, which is the route this wants too. What is missing is the harder case: several edges sharing a channel between two nodes neither of them is an end of, where the room needed is the whole stack of lanes rather than one text.

## Known to be wrong

Not omissions — defects, left here so nobody rediscovers them. Most were found by rendering the benchmark diagram; the last was not, and that is the interesting one, because the benchmark could never have caught it.

~~A placement written after an attribute was an error.~~ Gone entirely in 0.3.0, along with the papercut about how it was reported. `node q "Q"  gap: wide  level with p` is now an ordinary statement. The rule existed only because a bare `gap:` written between two placements could not be told from the node-wide default; [bracketing a gap onto its placement](#a-gap-belongs-to-the-placement) removed that ambiguity and left the ordering rule with nothing to protect.

**A bracketed node sits against one side of any slack.** When two opposing placements leave more room than the node needs — because something else forced the two targets further apart — the node sits against the side it was pushed from rather than centered between them. In practice the tightest arrangement usually leaves no slack, so this rarely shows. Whether it should center instead is not decided.

~~A node placed only with `left of` or `above` drifted to the canvas edge.~~ Fixed. Every constraint reads "this one is at least so far right of that one", so the solve puts each node at the smallest position its constraints allow — right for anything with something behind it, but `left of X` bounds *X* rather than the node that wrote it, leaving such a node nothing to be pushed by. It settled at the edge of the drawing while its target was carried off by the rest of the diagram. A node with nothing behind it now travels until the first of its own placements binds, which is what "as close together as your placements allow" always said.

~~An annotation could not be put beside the rows it was about.~~ Fixed by letting a placement name several targets, which places the node against the region bounding them. The workaround before it was to wrap the targets in an invisible container so there was a single thing to name, which made the author declare a node to stand in for an idea the language could have expressed directly — and cost the container's padding on top.

~~One relation cannot say what a real arrangement needs.~~ Fixed by letting a node carry several placements: it takes its horizontal position from one target and its vertical from another, and two opposing placements put it between two more.

~~The unwritten axis is a silent guess.~~ Fixed. A lone placement's centering is now the documented meaning of the direction rather than a fallback, and the case where it would have to choose between two targets is an error.

~~Two nodes can land on the same pixels in silence.~~ Fixed. Every pair of nodes must now clear the other, and where the file does not order them the tool says so instead of drawing one over the other. Edges are still unchecked.

~~Gaps get used as a fixing hack.~~ Fixed by making every gap a minimum. Room for something is made by saying that something goes there, not by widening a number on an unrelated line.

~~A text cannot contain a slash.~~ Fixed in two parts: the line-break marker now needs whitespace on both sides, so `TCP/IP`, `16/9`, `I/O` and every path and URL survive untouched, and `\/` escapes the marker for a text that wants a spaced slash and no break, such as `Before \/ After`.

That one was found by testing the lexer, not by rendering — and it could not have been found by rendering, because every text in the benchmark happens to use spaces around its separator. Worth knowing that the repository's own second test target is an OSI and **TCP/IP** diagram, so a picture the language was meant to be tested against could not have been written in it. A benchmark only exercises the cases it happens to contain.

~~An edge with text between two nodes at the default gap drew its text across both of them.~~ Fixed. The default gap is sized for nodes to breathe and a text is wider than that, so `edge a -> b "statements"` on two adjacent nodes came out unreadable and nothing said so; the authoring workaround was to name a wider gap on a placement that had no reason to be wider. An edge with text now widens the corridor it crosses by what the text needs. Note what this is *not*: no coordinate, no repair of a solved layout, and nothing that finds a route — the corridor is derived from where the nodes landed and then becomes an ordinary minimum distance like any other.

~~Two edges between the same pair of sides were drawn on top of each other.~~ Fixed. Each side was ordered on its own, by where the far ends sat, and for edges that share both ends that signal says nothing — so the two edges were ordered without reference to each other and the lines converged in the middle instead of nesting. The visible damage was to the texts: both landed at the same point and the second knocked a hole through the first, leaving one word of it. A group like this now takes one lane order used at both ends. See "Several edges between the same two sides".

~~Several edges between the same two nodes with no side named were drawn on top of each other.~~ Fixed. This is the same defect as the one above, one step out: a bundle is a statement about two named sides, and an end with no side named has not made one, so nothing saw the group. `edge a -> b` three times drew one visible line carrying one text. Each such edge now takes its own line, parallel to the one it would have drawn alone and a lane away from it. Note what did *not* change: an unnamed end still attaches where the center-to-center ray crosses the border, so no single edge anywhere moved. See "Several edges with no side named at all".

~~A text's properties sat among the node's.~~ Gone in 0.3.0. `size:`, `wrap:` and the text color `text:` were top-level attributes, sitting beside `fill:` and `shape:` as though how big a text is set were a fact about the node. They are in the brackets after the text now, where the reader can see what they modify, and an older file writing one at the top level gets an error naming the bracket. `at:` came with them and grew from `top | bottom` to the nine named positions, which is the same repair one level down: two of the nine had been handed out because those were the two somebody needed.

~~An unknown attribute was ignored in silence.~~ Fixed. `wibble: red` on a node parsed, was stored, and was never read again — nothing drew and nothing was said. So did every real attribute written on a kind with no use for it: `align:` on a node that may have no children, `gap:` on an edge. This was the same defect the color parts had closed one level down a version earlier, and it is how that migration produced false results from the repository's own regression check, since the older build simply dropped every `border:` it had not heard of. See "Attributes".

~~An edge text ignored the line break.~~ Fixed. ` / ` split a node's text and was never applied to an edge's, so the marker came out as a literal slash on an arrow and the benchmark's two-line captions had to be flattened to one. The measurer had always returned the split lines; the renderer was handing it the raw string and drawing that instead. The block now centers on the point the text already occupied, so a one-line text sits exactly where it did.

## Changelog

Pre-1.0, so the minor number is where a breaking change goes. Every removal below is refused by name with the replacement quoted, rather than dropped in silence — an older file stops with an error saying what to write instead.

**0.3.0** — the vocabulary, reworked in one breaking version so there is one migration rather than five.

- `box` is `node` and `link` is `edge`. The string on either is its *text*; "label" is not a word the language has.
- A node's **body** is `shape: rectangle | document | none` or `icon: <name>`, and writing both is an error naming both. `note` is gone — a note is `node … shape: none`. `shape: instance` is gone — the icon is `cube`, and a node drawn as one is `icon: cube`.
- A node drawn as a picture and given no text of its own shows none. A node with a body still falls back to its name.
- The decoration icon is `badge:`, which freed `icon:` for the body.
- A placement may target a *part* of a node — its text, a side or one of nine named points — with `inside`, `outside` and `on` reading a direction off it.
- Everything a text says about itself is in the brackets after it — `color`, `size`, `wrap`, `align`, `at`. The top-level `size:`, `wrap:`, `align:` and the text color `text:` are gone; a style says them as `text: (…)`. `at:` grew from two positions to the nine.
- `subtext:` is gone, replaced by inline markup `[style]word[/style]`, which names a style and reaches a word anywhere in a text. `\[` escapes a literal bracket.
- `align: widths` is `contents: (widths: match)`, and the same brackets take `align:` for where the block of contents sits.
- `url:` is new: a destination on a node or an edge.
- Attributes and placements may be written in any order after the text.

**0.2.0** — `stroke:` split into the part it colors (`border:`, `line:`, and the text's own color); `width:` became `wrap:`; every attribute is refused by name on a kind that has no use for it, where an unknown one used to be parsed and dropped.

**0.1.0** — first published version.

## Undecided

Open questions the benchmark raised, recorded so a later session does not rediscover them.

- Named gaps are the first step toward numbers, but making them minimums took most of the pressure off: they now set how much a diagram breathes, never whether something fits. Whether four names is the right number is still open.
- Four machines each holding a `files` child with the same text means writing the same line four times. This is the strongest case for a set-level declaration, for terseness rather than for placement.
- The 2×2 arrangement around a hub is four independent statements, so a fifth machine has no slot to reflow into. There are only eight directions.
- ~~Two annotations anchored to the same side of one node will collide.~~ Answered by putting both in an invisible container and placing the container, so they stack instead of stacking on top of each other. Writing it the colliding way is now an error rather than a bad picture, since nothing in the file orders the two. Whether the container idiom is good enough or wants dedicated syntax is open.
- Nothing yet expresses one node spanning several rows of a parallel column, which the OSI reference render needs.
- ~~How contents sit inside a container that is wider than they are.~~ Answered by `contents: (widths: …, align: …)` — see "How the contents sit". Automatic centering stays ruled out: it would move every existing diagram whose container title is wider than its contents. Whether this is the same question as the bracketed node sitting against one side of its slack, under "Known to be wrong", is still open — they share the phrase and not the mechanism, since one distributes to a group at size time and the other is a single member in a constraint system.
