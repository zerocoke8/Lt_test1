// 기획 5차: 폰 웹에서 두 손가락으로 화면이 확대되면 다시 줄일 수 없음 → 확대·축소 자체를 막음.
// - iOS Safari는 viewport의 user-scalable=no / maximum-scale을 무시하므로 gesture* 이벤트와 두 손가락 touchmove를 막음.
// - 더블탭 확대는 CSS touch-action(html/body: none) + dblclick 차단.
// - 데스크톱 트랙패드 핀치(ctrl+wheel)와 ctrl +/- 도 막음.
// The game itself only uses one-finger pointer drags, so nothing here blocks gameplay input.

let installed = false;

export function preventZoom(doc: Document = document): void {
  if (installed) return;
  installed = true;
  const stop = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };
  const opts: AddEventListenerOptions = { passive: false };
  // iOS Safari pinch
  doc.addEventListener('gesturestart', stop, opts);
  doc.addEventListener('gesturechange', stop, opts);
  doc.addEventListener('gestureend', stop, opts);
  // any browser: two or more fingers moving = pinch
  doc.addEventListener(
    'touchmove',
    e => {
      if ((e as TouchEvent).touches.length > 1) stop(e);
    },
    opts,
  );
  doc.addEventListener('dblclick', stop, opts);
  // desktop: trackpad pinch arrives as ctrl+wheel; keyboard ctrl/cmd + '+', '-', '0'
  doc.addEventListener(
    'wheel',
    e => {
      if ((e as WheelEvent).ctrlKey) stop(e);
    },
    opts,
  );
  doc.addEventListener('keydown', e => {
    const k = (e as KeyboardEvent).key;
    if (((e as KeyboardEvent).ctrlKey || (e as KeyboardEvent).metaKey) && (k === '+' || k === '-' || k === '=' || k === '0')) stop(e);
  });
}
