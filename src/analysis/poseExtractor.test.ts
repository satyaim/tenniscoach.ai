import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPoseLandmarker, loadVerifiedPoseModel, POSE_MODEL_MANIFEST, seekVideo } from './poseExtractor'

describe('pose model integrity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects a self-hosted model whose SHA-256 does not match the manifest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))))
    await expect(loadVerifiedPoseModel()).rejects.toThrow(/integrity verification failed/i)
    expect(fetch).toHaveBeenCalledWith(POSE_MODEL_MANIFEST.modelUrl, { signal: undefined })
  })

  it('does not fetch the model after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadVerifiedPoseModel(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back from GPU initialization to CPU', async () => {
    const close = vi.fn()
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('GPU unavailable'))
      .mockResolvedValueOnce({ close })
    const landmarker = await createPoseLandmarker(undefined, false, {
      loadModel: async () => new ArrayBuffer(8),
      resolveVision: async () => ({}) as never,
      create,
    })

    expect(landmarker).toEqual({ close })
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][1].baseOptions.delegate).toBe('GPU')
    expect(create.mock.calls[1][1].baseOptions.delegate).toBe('CPU')
  })

  it('closes a landmarker that resolves after cancellation', async () => {
    const controller = new AbortController()
    const close = vi.fn()
    let resolveCreate!: (value: never) => void
    const creating = createPoseLandmarker(controller.signal, false, {
      loadModel: async () => new ArrayBuffer(8),
      resolveVision: async () => ({}) as never,
      create: () => new Promise((resolve) => { resolveCreate = resolve }) as never,
    })
    const rejected = expect(creating).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(resolveCreate).toBeTypeOf('function'))
    controller.abort()
    resolveCreate({ close } as never)

    await rejected
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('aborts an in-progress video seek immediately', async () => {
    const video = document.createElement('video')
    const controller = new AbortController()
    const seeking = seekVideo(video, 2, controller.signal)
    controller.abort()
    await expect(seeking).rejects.toMatchObject({ name: 'AbortError' })
  })
})
