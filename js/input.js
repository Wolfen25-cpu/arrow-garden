// Pointer input (touch, mouse and pen alike). A tap is a press and release close
// together, so small finger jitter still counts; it calls `onTap` with the id of the
// arrow (or block) under the finger. On renderers that can turn (3D), dragging calls
// `rotate` instead. `getRenderer` returns whichever renderer is active right now.

export function attachInput(canvas, getRenderer, onTap) {
  let press = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button > 0) return;
    press = { id: e.pointerId, x: e.offsetX, y: e.offsetY, lastX: e.offsetX, lastY: e.offsetY, dragging: false };
  });

  canvas.addEventListener('pointermove', (e) => {
    const renderer = getRenderer();
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

  canvas.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const renderer = getRenderer();
    const moved = Math.hypot(e.offsetX - press.x, e.offsetY - press.y);
    const { x, y, dragging } = press;
    press = null;
    if (dragging || moved >= renderer.tapSlop) return;
    const id = renderer.pick(x, y);
    if (id !== null) onTap(id);
  });

  canvas.addEventListener('pointercancel', () => {
    press = null;
  });
}
