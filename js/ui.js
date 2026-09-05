// Waya — utilitários de interface
// Ícones em SVG (sem emojis), folhas inferiores, toasts e confirmação.

const icons = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.4"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7a5 5 0 010-10h2M15 7h2a5 5 0 010 10h-2M8 12h8"/></svg>',
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M5 8v4a4 4 0 004 4h6"/></svg>',
  ranking: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V12M12 20V4M20 20v-7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.7 1.7 0 000-3l-1-.2a6.9 6.9 0 00-.7-1.6l.6-.9a1.7 1.7 0 00-2.4-2.4l-.9.6a6.9 6.9 0 00-1.6-.7l-.2-1a1.7 1.7 0 00-3 0l-.2 1a6.9 6.9 0 00-1.6.7l-.9-.6a1.7 1.7 0 00-2.4 2.4l.6.9a6.9 6.9 0 00-.7 1.6l-1 .2a1.7 1.7 0 000 3l1 .2a6.9 6.9 0 00.7 1.6l-.6.9a1.7 1.7 0 002.4 2.4l.9-.6a6.9 6.9 0 001.6.7l.2 1a1.7 1.7 0 003 0l.2-1a6.9 6.9 0 001.6-.7l.9.6a1.7 1.7 0 002.4-2.4l-.6-.9a6.9 6.9 0 00.7-1.6z"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l6 6L20 6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l11-11-4-4L4 16v4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.4-4.4"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  cloudOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M9.5 7A5 5 0 0119 11.2 3.6 3.6 0 0118 18H8a4.3 4.3 0 01-1.7-8.2"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 9a3 3 0 110-6M15 14a5.5 5.5 0 015.5 6"/></svg>'
};

function icon(name, extraClass) {
  return `<span class="icon ${extraClass || ''}">${icons[name] || ''}</span>`;
}

// ---------------------------------------------------------------- toasts

function showToast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2800);
}

// ------------------------------------------------------------ bottom sheets
//
// Comportamento do botão de retroceder do Android: abrir uma folha empurra
// uma entrada no histórico do browser; fechar (por botão ou pelo próprio
// retroceder) consome essa entrada. Isto evita que o retroceder feche a app
// inteira quando só se queria fechar uma folha.

let overlayHistoryPushed = false;

function openSheet(id) {
  document.getElementById('backdrop').classList.add('show');
  document.getElementById(id).classList.add('open');
  if (!overlayHistoryPushed) {
    overlayHistoryPushed = true;
    history.pushState({ wayaOverlay: true }, '');
  }
}

function closeSheet(id) {
  document.getElementById(id).classList.remove('open');
  scheduleOverlayHistoryCheck();
}

function closeAllSheets() {
  document.querySelectorAll('.sheet.open').forEach((s) => s.classList.remove('open'));
  scheduleOverlayHistoryCheck();
}

// Espera um instante antes de decidir se deve "consumir" a entrada do
// histórico — assim, trocar directamente de uma folha para outra (fechar A,
// abrir B na mesma acção) não gera um vaivém desnecessário no histórico.
function scheduleOverlayHistoryCheck() {
  setTimeout(() => {
    if (document.querySelector('.sheet.open')) {
      document.getElementById('backdrop').classList.add('show');
      return;
    }
    document.getElementById('backdrop').classList.remove('show');
    if (overlayHistoryPushed) {
      overlayHistoryPushed = false;
      history.back();
    }
  }, 0);
}

window.addEventListener('popstate', () => {
  if (document.querySelector('.sheet.open')) {
    document.querySelectorAll('.sheet.open').forEach((s) => s.classList.remove('open'));
    document.getElementById('backdrop').classList.remove('show');
    overlayHistoryPushed = false;
  } else if (typeof window.wayaBackToMapScreen === 'function') {
    window.wayaBackToMapScreen();
  }
});

// -------------------------------------------------------------- confirmação

function confirmAction(message, confirmLabel = 'Confirmar') {
  return new Promise((resolve) => {
    const sheet = document.getElementById('confirmSheet');
    sheet.querySelector('.confirm-message').textContent = message;
    const confirmBtn = sheet.querySelector('.confirm-yes');
    const cancelBtn = sheet.querySelector('.confirm-no');
    confirmBtn.textContent = confirmLabel;

    const cleanup = (result) => {
      confirmBtn.removeEventListener('click', onYes);
      cancelBtn.removeEventListener('click', onNo);
      closeSheet('confirmSheet');
      resolve(result);
    };
    const onYes = () => cleanup(true);
    const onNo = () => cleanup(false);
    confirmBtn.addEventListener('click', onYes);
    cancelBtn.addEventListener('click', onNo);
    openSheet('confirmSheet');
  });
}

window.wayaUI = { icon, icons, showToast, openSheet, closeSheet, closeAllSheets, confirmAction };
