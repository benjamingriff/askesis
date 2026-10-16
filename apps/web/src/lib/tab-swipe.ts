import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** Touches that start this close to a screen edge belong to the browser's back/forward gesture. */
const EDGE_PX = 24;
const LOCK_PX = 10;
const COMMIT_RATIO = 0.28;
const COMMIT_VELOCITY = 0.45; // px per ms
const SETTLE_MS = 220;
const EASE = 'cubic-bezier(.2, .8, .2, 1)';

const IGNORE =
  'input, textarea, select, button[role="slider"], [contenteditable="true"], [role="dialog"], [data-no-tab-swipe]';

export type TabSwipeOptions = {
  /** Index of the current tab, or -1 when the page is not a swipeable tab. */
  index: number;
  count: number;
  /** Called once a swipe is committed, while the old page is off screen. */
  onCommit: (index: number) => void;
};

function scrollsSideways(target: Element, root: Element) {
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    if (node.scrollWidth <= node.clientWidth + 1) continue;
    const overflow = getComputedStyle(node).overflowX;
    if (overflow === 'auto' || overflow === 'scroll') return true;
  }
  return false;
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Matches the narrow-screen layout in shell.css; wider screens use the sidebar. */
function isNarrow() {
  return window.matchMedia?.('(max-width: 900px)').matches ?? true;
}

/**
 * Lets touch users swipe the workspace sideways between the primary tabs.
 * The page follows the finger, and `--tab-swipe` (-1…1) on `indicatorRoot`
 * lets the tab indicator follow along. Only touch on narrow screens counts.
 */
export function useTabSwipe(
  surface: RefObject<HTMLElement | null>,
  indicatorRoot: RefObject<HTMLElement | null>,
  { index, count, onCommit }: TabSwipeOptions,
) {
  const latest = useRef({ index, count, onCommit });
  useLayoutEffect(() => {
    latest.current = { index, count, onCommit };
  });

  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    let gesture: {
      id: number;
      x: number;
      y: number;
      time: number;
      dx: number;
      locked: boolean;
    } | null = null;

    const setOffset = (dx: number, animate: boolean, progress = -dx / node.clientWidth) => {
      node.style.transition = animate ? `transform ${SETTLE_MS}ms ${EASE}` : 'none';
      node.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : '';
      indicatorRoot.current?.style.setProperty('--tab-swipe', String(progress));
      indicatorRoot.current?.classList.toggle('tab-swiping', !animate);
    };
    const reset = () => {
      node.style.transition = '';
      node.style.transform = '';
      node.style.opacity = '';
      indicatorRoot.current?.style.setProperty('--tab-swipe', '0');
      indicatorRoot.current?.classList.remove('tab-swiping');
    };

    const down = (event: PointerEvent) => {
      const { index: current } = latest.current;
      if (event.pointerType !== 'touch' || current < 0 || !event.isPrimary || !isNarrow()) return;
      if (event.clientX < EDGE_PX || event.clientX > window.innerWidth - EDGE_PX) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(IGNORE) || scrollsSideways(target, node)) return;
      if (window.getSelection()?.toString()) return;
      gesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
        dx: 0,
        locked: false,
      };
    };

    const move = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.locked) {
        if (Math.abs(dy) > LOCK_PX && Math.abs(dy) >= Math.abs(dx)) {
          gesture = null;
          return;
        }
        if (Math.abs(dx) < LOCK_PX || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        gesture.locked = true;
        gesture.x = event.clientX; // avoid a jump when the page starts following
        gesture.time = event.timeStamp;
      }
      const { index: current, count: total } = latest.current;
      const raw = event.clientX - gesture.x;
      const atEdge = (raw > 0 && current === 0) || (raw < 0 && current === total - 1);
      gesture.dx = atEdge ? raw / 4 : raw;
      setOffset(gesture.dx, false);
    };

    const finish = (event: PointerEvent, cancelled: boolean) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const { dx, locked, time } = gesture;
      gesture = null;
      if (!locked) return;
      const { index: current, count: total, onCommit: commit } = latest.current;
      const width = node.clientWidth;
      const velocity = Math.abs(dx) / Math.max(1, event.timeStamp - time);
      const next = current + (dx < 0 ? 1 : -1);
      const passed = Math.abs(dx) > width * COMMIT_RATIO || velocity > COMMIT_VELOCITY;
      if (cancelled || !passed || next < 0 || next >= total) {
        setOffset(0, true);
        window.setTimeout(reset, SETTLE_MS);
        return;
      }
      const direction = dx < 0 ? -1 : 1;
      if (prefersReducedMotion()) {
        reset();
        commit(next);
        return;
      }
      setOffset(direction * width, true);
      window.setTimeout(() => {
        commit(next); // renders synchronously, so the indicator can settle on the new tab
        window.scrollTo(0, 0);
        // Bring the new page in from the opposite side.
        setOffset(-direction * width * 0.3, false, 0);
        node.style.opacity = '0';
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            node.style.transition = `transform ${SETTLE_MS}ms ${EASE}, opacity ${SETTLE_MS}ms ease`;
            node.style.transform = '';
            node.style.opacity = '';
            indicatorRoot.current?.classList.remove('tab-swiping');
            window.setTimeout(reset, SETTLE_MS);
          }),
        );
      }, SETTLE_MS * 0.8);
    };

    const up = (event: PointerEvent) => finish(event, false);
    const cancel = (event: PointerEvent) => finish(event, true);
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', cancel);
    return () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', cancel);
      reset();
    };
  }, [surface, indicatorRoot]);
}
