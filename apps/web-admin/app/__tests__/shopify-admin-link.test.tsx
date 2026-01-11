import type createApp from '@shopify/app-bridge';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ShopifyAdminLink, type ShopifyResourceType } from '../components/domain/ShopifyAdminLink';
import * as appBridgeSingleton from '../shopify/app-bridge-singleton';

type AppBridgeApp = ReturnType<typeof createApp>;

// Mock the app-bridge-singleton module
vi.mock('../shopify/app-bridge-singleton', () => ({
  getAppBridgeApp: vi.fn(() => null),
}));

// Mock App Bridge Redirect
vi.mock('@shopify/app-bridge/actions', () => ({
  Redirect: {
    create: vi.fn(() => ({
      dispatch: vi.fn(),
    })),
    Action: {
      ADMIN_PATH: 'ADMIN_PATH',
    },
  },
}));

describe('ShopifyAdminLink', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    // Mock window.location.search with shop parameter
    Object.defineProperty(window, 'location', {
      value: {
        ...originalLocation,
        search: '?shop=test-shop.myshopify.com',
      },
      writable: true,
    });

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  it('renders link with correct href for products resource', () => {
    render(<ShopifyAdminLink resourceType="products">View Products</ShopifyAdminLink>);

    const link = screen.getByRole('link', { name: /View Products/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://test-shop.myshopify.com/admin/products');
  });

  it('renders link with resource ID', () => {
    render(
      <ShopifyAdminLink resourceType="products" resourceId="123456789">
        View Product
      </ShopifyAdminLink>
    );

    const link = screen.getByRole('link', { name: /View Product/i });
    expect(link).toHaveAttribute(
      'href',
      'https://test-shop.myshopify.com/admin/products/123456789'
    );
  });

  it('renders link with sub-path', () => {
    render(
      <ShopifyAdminLink resourceType="orders" resourceId="987654321" subPath="edit">
        Edit Order
      </ShopifyAdminLink>
    );

    const link = screen.getByRole('link', { name: /Edit Order/i });
    expect(link).toHaveAttribute(
      'href',
      'https://test-shop.myshopify.com/admin/orders/987654321/edit'
    );
  });

  it('opens in new tab when App Bridge is not available', async () => {
    const user = userEvent.setup();
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <ShopifyAdminLink resourceType="products" fallbackNewTab>
        View Products
      </ShopifyAdminLink>
    );

    const link = screen.getByRole('link', { name: /View Products/i });
    await user.click(link);

    expect(windowOpen).toHaveBeenCalledWith(
      'https://test-shop.myshopify.com/admin/products',
      '_blank',
      'noopener,noreferrer'
    );

    windowOpen.mockRestore();
  });

  it('renders disabled state correctly', () => {
    render(
      <ShopifyAdminLink resourceType="products" disabled>
        View Products
      </ShopifyAdminLink>
    );

    const link = screen.getByRole('link', { name: /View Products/i });
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveClass('opacity-50');
  });

  it('prevents navigation when disabled', async () => {
    const user = userEvent.setup();
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <ShopifyAdminLink resourceType="products" disabled>
        View Products
      </ShopifyAdminLink>
    );

    const link = screen.getByRole('link', { name: /View Products/i });
    await user.click(link);

    expect(windowOpen).not.toHaveBeenCalled();

    windowOpen.mockRestore();
  });

  it('calls onClick handler when clicked', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <ShopifyAdminLink resourceType="products" onClick={handleClick}>
        View Products
      </ShopifyAdminLink>
    );

    const link = screen.getByRole('link', { name: /View Products/i });
    await user.click(link);

    expect(handleClick).toHaveBeenCalledTimes(1);

    windowOpen.mockRestore();
  });

  it('applies custom className', () => {
    render(
      <ShopifyAdminLink resourceType="products" className="custom-class">
        View Products
      </ShopifyAdminLink>
    );

    const link = screen.getByRole('link', { name: /View Products/i });
    expect(link).toHaveClass('custom-class');
  });

  it('uses App Bridge Redirect when available', async () => {
    const user = userEvent.setup();
    const mockDispatch = vi.fn();
    const mockRedirect = { dispatch: mockDispatch };

    // Mock App Bridge to be available
    vi.mocked(appBridgeSingleton.getAppBridgeApp).mockReturnValue({} as AppBridgeApp);

    const { Redirect } = await import('@shopify/app-bridge/actions');
    vi.mocked(Redirect.create).mockReturnValue(
      mockRedirect as unknown as ReturnType<typeof Redirect.create>
    );

    render(
      <ShopifyAdminLink resourceType="products" resourceId="123">
        View Product
      </ShopifyAdminLink>
    );

    const link = screen.getByRole('link', { name: /View Product/i });
    await user.click(link);

    expect(Redirect.create).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith('ADMIN_PATH', '/products/123');

    // Reset mock
    vi.mocked(appBridgeSingleton.getAppBridgeApp).mockReturnValue(null);
  });

  it('supports all resource types', () => {
    const resourceTypes: ShopifyResourceType[] = [
      'products',
      'orders',
      'customers',
      'collections',
      'inventory',
      'draft_orders',
      'discounts',
      'gift_cards',
    ];

    resourceTypes.forEach((resourceType) => {
      const { unmount } = render(
        <ShopifyAdminLink resourceType={resourceType}>Link</ShopifyAdminLink>
      );

      const link = screen.getByRole('link', { name: /Link/i });
      expect(link).toHaveAttribute('href', `https://test-shop.myshopify.com/admin/${resourceType}`);

      unmount();
    });
  });

  it('shows external link icon when in fallback mode', () => {
    render(
      <ShopifyAdminLink resourceType="products" fallbackNewTab>
        View Products
      </ShopifyAdminLink>
    );

    // Should have an SVG for external link icon
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
