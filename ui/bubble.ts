/**
 * The speech bubble: appended to document.body, absolutely positioned against
 * the chip's bounding rect, pointer-events none, auto-hides. Sits at z-index
 * 1105 - above the client's popups (~1104), below the output context menu
 * (10100), the same band arkadia-konfetti uses for its overlay.
 */

export const BUBBLE_Z_INDEX = 1105;
export const BUBBLE_BASE_MS = 4000;
/** Longer lines stay a little longer. */
export const BUBBLE_PER_CHAR_MS = 35;
export const BUBBLE_MAX_MS = 7000;

export class Bubble {
  private element: HTMLDivElement | null = null;
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

    // The tail: a rotated square hanging off the bottom edge.
    const tail = document.createElement('span');
    Object.assign(tail.style, {
      position: 'absolute',
      left: '50%',
      bottom: '-5px',
      width: '8px',
      height: '8px',
      marginLeft: '-4px',
      background: '#1b1710',
      borderRight: '1px solid #6b5a3a',
      borderBottom: '1px solid #6b5a3a',
      transform: 'rotate(45deg)',
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(tail);
    document.body.appendChild(el);
    this.element = el;
    return el;
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
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));
    let top = rect.top - height - 9;
    if (top < margin) top = rect.bottom + 9; // no room above: hang below
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
