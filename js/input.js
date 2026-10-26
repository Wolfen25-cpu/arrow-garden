// Pointer input (touch, mouse and pen alike). A tap is a press and release close
// together, so small finger jitter still counts; it calls `onTap` with the id of the
// arrow under the finger and, on flat boards, where on the board it landed (double
// arrows go towards the nearer end). On renderers that can turn (3D), dragging calls
// `rotate` instead, and on those that can zoom, two fingers pinch to zoom and move the
// view, as does the mouse wheel. `getRenderer` returns whichever renderer is active now.

const WHEEL_ZOOM = 0.0015; // zoom factor per wheel pixel, as an exponent

export function attachInput(canvas, getRenderer, onTap) {
  let press = null;
  const fingers = new Map(); // pointer id → { x, y }
  let pinch = null; // { dist, x, y } while two fingers are down
  let pinched = false; // a pinch ends the gesture: no tap or turn until every finger lifts

  const pinchState = () => {
    const [a, b] = [...fingers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    fingers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (fingers.size === 2 && getRenderer().zoomBy) {
      press = null;
      pinched = true;
      pinch = pinchState();
      return;
    }
    if (!e.isPrimary || pinched) return;
    press = { id: e.pointerId, x: e.offsetX, y: e.offsetY, lastX: e.offsetX, lastY: e.offsetY, dragging: false };
  });

  canvas.addEventListener('pointermove', (e) => {
    const renderer = getRenderer();
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pinch && fingers.size === 2) {
      const next = pinchState();
      if (pinch.dist > 0) renderer.zoomBy?.(next.dist / pinch.dist, next.x, next.y);
      renderer.panBy?.(next.x - pinch.x, next.y - pinch.y);
      pinch = next;
      return;
    }
    if (!press || e.pointerId !== press.id || !renderer.rotate) return;
    if (!press.dragging && Math.hypot(e.offsetX - press.x, e.offsetY - press.y) > renderer.tapSlop) {
      press.dragging = true;
      canvas.setPointerCapture(e.pointerId);
    }
    if (press.dragging) {
      renderer.rotate(e.offsetX - press.lastX, e.offsetY - press.lastY);
      press.lastX = e.offsetX;
      press.lastY = e.offsetY;
    }
  });

  const lift = (e) => {
    fingers.delete(e.pointerId);
    if (fingers.size < 2) pinch = null;
    if (!fingers.size) pinched = false;
  };

  canvas.addEventListener('pointerup', (e) => {
    lift(e);
    if (!press || e.pointerId !== press.id) return;
    const renderer = getRenderer();
    const moved = Math.hypot(e.offsetX - press.x, e.offsetY - press.y);
    const { x, y, dragging } = press;
    press = null;
    if (dragging || moved >= renderer.tapSlop) return;
    const id = renderer.pick(x, y);
    if (id !== null) onTap(id, renderer.boardPoint?.(x, y) ?? null);
  });

  canvas.addEventListener('pointercancel', (e) => {
    lift(e);
    press = null;
  });

  canvas.addEventListener('wheel', (e) => {
    const renderer = getRenderer();
    if (!renderer.zoomBy) return;
    e.preventDefault();
    renderer.zoomBy(Math.exp(-e.deltaY * WHEEL_ZOOM), e.offsetX, e.offsetY);
  }, { passive: false });
}
