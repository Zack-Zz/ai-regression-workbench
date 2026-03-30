import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { t, getLocale, setLocale, type Locale } from '../i18n.js';

const LOCALE_KEY = 'zarb-locale';

// Apply persisted locale on module load
const savedLocale = localStorage.getItem(LOCALE_KEY) as Locale | null;
if (savedLocale === 'en-US' || savedLocale === 'zh-CN') setLocale(savedLocale);

export function Layout(): React.ReactElement {
  const navigate = useNavigate();
  const [locale, setLocaleState] = React.useState(getLocale());
  const navItems = [
    { path: '/', label: t('nav.home') },
    { path: '/start-run', label: t('nav.startRun') },
    { path: '/runs', label: t('nav.runs') },
    { path: '/code-tasks', label: t('nav.codeTasks') },
    { path: '/projects', label: t('nav.projects') },
  ] as const;

  function toggleLocale(): void {
    const next = locale === 'zh-CN' ? 'en-US' : 'zh-CN';
    setLocale(next);
    localStorage.setItem(LOCALE_KEY, next);
    setLocaleState(next);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="app-brand">
            <span className="app-brand__mark">Z</span>
            <div className="app-brand__meta">
              <span className="app-brand__name">ZARB</span>
              <span className="app-brand__tagline">{t('layout.tagline')}</span>
            </div>
          </div>
          <nav className="app-nav" aria-label="Primary">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) => ['app-nav__link', isActive ? 'app-nav__link--active' : ''].filter(Boolean).join(' ')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="app-header__spacer" />
          <div className="app-header__actions">
            <button type="button" onClick={toggleLocale} className="app-header__button">
              {locale === 'zh-CN' ? 'EN' : '中文'}
            </button>
            <button type="button" onClick={() => { navigate('/settings'); }} className="app-header__button">
              {t('nav.settings')}
            </button>
          </div>
        </div>
      </header>
      <main className="app-main" key={locale}>
        <Outlet />
      </main>
    </div>
  );
}
