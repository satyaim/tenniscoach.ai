# Precomputed quarantined ball tracks

`public/ball-tracks/manifest.v1.json` indexes fixed demo-source tracks by the
full SHA-256 digest of the source video bytes. The stable
`public/ball-tracks/manifest.json` path is a byte-identical UTF-8 copy,
including the trailing line feed; validation rejects drift between them. Each
available source has one compact track file named by that digest. Coordinates
use intrinsic source pixels with a top-left origin and are synchronized by
source frame index and the declared source FPS.

These are frozen, quarantined RacketVision BallTrack research outputs for the
listed source hashes. They are not a general uploaded-video inference feature,
an accuracy claim, a contact or bounce detector, a timing or tactics signal,
or approval of the checkpoint for production. Source-media, checkpoint,
annotation, and training-media rights remain unresolved. No source media,
rendered media, model files, absolute paths, or private source names are
included.

This v1 bundle contains exactly three previously completed and identity-verified
tracks: one fixed back-view demo and two neutrally labeled local portrait demos.
The other nine inventoried back-view sources are not included in this bundle;
their additional learned runs were intentionally stopped and no unavailable
placeholder entries or synthetic data were added.

Frame states are intentionally narrow:

- `observed` contains a direct learned localization and may include the model's
  component radius and raw, uncalibrated heatmap/component evidence.
- `ambiguous` preserves candidate-count and raw score evidence when emitted,
  but never contains an accepted coordinate.
- `abstained` contains no coordinate and makes no absent/occluded claim.

No interpolation, smoothing, trajectory repair, heuristic core detection, or
hardcoded contact logic is represented. A later renderer may derive a marker
radius from the emitted component radius and may build an observed-only tail,
but those visualization rules must not alter this source evidence.

Run the committed structural and digest validator with:

```powershell
npm run test:ball-tracks
```

For a local source-byte audit, add `--source-map` with the private three-entry
mapping used to build the bundle. To prove deterministic reconstruction from
the frozen result receipts, run `scripts/build-ball-tracks.mjs` with the same
private mapping and `--check`. Private maps and learned runtime artifacts must
remain outside the repository.
