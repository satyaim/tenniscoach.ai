export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

export const containVideoRect = (
  sourceWidth: number,
  sourceHeight: number,
  displayWidth: number,
  displayHeight: number,
): DisplayRect => {
  const safeSourceWidth = Math.max(1, sourceWidth)
  const safeSourceHeight = Math.max(1, sourceHeight)
  const scale = Math.min(displayWidth / safeSourceWidth, displayHeight / safeSourceHeight)
  const width = safeSourceWidth * scale
  const height = safeSourceHeight * scale
  return {
    x: (displayWidth - width) / 2,
    y: (displayHeight - height) / 2,
    width,
    height,
    scale,
  }
}
