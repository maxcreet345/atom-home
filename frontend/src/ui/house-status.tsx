// The house status strip above Home's cards (release «classic», ported from design 2026 phase 2; model/house-status.ts decides, this only draws).
// One line that answers «всё ли в порядке?»: a status glyph and a sentence; when something needs a person, the items as chips, each opening its
// place. Glyph + word in the status colour, never colour alone. Drawn with the classic themes' tokens (atom.css, «Строка состояния дома»).
import { Icon } from './primitives.tsx';
import type { HouseStatus, StatusItem } from '../model/house-status.ts';
import type { T } from '../i18n/index.ts';
import type { View } from '../runtime/route.ts';
type Nav = (next: Partial<View>) => void;

const TONE_GLYPH = { ok: 'ok', warn: 'warning', danger: 'danger' } as const;
/** One chip: a button that opens the item's place, or plain words when there is nowhere to go (the house out of reach). */
export function StatusChip({ item, go, compact = false }: { item: StatusItem; go: Nav; compact?: boolean }) {
  const inner = <><span className="ah-status-chip-ic" aria-hidden="true"><Icon name={item.glyph} size={20} /></span><span className="ah-status-chip-text">{item.text}</span>{item.place && !compact && <Icon name="next" size={18} />}</>;
  return item.place
    ? <button type="button" className={`ah-status-chip tone-${item.tone}`} data-kind={item.kind} onClick={() => go(item.place!)}>{inner}</button>
    : <span className={`ah-status-chip tone-${item.tone} is-static`} data-kind={item.kind}>{inner}</span>;
}
export function HouseStatusStrip({ status, go, t, className = '' }: { status: HouseStatus; go: Nav; t: T; className?: string }) {
  return <section className={`ah-status hm-card tone-${status.tone} ${status.items.length ? 'has-items' : ''} ${className}`} aria-label={t('status.label')} data-tone={status.tone}>
    <div className="ah-status-head"><span className="ah-status-glyph" aria-hidden="true"><Icon name={TONE_GLYPH[status.tone]} size={28} /></span><h2 className="ah-status-title">{status.title}</h2></div>
    {status.items.length > 0 && <ul className="ah-status-chips">{status.items.map(i => <li key={i.id}><StatusChip item={i} go={go} /></li>)}</ul>}
  </section>;
}
