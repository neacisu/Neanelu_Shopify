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
        description
        descriptionHtml
        createdAt
        updatedAt
        publishedAt
        templateSuffix
        hasOnlyDefaultVariant
        totalInventory
        seo {
          title
          description
        }
        options {
          id
          name
          values
        }
        featuredImage {
          id
          url
          altText
          width
          height
        }
        priceRangeV2 {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
        compareAtPriceRange {
          minVariantCompareAtPrice { amount currencyCode }
          maxVariantCompareAtPrice { amount currencyCode }
        }
        images(first: 250) {
          nodes {
            id
            url
            altText
            width
            height
          }
        }
        media(first: 250) {
          nodes {
            __typename
            ... on MediaImage {
              id
              image { id url altText width height }
            }
            ... on Video {
              id
              sources { url mimeType format height width }
            }
            ... on ExternalVideo {
              id
              embeddedUrl
              host
            }
            ... on Model3d {
              id
              sources { url mimeType format filesize }
            }
          }
        }
        collections(first: 50) {
          nodes {
            id
            handle
            title
            updatedAt
          }
        }
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
              image { id url altText width height }
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
