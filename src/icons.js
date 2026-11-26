const artwork = {
  '🏠': '<path fill="#50b8ff" d="M2 11 12 2l10 9-3 1v9H5v-9z"/><path fill="#deefff" d="M9 13h6v8H9z"/>',
  '📚': '<path fill="#3894ed" d="m2 8 10-5 10 5-10 5zM2 12l10 5 10-5v3l-10 5-10-5z"/><path fill="#9cddff" d="m2 8 10 5 10-5-10-5z"/>',
  '📖': '<path fill="#64c1ff" d="M2 4h5c2 0 4 1 5 3 1-2 3-3 5-3h5v15h-5c-2 0-4 1-5 3-1-2-3-3-5-3H2z"/><path fill="#e9f7ff" d="M4 6h3c2 0 3 1 4 2v9c-1-1-3-2-4-2H4zm16 0h-3c-2 0-3 1-4 2v9c1-1 3-2 4-2h3z"/>',
  '🔎': '<circle cx="10" cy="10" r="6" fill="#8d3b85" stroke="#f7a0ea" stroke-width="3"/><path stroke="#f7a0ea" stroke-width="3" stroke-linecap="round" d="m15 15 6 6"/><path stroke="#fff2fa" stroke-width="2" d="M7 11v-2m3 2V6m3 5V8"/>',
  '🛡️': '<path fill="#42b788" d="M12 2 3 6v6c0 5 4 8 9 10 5-2 9-5 9-10V6z"/><path fill="#0f4434" d="m12 5-6 3v4c0 3 2 5 6 7 4-2 6-4 6-7V8z"/><path fill="none" stroke="#a0ffd5" stroke-width="2" d="m8 12 3 3 5-6"/>',
  '🪙': '<path fill="#d88427" d="M2 7h11v10c0 4-11 4-11 0zm11-1h9v12c0 3-9 3-9 0z"/><ellipse fill="#ffe18c" cx="7.5" cy="7" rx="5.5" ry="3"/><ellipse fill="#ffbf55" cx="17.5" cy="6" rx="4.5" ry="3"/><path stroke="#ffde7d" fill="none" d="M2 12c2 2 8 2 11 0m0 2c2 2 7 2 9 0"/>',
  '🧠': '<path fill="#a776ee" d="M12 4a4 4 0 0 0-7 2c-3 1-4 6-1 8-1 4 2 7 6 6l2-2 2 2c4 1 7-2 6-6 3-2 2-7-1-8a4 4 0 0 0-7-2z"/><path stroke="#f3dcff" stroke-width="1.6" fill="none" d="M12 4v14M6 8c4 0 4 4 1 5m11-5c-4 0-4 4-1 5"/>',
  '🌐': '<circle fill="#23699e" cx="12" cy="12" r="10"/><path fill="none" stroke="#87e9ff" stroke-width="1.5" d="M2 12h20M4 7h16M4 17h16M12 2c-6 5-6 15 0 20m0-20c6 5 6 15 0 20"/>',
  '👥': '<circle fill="#81d7ff" cx="9" cy="7" r="4"/><circle fill="#569de5" cx="18" cy="8" r="3"/><path fill="#489fff" d="M2 20v-3a7 7 0 0 1 14 0v3zm15 0v-4a5 5 0 0 0-1-3 5 5 0 0 1 7 5v2z"/>',
  '📄': '<path fill="#559fe9" d="M5 2h9l5 5v15H5z"/><path fill="#d5efff" d="M14 2v6h5M8 11h8v2H8zm0 4h8v2H8z"/>',
  '⚙️': '<path fill="#90afd4" d="m9 2 1 3h4l1-3 4 2-1 3 2 3 3 1-1 4-3 1-2 2v3l-4 1-2-2-3 1-3-3 1-3-2-2H1l1-4 3-1 1-3 3 1z"/><circle fill="#293e63" cx="12" cy="12" r="4"/>',
  'ℹ️': '<circle fill="#879fc6" cx="12" cy="12" r="10"/><path stroke="#142943" stroke-width="2.5" d="M12 11v6m0-10v2"/>',
  '🔗': '<path fill="none" stroke="#54bdff" stroke-width="3" stroke-linecap="round" d="m10 7 3-3a5 5 0 0 1 7 7l-3 3m-3 3-3 3a5 5 0 0 1-7-7l3-3"/><path stroke="#d4f3ff" stroke-width="3" stroke-linecap="round" d="m9 15 6-6"/>',
  '📊': '<path fill="#53aaff" d="M3 12h4v9H3z"/><path fill="#bd8ffa" d="M10 7h4v14h-4z"/><path fill="#f7bc5b" d="M17 3h4v18h-4z"/>',
  '💬': '<path fill="#54baf6" d="M3 4h18v12H9l-6 5z"/><path stroke="#153460" stroke-width="2" d="M7 8h10m-10 4h7"/>',
  '🤝': '<path fill="#f3ae68" d="M2 9 6 5l5 2 3-1 8 5-5 8-6-1-5-4z"/><path fill="#925f65" d="m8 9 4-3 3 1 5 5-2 2-5-4-3 2z"/><path fill="#ffd6a0" d="m3 8 5 6-3 3-4-6zm17 0 3 4-4 5-3-3z"/>',
  '🔭': '<path fill="#9cd9ff" d="M3 6 19 2l2 5-16 6z"/><path fill="#4578cb" d="m11 11 3-1 6 11h-3l-4-7-4 7H6z"/><path fill="#eff8ff" d="m17 3 3-1 2 5-3 1z"/>',
  '📈': '<path fill="#294654" d="M3 3h18v18H3z"/><path fill="none" stroke="#86f0ad" stroke-width="2" d="m5 17 5-6 4 3 5-8m-4 0h4v4"/>',
  '🎓': '<path fill="#81caff" d="M2 8 12 3l10 5-10 5zm4 4 6 3 6-3v6c-4 3-8 3-12 0z"/><path stroke="#ffcd6a" stroke-width="2" d="M22 9v7"/>',
  '⚗️': '<path fill="#82caff" d="M9 3h6v7l6 8c1 2 0 3-2 3H5c-2 0-3-1-2-3l6-8z"/><path fill="#4e68d8" d="m6 15-3 4h18l-3-4z"/><path fill="#f0f7ff" d="M8 2h8v3H8z"/>',
  '🌿': '<path fill="#69df90" d="M3 4c9-2 17 0 18 8 0 5-4 8-8 8C6 20 2 13 3 4z"/><path stroke="#12654d" stroke-width="2" d="m4 21 13-13m-8 8-2-7m5 4h6"/>',
};

const aliases = {
  '📑': '📄', '📝': '📄', '🧾': '📄', '🗂️': '📚', '🧪': '⚗️',
  '🕒': 'ℹ️', '🛰️': '🌐', '💹': '📊',
};

export function icon(glyph) {
  const drawing = artwork[glyph] ?? artwork[aliases[glyph]] ?? artwork['ℹ️'];
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${drawing}</svg>`;
}
