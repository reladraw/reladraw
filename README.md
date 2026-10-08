# reladraw

reladraw is a text language for diagrams where you say where things go.

**[Try it in your browser →](https://reladraw.github.io/reladraw/)**

I wanted to be able to create custom, expressive diagrams where I decided how to arrange the diagram, but without the inefficiency of manually drawing in draw.io. For example, this is a diagram drawn in draw.io:

![Hand-drawn reference diagram](https://raw.githubusercontent.com/reladraw/reladraw/main/examples/reference/arch.png)

This is the same diagram, but written in reladraw ([`examples/arch.reladraw`](examples/arch.reladraw)).

![reference diagram via reladraw](https://raw.githubusercontent.com/reladraw/reladraw/main/docs/arch-render.png)

## Why not Mermaid or draw.io?

Mermaid, Graphviz and D2 let you declare boxes and connections, then determine positions for you. If you have a particular picture in mind, these aren't the right tool.

On the other hand, tools like draw.io or Excalidraw allow absolute placement, but that means much more effort, whether for humans clicking and dragging nodes around or agents recalculating coordinates and editing verbose XML source code files.

![The two ends of the spectrum, with reladraw between them](https://raw.githubusercontent.com/reladraw/reladraw/main/docs/gap.png)

reladraw sits between those two extremes, aiming to have the benefits of a diagram language, like Mermaid, but also having the expressiveness and custom placement that you can get with draw.io. Positions are relative, so you don't have to manually pick coordinates. For example:

```
node app "Web app"
node app.ui  "Interface"
node app.api "API"  below app.ui

node store "Database"  right of app  level with app

edge app.api -> store  "queries"  from: right  to: left
```

See also [SYNTAX.md](SYNTAX.md) and [examples/](examples/).

## Install

```
npm install -g reladraw
reladraw diagram.reladraw -o diagram.svg
```

Or from a clone, which also gets you the examples:

```
npm install && npm run build
node dist/cli.js examples/arch.reladraw -o out.svg
```

## In a web page

Load one script, then write diagrams straight into the page:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/reladraw/dist/element.js"></script>

<reladraw-diagram>
  node a "Parser"
  node b "Renderer" right of a
  edge a -> b
</reladraw-diagram>
```

Each `<reladraw-diagram>` is replaced by its SVG. Indent the source however suits the page, since the indentation its lines share is taken off. Add `theme="light"` (or any other theme) to change the colors. A mistake is shown where the diagram would have been, with its line number counted from the first line of the diagram. The page's HTML is read first, so a `<` followed by a letter inside a text has to be written `&lt;`.

## Using it with an agent

To install a skill to let your agent know how to use reladraw:

```
npx skills add reladraw/reladraw -g
```

That installs it for every agent you use (Claude Code, Codex, Cursor, Copilot and others), each in its own skills directory. Leave off `-g` to install it into the current project only. To install it for just one agent, name it with `-a`:

```
npx skills add reladraw/reladraw -g -a claude-code
```

That gets you a copy of the skill at the time you run it, so you'll need to re-run that command to get the latest skill when there is a new release.

## Status

Version 0.16.0. Early stage, but works. The parser, layout engine, and SVG renderer are written in TypeScript, with zero runtime dependencies. There is a command-line tool that turns a .reladraw text file into an SVG, and an element that does the same inside a web page.

The language isn't stable yet, so expect the syntax to change.

## License

Apache-2.0. See [LICENSE](LICENSE). The license covers the code, not the name. It grants no rights to "reladraw", the project logo or the project's other marks. See [NOTICE](NOTICE).

## Contributing

Issues are welcome. Particularly helpful is a diagram you could not represent in reladraw. Pull requests are not accepted; please open an issue instead. See [CONTRIBUTING.md](CONTRIBUTING.md).
