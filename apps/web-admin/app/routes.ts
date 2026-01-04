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
        element: createElement(DashboardIndex),
      },
      {
        path: 'queues',
        loader: queuesLoader,
        element: createElement(QueuesPage),
      },
      {
        path: 'ingestion',
        element: createElement(IngestionPage),
      },
      {
        path: 'search',
        element: createElement(SearchPage),
      },
      {
        path: 'settings',
        action: settingsAction,
        element: createElement(SettingsPage),
      },
    ],
  },
];
