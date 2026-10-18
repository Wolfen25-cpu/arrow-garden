// Pointer input (touch, mouse and pen alike): a tap on a board cell calls `onTap`.
// A tap is a press and release close together, so small finger jitter still counts.

export function attachInput(canvas, renderer, onTap) {
  let press = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button > 0) return;
    press = { id: e.pointerId, x: e.offsetX, y: e.offsetY };
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const moved = Math.hypot(e.offsetX - press.x, e.offsetY - press.y);
    const cell = renderer.cellAt(press.x, press.y);
    press = null;
    if (cell && moved < renderer.cell * 0.8) onTap(cell);
  });

  canvas.addEventListener('pointercancel', () => {
    press = null;
  });
}
