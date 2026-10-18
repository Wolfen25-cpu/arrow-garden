// Account dialog: sign in / sign up / sign out. Talks to cloud.js; main.js owns syncing.

import * as cloud from './cloud.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);

// Firebase error code → i18n key ('' means stay quiet, e.g. the user closed the popup).
const ERRORS = {
  'auth/invalid-email': 'error.invalidEmail',
  'auth/missing-password': 'error.missingPassword',
  'auth/weak-password': 'error.weakPassword',
  'auth/email-already-in-use': 'error.emailInUse',
  'auth/invalid-credential': 'error.badCredentials',
  'auth/wrong-password': 'error.badCredentials',
  'auth/user-not-found': 'error.badCredentials',
  'auth/too-many-requests': 'error.tooMany',
  'auth/network-request-failed': 'error.network',
  'auth/unauthorized-domain': 'error.domain',
  'auth/operation-not-allowed': 'error.notAllowed',
  'auth/popup-closed-by-user': '',
  'auth/cancelled-popup-request': '',
};

const errorText = (err) => {
  const key = ERRORS[err?.code];
  if (key === '') return '';
  return t(key ?? 'error.generic');
};

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
    if (cloud.cloudEnabled) ensureCloud().catch(() => say(t('error.network'), true));
  };

  // Without a Firebase config the dialog just explains that accounts are not set up yet.
  if (!cloud.cloudEnabled) {
    el.signedOut.hidden = true;
    el.unavailable.hidden = false;
    return { open, setUser() {}, setStatus() {}, translate() {} };
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
      say(typeof success === 'function' ? success() : success);
    } catch (err) {
      say(errorText(err), true);
    } finally {
      busy(false);
    }
  };

  el.open.addEventListener('click', open);

  el.google.addEventListener('click', () => {
    if (!cloud.isReady()) {
      say(t('account.loading'));
      return;
    }
    run(() => cloud.signInWithGoogle());
  });

  el.form.addEventListener('submit', (e) => {
    e.preventDefault(); // never let the browser submit credentials
    const action = e.submitter?.value === 'signup' ? 'signup' : 'signin';
    const email = el.form.email.value.trim();
    const password = el.form.password.value;
    if (!el.form.email.checkValidity()) return say(t('error.invalidEmail'), true);
    if (password.length < 6) return say(t('error.weakPassword'), true);
    run(async () => {
      await ensureCloud();
      await (action === 'signup' ? cloud.signUp(email, password) : cloud.signIn(email, password));
      el.form.password.value = '';
    });
  });

  el.reset.addEventListener('click', () => {
    const email = el.form.email.value.trim();
    if (!email || !el.form.email.checkValidity()) return say(t('account.resetNeedsEmail'), true);
    run(async () => {
      await ensureCloud();
      await cloud.resetPassword(email);
    }, () => t('account.resetSent'));
  });

  el.signOut.addEventListener('click', () => run(() => cloud.signOut()));

  let current = null;

  const account = {
    open,

    setUser(user) {
      current = user;
      el.signedOut.hidden = Boolean(user);
      el.signedIn.hidden = !user;
      el.email.textContent = user ? user.email || user.name : '';
      el.summary.textContent = t(user ? 'account.connected' : 'home.account');
      el.open.textContent = t(user ? 'account.view' : 'account.signIn');
      el.note.textContent = t(user ? 'settings.saveCloud' : 'settings.saveLocal');
    },

    // Redraws the texts that depend on the sign-in state after a language change.
    translate() {
      account.setUser(current);
      say('');
      cloud.setLanguage();
    },

    setStatus(text, isError = false) {
      say(text, isError);
    },
  };
  return account;
}
