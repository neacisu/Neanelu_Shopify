export const PRODUCTS_EXPORT_CORE_QUERY_V1 = `#graphql
{
  products(first: 250) {
    nodes {
      __typename
      id
      handle
      title
      vendor
      productType
      status
      tags
      createdAt
      updatedAt
      variants(first: 100) {
        nodes {
          __typename
          id
          title
          sku
          barcode
          price
          compareAtPrice
          taxable
          inventoryQuantity
          availableForSale
          inventoryPolicy
          requiresComponents
          selectedOptions { name value }
          inventoryItem {
            id
            tracked
          }
          createdAt
          updatedAt
        }
      }
    }
  }
}
`;

export const PRODUCTS_EXPORT_META_QUERY_V1 = `#graphql
{
  products(first: 250) {
    nodes {
      __typename
      id
      metafields(first: 250) {
        nodes {
          __typename
          id
          namespace
          key
          type
          value
          jsonValue
          createdAt
          updatedAt
          description
        }
      }
    }
  }
}
`;

export const PRODUCTS_EXPORT_INVENTORY_QUERY_V1 = `#graphql
{
  products(first: 250) {
    nodes {
      __typename
      id
      variants(first: 100) {
        nodes {
          __typename
          id
          inventoryQuantity
          inventoryItem {
            id
            tracked
          }
        }
      }
    }
  }
}
`;
