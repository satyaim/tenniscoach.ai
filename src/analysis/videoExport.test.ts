import { describe, expect, it, vi } from 'vitest'
import { composeExportStream } from './videoExport'

describe('combined export media composition', () => {
  it('keeps canvas video and source audio tracks', () => {
    class MockMediaStream {
      constructor(private readonly tracks: MediaStreamTrack[]) {}
      getVideoTracks() {
        return this.tracks.filter((track) => track.kind === 'video')
      }
      getAudioTracks() {
        return this.tracks.filter((track) => track.kind === 'audio')
      }
    }
    vi.stubGlobal('MediaStream', MockMediaStream)
    const videoTrack = { kind: 'video' } as MediaStreamTrack
    const audioTrack = { kind: 'audio' } as MediaStreamTrack
    const canvas = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [],
    } as unknown as MediaStream
    const audio = {
      getVideoTracks: () => [],
      getAudioTracks: () => [audioTrack],
    } as unknown as MediaStream
    const stream = composeExportStream(canvas, audio)
    expect(stream.getVideoTracks()).toEqual([videoTrack])
    expect(stream.getAudioTracks()).toEqual([audioTrack])
    vi.unstubAllGlobals()
  })
})
