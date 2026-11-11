/** The keyboard's place in the panel is never lost to a command (audit 2026-11-09, round 2: a11y2-focus-lost-while-pending).
 *
 *  A control that becomes `disabled` while its command is on its way drops the focus to `body` — for good: the browser does not give it back
 *  when the control is free again, the ring is gone, Enter and the arrows of a remote do nothing. Cards keep their own busy flags and many do
 *  not re-render the shell, so the net is one observer on the shell's root, whatever the control is (a tile, a sheet row, a room button,
 *  security, heating, the vacuum, a module):
 *   - the last focused control is remembered as focus moves (`focusin`);
 *   - when that control becomes `disabled` it is «owed» the focus;
 *   - when it is enabled again and the focus is still nowhere (body, the shadow host, nothing), it gets it back;
 *   - it is forgotten when the person moved the focus elsewhere or the control left the page.
 *  A control that only says `aria-disabled` + `aria-busy` never loses the focus: nothing to do for it. The shell hands its own returns here
 *  too (`give`: the opener of a sheet or a question that is disabled at the moment the window closes).
 *  Shadow-root aware: inside Home Assistant `document.activeElement` is the panel's host, the control is the root node's `activeElement`. */
export interface FocusKeep {
  /** The control that had the focus last (inside the root), if it is still in the page. */
  last(): HTMLElement | null;
  /** True when the focus is nowhere: on `body`, on the host that holds the panel, or on something that left the page. */
  lost(): boolean;
  /** Focus `el` now, or as soon as it is enabled again (when the focus is still nowhere by then). */
  give(el: HTMLElement | null): void;
  /** The control that is owed the focus (tests). */
  owed(): HTMLElement | null;
  stop(): void;
}
/** The part that decides, without a DOM: what the net does when a control changed its `disabled`. */
export function focusVerdict(o: { disabled: boolean; isLast: boolean; isOwed: boolean; focusOnIt: boolean; focusLost: boolean }): 'owe' | 'restore' | 'forget' | 'nothing' {
  if (o.disabled) return o.isLast && (o.focusOnIt || o.focusLost) ? 'owe' : 'nothing';
  if (!o.isOwed) return 'nothing';
  return o.focusLost || o.focusOnIt ? 'restore' : 'forget';
}
const isDisabled = (el: Element) => (el as HTMLButtonElement).disabled === true;
export function keepFocus(root: HTMLElement): FocusKeep {
  const doc = root.ownerDocument, scope = root.getRootNode() as Document | ShadowRoot;
  let last: HTMLElement | null = null, owed: HTMLElement | null = null;
  const active = () => (scope.activeElement as HTMLElement | null) ?? null;
  const lost = () => {
    const a = active();
    if (a && a.isConnected && a !== doc.body && a !== doc.documentElement && !isDisabled(a)) return false;
    if (scope === doc) return true;
    // inside a shadow root nothing of ours has the focus: it is lost unless the person took it to the page around the panel (HA's sidebar)
    const top = doc.activeElement; if (!top || top === doc.body || top === doc.documentElement) return true;
    for (let n: Node | null = root; n; n = n.parentNode ?? (n as ShadowRoot).host ?? null) if (n === top) return true;
    return false;
  };
  const focusIn = (e: FocusEvent) => { const el = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null; if (!el || !root.contains(el)) return; last = el; if (owed && owed !== el) owed = null; };
  root.addEventListener('focusin', focusIn);
  const restore = () => { const el = owed; if (!el) return; if (!el.isConnected) { owed = null; return; } if (isDisabled(el)) return; owed = null; if (lost() || active() === el) el.focus({ preventScroll: true }); };
  const seen = (list: MutationRecord[]) => {
    for (const m of list) {
      if (m.type !== 'attributes') continue;
      const el = m.target as HTMLElement, a = active();
      const v = focusVerdict({ disabled: isDisabled(el), isLast: el === last, isOwed: el === owed, focusOnIt: a === el, focusLost: lost() });
      if (v === 'owe') owed = el; else if (v === 'restore') restore(); else if (v === 'forget') owed = null;
    }
    if (owed && !owed.isConnected) owed = null;
    if (last && !last.isConnected) last = null;
  };
  const Observer = (doc.defaultView as (Window & typeof globalThis) | null)?.MutationObserver ?? (typeof MutationObserver === 'undefined' ? null : MutationObserver);
  const mo = Observer ? new Observer(seen) : null;
  mo?.observe(root, { subtree: true, attributes: true, attributeFilter: ['disabled'], childList: true });
  return {
    last: () => last && last.isConnected ? last : null,
    lost,
    owed: () => owed,
    give(el) { if (!el?.isConnected) return; if (isDisabled(el)) { owed = el; return; } owed = null; el.focus({ preventScroll: true }); },
    stop() { root.removeEventListener('focusin', focusIn); mo?.disconnect(); owed = null; last = null; },
  };
}
