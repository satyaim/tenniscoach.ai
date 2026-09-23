# QA strategy and acceptance matrix

## Primary risks

Privacy leakage, unsupported coaching claims, timestamp poisoning across videos, player-track swaps, segmentation removing playback, provisional evidence leaking into final observations, nondeterministic chapter IDs, browser export failures, and unusable latency.

## Automated acceptance

| Criterion | Evidence |
|---|---|
| Upload creates a real object URL and the actual source video replaces the prepared code-only placeholder. | `src\App.test.tsx` |
| The upload → analyzing → analysis-ready journey is driven by the real pipeline rather than an exact timer. | `src\App.test.tsx` |
| Inference failure retains normal source playback and exposes retry/new-upload actions. | `src\App.test.tsx` |
| Automatic stroke identity remains unavailable in the uploaded-video POC. | `src\analysis\heuristicAnalyzer.test.ts` |
| The movement segmenter supports handedness-neutral internal detection. | `src\analysis\strokeSegmenter.test.ts` |
| Handedness remains unknown; unstable active-wrist evidence abstains. | `src\analysis\heuristicAnalyzer.test.ts` |
| Ambiguous multiple tracks require explicit selection and publish no observations. | `src\analysis\videoAnalysisPipeline.test.ts`, `src\App.test.tsx` |
| Source hashing, model loading, and repeated seeks honor cancellation; a late landmarker is closed. | `src\analysis\analysisCache.test.ts`, `src\analysis\poseExtractor.test.ts` |
| The self-hosted model is source-controlled, copied into the build, and SHA-256 verified; required license/attribution files ship with it; GPU initialization falls back to CPU. | `scripts\smoke.mjs`, `src\analysis\poseExtractor.test.ts`, `scripts\browser-pose-validation.mjs` |
| Stale pose frames are suppressed and portrait/landscape contain geometry preserves source aspect. | `src\analysis\overlayModel.test.ts`, `src\analysis\videoGeometry.test.ts` |
| Result playback advances overlay selection on every presented video frame, with `timeupdate` and `seeked` retained as browser fallbacks. | `src\components\PoseViewer.test.tsx` |
| Conservative image-plane observations may remain available at 6 Hz while speed magnitude is withheld below 30 Hz. | `src\analysis\heuristicAnalyzer.test.ts` |
| Camera denial is recoverable and demo/upload remain available. | `src\App.test.tsx` |
| Upload type/size and corrupt/short/no-person cases fail explicitly. | App/analyzer tests |
| Offline clips and live camera never share a MediaPipe timestamp graph. | pose adapter design plus sequential real-browser smoke |
| Two tracked players require one session-level confirmation and allow manual override. | `src\analysis\playerTracker.test.ts`, `src\App.test.tsx` |
| Causal segmenter does not scan future active samples. | state-machine implementation and deterministic segment tests |
| Every clean segment has context, valid pre/post samples, duration, pose, scale, and sampling gates. | `src\analysis\strokeSegmenter.test.ts` |
| Failed finalization never removes playback. | still-motion/provisional unit and component regressions |
| Provisional chapters show Review needed and produce no descriptors, drill, timing, or contact claim. | analyzer/App tests |
| All finalized chapters are analyzed automatically exactly once with deterministic IDs. | multi-chapter App/segmenter tests |
| One replay contains chapter ranges, possible-movement markers, scrub, previous/next, and active selection. | App/overlay tests and browser evidence |
| Manual add/move marker retains `user-adjusted` provenance and remains provisional. | UI implementation; browser exploratory check |
| WebM export is explicit and unsupported APIs fail honestly. | overlay capability and App tests |
| Sampling below 6 Hz abstains from movement descriptors; speed magnitude remains withheld below 30 Hz and automatic stroke hypotheses stay disabled in upload analysis. | `src\analysis\heuristicAnalyzer.test.ts` |
| Progressive batch sizes converge to deterministic chapter IDs and later movements do not mutate finalized chapter data. | `src\analysis\strokeSegmenter.test.ts` |
| Provider metadata cannot activate ball inference without eligible lifecycle, cleared rights, explicit product enablement, availability, and an executable binding. | `src\analysis\providerRegistry.test.ts` |
| Cache keys change on source/model ID/model version/runtime ID/runtime version/checkpoint/config/contract/decoder/dependency changes while independent pose keys survive ball-model switches. | `src\analysis\analysisCache.test.ts` |
| Cancelled, partial, stale, incompatible, payload-hash-tampered, or artifact-hash-tampered cache artifacts are never reused as complete output. | `src\analysis\analysisCache.test.ts` |
| Real IndexedDB transactions reject uncloneable writes, post-commit cancellation removes the exact artifact, and clear/write races cannot republish stale data. | `src\analysis\analysisCache.test.ts` |
| Persistent cache privacy guards reject nested media objects, pixel buffers, and `blob:` URLs. | `src\analysis\analysisCache.test.ts` |
| Cache quota/write failures do not hide source playback or block normal pose/chapter results. | `src\App.test.tsx` |
| User cancellation stops post-session processing while preserving the current source-video playback URL. | `src\App.test.tsx` |
| Ball selector exposes unavailable and rights-blocked states without success-shaped fallback. | `src\App.test.tsx` |

## Current release boundary

The public source release requires lint, TypeScript, Vitest, production build, and static smoke checks. Private media, sample datasets, generated browser evidence, and evidence-only tests are not shipped. Maintainers run rights-cleared real-browser evaluation locally; those source clips and results remain outside the public release manifest. Chrome desktop is the primary POC target and Edge is the compatible target. Safari/Firefox and codec combinations remain best-effort until measured.

The smoke gate checks that the exact model path is in Git when repository
metadata is available, then verifies the source and built copies against the
declared 5,777,746-byte size and SHA-256. It also requires the Apache-2.0
license and MediaPipe attribution files in the production build. The separate
clean release-validation procedure creates an export from the Git index so
machine-local ignored files cannot satisfy the build and browser gates.

`scripts\browser-pose-validation.mjs` runs the actual model in installed Chrome and Edge on port 5174, leaving 5173 untouched. It accepts external rights-cleared landscape and portrait clip paths and covers first-run model load/inference, cache miss/hit, repeated seek, immediate cancellation, cancellation during sampled seeking, forced CPU execution plus unit-tested GPU fallback, portrait/landscape geometry, decode-failure playback, and object-URL replacement cleanup. The clips remain outside the repository.

Known blockers for production:

- Offline extraction uses repeated HTML-video seeks and synchronous MediaPipe calls. It yields every six samples and publishes progress batches, but inference is not yet moved to a dedicated worker or a formally bounded scheduler.
- Pose inference is not worker-backed; cache publication is cancellation-safe, but MediaPipe execution itself remains synchronous and page-lifetime-bound.
- Chapter boundaries and stroke family hypotheses are not coach-labelled or calibrated.
- Ball, racket, court calibration, metric depth, and true contact remain absent.
- Device/browser/FPS matrix and five-user comprehension study remain outstanding.
