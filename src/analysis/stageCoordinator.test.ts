import { describe, expect, it } from 'vitest'
import { createPipelineStages, stageReducer } from './stageCoordinator'

describe('stage coordinator', () => {
  it('accepts out-of-order independent completion and ignores stale runs', () => {
    let state = createPipelineStages<string[], string, string[], string>(4)
    state = stageReducer(state, {
      type: 'update-ball',
      runId: 4,
      patch: { status: 'ready', result: 'ball-ready', progress: 1 },
    })
    state = stageReducer(state, {
      type: 'update-pose',
      runId: 4,
      patch: { status: 'running', partialResult: ['pose-1'], progress: 0.2 },
    })
    state = stageReducer(state, {
      type: 'update-pose',
      runId: 3,
      patch: { status: 'failed', message: 'stale' },
    })
    expect(state.ball.result).toBe('ball-ready')
    expect(state.pose.partialResult).toEqual(['pose-1'])
    expect(state.pose.status).toBe('running')
  })

  it('keeps failure and cancellation isolated by stage', () => {
    let state = createPipelineStages<string[], string, string[], string>(2)
    state = stageReducer(state, {
      type: 'update-pose',
      runId: 2,
      patch: { status: 'failed', message: 'pose failed' },
    })
    state = stageReducer(state, {
      type: 'update-ball',
      runId: 2,
      patch: { status: 'cancelled', message: 'ball cancelled' },
    })
    expect(state.pose.status).toBe('failed')
    expect(state.ball.status).toBe('cancelled')
  })
})

