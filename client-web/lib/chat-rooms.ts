export const CHAT_ROOMS = [
  { key: 'WORK', sentinel: '__CHAT_WORK__', label: 'WORK', icon: '💼' },
  { key: 'CS', sentinel: '__CHAT_CS__', label: 'CS', icon: '🎧' },
  { key: 'GRAPHIC', sentinel: '__CHAT_GRAPHIC__', label: 'GRAPHIC', icon: '🎨' },
  { key: 'KOL', sentinel: '__CHAT_KOL__', label: 'KOL', icon: '📢' },
] as const;

export type ChatRoomKey = typeof CHAT_ROOMS[number]['key'];

export const CHAT_SENTINELS = CHAT_ROOMS.map(r => r.sentinel);

// __GENERAL_CHAT__ also needs to be filtered from normal task lists (backward compat)
export const ALL_CHAT_SENTINELS = [...CHAT_SENTINELS, '__GENERAL_CHAT__'];
