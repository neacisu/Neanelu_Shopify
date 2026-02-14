import { isRouteErrorResponse, useRouteError } from 'react-router-dom';

import { RouteErrorPage } from '../components/errors/error-pages';
import { reportUiError } from '../utils/report-ui-error';

export default function PimRouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return <RouteErrorPage status={error.status} statusText={error.statusText} />;
  }

  // Keep UI safe and actionable; retry is provided by RouteErrorPage via revalidator.
  const message = error instanceof Error ? error.message : 'Eroare neasteptata in PIM.';
  reportUiError(error instanceof Error ? error : new Error(message), {
    source: 'route',
    route: '/pim',
  });

  return <RouteErrorPage status={500} statusText={message} />;
}
