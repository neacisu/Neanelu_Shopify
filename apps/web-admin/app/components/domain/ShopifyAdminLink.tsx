import type { PropsWithChildren, MouseEvent } from 'react';
import { useCallback, useMemo } from 'react';

import { Redirect } from '@shopify/app-bridge/actions';

import { getAppBridgeApp } from '@/app/shopify/app-bridge-singleton';

/**
 * Supported Shopify Admin resource types.
 * Based on Shopify Admin URLs structure.
 */
export type ShopifyResourceType =
  | 'products'
  | 'orders'
  | 'customers'
  | 'collections'
  | 'inventory'
  | 'draft_orders'
  | 'discounts'
  | 'gift_cards'
  | 'metafields'
  | 'files'
  | 'pages'
  | 'blogs'
  | 'navigation'
  | 'themes'
  | 'settings';

/**
 * Props for the ShopifyAdminLink component.
 */
export type ShopifyAdminLinkProps = PropsWithChildren<
  Readonly<{
    /**
     * The type of Shopify resource to link to.
     */
    resourceType: ShopifyResourceType;

    /**
     * The ID of the specific resource. If omitted, links to the resource list.
     */
    resourceId?: string | number;

    /**
     * Optional sub-path to append after the resource (e.g., 'edit', 'variants').
     */
    subPath?: string;

    /**
     * Additional CSS classes for the link.
     */
    className?: string;

    /**
     * Whether the link is disabled.
     */
    disabled?: boolean;

    /**
     * Fallback behavior when App Bridge is not available.
     * If true, opens in a new tab instead. Defaults to true.
     */
    fallbackNewTab?: boolean;

    /**
     * Optional title attribute for the link.
     */
    title?: string;

    /**
     * Callback when link is clicked (before navigation).
     */
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  }>
>;

/**
 * Builds the Shopify Admin path for a given resource.
 */
function buildAdminPath(
  resourceType: ShopifyResourceType,
  resourceId?: string | number,
  subPath?: string
): string {
  let path = `/${resourceType}`;

  if (resourceId !== undefined) {
    path += `/${resourceId}`;
  }

  if (subPath) {
    path += `/${subPath}`;
  }

  return path;
}

/**
 * Builds the full Shopify Admin URL for fallback navigation.
 * Uses the shop domain from the current URL search params.
 */
function buildAdminUrl(path: string): string | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const shop = params.get('shop');

  if (!shop) return null;

  // Normalize shop domain (remove protocol if present)
  const normalizedShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return `https://${normalizedShop}/admin${path}`;
}

/**
 * A link component that navigates to Shopify Admin resources.
 *
 * When used inside Shopify App Bridge context, uses App Bridge Redirect
 * for seamless navigation within the embedded app frame.
 *
 * Falls back to opening in a new tab when App Bridge is not available.
 *
 * @example
 * ```tsx
 * // Link to products list
 * <ShopifyAdminLink resourceType="products">
 *   View Products
 * </ShopifyAdminLink>
 *
 * // Link to specific product
 * <ShopifyAdminLink resourceType="products" resourceId="123456789">
 *   View Product
 * </ShopifyAdminLink>
 *
 * // Link to order edit page
 * <ShopifyAdminLink resourceType="orders" resourceId="987654321" subPath="edit">
 *   Edit Order
 * </ShopifyAdminLink>
 * ```
 */
export function ShopifyAdminLink(props: ShopifyAdminLinkProps) {
  const {
    resourceType,
    resourceId,
    subPath,
    className,
    disabled = false,
    fallbackNewTab = true,
    title,
    onClick,
    children,
  } = props;

  const adminPath = useMemo(
    () => buildAdminPath(resourceType, resourceId, subPath),
    [resourceType, resourceId, subPath]
  );

  const adminUrl = useMemo(() => buildAdminUrl(adminPath), [adminPath]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (disabled) {
        event.preventDefault();
        return;
      }

      // Call user's onClick handler first
      onClick?.(event);

      if (event.defaultPrevented) {
        return;
      }

      const app = getAppBridgeApp();

      if (app) {
        // Use App Bridge Redirect for embedded app navigation
        event.preventDefault();

        const redirect = Redirect.create(app);
        redirect.dispatch(Redirect.Action.ADMIN_PATH, adminPath);
      } else if (fallbackNewTab && adminUrl) {
        // Fallback: open in new tab
        event.preventDefault();
        window.open(adminUrl, '_blank', 'noopener,noreferrer');
      }
      // If no App Bridge and no fallback URL, let the default anchor behavior work
    },
    [adminPath, adminUrl, disabled, fallbackNewTab, onClick]
  );

  const baseStyles =
    'inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:text-blue-400 dark:hover:text-blue-300';

  const disabledStyles = disabled
    ? 'opacity-50 cursor-not-allowed pointer-events-none'
    : 'cursor-pointer';

  const combinedClassName = `${baseStyles} ${disabledStyles} ${className ?? ''}`.trim();

  return (
    <a
      href={adminUrl ?? '#'}
      className={combinedClassName}
      onClick={handleClick}
      title={title}
      aria-disabled={disabled}
      role={disabled ? 'link' : undefined}
      target={!getAppBridgeApp() && fallbackNewTab ? '_blank' : undefined}
      rel={!getAppBridgeApp() && fallbackNewTab ? 'noopener noreferrer' : undefined}
    >
      {children}
      {/* External link icon for fallback mode */}
      {!getAppBridgeApp() && fallbackNewTab && !disabled ? (
        <svg
          className="h-3 w-3 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      ) : null}
    </a>
  );
}
