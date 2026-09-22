# AI Tennis Coach POC

A Phase 0, local-first React/TypeScript proof of concept for a tennis video
review experience. This code-only release contains the hack-demo interface and
the underlying browser analysis modules, but intentionally ships no video,
dataset, generated result, model weight, or research artifact.

## Current capabilities

- **Upload-only demo:** choosing a local file starts an exact four-second
  presentation state and then opens a prepared-result screen.
- **Code-only result:** the result area clearly states that the demonstration
  video asset is not included in this source release; it does not display,
  retain, or upload the selected file.
- **Prepared UI cues:** sample coaching-card presentation is included as static
  interface content only, not as output derived from the selected video.
- **Analysis foundation:** deterministic pose, tracking, segmentation, cache,
  and evidence-boundary modules remain in source for continued development and
  testing, but are not invoked by the code-only hack-demo screen.

## Setup

Requirements: Node.js 20+ and a current Chrome or Edge desktop browser.

```powershell
npm ci
npm run dev
```

Open the local URL printed by Vite. Any selected file remains local and is used
only to advance the demonstration interface.

## Validate

```powershell
npm run validate
```

This runs ESLint, TypeScript checks, Vitest, the production build, and a static
smoke check.

## Safety and uncertainty boundary

This POC is an evidence reviewer, not a certified coach, medical device, or
injury-prevention system. It does **not** establish racket-ball contact,
early/on-time/late timing, ball speed or spin, force, true weight transfer,
racket-face angle, diagnosis, injury risk, or technique correctness.
Categorical evidence bands are not probabilities or grades. Automatic stroke
families and chapter boundaries are unverified hypotheses and may abstain.
Users should stop activity and seek qualified help for pain, numbness,
dizziness, instability, or medical concerns.

## Ball research boundary

The UI contains a fail-closed, model-neutral provider template, but no ball
model, checkpoint, executable provider, trajectory inference, or contact
detector is shipped or enabled. Ball-tracking experiments and candidate assets
remain quarantined research-only work until licensing, redistribution,
validation, and product gates are satisfied.

## Public release contents

This first public release intentionally excludes:

- all private source videos and derived screenshots, evaluations, annotations,
  provenance, and exports;
- all sample videos, datasets, CSV annotations, and generated evidence;
- model weights, checkpoints, research experiments, and quarantined artifacts;
- local caches, logs, browser profiles, build outputs, and dependency folders;
- internal hackathon and SharePoint material.

The source retains a catalog schema and rights metadata used by local
maintainers, but its referenced media is not included. Supply only
rights-cleared media locally. Research/evaluation assets are not part of this
distribution.

## Privacy

There is no application backend, account, telemetry upload, or automatic media
export. The code-only demo does not create an object URL for the selected file
or persist its contents.

## License

No open-source license has been granted for this repository. Public visibility
does not grant permission to copy, modify, redistribute, or reuse the code or
other contents. Third-party dependencies remain subject to their own licenses.

See [product and architecture decisions](docs/product-architecture-decisions.md)
and the [QA strategy](docs/test-strategy.md) for the detailed evidence and
abstention design.
