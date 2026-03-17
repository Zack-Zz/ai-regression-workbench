import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { HomePage } from './pages/HomePage.js';
import { RunListPage } from './pages/RunListPage.js';
import { RunDetailPage } from './pages/RunDetailPage.js';
import { FailureReportPage } from './pages/FailureReportPage.js';
import { ExecutionReportPage } from './pages/ExecutionReportPage.js';
import { CodeTaskDetailPage } from './pages/CodeTaskDetailPage.js';
import { CodeTaskListPage } from './pages/CodeTaskListPage.js';
import { ProjectsPage } from './pages/ProjectsPage.js';
import { ProjectDetailPage } from './pages/ProjectDetailPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

export function App(): React.ReactElement {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="runs" element={<RunListPage />} />
        <Route path="runs/:runId" element={<RunDetailPage />} />
        <Route path="runs/:runId/execution-report" element={<ExecutionReportPage />} />
        <Route path="runs/:runId/testcases/:testcaseId/failure-report" element={<FailureReportPage />} />
        <Route path="code-tasks" element={<CodeTaskListPage />} />
        <Route path="code-tasks/:taskId" element={<CodeTaskDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
      </Route>
    </Routes>
  );
}
