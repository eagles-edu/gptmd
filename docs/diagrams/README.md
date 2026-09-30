# Architecture diagrams

Use D2 source files in this directory for version-controlled diagrams. D2 is
the independent diagram-as-code package used here; generated SVGs stay under
`docs/` so they can be linked from Markdown and opened without a renderer.

```bash
npm run diagrams:build
npm run diagrams:check
```

`diagrams:build` renders each `*.d2` source to a same-named SVG in `docs/`.
`diagrams:check` renders in memory and fails if a checked-in SVG is missing or
out of date. Keep the source model and generated image in the same change.

The source describes GPTpatient's clean-slate target architecture. It is a
proposal, not a description of the currently implemented service runtime.
