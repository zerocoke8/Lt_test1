import { describe, expect, it } from 'vitest';
import { preventZoom } from '../../src/ui/nozoom';

// 기획 5차: 두 손가락 확대·축소를 막음 (iOS는 viewport user-scalable=no를 무시).
describe('preventZoom', () => {
  it('cancels pinch gestures, multi-touch moves, double-click and ctrl+wheel but not one-finger moves', () => {
    const handlers = new Map<string, (e: Event) => void>();
    const fakeDoc = {
      addEventListener: (type: string, fn: (e: Event) => void) => handlers.set(type, fn),
    } as unknown as Document;
    preventZoom(fakeDoc);
    const ev = (extra: Record<string, unknown>) => {
      const e = { cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      return e as unknown as Event & { defaultPrevented: boolean };
    };
    for (const t of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) {
      const e = ev({});
      handlers.get(t)!(e);
      expect(e.defaultPrevented, t).toBe(true);
    }
    const two = ev({ touches: { length: 2 } });
    handlers.get('touchmove')!(two);
    expect(two.defaultPrevented).toBe(true);
    const one = ev({ touches: { length: 1 } });
    handlers.get('touchmove')!(one);
    expect(one.defaultPrevented).toBe(false);
    const pinchWheel = ev({ ctrlKey: true });
    handlers.get('wheel')!(pinchWheel);
    expect(pinchWheel.defaultPrevented).toBe(true);
    const scroll = ev({ ctrlKey: false });
    handlers.get('wheel')!(scroll);
    expect(scroll.defaultPrevented).toBe(false);
  });
});
