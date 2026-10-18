// Account dialog: sign in / sign up / sign out. Talks to cloud.js; main.js owns syncing.

import * as cloud from './cloud.js';

const $ = (id) => document.getElementById(id);

const ERRORS = {
  'auth/invalid-email': 'El correo no es válido.',
  'auth/missing-password': 'Escribe tu contraseña.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Prueba a entrar.',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/too-many-requests': 'Demasiados intentos. Espera un momento y vuelve a probar.',
  'auth/network-request-failed': 'Sin conexión. Revisa tu internet e inténtalo de nuevo.',
  'auth/unauthorized-domain': 'Este sitio no está autorizado en Firebase (revisa los dominios autorizados).',
  'auth/operation-not-allowed': 'Este método de inicio de sesión no está activado.',
  'auth/popup-closed-by-user': '',
  'auth/cancelled-popup-request': '',
};

const errorText = (err) => ERRORS[err?.code] ?? 'Algo salió mal. Inténtalo de nuevo.';

export function setupAccount({ ensureCloud }) {
  const el = {
    row: $('account-row'),
    summary: $('account-summary'),
    open: $('btn-account'),
    note: $('save-note'),
    settings: $('settings'),
    dialog: $('account'),
    signedOut: $('account-signed-out'),
    signedIn: $('account-signed-in'),
    email: $('account-email'),
    form: $('email-form'),
    google: $('btn-google'),
    reset: $('btn-reset'),
    signOut: $('btn-signout'),
    message: $('account-message'),
    unavailable: $('account-unavailable'),
  };

  const say = (text, isError = false) => {
    el.message.textContent = text;
    el.message.classList.toggle('is-error', isError);
  };

  const open = () => {
    el.settings.close();
    say('');
    el.dialog.showModal();
    // Start loading Firebase now so the Google popup can open instantly on click.
    if (cloud.cloudEnabled) ensureCloud().catch(() => say(ERRORS['auth/network-request-failed'], true));
  };

  // Without a Firebase config the dialog just explains that accounts are not set up yet.
  if (!cloud.cloudEnabled) {
    el.signedOut.hidden = true;
    el.unavailable.hidden = false;
    return { open, setUser() {}, setStatus() {} };
  }
  el.row.hidden = false;

  const busy = (on) => {
    for (const button of el.dialog.querySelectorAll('button:not([data-close])')) button.disabled = on;
  };

  const run = async (task, success = '') => {
    busy(true);
    say('');
    try {
      await task();
      say(success);
    } catch (err) {
      say(errorText(err), true);
    } finally {
      busy(false);
    }
  };

  el.open.addEventListener('click', open);

  el.google.addEventListener('click', () => {
    if (!cloud.isReady()) {
      say('Cargando… vuelve a tocar en un momento.');
      return;
    }
    run(() => cloud.signInWithGoogle());
  });

  el.form.addEventListener('submit', (e) => {
    e.preventDefault(); // never let the browser submit credentials
    const action = e.submitter?.value === 'signup' ? 'signup' : 'signin';
    const email = el.form.email.value.trim();
    const password = el.form.password.value;
    if (!el.form.email.checkValidity()) return say(ERRORS['auth/invalid-email'], true);
    if (password.length < 6) return say(ERRORS['auth/weak-password'], true);
    run(async () => {
      await ensureCloud();
      await (action === 'signup' ? cloud.signUp(email, password) : cloud.signIn(email, password));
      el.form.password.value = '';
    });
  });

  el.reset.addEventListener('click', () => {
    const email = el.form.email.value.trim();
    if (!email || !el.form.email.checkValidity()) return say('Escribe tu correo arriba y vuelve a tocar aquí.', true);
    run(async () => {
      await ensureCloud();
      await cloud.resetPassword(email);
    }, 'Si existe una cuenta con ese correo, te enviamos un enlace para cambiar la contraseña.');
  });

  el.signOut.addEventListener('click', () => run(() => cloud.signOut()));

  return {
    open,

    setUser(user) {
      el.signedOut.hidden = Boolean(user);
      el.signedIn.hidden = !user;
      el.email.textContent = user ? user.email || user.name : '';
      el.summary.textContent = user ? 'Cuenta conectada' : 'Cuenta';
      el.open.textContent = user ? 'Ver cuenta' : 'Iniciar sesión';
      el.note.textContent = user
        ? 'Tu progreso se guarda en este dispositivo y en tu cuenta.'
        : 'Tu progreso se guarda en este dispositivo.';
    },

    setStatus(text, isError = false) {
      say(text, isError);
    },
  };
}
