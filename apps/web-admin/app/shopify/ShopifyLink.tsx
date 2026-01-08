import type { PropsWithChildren } from 'react';
import { Link, type LinkProps, useLocation } from 'react-router-dom';

import { withShopifyQuery } from './shopify-url';

export type ShopifyLinkProps = PropsWithChildren<Omit<LinkProps, 'to'> & { to: LinkProps['to'] }>;

export function ShopifyLink({ to, ...props }: ShopifyLinkProps) {
  const location = useLocation();

  return <Link {...props} to={withShopifyQuery(to, location.search)} />;
}
