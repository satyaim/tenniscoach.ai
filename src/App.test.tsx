import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('code-only hack demo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('shows upload, waits exactly four seconds, then displays the code-only result', async () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Your personal tennis coach' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Upload tennis video'), {
      target: { files: [new File(['demo'], 'demo.mp4', { type: 'video/mp4' })] },
    })

    expect(screen.getByRole('heading', { name: 'Analyzing your tennis video…' })).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(3999))
    expect(screen.queryByRole('heading', { name: 'Prepared analysis demo' })).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('heading', { name: 'Prepared analysis demo' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Demo video unavailable in code-only release' })).toHaveTextContent(
      'Demo video asset not included',
    )
    expect(document.querySelectorAll('video')).toHaveLength(0)
    expect(screen.getByText('Prepared sample')).toBeInTheDocument()
  })

  it('returns to upload from the prepared result', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Upload tennis video'), {
      target: { files: [new File(['demo'], 'demo.mp4', { type: 'video/mp4' })] },
    })
    act(() => vi.advanceTimersByTime(4000))

    fireEvent.click(screen.getByRole('button', { name: 'Upload another video' }))

    expect(screen.getByRole('heading', { name: 'Your personal tennis coach' })).toBeInTheDocument()
  })
})
