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

## About pull requests

Please open an issue before writing a patch.

Pull requests are read, and I am grateful for them, but they are not being
merged right now. This is not a closed-to-outsiders project and the reason is
narrow. Under Apache-2.0, a contribution arrives licensed on the same terms as
everything else here — you keep your copyright, and I would never ask you to
sign it away. But that also means the project's license could then only ever
stay Apache-2.0, and I am not yet ready to close off dual-licensing. A
license-grant CLA is the normal way to keep that open, and there is not one yet
because there has been nobody to sign it.

So if you have written something you want in, say so in the issue. When there is
code that genuinely belongs in the project, that is when a license-grant CLA gets
set up — and that is a good problem to have, not a rejection.

In the meantime: the problem you hit is more valuable to this project than the
patch that fixes it. A clear issue describing what broke will usually get the fix
in faster than a PR would.

## Getting the code running

```
npm install
npm run build
node dist/cli.js examples/arch.reladraw -o out.svg
```

No runtime dependencies; TypeScript and Node 18+ are all that is needed.
