/**
 * The pan and zoom shared by the page `render --page` writes and the
 * playground, so the two look at a diagram the same way: − and +, Fit, 100%,
 * the zoom always shown and saying "Fit" while fitted, the wheel, a pinch, a
 * drag, a double-click, the keys + - 0 1, and g to grab the diagram so the
 * arrows or h j k l pan it.
 *
 * It is browser code kept as a string, since it runs in a page, not here: the
 * page writes it into its script, and the playground's build writes it into
 * its own. Calling `panZoom(view, stage, label, buttons)` returns the controls
 * the page and the playground need beyond it.
 *
 * `view` clips and takes the pointer; `stage` holds the SVG and is moved
 * inside it; `label` shows the zoom; `buttons` holds the elements for out, in,
 * fit and 100%, any of which may be missing.
 */
export const PAN_ZOOM = String.raw`
function panZoom(view, stage, label, buttons) {
  var MIN = 0.05;
  var MAX = 20;
  var svg = null;
  var natural = { w: 1, h: 1 };
  // The drawing is resized rather than scaled with a transform, so the
  // browser draws it afresh at every size and it stays sharp.
  var at = { x: 0, y: 0, s: 1 };
  // Until the reader pans or zooms, a change of size redraws the view the way
  // it was asked for: as it opened, or fitted.
  var fitted = 'open';

  function apply() {
    if (!svg) {
      label.textContent = '';
      return;
    }
    svg.setAttribute('width', natural.w * at.s);
    svg.setAttribute('height', natural.h * at.s);
    stage.style.transform = 'translate(' + at.x + 'px,' + at.y + 'px)';
    // The zoom always shows. Fitted, it says so too, since 62% alone doesn't
    // say whether that is the whole diagram or a zoom that happens to be 62%.
    // A large diagram opens fitted; a small one opens at 100%, not fitted.
    var isFit = fitted === 'fit' || (fitted === 'open' && at.s < 1);
    label.innerHTML = (isFit ? '<span class="fitted">Fit</span> · ' : '') + Math.round(at.s * 100) + '%';
  }

  function size() {
    return { w: view.clientWidth, h: view.clientHeight };
  }

  function center(s) {
    var room = size();
    at = { s: s, x: (room.w - natural.w * s) / 2, y: (room.h - natural.h * s) / 2 };
    apply();
  }

  function fitScale() {
    var room = size();
    // More room above and below, so a fitted drawing stays clear of the
    // controls floating in the picture's top-left and bottom-right corners.
    return Math.max(MIN, Math.min((room.w - 32) / natural.w, (room.h - 112) / natural.h));
  }

  function fit() {
    fitted = 'fit';
    center(fitScale());
  }

  function actual() {
    fitted = false;
    center(1);
  }

  // A diagram smaller than the view opens at its own size; a larger one
  // opens fitted.
  function open() {
    fitted = 'open';
    center(Math.min(1, fitScale()));
  }

  function refit() {
    if (!svg) return;
    if (fitted === 'fit') fit();
    else if (fitted === 'open') open();
    else apply();
  }

  // Zoom about a point of the view, which stays where it is on screen.
  function zoomAt(factor, px, py) {
    if (!svg) return;
    var s = Math.min(MAX, Math.max(MIN, at.s * factor));
    var k = s / at.s;
    at = { s: s, x: px - (px - at.x) * k, y: py - (py - at.y) * k };
    fitted = false;
    apply();
  }

  function zoomMiddle(factor) {
    var room = size();
    zoomAt(factor, room.w / 2, room.h / 2);
  }

  function pan(dx, dy) {
    at.x += dx;
    at.y += dy;
    fitted = false;
    apply();
  }

  // A new drawing in the stage. The view stays as the reader left it: fitted
  // stays fitted to the new drawing, and a zoom keeps its scale and place.
  function show() {
    svg = stage.querySelector('svg');
    if (!svg) return apply();
    var box = svg.viewBox.baseVal;
    natural = box && box.width ? { w: box.width, h: box.height } : { w: parseFloat(svg.getAttribute('width')) || 1, h: parseFloat(svg.getAttribute('height')) || 1 };
    refit();
  }

  if (buttons.out) buttons.out.onclick = function () { zoomMiddle(0.8); };
  if (buttons.in) buttons.in.onclick = function () { zoomMiddle(1.25); };
  if (buttons.fit) buttons.fit.onclick = fit;
  if (buttons.actual) buttons.actual.onclick = actual;

  view.addEventListener('wheel', function (event) {
    event.preventDefault();
    var rect = view.getBoundingClientRect();
    // A pinch on a trackpad arrives as a wheel with ctrl held, in small steps.
    var step = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    zoomAt(Math.exp(-step * (event.ctrlKey ? 0.01 : 0.0015)), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });

  // Dragging pans; two fingers pinch.
  var pointers = new Map();
  var pinch = null;
  view.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    if (event.target.closest('a')) return;
    view.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      var two = Array.from(pointers.values());
      pinch = Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y);
    }
    view.classList.add('dragging');
  });
  view.addEventListener('pointermove', function (event) {
    var last = pointers.get(event.pointerId);
    if (!last) return;
    var now = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, now);
    if (pointers.size === 2 && pinch) {
      var two = Array.from(pointers.values());
      var apart = Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y);
      var rect = view.getBoundingClientRect();
      zoomAt(apart / pinch, (two[0].x + two[1].x) / 2 - rect.left, (two[0].y + two[1].y) / 2 - rect.top);
      pinch = apart;
      return;
    }
    pan(now.x - last.x, now.y - last.y);
  });
  function release(event) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) view.classList.remove('dragging');
  }
  view.addEventListener('pointerup', release);
  view.addEventListener('pointercancel', release);
  view.addEventListener('dblclick', function (event) {
    var rect = view.getBoundingClientRect();
    zoomAt(event.shiftKey ? 0.5 : 2, event.clientX - rect.left, event.clientY - rect.top);
  });

  // The view's own size, not the window's: a dragged divider changes it too.
  new ResizeObserver(refit).observe(view);

  function typing(target) {
    return !!(target && target.closest && target.closest('input, textarea, select, [contenteditable]'));
  }

  // g grabs the diagram, and while it is held the arrows or h j k l pan it; g again or
  // Escape lets go, and the arrows go back to whatever else uses them. The
  // keys are taken before the page's own handlers see them, so a held
  // diagram's arrows don't also move a list or a divider, and its Escape lets
  // go without also clearing what is selected.
  var held = false;
  var hint = document.createElement('div');
  hint.className = 'grab-hint';
  hint.textContent = 'Arrows or h j k l pan · Shift for bigger steps · g or Esc to let go';
  hint.hidden = true;
  view.appendChild(hint);

  function grab(on) {
    held = on;
    hint.hidden = !on;
    view.classList.toggle('grabbed', on);
  }

  var ARROWS = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  // h j k l pan as the arrows do, and like them only while the diagram is
  // held, so g is the one way into panning from the keyboard.
  var LETTERS = { h: [1, 0], l: [-1, 0], k: [0, 1], j: [0, -1] };

  document.addEventListener('keydown', function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (typing(event.target)) return;
    var arrow = ARROWS[event.key] || LETTERS[event.key.toLowerCase()];
    if (event.key === 'g' || event.key === 'G') grab(!held);
    else if (held && event.key === 'Escape') grab(false);
    else if (held && arrow) {
      // A tenth of the view a press, half of it with Shift; held down, the
      // key repeats.
      var room = size();
      var part = event.shiftKey ? 0.5 : 0.1;
      pan(arrow[0] * room.w * part, arrow[1] * room.h * part);
    } else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // Starting to type lets go, so the arrows move the cursor again.
  document.addEventListener('focusin', function (event) {
    if (held && typing(event.target)) grab(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (typing(event.target)) return;
    if (event.key === '+' || event.key === '=') zoomMiddle(1.25);
    else if (event.key === '-' || event.key === '_') zoomMiddle(0.8);
    else if (event.key === '0') fit();
    else if (event.key === '1') actual();
    else return;
    event.preventDefault();
  });

  return { show: show, open: open, fit: fit, pan: pan, grab: grab, held: function () { return held; } };
}
`;
