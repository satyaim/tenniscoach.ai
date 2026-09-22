import type { Handedness, StrokeType } from './analysis/types'

export type DemoExpectation = 'analyze' | 'reject' | 'unverified'

export interface DemoClip {
  catalogGroup: 'guided-fixture' | 'evaluation-lab'
  id: string
  title: string
  description: string
  asset: string
  creator: string
  sourceUrl: string
  directUrl: string
  licenseName: string
  licenseUrl: string
  viewpoint: string
  expectedStroke: Exclude<StrokeType, 'auto'> | 'unclear'
  expectation: DemoExpectation
  expectedError?: 'MULTIPLE_PEOPLE' | 'NO_PERSON' | 'LOW_VISIBILITY'
  handedness: Handedness
  selectedStroke: StrokeType
  analysisWindow?: { start: number; end: number }
  sourceFps: number
  sourceResolution: string
  cameraMotion: 'fixed' | 'moving'
  cuts: 'none' | 'present'
  preparation: string
  testerNote: string
  fileBytes?: number
  sha256?: string
}

const licensedRegressionClips: DemoClip[] = [
  {
    catalogGroup: 'guided-fixture',
    id: 'backhand-indoor',
    title: 'Pre-trimmed backhand regression fixture',
    description: 'Adult player, fixed landscape camera, clear full-body two-handed swing.',
    asset: '/samples/pexels-backhand-5740603.mp4',
    creator: 'cottonbro studio',
    sourceUrl: 'https://www.pexels.com/video/a-man-playing-tennis-5740603/',
    directUrl: 'https://videos.pexels.com/video-files/5740603/5740603-uhd_2732_1440_25fps.mp4',
    licenseName: 'Pexels License',
    licenseUrl: 'https://www.pexels.com/license/',
    viewpoint: 'Fixed landscape, front/side-oblique, full body',
    expectedStroke: 'backhand',
    expectation: 'analyze',
    handedness: 'right',
    selectedStroke: 'auto',
    analysisWindow: { start: 3.8, end: 7.8 },
    sourceFps: 25,
    sourceResolution: '2732x1440',
    cameraMotion: 'fixed',
    cuts: 'none',
    preparation: 'Pre-trimmed regression window: original 4K/25 fps source retained; analyzer samples 3.8-7.8 s. This is not full-video chapter evidence.',
    testerNote: 'Primary adult single-player regression clip.',
  },
  {
    catalogGroup: 'guided-fixture',
    id: 'forehand-outdoor',
    title: 'Guided pre-trimmed forehand fixture',
    description: 'Youth player, fixed landscape camera, full-body forehand finish.',
    asset: '/samples/pexels-forehand-11154706.mp4',
    creator: 'Riaj Sohel',
    sourceUrl: 'https://www.pexels.com/video/a-teenage-girl-practising-tennis-11154706/',
    directUrl: 'https://videos.pexels.com/video-files/11154706/11154706-hd_1920_1080_25fps.mp4',
    licenseName: 'Pexels License',
    licenseUrl: 'https://www.pexels.com/license/',
    viewpoint: 'Fixed landscape, front/side-oblique, full body',
    expectedStroke: 'forehand',
    expectation: 'analyze',
    handedness: 'right',
    selectedStroke: 'forehand',
    analysisWindow: { start: 0.2, end: 4.5 },
    sourceFps: 25,
    sourceResolution: '1920x1080',
    cameraMotion: 'fixed',
    cuts: 'none',
    preparation: 'Pre-trimmed regression window: original 1080p/25 fps source retained; analyzer samples 0.2-4.5 s. This demonstrates the review journey, not broad chapter reliability.',
    testerNote: 'Technique is not compared with adult norms; the clip tests body and clothing diversity.',
  },
  {
    catalogGroup: 'guided-fixture',
    id: 'serve-portrait',
    title: 'Pre-trimmed serve regression fixture',
    description: 'Adult baseline serve in a portrait recording with full body visible.',
    asset: '/samples/pexels-serve-4902137.mp4',
    creator: 'Antoni Shkraba',
    sourceUrl: 'https://www.pexels.com/video/a-man-serving-a-tennis-ball-in-from-the-baseline-4902137/',
    directUrl: 'https://videos.pexels.com/video-files/4902137/4902137-hd_1066_1920_25fps.mp4',
    licenseName: 'Pexels License',
    licenseUrl: 'https://www.pexels.com/license/',
    viewpoint: 'Fixed portrait, rear/side-oblique, full body',
    expectedStroke: 'serve',
    expectation: 'analyze',
    handedness: 'right',
    selectedStroke: 'serve',
    analysisWindow: { start: 1, end: 6.5 },
    sourceFps: 25,
    sourceResolution: '1066x1920',
    cameraMotion: 'fixed',
    cuts: 'none',
    preparation: 'Pre-trimmed regression window: original portrait HD/25 fps source retained; analyzer samples 1.0-6.5 s. This is not full-video chapter evidence.',
    testerNote: 'Selected stroke avoids pretending that coarse auto-detection is validated for portrait serve.',
  },
  {
    catalogGroup: 'guided-fixture',
    id: 'multiple-people',
    title: 'Pre-trimmed two-player regression fixture',
    description: 'Wide court scene used to verify near/far player tracking and explicit selection.',
    asset: '/samples/pexels-multiple-people-4902142.mp4',
    creator: 'Antoni Shkraba',
    sourceUrl: 'https://www.pexels.com/video/a-tennis-player-practicing-in-a-clay-court-4902142/',
    directUrl: 'https://videos.pexels.com/video-files/4902142/4902142-hd_1920_1080_25fps.mp4',
    licenseName: 'Pexels License',
    licenseUrl: 'https://www.pexels.com/license/',
    viewpoint: 'Fixed landscape, wide court view, multiple visible people',
    expectedStroke: 'unclear',
    expectation: 'unverified',
    handedness: 'right',
    selectedStroke: 'auto',
    analysisWindow: { start: 3.8, end: 7.8 },
    sourceFps: 25,
    sourceResolution: '1920x1080',
    cameraMotion: 'fixed',
    cuts: 'none',
    preparation: 'Pre-trimmed regression window: original 1080p/25 fps source retained; analyzer samples 3.8-7.8 s. This tests selection, not full-video chapter accuracy.',
    testerNote: 'Verify that near and far players remain separate and that the selected track is disclosed.',
  },
]

const kaggleFiles = [
  ['video1.mp4', 11059377, 'e130ba17ef3cf0581103cf8b913e0796eca57426e30eb1c03fbda5fde71dc23e', 60.09],
  ['video2.mp4', 11949220, '4bff56ff43d35c7fd85c7e3664be527cdf9089d202a2674be9066f6731afddee', 60.01],
  ['video3.mp4', 10892398, '2097e6c8ae3b43ea703ce65c42b2d74a636da8bb76b7e2469758f28cd9d1fff1', 60.07],
  ['video4.mp4', 11641824, 'd3214eafbe7c10190f7e662e5693c5c7951184884ad21aa38d3e2fddc01ef68b', 60.06],
  ['video5.mp4', 4236828, '6b3403405c9270bc85136deb7516c0142c0eaf764fb62a4211fb5fc49a834048', 60.17],
  ['video6.mp4', 3826109, 'b346e7b05f5b0ced62b431a54c9eabbd6337e3bf9105c81a156115bed3224ac6', 60.00],
  ['video7.mp4', 14229922, '9460fa2f1b536b910262b4667a06dfc9cdac4bb42b09bc1f2464ecd7698a173f', 60.02],
  ['video8.mp4', 9162606, 'cfa554188c101c08d8bd3757b1721c242432a524fce6ebd8ec55d28a21415022', 30.06],
  ['video9.mp4', 7780397, 'bd15cb86adecfd17db1d114e14566dfa092fa67cee2aa17721c34788b4e0e33a', 60.10],
  ['video10.mp4', 5411908, '63413657dcfd1e1ebb968c87ca23fc47e1e23d495681b5d056edbb63ce317225', 30.13],
] as const

const kaggleBackviewClips: DemoClip[] = kaggleFiles.map(([file, fileBytes, sha256, sourceFps], index) => ({
  catalogGroup: 'evaluation-lab',
  id: `kaggle-backview-video-${String(index + 1).padStart(2, '0')}`,
  title: `Kaggle back view · video${index + 1}`,
  description: 'Back-court tennis footage with no coach-verified stroke label in the dataset metadata.',
  asset: `/samples/kaggle-tenis-backview/${file}`,
  creator: 'Gaston Ariel Francois',
  sourceUrl: `https://www.kaggle.com/datasets/gastonarielfrancois/tenis-backview/data?select=${file}`,
  directUrl: 'https://www.kaggle.com/api/v1/datasets/download/gastonarielfrancois/tenis-backview',
  licenseName: 'CC0: Public Domain',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  viewpoint: 'Fixed back-court view; distant player scale and possible opponent/occlusion',
  expectedStroke: 'unclear',
  expectation: 'unverified',
  handedness: 'right',
  selectedStroke: 'auto',
  sourceFps,
  sourceResolution: '1920x1080',
  cameraMotion: 'fixed',
  cuts: 'none',
  preparation: 'Original Kaggle MP4 retained without trim/transcode; full clip is sampled up to 320 frames.',
  testerNote: 'Stroke, handedness, and contact timing require human coach labels. Treat analyzer output as an unverified hypothesis.',
  fileBytes,
  sha256,
}))

const guidedValueClip: DemoClip = {
  catalogGroup: 'guided-fixture',
  id: 'guided-cc0-backview-movement',
  title: 'Guided CC0 back-view movement',
  description: 'Normal-speed fixed-camera CC0 interval selected for automatic descriptive review.',
  asset: '/samples/kaggle-tenis-backview/video8.mp4',
  creator: 'Gaston Ariel Francois',
  sourceUrl: 'https://www.kaggle.com/datasets/gastonarielfrancois/tenis-backview/data?select=video8.mp4',
  directUrl: 'https://www.kaggle.com/api/v1/datasets/download/gastonarielfrancois/tenis-backview',
  licenseName: 'CC0: Public Domain',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  viewpoint: 'Dataset-provided fixed back-court view; full court and near player are visible',
  expectedStroke: 'unclear',
  expectation: 'analyze',
  handedness: 'right',
  selectedStroke: 'auto',
  analysisWindow: { start: 7.7, end: 10.6 },
  sourceFps: 30.06,
  sourceResolution: '1920x1080',
  cameraMotion: 'fixed',
  cuts: 'none',
  preparation: 'Normal-speed CC0 interval; automatic chaptering and automatic stroke presentation remain required.',
  testerNote: 'Must produce at least one finalized descriptor-eligible movement chapter without selected-stroke metadata or clip-specific analyzer logic. Stroke, handedness, and contact timing require human coach labels; automatic stroke output is an unverified hypothesis.',
  fileBytes: 9162606,
  sha256: 'cfa554188c101c08d8bd3757b1721c242432a524fce6ebd8ec55d28a21415022',
}

const guidedOrder = ['forehand-outdoor', 'backhand-indoor', 'serve-portrait', 'multiple-people']

export const demoCatalog: DemoClip[] = [
  guidedValueClip,
  ...guidedOrder.map((id) => licensedRegressionClips.find((clip) => clip.id === id)!),
  ...kaggleBackviewClips,
]

export const getDemoClip = (id: string) => demoCatalog.find((clip) => clip.id === id)
