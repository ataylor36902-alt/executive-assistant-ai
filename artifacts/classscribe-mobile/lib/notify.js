let presentNotice = null;

export const Alert = {
  alert(title, message, buttons) {
    presentNotice?.({
      title: String(title || ''),
      message: typeof message === 'string' ? message : '',
      buttons: Array.isArray(buttons) && buttons.length ? buttons : [{ text: 'OK' }],
    });
  },
};

export function setNoticePresenter(presenter) {
  presentNotice = presenter;
  return () => { if (presentNotice === presenter) presentNotice = null; };
}