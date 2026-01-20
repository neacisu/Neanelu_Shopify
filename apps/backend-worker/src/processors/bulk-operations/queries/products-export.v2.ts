export const PRODUCTS_EXPORT_CORE_QUERY_V2 = `#graphql
{
  products(first: 250) {
    edges {
      node {
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
          edges {
            node {
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
              product {
                id
              }
              inventoryItem {
                __typename
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
  }
}
`;

export const PRODUCTS_EXPORT_META_QUERY_V2 = `#graphql
{
  products(first: 250) {
    edges {
      node {
        __typename
        id
        metafields(first: 250) {
          edges {
            node {
              __typename
              id
              namespace
              key
              type
              value
              jsonValue
              description
              createdAt
              updatedAt
              owner {
                __typename
                ... on Product {
                  id
                }
                ... on ProductVariant {
                  id
                }
              }
              reference {
                __typename
                ... on Metaobject {
                  id
                  type
                  handle
                  fields {
                    key
                    value
                  }
                }
              }
              references(first: 25) {
                edges {
                  node {
                    __typename
                    ... on Metaobject {
                      id
                      type
                      handle
                      fields {
                        key
                        value
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

export const PRODUCTS_EXPORT_INVENTORY_QUERY_V2 = `#graphql
{
  products(first: 250) {
    edges {
      node {
        __typename
        id
        variants(first: 100) {
          edges {
            node {
              __typename
              id
              sku
              inventoryQuantity
              inventoryItem {
                __typename
                id
                tracked
                inventoryLevels(first: 250) {
                  edges {
                    node {
                      __typename
                      id
                      available
                      location {
                        __typename
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;
