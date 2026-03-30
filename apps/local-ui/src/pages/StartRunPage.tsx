import React from 'react';
import { Card } from '../components/ui.js';
import { t } from '../i18n.js';
import { QuickRunPanel } from '../components/QuickRunPanel.js';

export function StartRunPage(): React.ReactElement {
  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <span className="page-intro__eyebrow">{t('startRun.eyebrow')}</span>
          <h1 className="page-intro__title">{t('startRun.title')}</h1>
        </div>
      </section>

      <div className="home-grid">
        <Card
          title={t('startRun.config.title')}
          subtitle={t('startRun.config.subtitle')}
          className="ui-card--accent"
        >
          <QuickRunPanel />
        </Card>

        <div className="sidebar-stack">
          <Card
            title={t('startRun.help.title')}
            subtitle={t('startRun.help.subtitle')}
          >
            <div className="info-list">
              <div className="info-list__item">
                <div className="info-list__title">{t('startRun.help.step1.title')}</div>
                <div className="info-list__body">{t('startRun.help.step1.body')}</div>
              </div>
              <div className="info-list__item">
                <div className="info-list__title">{t('startRun.help.step2.title')}</div>
                <div className="info-list__body">{t('startRun.help.step2.body')}</div>
              </div>
              <div className="info-list__item">
                <div className="info-list__title">{t('startRun.help.step3.title')}</div>
                <div className="info-list__body">{t('startRun.help.step3.body')}</div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
