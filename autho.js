import { api, setToken } from '../api.js';
import { q } from '../dom.js';

function showPanel(name) {
  q('#login-panel').classList.toggle('hidden', name !== 'login');
  q('#signup-panel').classList.toggle('hidden', name !== 'signup');
  q('#forgot-panel').classList.toggle('hidden', name !== 'forgot');
}

function setError(id, msg) {
  const node = q(id);
  if (!msg) { node.classList.add('hidden'); node.textContent = ''; return; }
  node.textContent = msg;
  node.classList.remove('hidden');
}

export function initAuthScreen(onAuthed) {
  q('#show-signup').addEventListener('click', (e) => { e.preventDefault(); showPanel('signup'); });
  q('#show-login').addEventListener('click', (e) => { e.preventDefault(); showPanel('login'); });
  q('#forgot-link').addEventListener('click', (e) => { e.preventDefault(); showPanel('forgot'); });
  q('#back-to-login').addEventListener('click', (e) => { e.preventDefault(); showPanel('login'); });

  q('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('#login-error', '');
    const btn = q('#login-submit');
    btn.disabled = true; btn.textContent = 'Logging in…';
    try {
      const { token, user } = await api.login({
        identifier: q('#login-identifier').value.trim(),
        password: q('#login-password').value,
      });
      setToken(token);
      onAuthed(user);
    } catch (err) {
      setError('#login-error', err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Log In';
    }
  });

  q('#signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('#signup-error', '');
    const btn = q('#signup-submit');
    btn.disabled = true; btn.textContent = 'Creating account…';
    try {
      const { token, user } = await api.register({
        displayName: q('#signup-displayname').value.trim(),
        username: q('#signup-username').value.trim(),
        email: q('#signup-email').value.trim(),
        password: q('#signup-password').value,
      });
      setToken(token);
      onAuthed(user);
    } catch (err) {
      setError('#signup-error', err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Create Account';
    }
  });

  q('#forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultBox = q('#forgot-result');
    try {
      const res = await api.forgotPassword(q('#forgot-email').value.trim());
      resultBox.classList.remove('hidden');
      resultBox.textContent = 'If that email has an account, a reset link has been generated.'
        + (res.resetToken ? ` (No email service is configured — dev reset token: ${res.resetToken})` : '');
    } catch (err) {
      resultBox.classList.remove('hidden');
      resultBox.textContent = err.message;
    }
  });
}

export function showAuthScreen() {
  q('#boot-loading').classList.add('hidden');
  q('#app-screen').classList.add('hidden');
  q('#auth-screen').classList.remove('hidden');
  showPanel('login');
}
