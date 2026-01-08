import { createElement } from 'react';
import type { RouteObject } from 'react-router-dom';

import DashboardIndex, { loader as dashboardLoader } from './routes/_index';
import AuthCallbackPage from './routes/auth.callback';
import IngestionPage from './routes/ingestion';
import QueuesPage, { loader as queuesLoader } from './routes/queues';
import Root, { ErrorBoundary } from './root';
import SearchPage from './routes/search';
import SettingsPage, { action as settingsAction } from './routes/settings';

export const routes: RouteObject[] = [
  {
    id: 'root',
    path: '/',
    element: createElement(Root),
    errorElement: createElement(ErrorBoundary),
    children: [
      {
        id: 'auth-callback',
        path: 'auth/callback',
        handle: { title: 'Auth', skipEmbeddedGate: true },
        element: createElement(AuthCallbackPage),
      },
      {
        id: 'dashboard',
        index: true,
        loader: dashboardLoader,
        handle: { title: 'Dashboard' },
        element: createElement(DashboardIndex),
      },
      {
        id: 'queues',
        path: 'queues',
        loader: queuesLoader,
        handle: { title: 'Queues' },
        element: createElement(QueuesPage),
      },
      {
        id: 'ingestion',
        path: 'ingestion',
        handle: { title: 'Ingestion' },
        element: createElement(IngestionPage),
      },
      {
        id: 'search',
        path: 'search',
        handle: { title: 'Search' },
        element: createElement(SearchPage),
      },
      {
        id: 'settings',
        path: 'settings',
        action: settingsAction,
        handle: { title: 'Settings' },
        element: createElement(SettingsPage),
      },
    ],
  },
];
