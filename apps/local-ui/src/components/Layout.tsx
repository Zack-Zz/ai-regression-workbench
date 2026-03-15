import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { t } from '../i18n.js';

export function Layout(): React.ReactElement {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', padding: '0 1.5rem', height: 48, background: '#1a1a2e', color: '#fff', gap: '1.5rem' }}>
        <span style={{ fontWeight: 700, fontSize: '1.1em', marginRight: '1rem' }}>ZARB</span>
        {(['/', '/runs', '/code-tasks'] as const).map((path, i) => (
          <NavLink key={path} to={path} end={path === '/'} style={({ isActive }) => ({ color: isActive ? '#7af' : '#ccc', textDecoration: 'none', fontSize: '0.9em' })}>
            {[t('nav.home'), t('nav.runs'), t('nav.codeTasks')][i]}
          </NavLink>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => { navigate('/settings'); }} style={{ background: 'none', border: '1px solid #555', color: '#ccc', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: '0.85em' }}>
          {t('nav.settings')}
        </button>
      </header>
      <main style={{ flex: 1, padding: '1.5rem', maxWidth: 1200, width: '100%', margin: '0 auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
