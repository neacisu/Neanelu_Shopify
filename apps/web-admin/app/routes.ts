import { createElement } from 'react';
import type { RouteObject } from 'react-router-dom';

import DashboardIndex, { loader as dashboardLoader } from './routes/_index';
import AuthCallbackPage from './routes/auth.callback';
import AuthRequiredPage from './routes/auth.required';
import IngestionPage, {
  loader as ingestionLoader,
  action as ingestionAction,
} from './routes/ingestion';
import IngestionHistoryPage, {
  loader as ingestionHistoryLoader,
  action as ingestionHistoryAction,
} from './routes/ingestion.history';
import IngestionSchedulePage, {
  loader as ingestionScheduleLoader,
  action as ingestionScheduleAction,
} from './routes/ingestion.schedule';
import QueuesPage, { action as queuesAction, loader as queuesLoader } from './routes/queues';
import Root, { ErrorBoundary, HydrateFallback } from './root';
import SearchPage from './routes/search';
import SettingsPage from './routes/settings';

export const routes: RouteObject[] = [
  {
    id: 'root',
    path: '/',
    element: createElement(Root),
    errorElement: createElement(ErrorBoundary),
    hydrateFallbackElement: createElement(HydrateFallback),
    children: [
      {
        id: 'auth-callback',
        path: 'auth/callback',
        handle: { title: 'Auth', skipEmbeddedGate: true },
        element: createElement(AuthCallbackPage),
      },
      {
        id: 'auth-required',
        path: 'auth/required',
        handle: { title: 'Auth', skipEmbeddedGate: true },
        element: createElement(AuthRequiredPage),
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
        action: queuesAction,
        handle: { title: 'Queues' },
        element: createElement(QueuesPage),
      },
      {
        id: 'ingestion',
        path: 'ingestion',
        loader: ingestionLoader,
        action: ingestionAction,
        handle: { title: 'Ingestion' },
        element: createElement(IngestionPage),
      },
      {
        id: 'ingestion-history',
        path: 'ingestion/history',
        loader: ingestionHistoryLoader,
        action: ingestionHistoryAction,
        handle: { title: 'Ingestion History' },
        element: createElement(IngestionHistoryPage),
      },
      {
        id: 'ingestion-schedule',
        path: 'ingestion/schedule',
        loader: ingestionScheduleLoader,
        action: ingestionScheduleAction,
        handle: { title: 'Ingestion Schedule' },
        element: createElement(IngestionSchedulePage),
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
        handle: { title: 'Settings' },
        element: createElement(SettingsPage),
      },
    ],
  },
];
