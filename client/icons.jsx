import React from 'react';

// סט אייקונים קווי אחיד (ציור מקורי, 24x24, קו בעובי 2). צבע לפי currentColor
const P = {
  dashboard: <><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="5" rx="2" /><rect x="13" y="10" width="8" height="11" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /></>,
  donors: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.6" /><path d="M16 14.6c2.6.1 4.6 1.8 5.2 4.9" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4.3 4-6.5 8-6.5s7.2 2.2 8 6.5" /></>,
  userPlus: <><circle cx="10" cy="8" r="4" /><path d="M2.5 21c.8-4.3 3.8-6.5 7.5-6.5 1.6 0 3 .4 4.2 1.1" /><path d="M18 14v7M14.5 17.5h7" /></>,
  shekel: <><path d="M6 20V5h5a4 4 0 0 1 4 4v6" /><path d="M10 9v11h5a4 4 0 0 0 4-4V4" /></>,
  repeat: <><path d="M4 11V9a4 4 0 0 1 4-4h11" /><path d="M16 2l3 3-3 3" /><path d="M20 13v2a4 4 0 0 1-4 4H5" /><path d="M8 22l-3-3 3-3" /></>,
  receipt: <><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z" /><path d="M9 7.5h6M9 11.5h6M9 15.5h4" /></>,
  phone: <path d="M5 3.5h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.6 6.6l1.4-2.3 4.5 1.8V19a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3 5.5a2 2 0 0 1 2-2z" />,
  mobile: <><rect x="6.5" y="2" width="11" height="20" rx="2.5" /><path d="M10.5 18.5h3" /></>,
  calendar: <><rect x="3" y="4.5" width="18" height="16.5" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /><path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" /></>,
  mail: <><rect x="2.5" y="4.5" width="19" height="15" rx="2.5" /><path d="M3 6.5l9 6.5 9-6.5" /></>,
  chat: <><path d="M4 18.5l1.2-3.6A8 8 0 1 1 8.6 19l-4.6-.5z" /><path d="M9 10.5h.01M12.5 10.5h.01M16 10.5h.01" /></>,
  send: <><path d="M21 3L3 10.5l7 3 3 7z" /><path d="M10 13.5L21 3" /></>,
  pen: <><path d="M14.5 4.5l5 5L9 20H4v-5z" /><path d="M12.5 6.5l5 5" /></>,
  coin: <><ellipse cx="12" cy="6.5" rx="7.5" ry="3.5" /><path d="M4.5 6.5v5c0 1.9 3.4 3.5 7.5 3.5s7.5-1.6 7.5-3.5v-5" /><path d="M4.5 11.5v5c0 1.9 3.4 3.5 7.5 3.5s7.5-1.6 7.5-3.5v-5" /></>,
  box: <><path d="M3.5 8L12 3.5 20.5 8v8.5L12 21l-8.5-4.5z" /><path d="M3.5 8L12 12.5 20.5 8M12 12.5V21" /><path d="M10 6.5h4" /></>,
  flag: <><path d="M5 21V3.5" /><path d="M5 4h12l-2.5 4L17 12H5" /></>,
  candle: <><path d="M12 2.5c1.6 1.8 2 3 2 4a2 2 0 0 1-4 0c0-1 .4-2.2 2-4z" /><rect x="8.5" y="10" width="7" height="11.5" rx="1.5" /></>,
  star: <path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" />,
  heart: <path d="M12 20.5s-8-4.7-8-10.6A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 8 2.7c0 5.9-8 10.6-8 10.6z" />,
  chart: <><path d="M3.5 3.5v17h17" /><rect x="7" y="12" width="3" height="5.5" rx="1" /><rect x="12" y="8" width="3" height="9.5" rx="1" /><rect x="17" y="5" width="3" height="12.5" rx="1" /></>,
  bank: <><path d="M3 9.5L12 4l9 5.5z" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20.5h18" /></>,
  card: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 9.5h19M6 15h4" /></>,
  inbox: <><path d="M3 13.5l2.5-8.5h13L21 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z" /><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5" /></>,
  building: <><path d="M4 21V5.5L12 3l8 2.5V21" /><path d="M2.5 21h19M9 21v-5h6v5" /><path d="M8 8.5h.01M12 8.5h.01M16 8.5h.01M8 12h.01M12 12h.01M16 12h.01" /></>,
  bolt: <path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z" />,
  clip: <path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4L15 7.5" />,
  key: <><circle cx="8" cy="15" r="4.5" /><path d="M11.2 11.8L20 3M16.5 6.5l2.5 2.5M14 9l2 2" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M5.3 18.7l2-2M16.7 7.3l2-2" /></>,
  scroll: <><path d="M7 3.5h11a2 2 0 0 1 2 2V18a2.5 2.5 0 0 1-2.5 2.5H7" /><path d="M7 3.5a2.5 2.5 0 0 0-2.5 2.5v2h3" /><path d="M7 3.5v14.5a2.5 2.5 0 0 0 5 0V16H20" /><path d="M10.5 8h6M10.5 11.5h6" /></>,
  code: <><path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5" /><path d="M13.5 4.5l-3 15" /></>,
  help: <><circle cx="12" cy="12" r="9.5" /><path d="M9.3 9.3a2.8 2.8 0 1 1 3.7 2.6c-.6.3-1 .9-1 1.6v.6" /><path d="M12 17.3h.01" /></>,
  plus: <path d="M12 4.5v15M4.5 12h15" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M4.5 12.5l5 5 10-11" />,
  alert: <><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5h.01" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5l5 5" /></>,
  task: <><rect x="4" y="3.5" width="16" height="18" rx="2.5" /><path d="M9 3.5V2.5h6v1" /><path d="M8 12l2.5 2.5L16 9" /></>,
  note: <><path d="M5 3.5h10l4 4v13H5z" /><path d="M15 3.5v4h4M8.5 12h7M8.5 15.5h5" /></>,
  globe: <><circle cx="12" cy="12" r="9.5" /><path d="M2.5 12h19M12 2.5c2.7 2.7 4 6 4 9.5s-1.3 6.8-4 9.5c-2.7-2.7-4-6-4-9.5s1.3-6.8 4-9.5z" /></>,
  cash: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.8" /><path d="M6 9.5v.01M18 14.5v.01" /></>,
  check2: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h7M6 13.5h4M15.5 14.5l1.5 1.5 3-3.5" /></>,
  transfer: <><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" /></>,
  arrowLeft: <path d="M15 5l-7 7 7 7" />,
  logout: <><path d="M14 4.5h4.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H14" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  gift: <><rect x="3.5" y="9" width="17" height="12" rx="1.5" /><path d="M2.5 9h19v-3h-19zM12 6v15" /><path d="M12 6C10.5 3 7 3 7.5 5s4.5 1 4.5 1 4-.5 4.5-1S13.5 3 12 6z" /></>,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8.5" /><path d="M4 3.5v5h5" /><path d="M4 13a8 8 0 0 0 14.5 4.5l1.5-2" /><path d="M20 20.5v-5h-5" /></>,
  download: <><path d="M12 3.5v12M7 10.5l5 5 5-5" /><path d="M4 20.5h16" /></>,
  filter: <path d="M3.5 5h17l-6.5 8v6l-4 2v-8z" />,
};

export function Icon({ name, size = 20, className = '', title, style }) {
  const p = P[name] || P.dashboard;
  return (
    <svg className={`ico ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined} style={style}>
      {title && <title>{title}</title>}
      {p}
    </svg>
  );
}

// סמל צבעוני לכל מקור תרומה - לזיהוי במבט אחד
export const SOURCE_STYLE = {
  nedarim: ['#1f6f4a', 'נ'], kehilot: ['#7a3fb0', 'ק'], jgive: ['#d9465f', 'J'], charidy: ['#e07a1f', 'C'],
  masav: ['#16357a', 'מ'], manual: ['#5b6478', 'י'], cardcom: ['#0a7cc4', 'כ'], tranzila: ['#2b5aa6', 'ט'], grow: ['#13a37a', 'G'],
  payplus: ['#3d4fd6', 'P'], hyp: ['#b8862b', 'H'], pelecard: ['#4a7c1f', 'P'], payme: ['#c2410c', 'P'], icredit: ['#0f766e', 'i'],
  greeninvoice: ['#2f855a', 'ח'], field: ['#b45309', 'ש'], bank_import: ['#334155', 'ב'], boxes: ['#a16207', 'ק'],
};
export function SourceBadge({ s, label, withText = true }) {
  const [color, letter] = SOURCE_STYLE[s] || ['#64748b', (label || s || '?').slice(0, 1)];
  return (
    <span className="src-badge" title={label || s}>
      <span className="src-dot" style={{ background: color }}>{letter}</span>
      {withText && <span className="src-txt">{label || s}</span>}
    </span>
  );
}
