# GPTMD System Explorer

A read-only, local architecture explainer for GPTMD. It starts with the current
learner journey, lets a reader open setup, conversation, storage, sign-in, and
review details, and can animate the direction of the visit flow.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The app binds to loopback only and does not
connect to GPTMD services or use application credentials.

## View controls

- Select a stage to update the explanation panel.
- Use **Open this part in detail** or double click a stage to inspect its
  sequence. Use **Whole visit** to return to the complete map.
- **Play the visit**, **Previous**, and **Next step** follow the request path.
- Drag the canvas, scroll to zoom, or use the on-canvas controls and minimap.
- **Reduce animation** disables moving edge strokes. The initial setting follows
  the operating system's reduced-motion preference.

## Status rule

Green means implemented in the current app; amber means a live provider step
still needs verification; gray means planned. These labels describe the
repository state summarized in `docs/plangpt-modernization-checklist.md` as of
2026-10-05. They are an explanatory view, not runtime monitoring.

## Package choice

The map uses Vue Flow (`@vue-flow/core`) because GPTMD already uses Vue 3 and the
library supplies pan/zoom, custom nodes and edges, nested graphs, minimap, and
animated edges. The explorer uses fixed positions and disabled editing so the
reader sees a guided explanation rather than an architecture editor.
