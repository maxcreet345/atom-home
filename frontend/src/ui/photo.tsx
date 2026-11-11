import { createContext, type ComponentChildren } from 'preact';
import { useContext, useState } from 'preact/hooks';
/** entity id → the product photo of its appliance (model/photos.ts); the shell provides it, a card asks for its own device. */
export const PhotoOf = createContext<(entityId?: string | null) => string | null>(() => null);
export const usePhoto = (entityId?: string | null) => useContext(PhotoOf)(entityId);
/** A cut-out (PNG, WebP: transparent around the product) stands whole on the plate; an ordinary photograph fills it. */
const opaque = (src: string) => /\.jpe?g($|\?)|^data:image\/jpeg/i.test(src);
/** The appliance's own photo on a neutral plate: a white kettle stays visible on light glass, a black doorbell on dark glass.
 * Without a photo — or when it does not load — the card's quiet pictogram (`children`) stands in, never a broken picture. */
export function ProductPhoto({ src, className = '', label, children, eager }: { src: string | null | undefined; className?: string; /** what the picture says, when nothing next to it does */ label?: string; children?: ComponentChildren; eager?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!src || broken === src) return <>{children}</>;
  return <span className={`ah-photo ${opaque(src) ? 'is-opaque' : 'is-cutout'} ${className}`} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}><img src={src} alt="" decoding="async" loading={eager ? undefined : 'lazy'} onError={() => setBroken(src)} /></span>;
}
