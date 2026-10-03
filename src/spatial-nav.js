/**
 * Vanilla 5-way spatial focus navigation for the TV remote.
 *
 * Note: I first tried @noriginmedia/norigin-spatial-navigation-core (Norigin's
 * framework-agnostic build). Its geometry engine works, but its internal task
 * scheduler is built around React's mount/measure lifecycle and doesn't reliably
 * apply focus when driven standalone. This is a compact drop-in with the same
 * model: register the focusables on the active screen, move focus to the nearest
 * one in the pressed direction, and activate the focused one on OK. Focus is
 * reflected as `data-focused="true"` on the node (styled by styles/app.css) and
 * as native DOM focus (so inputs receive keystrokes).
 *
 * Mark focusables in the HTML with `data-sn="<key>"`.
 */

const DIR = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down',
  ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down',
};

let _started = false;
let _nodes = [];          // currently-navigable elements
let _current = null;      // focused element

export function initSpatialNav() {
  if (_started) return;
  _started = true;
  document.addEventListener('keydown', onKeyDown, true);
}

function onKeyDown(e) {
  const dir = DIR[e.keyCode] ?? DIR[e.key];
  if (dir) {
    const el = document.activeElement;
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    if (typing && (dir === 'left' || dir === 'right')) return; // let caret move
    const next = nearest(_current, dir);
    if (next) { e.preventDefault(); focus(next); }
    return;
  }
  if ((e.keyCode === 13 || e.key === 'Enter') && _current) {
    e.preventDefault();
    _current.click();
  }
}

/** Register the focusables inside `rootSelector`, focus `firstKey` (or the first). */
export function refreshFocus(rootSelector, firstKey) {
  if (!_started) return;
  const root = document.querySelector(rootSelector);
  _nodes = root ? [...root.querySelectorAll('[data-sn]')].filter((n) => n.offsetParent !== null) : [];
  const target = (firstKey && _nodes.find((n) => n.dataset.sn === firstKey)) || _nodes[0] || null;
  if (target) focus(target);
}

function focus(node) {
  if (_current && _current !== node) _current.removeAttribute('data-focused');
  _current = node;
  node.setAttribute('data-focused', 'true');
  try { node.focus({ preventScroll: true }); } catch (_) { /* older engines */ }
}

function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

/** Nearest focusable strictly in `dir` from `fromNode`, weighted to favour alignment. */
function nearest(fromNode, dir) {
  if (!fromNode) return _nodes[0] ?? null;
  const from = center(fromNode.getBoundingClientRect());
  let best = null;
  let bestScore = Infinity;
  for (const node of _nodes) {
    if (node === fromNode) continue;
    const c = center(node.getBoundingClientRect());
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    // primary = distance along the travel axis; cross = misalignment on the other
    let primary; let cross;
    if (dir === 'left')  { if (dx >= -1) continue; primary = -dx; cross = Math.abs(dy); }
    else if (dir === 'right') { if (dx <= 1) continue; primary = dx;  cross = Math.abs(dy); }
    else if (dir === 'up')    { if (dy >= -1) continue; primary = -dy; cross = Math.abs(dx); }
    else { if (dy <= 1) continue; primary = dy; cross = Math.abs(dx); } // down
    const score = primary + cross * 2; // bias toward staying aligned
    if (score < bestScore) { bestScore = score; best = node; }
  }
  return best;
}
