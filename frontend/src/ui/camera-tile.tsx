/* One camera's tile on «Главная» and in a room (moved out of app.tsx, 21.11.2026, so its sizes are its own file). */
import type { JSX } from 'preact';
import type { HomeDevice } from '../model/discover.ts';
import type { TileState } from '../modules/index.ts';
import { Icon } from './primitives.tsx';
import { modelText } from './cards.tsx';
import type { T } from '../i18n/index.ts';
import { stateText, type Lang } from './format.ts';

export function CameraTile({ device, player, state, onOpen, t, lang, large }: { device: HomeDevice; player?: JSX.Element | null; state?: TileState | null; onOpen: () => void; t: T; lang: 'ru' | 'ro' | 'en'; large?: boolean }) {
  const pic = typeof device.primary.attributes.entity_picture === 'string' ? device.primary.attributes.entity_picture : null;
  const closed = state?.closed === true;
  return <div className={`hm-card hm-camera-tile ah-camera ah-tile ${large ? 'is-large' : ''} ${closed ? 'is-closed' : ''} ${state?.tone ? `is-${state.tone}` : ''}`}>
    <button type="button" className="at-cams-hit" aria-label={`${t('ui.open')}: ${device.name}`} onClick={onOpen} />
    <div className="hm-camera-frame">{closed ? <div className="hm-camera-wait"><Icon name="camera" size={32} /><span>{t('module.camera.closed')}</span></div> : player ? player : pic ? <img className="at-camera-img" src={pic} alt="" /> : <div className="hm-camera-wait"><Icon name="camera" size={32} /><span>{stateText(device.primary, t, lang)}</span></div>}{(!player || closed) && <span className="hm-live"><i />{closed ? t('state.off') : device.primary.available ? t('state.idle') : t('state.unavailable')}</span>}
      {state?.icon && !closed && <span className={`at-cam-badge ${state.tone === 'danger' ? 'is-ring' : ''}`} title={state.line ?? ''}><Icon name={state.icon} size={16} />{state.tone === 'danger' && <span>{state.line}</span>}</span>}
      <div className="hm-camera-caption"><strong>{device.name}</strong><small>{state?.line ?? modelText(device.model) ?? ''}</small><Icon name="next" size={18} /></div></div>
  </div>;
}
