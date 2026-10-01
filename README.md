# TennisCoach.AI

A local-first React/TypeScript POC that analyzes a short uploaded tennis video
in the browser. It runs a learned pose model against the selected file, draws a
time-aligned body skeleton over the real video, and presents conservative
movement observations linked to visible pose evidence.

## Current capabilities

- **Real local upload:** MP4, MOV, or WebM clips up to 30 seconds and 200 MB are
  opened through a temporary browser object URL. The selected video is not sent
  to an application server.
- **Learned pose inference:** MediaPipe Tasks Vision 1.0.1 runs the official
  Pose Landmarker Lite float16/v1 bundle with GPU-first and CPU-fallback
  execution.
- **Immediate progressive review:** source playback becomes available as soon
  as metadata loads and remains independent of analysis. Pose and ball are
  separate run-scoped jobs with queued/loading/running/ready/unavailable/
  failed/cancelled state, independent progress, cancellation, and retry.
- **Isolated media:** the visible player is never sought by inference. Pose
  extraction and annotated export each use their own hidden video element.
- **Progressive pose evidence:** MediaPipe batches are published during
  extraction; final player tracking, segmentation, and coaching remain a
  finalization step.
- **Conservative sampling:** uploaded clips are sampled at up to 6 Hz with a
  180-frame cap; speed magnitude remains withheld below 30 Hz and observations
  abstain below 6 Hz.
- **Synchronized replay:** normalized pose landmarks are aligned to the
  intrinsic video aspect ratio and selected by source-media timestamp.
- **Exact-match precomputed ball evidence:** after the upload has been hashed,
  the site may load a versioned same-origin manifest and a SHA-256-verified JSON
  track only when the full source hash, byte length, duration, and geometry
  match. Unknown videos remain pose-only.
- **Observed-only ball visualization:** accepted BallTrack observations are
  drawn as a green marker with a short raw-observation trail. Ambiguous and
  abstained frames render no coordinate and reset the trail. There is no
  interpolation. Repeated browser presentation callbacks for the same ball
  observation retain the existing trail, and progressive/final updates for the
  same source continue one trail instead of resetting it.
- **Live overlay styling:** the review-page gear opens accessible sliders for
  ball marker scale, ball trail width and point count, body line width, and body
  joint size. Defaults preserve the thin cyan pose and compact green observed
  ball style. The same settings object drives onscreen and WebM rendering.
- **Editable coaching preference:** the same settings panel exposes the current
  coaching instruction in a multiline field. `Rerun coaching analysis` reuses
  existing pose, ball, and shot-segmentation evidence; it does not rerun
  MediaPipe or BallTrack. Reset restores the repository default. The preference
  is locally persisted under a versioned browser key and is included only as a
  clearly delimited, untrusted section of the server-owned evidence prompt.
- **Optional private/local ball provider:** unknown videos can be sent only to
  an explicitly configured same-origin or loopback endpoint. The public build
  has no endpoint and fails closed as unavailable. The unresolved RacketVision
  checkpoint is not included, downloaded, or redistributed.
- **Combined WebM export:** enabled overlays are rendered at source dimensions
  by the same composite renderer used onscreen. Current Chrome/Edge can combine
  the canvas video with source audio exposed by media capture/Web Audio. Export
  uses a separate hidden video, reports progress, and never claims MP4 support.
  Coaching/evidence warning banners are not burned into the video.
- **Shot navigation when both signals exist:** pose-derived movement segments
  that overlap a direct observed ball coordinate appear as clickable ranges on
  the video timeline and as a compact shot list below the replay. Provisional
  boundaries remain visibly marked for review and do not become contact or
  stroke-classification claims. Shot ranges use the same selected player shown
  by the pose overlay and require observed ball evidence inside that player’s
  active onset-to-offset movement window. Overlapping provisional fallback
  windows are consolidated so follow-through/recovery peaks do not become
  duplicate navigation entries.
- **Opt-in Azure segment insight POC:** selecting a shot builds a six-frame,
  timestamped contact sheet locally and reveals its insight. Once pose and ball
  processing finish, these contact sheets are generated and sent sequentially
  in the background so later clicks usually reuse a ready in-memory result. The
  same-origin development API calls the existing `gpt-4o-mini` deployment,
  validates timestamps, and blocks unsupported claims before returning visual
  facts. The full video is never sent. Production hosting still requires an
  authenticated server-side implementation of `/api/shot-insight`; Azure
  credentials must never be placed in the browser bundle.
  Grounded visual facts remain distinct from one conservative coaching focus,
  actionable cue, and drill with repetitions and a visible success check.
  Evidence timestamps seek and pause the replay for direct visual inspection.
  The editable preference cannot remove the server-owned JSON schema, exact
  timestamps, evidence/abstention rules, safety constraints, or forbidden
  claims. Insight cache identity includes the prompt version and hash.

For the local hack demo, copy `.env.example` to `.env.local` and set
`AZURE_OPENAI_API_KEY`. Vite reads this value only in its Node middleware; do
not prefix it with `VITE_`, which would expose it to browser code. If the key is
absent, the middleware falls back to the authenticated Azure CLI token.

### Private/local ball provider

Set `VITE_LOCAL_BALL_PROVIDER_URL` to a loopback endpoint, for example:

```powershell
$env:VITE_LOCAL_BALL_PROVIDER_URL = "http://127.0.0.1:8765/track"
npm run dev
```

The app posts `multipart/form-data` with `video`, `runId`, and `sourceSha256`.
The provider must return `application/x-ndjson`. The shape below is abbreviated;
the final `result` must be a complete valid `BallTrackingResult`:

```text
{"type":"progress","progress":{"stage":"observation","processedFrames":12,"estimatedTotalFrames":300,"latestObservations":[],"latestInpaintedPoints":[]}}
{"type":"result","result":<complete BallTrackingResult JSON>}
```

The final payload must satisfy `BallTrackingResult`, match the active run,
duration, and geometry, and express observed centers in intrinsic source pixels.
Progressive observations are validated before display. Run a private provider
with a checkpoint you are authorized to use; this repository intentionally
contains no RacketVision checkpoint or installer.
- **Evidence-linked feedback:** visible image-plane posture and movement
  observations include evidence, reliability, and explicit abstention.
- **Automatic primary player:** the most stable/near player track is selected
  for the full analysis. Secondary or stray pose detections are ignored and
  cannot change shot navigation.
- **Derived-only cache:** complete pose artifacts may be reused from local
  IndexedDB. Source video bytes, object URLs, decoded frames, and pixel buffers
  are not persisted.
- **Failure-safe playback:** decode, model, pose, ball-provider, tracking,
  segmentation, or cache failures do not remove the ordinary uploaded-video
  player or cancel the other analysis stage.

## Model and provenance

| Item | Value |
|---|---|
| Runtime | `@mediapipe/tasks-vision` 1.0.1 |
| Runtime license | Apache-2.0 |
| Model | Google MediaPipe Pose Landmarker Lite, float16 bundle version 1 |
| Model family | BlazePose GHUM |
| Model artifact | Versioned same-origin copy of the official Google bundle |
| Model size | About 5.8 MB |
| Integrity | SHA-256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| Delivery | Exact-version jsDelivr WASM plus a self-hosted verified model artifact |
| Third-party terms | [Apache License 2.0](public/models/LICENSE-APACHE-2.0.txt) and [MediaPipe attribution](public/models/ATTRIBUTION.md) |

The first analysis downloads the exact MediaPipe WASM runtime from jsDelivr if
it is not already in the browser HTTP cache. The model is served by the same
TennisCoach.AI origin and is cryptographically verified before initialization.
Neither request includes the selected video or derived landmarks. Public
MediaPipe documentation does not disclose a complete inventory of the model's
training data. This general pose model is not validated as a tennis stroke
classifier or certified coaching system.

## Setup

Requirements: Node.js 20+ and a current Chrome or Edge desktop browser.

```powershell
npm ci
npm run dev
```

Open the local URL printed by Vite and upload a short, rights-cleared tennis
clip. Keep the full player visible for the most useful result.

## Validate

```powershell
npm run validate
```

This runs ESLint, TypeScript checks, Vitest, the production build, and the
static smoke check.

## Evidence boundary

The POC may describe visible 2D stance width, joint-angle changes,
shoulder-line orientation, pelvis projection within the visible ankle span,
and hand-path movement when landmark and sampling gates pass.

It does **not** establish:

- public/default ball inference for unknown uploads;
- physical racket-ball contact or impact time;
- early/on-time/late timing relative to impact;
- validated forehand, backhand, or serve identity;
- ball speed, spin, trajectory, or racket-face angle;
- true depth, force, torque, joint loading, center of mass, or weight transfer;
- technique correctness, diagnosis, injury risk, or medical guidance.

Automatic movement ranges are review aids. Low-quality or provisional evidence
is shown as unavailable instead of being converted into a prepared result.

## Privacy

- Video processing occurs in the browser.
- The selected video bytes are hashed and decoded locally. If and only if the
  user configures `VITE_LOCAL_BALL_PROVIDER_URL`, the source file is posted to
  that same-origin/loopback private endpoint for ball inference.
- The app may request a small same-origin precomputed-ball manifest and, for an
  exact known content hash only, its declared JSON track. The track bytes are
  verified against the manifest before use.
- No default application backend, account, telemetry upload, or automatic media
  export is used.
- The source file remains a temporary `blob:` URL and is revoked on replacement
  or exit.
- Model/runtime files may be downloaded on first use.
- The model file is served from the TennisCoach.AI origin and verified by
  SHA-256; the exact MediaPipe WASM runtime is currently loaded from jsDelivr.
- Validated derived pose JSON may be stored in this browser until the user
  clears the local analysis cache from settings.
- The coaching preference is stored only in browser `localStorage` under a
  versioned key. It has no backend persistence or telemetry. Reset removes the
  stored value. When coaching is requested, the text accompanies the derived
  six-frame contact sheet to the same-origin insight API; it never affects pose,
  ball tracking, deterministic overlays, or WebM export.
- Verified ball-track JSON may be retained in a separate in-memory cache whose
  revision includes the manifest, provider, config, and track digest; it does
  not invalidate or replace pose cache entries.
- Export is explicit, in-memory, WebM-only, and releases object URLs, media
  streams, tracks, and audio nodes after completion or cancellation.

## License

No open-source license has been granted for this repository. Public visibility
does not grant permission to copy, modify, redistribute, or reuse its contents.
Third-party dependencies and model artifacts remain subject to their own
licenses and notices. The redistributed MediaPipe model and runtime are covered
by the included [Apache License 2.0 text](public/models/LICENSE-APACHE-2.0.txt)
and [upstream attribution record](public/models/ATTRIBUTION.md).

See [product and architecture decisions](docs/product-architecture-decisions.md)
and the [QA strategy](docs/test-strategy.md) for the detailed evidence,
abstention, and cache design.
