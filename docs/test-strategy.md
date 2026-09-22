# QA strategy and acceptance matrix

## Primary risks

Privacy leakage, unsupported coaching claims, timestamp poisoning across videos, player-track swaps, segmentation removing playback, provisional evidence leaking into final observations, nondeterministic chapter IDs, browser export failures, and unusable latency.

## Automated acceptance

| Criterion | Evidence |
|---|---|
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
| Sampling below 30 Hz abstains from peak-dependent descriptors and automatic stroke hypotheses. | `src\analysis\heuristicAnalyzer.test.ts` |
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

The public source release requires lint, TypeScript, Vitest, production build, and static smoke checks. Private media, sample datasets, generated browser evidence, and evidence-only tests are not shipped. Maintainers may run rights-cleared real-browser evaluation locally, but those artifacts are outside the public release manifest. Chrome desktop is verified; Edge is the compatible target. Safari/Firefox export varies by canvas capture, MediaRecorder, and codec support.

Known blockers for production:

- Offline extraction uses repeated HTML-video seeks and synchronous MediaPipe calls; it is slow. Chapter estimates now publish in batches, but inference is not yet moved to a dedicated worker or a formally bounded scheduler.
- Pose inference is not worker-backed; cache publication is cancellation-safe, but MediaPipe execution itself remains synchronous and page-lifetime-bound.
- Chapter boundaries and stroke family hypotheses are not coach-labelled or calibrated.
- Ball, racket, court calibration, metric depth, and true contact remain absent.
- Device/browser/FPS matrix and five-user comprehension study remain outstanding.
