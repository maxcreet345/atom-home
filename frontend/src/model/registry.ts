/** Read-only mirror of the Home Assistant registries and states that the panel needs. No tokens, no credentials. */
export interface AreaRow { area_id: string; name: string; icon?: string | null; picture?: string | null; temperature_entity_id?: string | null; humidity_entity_id?: string | null }
export interface DeviceRow { id: string; name: string | null; model?: string | null; manufacturer?: string | null; area_id: string | null; entry_type?: string | null; disabled_by?: string | null; via_device_id?: string | null }
export interface EntityRow {
  entity_id: string; device_id: string | null; area_id: string | null; name: string | null; original_name: string | null; platform: string;
  entity_category: 'config' | 'diagnostic' | null; disabled_by: string | null; hidden_by: string | null; icon?: string | null; original_icon?: string | null;
  device_class?: string | null; unit?: string | null; has_entity_name?: boolean;
}
export interface StateRow { state: string; attributes: Record<string, unknown>; last_changed: string; last_updated: string }
export interface Registry { areas: AreaRow[]; devices: DeviceRow[]; entities: EntityRow[]; states: Record<string, StateRow>; services?: Record<string, string[]> }

export const domainOf = (entityId: string) => entityId.slice(0, entityId.indexOf('.'));
export const isNumeric = (state: string) => state.trim() !== '' && Number.isFinite(Number(state));
export const unavailable = (state: string | undefined) => state === undefined || state === 'unavailable' || state === 'unknown';
