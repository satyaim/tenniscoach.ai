const PORTRAIT_MAX_VIEWPORT_HEIGHT = 68
const PORTRAIT_MAX_HEIGHT_PX = 760

export const videoStageStyle = (aspectRatio: number) => ({
  aspectRatio,
  ...(aspectRatio < 1
    ? {
        width: `min(100%, ${aspectRatio * PORTRAIT_MAX_VIEWPORT_HEIGHT}vh, ${aspectRatio * PORTRAIT_MAX_HEIGHT_PX}px)`,
      }
    : {}),
})
