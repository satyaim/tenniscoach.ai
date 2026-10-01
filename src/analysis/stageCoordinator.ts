export type StageStatus =
  | 'queued'
  | 'loading'
  | 'running'
  | 'ready'
  | 'unavailable'
  | 'failed'
  | 'cancelled'

export interface StageState<TPartial, TResult = TPartial> {
  runId: number
  status: StageStatus
  progress: number
  message: string
  processedFrames?: number
  estimatedTotalFrames?: number
  partialResult?: TPartial
  result?: TResult
  cacheReuse?: boolean
}

export interface PipelineStages<TPosePartial, TPoseResult, TBallPartial, TBallResult> {
  pose: StageState<TPosePartial, TPoseResult>
  ball: StageState<TBallPartial, TBallResult>
}

export type StageName = 'pose' | 'ball'

export type StageAction<TPosePartial, TPoseResult, TBallPartial, TBallResult> =
  | {
      type: 'reset'
      runId: number
      poseMessage: string
      ballMessage: string
    }
  | {
      type: 'update-pose'
      runId: number
      patch: Partial<StageState<TPosePartial, TPoseResult>>
    }
  | {
      type: 'update-ball'
      runId: number
      patch: Partial<StageState<TBallPartial, TBallResult>>
    }

export const createStageState = <TPartial, TResult = TPartial>(
  runId: number,
  message: string,
): StageState<TPartial, TResult> => ({
  runId,
  status: 'queued',
  progress: 0,
  message,
})

export const createPipelineStages = <TPosePartial, TPoseResult, TBallPartial, TBallResult>(
  runId = 0,
): PipelineStages<TPosePartial, TPoseResult, TBallPartial, TBallResult> => ({
  pose: createStageState(runId, 'Waiting for video metadata…'),
  ball: createStageState(runId, 'Waiting for video metadata…'),
})

export const stageReducer = <TPosePartial, TPoseResult, TBallPartial, TBallResult>(
  state: PipelineStages<TPosePartial, TPoseResult, TBallPartial, TBallResult>,
  action: StageAction<TPosePartial, TPoseResult, TBallPartial, TBallResult>,
): PipelineStages<TPosePartial, TPoseResult, TBallPartial, TBallResult> => {
  if (action.type === 'reset') {
    return {
      pose: createStageState(action.runId, action.poseMessage),
      ball: createStageState(action.runId, action.ballMessage),
    }
  }
  if (action.runId !== state[action.type === 'update-pose' ? 'pose' : 'ball'].runId) {
    return state
  }
  if (action.type === 'update-pose') {
    return { ...state, pose: { ...state.pose, ...action.patch } }
  }
  return { ...state, ball: { ...state.ball, ...action.patch } }
}

export const stageHasEvidence = <TPartial, TResult>(
  stage: StageState<TPartial, TResult>,
) => Boolean(stage.partialResult || stage.result)

