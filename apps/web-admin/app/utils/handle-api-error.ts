import { ApiError } from './api-error';

export function handleApiError(error: unknown): never {
  // React Router loaders/actions intentionally throw Response objects.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  if (error instanceof Response) throw error;

  if (error instanceof ApiError) {
    if (error.status === 404) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw new Response('Not Found', { status: 404 });
    }
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw new Response('Internal Error', { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw new Response('Internal Error', { status: 500 });
}
