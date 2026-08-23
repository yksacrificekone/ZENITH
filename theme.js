// theme.js — the whole customization engine. Every value here maps directly
// to a CSS custom property consumed by style.css, so changes apply live
// with zero re-render of the rest of the app.

const STORAGE_KEY = 'zenith_theme_v1';
const SAVED_THEMES_KEY = 'zenith_saved_themes_v1';

export const DEFAULT_THEME = {
  name: 'Default (Midnight)',
  mode: 'dark',
  vars: {
    '--bg-deepest': '#0a0b10', '--bg-primary': '#14151c', '--bg-secondary': '#191a22',
    '--bg-tertiary': '#1f2029', '--bg-floating': '#20212b', '--bg-chat': '#15161e',
    '--bg-input': '#0f1017',
    '--text-primary': '#eef0f6', '--text-secondary': '#a7abb8', '--text-muted': '#72768a',
    '--accent': '#6c5ce7', '--accent-hover': '#7d6ff0',
    '--font-family': "'Inter','Segoe UI',system-ui,-apple-system,sans-serif",
    '--font-size-base': '15px', '--msg-spacing': '14px', '--ui-density': '1',
    '--panel-blur': '18px', '--panel-alpha': '0.86', '--bg-image': 'none',
  },
};

export const PRESETS = [
  DEFAULT_THEME,
  { name: 'Violet Dusk', mode: 'dark', previewClass: 'theme-preview-violet', vars: { ...DEFAULT_THEME.vars, '--accent': '#8b6cf0', '--accent-hover': '#9c81f5', '--bg-primary': '#1a1530', '--bg-secondary': '#201a3d', '--bg-tertiary': '#271f4a', '--bg-chat': '#160f28', '--bg-deepest': '#0d0a1a' } },
  { name: 'Crimson', mode: 'dark', previewClass: 'theme-preview-crimson', vars: { ...DEFAULT_THEME.vars, '--accent': '#e8485c', '--accent-hover': '#f25f72', '--bg-primary': '#1c1215', '--bg-secondary': '#231518', '--bg-tertiary': '#2b191c', '--bg-chat': '#170f11', '--bg-deepest': '#0f0a0b' } },
  { name: 'Forest', mode: 'dark', previewClass: 'theme-preview-forest', vars: { ...DEFAULT_THEME.vars, '--accent': '#2fbf71', '--accent-hover': '#3fd382', '--bg-primary': '#0f1a15', '--bg-secondary': '#12201a', '--bg-tertiary': '#172a21', '--bg-chat': '#0b140f', '--bg-deepest': '#080f0b' } },
  { name: 'Sunset', mode: 'dark', previewClass: 'theme-preview-sunset', vars: { ...DEFAULT_THEME.vars, '--accent': '#f5934b', '--accent-hover': '#f9a868', '--bg-primary': '#1c150f', '--bg-secondary': '#231a12', '--bg-tertiary': '#2b2016', '--bg-chat': '#170f0a', '--bg-deepest': '#0f0a07' } },
  { name: 'Ocean', mode: 'dark', previewClass: 'theme-preview-ocean', vars: { ...DEFAULT_THEME.vars, '--accent': '#3aa6ff', '--accent-hover': '#5cb8ff', '--bg-primary': '#0d1826', '--bg-secondary': '#101f30', '--bg-tertiary': '#14283c', '--bg-chat': '#0a131e', '--bg-deepest': '#070d15' } },
  { name: 'Monochrome', mode: 'dark', previewClass: 'theme-preview-mono', vars: { ...DEFAULT_THEME.vars, '--accent': '#8a8a8a', '--accent-hover': '#a0a0a0', '--bg-primary': '#141414', '--bg-secondary': '#191919', '--bg-tertiary': '#202020', '--bg-chat': '#101010', '--bg-deepest': '#0a0a0a' } },
  { name: 'Daylight', mode: 'light', previewClass: 'theme-preview-light', vars: { ...DEFAULT_THEME.vars, '--accent': '#6c5ce7', '--accent-hover': '#5b4bd6', '--bg-deepest': '#e7e9f2', '--bg-primary': '#ffffff', '--bg-secondary': '#f4f5f9', '--bg-tertiary': '#e9ebf3', '--bg-floating': '#ffffff', '--bg-chat': '#fbfbfe', '--bg-input': '#eef0f7', '--text-primary': '#1c1d26', '--text-secondary': '#4d4f5c', '--text-muted': '#83869a' } },
];

export function loadThemeState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { vars: { ...DEFAULT_THEME.vars }, presetName: DEFAULT_THEME.name };
  } catch (e) { return { vars: { ...DEFAULT_THEME.vars }, presetName: DEFAULT_THEME.name }; }
}

export function saveThemeState(themeState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(themeState));
}

export function applyThemeVars(vars) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  if (vars['--bg-image'] && vars['--bg-image'] !== 'none') {
    document.getElementById('app-bg').style.backgroundImage = vars['--bg-image'];
    document.getElementById('app-bg').classList.remove('hidden');
  } else {
    document.getElementById('app-bg').classList.add('hidden');
  }
}

export function initTheme() {
  const t = loadThemeState();
  applyThemeVars({ ...DEFAULT_THEME.vars, ...t.vars });
  return t;
}

export function getSavedThemes() {
  try { return JSON.parse(localStorage.getItem(SAVED_THEMES_KEY) || '[]'); } catch (e) { return []; }
}
export function saveCustomTheme(name, vars) {
  const list = getSavedThemes();
  const idx = list.findIndex(t => t.name === name);
  const entry = { name, vars };
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  localStorage.setItem(SAVED_THEMES_KEY, JSON.stringify(list));
  return list;
}
export function deleteCustomTheme(name) {
  const list = getSavedThemes().filter(t => t.name !== name);
  localStorage.setItem(SAVED_THEMES_KEY, JSON.stringify(list));
  return list;
}

export function resetTheme() {
  saveThemeState({ vars: { ...DEFAULT_THEME.vars }, presetName: DEFAULT_THEME.name });
  applyThemeVars(DEFAULT_THEME.vars);
}
