// The speaker family cards (src/appliances/speaker.*). ru = ro = en by keys.
const ru = {} as Record<string, string>;
const ro: Record<keyof typeof ru, string> = {};
const en: Record<keyof typeof ru, string> = {};
export const words_speaker = { ru, ro, en };
