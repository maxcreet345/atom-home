import { Component, type ComponentChildren } from 'preact';
import type { T } from '../i18n/index.ts';

/** C-1 of the audit of 17.11.2026: one exception in a card used to take the whole Preact tree down, and a wall tablet stayed blank
 *  until someone reloaded it by hand. A guard keeps the failure where it happened and says so in the panel's words. */

type Report = (error: unknown, where: string) => void;
let reporter: Report = (error, where) => { console.error(`[atom-home] ${where}:`, error); };
/** live-main sets this: the console plus, at most a few times a session, Home Assistant's own log. */
export function setErrorReporter(report: Report) { reporter = report; }
export function reportError(error: unknown, where: string) { try { reporter(error, where); } catch { /* reporting must never throw */ } }

interface GuardProps {
  /** where it failed, for the log: «page:climate», «sheet:light.kitchen», «tile:clock» */
  where: string;
  /** page: a message in the page; sheet: a message with «Закрыть»; tile: a quiet empty tile; panel: the caller's own fallback */
  kind: 'page' | 'sheet' | 'tile' | 'panel';
  t?: T;
  onClose?: () => void;
  /** the panel level draws its own screen (it has no translator yet) */
  fallback?: ComponentChildren;
  /** a page tries again by itself after this long: the state that broke it (an odd attribute) is often gone by then */
  retryMs?: number;
  onFail?: (error: unknown) => void;
  children?: ComponentChildren;
}
interface GuardState { failed: boolean; tries: number }

const RETRY_MS = 30_000;
/** Self-repair stops after this many tries: a part that fails every time is left as the message, not redrawn forever. */
const MAX_TRIES = 5;

export class Guard extends Component<GuardProps, GuardState> {
  state: GuardState = { failed: false, tries: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    reportError(error, this.props.where);
    this.props.onFail?.(error);
    const wait = this.props.retryMs ?? (this.props.kind === 'panel' ? 0 : RETRY_MS);
    if (wait > 0 && this.state.tries < MAX_TRIES && !this.timer) this.timer = setTimeout(() => { this.timer = null; this.retry(); }, wait);
  }
  componentWillUnmount() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private retry = () => { if (this.timer) clearTimeout(this.timer); this.timer = null; this.setState(s => ({ failed: false, tries: s.tries + 1 })); };
  render() {
    const { failed } = this.state, { kind, t, onClose, fallback, children } = this.props;
    if (!failed) return <>{children}</>;
    if (fallback !== undefined) return <>{fallback}</>;
    const word = (key: 'crash.page' | 'crash.sheet' | 'crash.tile' | 'crash.retry', plain: string) => t ? t(key) : plain;
    if (kind === 'tile') return <div className="ah-tile at-crash-tile" role="status"><span className="hm-muted">{word('crash.tile', 'Карточка недоступна')}</span></div>;
    return <div className={`at-crash at-crash-${kind}`} role="alert">
      <p>{word(kind === 'sheet' ? 'crash.sheet' : 'crash.page', kind === 'sheet' ? 'Эта карточка не открылась' : 'Этот раздел не открылся')}</p>
      <div className="at-crash-actions">
        <button type="button" className="hm-text-btn" onClick={this.retry}>{word('crash.retry', 'Попробовать снова')}</button>
        {onClose && <button type="button" className="hm-text-btn" onClick={onClose}>{t ? t('ui.close') : 'Закрыть'}</button>}
      </div>
    </div>;
  }
}
