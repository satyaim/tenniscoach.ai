import { BALL_TRACK_SCHEMA_VERSION } from './ballTracking'

export type ProviderStage =
  | 'player-evidence'
  | 'ball-observations'
  | 'trajectory'
  | 'temporal-events'

export type ProviderLifecycle = 'template' | 'testing' | 'eligible' | 'retired'
export type ProviderRightsStatus = 'cleared' | 'unresolved' | 'blocked' | 'not-applicable'
export type ProviderAvailability = 'available' | 'testing' | 'unavailable' | 'rights-blocked'

export interface ProviderDescriptor {
  id: string
  displayName: string
  stage: ProviderStage
  providerVersion: string
  modelId: string
  modelVersion: string
  checkpointHash?: string
  preprocessingConfigHash: string
  contractVersion: string
  runtimeCapabilities: {
    postSession: boolean
    live: boolean
    browserOnly: true
  }
  lifecycle: ProviderLifecycle
  rightsStatus: ProviderRightsStatus
  researchAuthorized: boolean
  productEnabled: boolean
  scoreSemantics: {
    field: string
    meaning: string
    calibrated: boolean
    range?: readonly [number, number]
  }[]
  availability: ProviderAvailability
  availabilityReason: string
}

export interface StageProvider<I, O> {
  readonly descriptor: ProviderDescriptor
  initialize(signal: AbortSignal): Promise<void>
  run(input: I, signal: AbortSignal, onProgress: (value: number) => void): Promise<O>
  dispose(): Promise<void>
}

export interface PlayerEvidenceProvider<I, O> extends StageProvider<I, O> {
  readonly descriptor: ProviderDescriptor & { stage: 'player-evidence' }
}

export interface BallObservationProvider<I, O> extends StageProvider<I, O> {
  readonly descriptor: ProviderDescriptor & { stage: 'ball-observations' }
}

export interface TrajectoryProvider<I, O> extends StageProvider<I, O> {
  readonly descriptor: ProviderDescriptor & { stage: 'trajectory' }
}

export interface TemporalEventProvider<I, O> extends StageProvider<I, O> {
  readonly descriptor: ProviderDescriptor & { stage: 'temporal-events' }
}

export const ballProviderCatalog: readonly ProviderDescriptor[] = [
  {
    id: 'no-approved-ball-model',
    displayName: 'No approved ball model',
    stage: 'ball-observations',
    providerVersion: '1.0.0',
    modelId: 'none',
    modelVersion: 'not-adopted',
    preprocessingConfigHash: 'sha256:not-applicable',
    contractVersion: BALL_TRACK_SCHEMA_VERSION,
    runtimeCapabilities: { postSession: false, live: false, browserOnly: true },
    lifecycle: 'template',
    rightsStatus: 'not-applicable',
    researchAuthorized: false,
    productEnabled: false,
    scoreSemantics: [],
    availability: 'unavailable',
    availabilityReason: 'No reviewed ball model or checkpoint is enabled in the Phase 0 product.',
  },
  {
    id: 'research-provider-template',
    displayName: 'Research provider template',
    stage: 'ball-observations',
    providerVersion: '1.0.0',
    modelId: 'unassigned',
    modelVersion: 'unassigned',
    preprocessingConfigHash: 'sha256:unassigned',
    contractVersion: BALL_TRACK_SCHEMA_VERSION,
    runtimeCapabilities: { postSession: true, live: false, browserOnly: true },
    lifecycle: 'testing',
    rightsStatus: 'blocked',
    researchAuthorized: false,
    productEnabled: false,
    scoreSemantics: [{
      field: 'provider-defined-score',
      meaning: 'A future provider must declare exact semantics; this is not a probability or confidence.',
      calibrated: false,
    }],
    availability: 'rights-blocked',
    availabilityReason: 'Template only. No executable binding, eligible artifact, or cleared rights are present.',
  },
]

export const executableProviderBindings = new Map<string, never>()

export const canExecuteProvider = (descriptor: ProviderDescriptor) =>
  descriptor.lifecycle === 'eligible' &&
  descriptor.rightsStatus === 'cleared' &&
  descriptor.productEnabled &&
  descriptor.availability === 'available' &&
  executableProviderBindings.has(descriptor.id)

export const getBallProvider = (id: string) =>
  ballProviderCatalog.find((provider) => provider.id === id) ?? ballProviderCatalog[0]
