import { captureReadingPosition } from './reading-position.mjs';

export function captureLearningReturn(root, view = window) {
  const reader = root?.querySelector('.tracked-reading-scroll');
  const tracker = reader?.closest('.reading-tracker');
  const outline = root?.querySelector('.outline-list');
  const zoom = tracker
    ? Number.parseFloat(view.getComputedStyle(tracker).getPropertyValue('--book-page-width'))
    : 100;
  return {
    scroll: { left: view.scrollX, top: view.scrollY },
    outline: { left: outline?.scrollLeft || 0, top: outline?.scrollTop || 0 },
    reading: reader
      ? {
          position: captureReadingPosition(reader),
          zoom: Number.isFinite(zoom) && zoom >= 1 && zoom <= 1000 ? zoom : 100,
        }
      : null,
  };
}

export function restoreLearningViewport(root, location, view = window) {
  const outline = root?.querySelector('.outline-list');
  if (outline && location.outline) outline.scrollTo(location.outline);
  view.scrollTo({ ...location.scroll, behavior: 'instant' });
  root?.querySelector('.chapter-ask-assistant-btn')?.focus({ preventScroll: true });
}
