/**
 * The speech bubble: appended to document.body, absolutely positioned against
 * the chip's bounding rect, pointer-events none, auto-hides. Sits at z-index
 * 1105 - above the client's popups (~1104), below the output context menu
 * (10100), the same band arkadia-konfetti uses for its overlay.
 *
 * It stands beside the companion rather than over them - a bubble above the
 * chip covered the one thing it was drawn to comment on, and the companion
 * jumps, warps and sits down inside that box. So it goes to the side, its tail
 * pointing back at them, lifted clear of the name; if neither side has room it
 * falls back to hanging above, which is where it used to live.
 */

export const BUBBLE_Z_INDEX = 1105;
export const BUBBLE_BASE_MS = 4000;
/** Longer lines stay a little longer. */
export const BUBBLE_PER_CHAR_MS = 35;
export const BUBBLE_MAX_MS = 7000;
/** The gap between the companion and the bubble beside them, in CSS pixels. */
export const BUBBLE_GAP = 8;
/**
 * How far above the bottom of the companion the bubble's own bottom sits. The
 * name is on that line, so this is what lifts the bubble clear of it.
 */
export const BUBBLE_LIFT = 16;

/** Which edge of the bubble the tail hangs off - the edge nearest the companion. */
type Tail = 'left' | 'right' | 'bottom';

export class Bubble {
  private element: HTMLDivElement | null = null;
  private tail: HTMLSpanElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private anchor: HTMLElement | null = null;
  private followTimer: ReturnType<typeof setInterval> | null = null;

  show(text: string, anchor: HTMLElement): void {
    const el = this.ensureElement();
    this.anchor = anchor;
    this.setText(text);
    el.style.opacity = '1';
    el.style.display = 'block';
    this.reposition();
    this.startFollowing();

    if (this.hideTimer) clearTimeout(this.hideTimer);
    const duration = Math.min(BUBBLE_MAX_MS, BUBBLE_BASE_MS + text.length * BUBBLE_PER_CHAR_MS);
    this.hideTimer = setTimeout(() => this.hide(), duration);
  }

  hide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.stopFollowing();
    const el = this.element;
    if (!el) return;
    el.style.opacity = '0';
    // Let the fade finish before the element stops taking space.
    setTimeout(() => {
      if (el.style.opacity === '0') el.style.display = 'none';
    }, 220);
  }

  destroy(): void {
    this.hide();
    this.element?.remove();
    this.element = null;
    this.tail = null;
    this.anchor = null;
  }

  private ensureElement(): HTMLDivElement {
    if (this.element) return this.element;
    const el = document.createElement('div');
    el.setAttribute('data-towarzysz-bubble', '');
    Object.assign(el.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: String(BUBBLE_Z_INDEX),
      pointerEvents: 'none',
      maxWidth: '260px',
      padding: '5px 9px',
      borderRadius: '7px',
      background: '#1b1710',
      color: '#ece2c8',
      border: '1px solid #6b5a3a',
      boxShadow: '0 2px 8px rgba(0,0,0,.6)',
      font: '12px/1.35 Georgia, "EB Garamond", serif',
      whiteSpace: 'normal',
      opacity: '0',
      transition: 'opacity .2s ease',
      display: 'none',
    } as Partial<CSSStyleDeclaration>);

    // The tail: a rotated square hanging off whichever edge faces the
    // companion. `placeTail` moves it; two of its four borders are drawn, and
    // which two is what makes it a point rather than a diamond.
    const tail = document.createElement('span');
    Object.assign(tail.style, {
      position: 'absolute',
      width: '8px',
      height: '8px',
      background: '#1b1710',
      transform: 'rotate(45deg)',
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(tail);
    document.body.appendChild(el);
    this.element = el;
    this.tail = tail;
    this.placeTail('left');
    return el;
  }

  /** Hang the tail off one edge, pointing away from the bubble. */
  private placeTail(side: Tail): void {
    const tail = this.tail;
    if (!tail) return;
    const edge = '1px solid #6b5a3a';
    Object.assign(tail.style, {
      left: '',
      right: '',
      top: '',
      bottom: '',
      marginLeft: '',
      marginTop: '',
      borderLeft: '',
      borderRight: '',
      borderTop: '',
      borderBottom: '',
    } as Partial<CSSStyleDeclaration>);
    if (side === 'bottom') {
      // Under the middle, pointing down: the fallback, over the companion's head.
      Object.assign(tail.style, {
        left: '50%',
        bottom: '-5px',
        marginLeft: '-4px',
        borderRight: edge,
        borderBottom: edge,
      } as Partial<CSSStyleDeclaration>);
      return;
    }
    // Beside the text, level with the bottom of the bubble, which is the end
    // the companion is standing at.
    const vertical = { bottom: '9px' };
    if (side === 'left') {
      Object.assign(tail.style, {
        ...vertical,
        left: '-5px',
        borderLeft: edge,
        borderBottom: edge,
      } as Partial<CSSStyleDeclaration>);
    } else {
      Object.assign(tail.style, {
        ...vertical,
        right: '-5px',
        borderRight: edge,
        borderTop: edge,
      } as Partial<CSSStyleDeclaration>);
    }
  }

  /** Text lives in a text node before the tail, so textContent must not wipe the tail. */
  private setText(text: string): void {
    const el = this.element;
    if (!el) return;
    const tail = el.lastElementChild;
    el.textContent = '';
    el.appendChild(document.createTextNode(text));
    if (tail) el.appendChild(tail);
  }

  private reposition(): void {
    const el = this.element;
    const anchor = this.anchor;
    if (!el || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.hide();
      return;
    }
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const margin = 6;

    // Beside them, and lifted so the bottom edge clears the name.
    let tail: Tail = 'left';
    let left = rect.right + BUBBLE_GAP;
    let top = rect.bottom - BUBBLE_LIFT - height;
    if (left + width + margin > window.innerWidth) {
      // The footer's right-hand end is where this chip usually sits, so this is
      // the ordinary case rather than the exception: go to the other side.
      left = rect.left - BUBBLE_GAP - width;
      tail = 'right';
    }
    if (left < margin) {
      // Neither side fits - a narrow window - so hang above them after all.
      tail = 'bottom';
      left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.left + rect.width / 2 - width / 2));
      top = rect.top - height - 9;
      if (top < margin) top = rect.bottom + 9; // nor above: below, then
    }
    top = Math.max(margin, Math.min(window.innerHeight - height - margin, top));
    this.placeTail(tail);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  private startFollowing(): void {
    if (this.followTimer) return;
    this.followTimer = setInterval(() => this.reposition(), 250);
  }

  private stopFollowing(): void {
    if (this.followTimer) clearInterval(this.followTimer);
    this.followTimer = null;
  }
}
