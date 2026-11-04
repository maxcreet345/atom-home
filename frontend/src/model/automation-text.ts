/** AUTO-2 rule (05.11.2026): a family member reads the row, so an automation's description is shown only when it is short and human.
 * The owner's notes in HA often carry entity ids, file paths and state arrows — those stay in HA, the row then shows the name and the last run. */
const TECHNICAL = /[a-z_]+\.[a-z0-9_<>]+|<[a-z_]+>|book\/|→|≠|\b(off|on|heat|auto)\b/;
export const familyDescription = (text: string, max = 90): string => { const t = text.trim(); return t && t.length <= max && !TECHNICAL.test(t) ? t : ''; };
