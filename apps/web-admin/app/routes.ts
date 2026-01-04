import { createElement } from 'react';
import type { RouteObject } from 'react-router-dom';

import DashboardIndex from './routes/_index';
import Root, { ErrorBoundary } from './root';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: createElement(Root),
    errorElement: createElement(ErrorBoundary),
    children: [
      {
        index: true,
        element: createElement(DashboardIndex),
      },
    ],
  },
];
