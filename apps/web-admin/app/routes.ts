import { createElement } from 'react';
import type { RouteObject } from 'react-router-dom';

import DashboardIndex, { loader as dashboardLoader } from './routes/_index';
import IngestionPage from './routes/ingestion';
import QueuesPage, { loader as queuesLoader } from './routes/queues';
import Root, { ErrorBoundary } from './root';
import SearchPage from './routes/search';
import SettingsPage, { action as settingsAction } from './routes/settings';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: createElement(Root),
    errorElement: createElement(ErrorBoundary),
    children: [
      {
        index: true,
        loader: dashboardLoader,
        handle: { title: 'Dashboard' },
        element: createElement(DashboardIndex),
      },
      {
        path: 'queues',
        loader: queuesLoader,
        handle: { title: 'Queues' },
        element: createElement(QueuesPage),
      },
      {
        path: 'ingestion',
        handle: { title: 'Ingestion' },
        element: createElement(IngestionPage),
      },
      {
        path: 'search',
        handle: { title: 'Search' },
        element: createElement(SearchPage),
      },
      {
        path: 'settings',
        action: settingsAction,
        handle: { title: 'Settings' },
        element: createElement(SettingsPage),
      },
    ],
  },
];
