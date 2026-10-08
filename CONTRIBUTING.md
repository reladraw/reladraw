# Contributing to reladraw

Thanks for looking. The most useful thing you can send is not code — it is a
diagram you tried to write and could not.

## What is most wanted

**Diagrams that the language cannot express.** This is the highest-value
contribution by a wide margin. reladraw is built on the claim that you can state
an arrangement in the terms a person would use out loud and get that arrangement
back. Every gap in that claim so far has been found by pushing a real diagram
through it, and each one produced a language change rather than a code fix. If
you sketched something and could not say it in `.reladraw`, open an issue with the
sketch and what you tried. That is a finding, not a support request.

**Bugs, with a reproduction.** The smallest `.reladraw` file that shows the problem,
the command you ran, and what you expected instead. Rendered output helps but
the source file is what matters.

**Feature requests.** Say what you were trying to draw. A request framed as a
diagram you wanted is far easier to act on than one framed as a syntax proposal,
because the syntax is the part I can work out and the need is the part I cannot.

**Questions about the design.** If something in [README.md](README.md) or
[SYNTAX.md](SYNTAX.md) is unconvincing or unclear, that is worth an issue too.

Open all of these as [GitHub issues](https://github.com/reladraw/reladraw/issues).

## Pull requests

reladraw does not accept pull requests. Pull requests will be closed without review.

This isn't about the quality of anyone's code. The language is still being designed, I want that design to stay in one head, and the code underneath changes too quickly for an outside patch to keep up. The problem you hit is the valuable part: open an issue describing what you were trying to draw, and I'll take it from there.

## Getting the code running

```
npm install
npm run build
node dist/cli.js examples/arch.reladraw -o out.svg
```

No runtime dependencies; TypeScript and Node 18+ are all that is needed.
