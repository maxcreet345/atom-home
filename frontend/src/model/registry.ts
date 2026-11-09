/** Read-only mirror of the Home Assistant registries and states that the panel needs. No tokens, no credentials. */
export interface FloorRow { floor_id: string; name: string; level?: number | null }
export interface AreaRow { area_id: string; name: string; floor_id?: string | null; icon?: string | null; picture?: string | null; temperature_entity_id?: string | null; humidity_entity_id?: string | null; labels?: string[] }
export interface DeviceRow { id: string; name: string | null; model?: string | null; manufacturer?: string | null; area_id: string | null; entry_type?: string | null; disabled_by?: string | null; via_device_id?: string | null; labels?: string[] }
export interface EntityRow {
  entity_id: string; device_id: string | null; area_id: string | null; name: string | null; original_name: string | null; platform: string;
  entity_category: 'config' | 'diagnostic' | null; disabled_by: string | null; hidden_by: string | null; icon?: string | null; original_icon?: string | null;
  device_class?: string | null; unit?: string | null; has_entity_name?: boolean; labels?: string[];
}
export interface StateRow { state: string; attributes: Record<string, unknown>; last_changed: string; last_updated: string }
export interface Registry { /** HA's floors (a building of several, Atom + Okapi 09.11.2026); absent where not read */ floors?: FloorRow[]; areas: AreaRow[]; devices: DeviceRow[]; entities: EntityRow[]; states: Record<string, StateRow>; services?: Record<string, string[]> }

export const domainOf = (entityId: string) => entityId.slice(0, entityId.indexOf('.'));
export const isNumeric = (state: string) => state.trim() !== '' && Number.isFinite(Number(state));
export const unavailable = (state: string | undefined) => state === undefined || state === 'unavailable' || state === 'unknown';
