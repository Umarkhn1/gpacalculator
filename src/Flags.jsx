// Компактные SVG-флаги для переключателя языка (эмодзи-флаги не рендерятся на Windows).

export function FlagUZ() {
  return (
    <svg viewBox="0 0 30 20" className="flag" aria-hidden="true">
      <rect width="30" height="20" fill="#fff" />
      <rect width="30" height="6.2" fill="#0099b5" />
      <rect y="13.8" width="30" height="6.2" fill="#1eb53a" />
      <rect y="6.2" width="30" height="0.7" fill="#ce1126" />
      <rect y="13.1" width="30" height="0.7" fill="#ce1126" />
      <circle cx="4.6" cy="3.3" r="2" fill="#fff" />
      <circle cx="5.5" cy="3.3" r="1.7" fill="#0099b5" />
    </svg>
  )
}

export function FlagRU() {
  return (
    <svg viewBox="0 0 30 20" className="flag" aria-hidden="true">
      <rect width="30" height="20" fill="#fff" />
      <rect y="6.66" width="30" height="6.67" fill="#0039a6" />
      <rect y="13.33" width="30" height="6.67" fill="#d52b1e" />
    </svg>
  )
}

export function FlagEN() {
  return (
    <svg viewBox="0 0 30 20" className="flag" aria-hidden="true">
      <rect width="30" height="20" fill="#012169" />
      <path d="M0,0 L30,20 M30,0 L0,20" stroke="#fff" strokeWidth="4" />
      <path d="M0,0 L30,20 M30,0 L0,20" stroke="#c8102e" strokeWidth="2" />
      <path d="M15,0 V20 M0,10 H30" stroke="#fff" strokeWidth="6" />
      <path d="M15,0 V20 M0,10 H30" stroke="#c8102e" strokeWidth="3.5" />
    </svg>
  )
}

export const FLAGS = { uz: FlagUZ, ru: FlagRU, en: FlagEN }
