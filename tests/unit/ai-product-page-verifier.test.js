/**
 * Unit Tests for Product Page Verifier (product-page-verifier.js).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  isPrivateOrLoopbackIp,
  validateResolvedIp,
  isAllowedHost,
  isRejectedUrlPath,
  isItemInStock,
  extractJsonLdProduct,
  extractMetaTags,
  verifyProductPage,
  setHttpFetchOverride,
} from '../../src/modules/ai/products/product-page-verifier.js';

describe('Phase 15 — product-page-verifier.js', () => {
  beforeEach(() => {
    setHttpFetchOverride(null);
  });

  afterEach(() => {
    setHttpFetchOverride(null);
  });

  describe('SSRF & IP Guard: isPrivateOrLoopbackIp', () => {
    it('detects IPv4 loopback and private ranges', () => {
      expect(isPrivateOrLoopbackIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrLoopbackIp('127.255.255.255')).toBe(true);
      expect(isPrivateOrLoopbackIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrLoopbackIp('172.16.0.1')).toBe(true);
      expect(isPrivateOrLoopbackIp('172.31.255.255')).toBe(true);
      expect(isPrivateOrLoopbackIp('192.168.1.100')).toBe(true);
      expect(isPrivateOrLoopbackIp('169.254.169.254')).toBe(true);
      expect(isPrivateOrLoopbackIp('0.0.0.0')).toBe(true);
    });

    it('detects IPv6 loopback and local ranges', () => {
      expect(isPrivateOrLoopbackIp('::1')).toBe(true);
      expect(isPrivateOrLoopbackIp('fe80::1')).toBe(true);
    });

    it('allows public IPv4 addresses', () => {
      expect(isPrivateOrLoopbackIp('8.8.8.8')).toBe(false);
      expect(isPrivateOrLoopbackIp('104.18.26.120')).toBe(false);
    });

    it('returns false for invalid non-IP strings', () => {
      expect(isPrivateOrLoopbackIp('zara.com')).toBe(false);
      expect(isPrivateOrLoopbackIp('')).toBe(false);
    });
  });

  describe('DNS & IP Validator: validateResolvedIp', () => {
    it('rejects direct private and loopback IP hostnames', async () => {
      expect(await validateResolvedIp('127.0.0.1')).toBe(false);
      expect(await validateResolvedIp('10.0.0.1')).toBe(false);
      expect(await validateResolvedIp('192.168.1.1')).toBe(false);
      expect(await validateResolvedIp('169.254.169.254')).toBe(false);
      expect(await validateResolvedIp('::1')).toBe(false);
    });

    it('allows public IP hostnames', async () => {
      expect(await validateResolvedIp('8.8.8.8')).toBe(true);
      expect(await validateResolvedIp('104.18.26.120')).toBe(true);
    });

    it('returns false for empty hostname', async () => {
      expect(await validateResolvedIp('')).toBe(false);
      expect(await validateResolvedIp(null)).toBe(false);
    });
  });

  describe('Stock Availability Helper: isItemInStock', () => {
    it('detects schema.org in-stock URLs and normalized terms', () => {
      expect(isItemInStock('https://schema.org/InStock')).toBe(true);
      expect(isItemInStock('http://schema.org/InStock')).toBe(true);
      expect(isItemInStock('InStock')).toBe(true);
      expect(isItemInStock('instock')).toBe(true);
      expect(isItemInStock('In Stock')).toBe(true);
      expect(isItemInStock('available')).toBe(true);
      expect(isItemInStock('LimitedAvailability')).toBe(true);
    });

    it('detects schema.org out-of-stock URLs and terms', () => {
      expect(isItemInStock('https://schema.org/OutOfStock')).toBe(false);
      expect(isItemInStock('http://schema.org/OutOfStock')).toBe(false);
      expect(isItemInStock('OutOfStock')).toBe(false);
      expect(isItemInStock('out_of_stock')).toBe(false);
      expect(isItemInStock('SoldOut')).toBe(false);
      expect(isItemInStock('Discontinued')).toBe(false);
    });

    it('returns null for unspecified or unknown values', () => {
      expect(isItemInStock(null)).toBeNull();
      expect(isItemInStock('')).toBeNull();
      expect(isItemInStock('custom_status_xyz')).toBeNull();
    });
  });

  describe('Trusted Retailer Host Guard: isAllowedHost', () => {
    it('allows official trusted retailer domains and subdomains', () => {
      expect(isAllowedHost('zara.com')).toBe(true);
      expect(isAllowedHost('www.zara.com')).toBe(true);
      expect(isAllowedHost('massimodutti.com')).toBe(true);
      expect(isAllowedHost('eg.hm.com')).toBe(true);
      expect(isAllowedHost('shop.mango.com')).toBe(true);
      expect(isAllowedHost('amazon.eg')).toBe(true);
      expect(isAllowedHost('jumia.com.eg')).toBe(true);
      expect(isAllowedHost('noon.com')).toBe(true);
      expect(isAllowedHost('vertexaisearch.cloud.google.com')).toBe(true);
    });

    it('rejects untrusted domains and internal hosts', () => {
      expect(isAllowedHost('evil.com')).toBe(false);
      expect(isAllowedHost('fake-zara.com')).toBe(false);
      expect(isAllowedHost('localhost')).toBe(false);
      expect(isAllowedHost('127.0.0.1')).toBe(false);
      expect(isAllowedHost('10.0.0.1')).toBe(false);
      expect(isAllowedHost('')).toBe(false);
    });
  });

  describe('Rejected URL Paths: isRejectedUrlPath', () => {
    it('rejects homepages and locale roots', () => {
      expect(isRejectedUrlPath(new URL('https://www.zara.com/'))).toBe(true);
      expect(isRejectedUrlPath(new URL('https://www.zara.com/eg/en/'))).toBe(true);
      expect(isRejectedUrlPath(new URL('https://www.zara.com/home.html'))).toBe(true);
      expect(isRejectedUrlPath(new URL('https://www.zara.com/index.html'))).toBe(true);
    });

    it('rejects search and catalog search pages', () => {
      expect(isRejectedUrlPath(new URL('https://www.zara.com/eg/en/search?searchTerm=trousers'))).toBe(true);
      expect(isRejectedUrlPath(new URL('https://www.amazon.eg/s?k=trousers'))).toBe(true);
      expect(isRejectedUrlPath(new URL('https://www.jumia.com.eg/catalog/?q=trousers'))).toBe(true);
    });

    it('rejects cart, account, and category pages', () => {
      expect(isRejectedUrlPath(new URL('https://www.zara.com/eg/en/cart'))).toBe(true);
      expect(isRejectedUrlPath(new URL('https://www.zara.com/eg/en/men/trousers-c12345.html'))).toBe(true);
      expect(isRejectedUrlPath(new URL('https://www.zara.com/c/men-trousers'))).toBe(true);
    });

    it('accepts deep product URLs', () => {
      expect(isRejectedUrlPath(new URL('https://www.zara.com/eg/en/tailored-wool-trousers-p04404332.html'))).toBe(false);
      expect(isRejectedUrlPath(new URL('https://www.amazon.eg/dp/B08XYZ1234'))).toBe(false);
      expect(isRejectedUrlPath(new URL('https://www.jumia.com.eg/product-name-12345.html'))).toBe(false);
    });
  });

  describe('JSON-LD Product Extraction: extractJsonLdProduct', () => {
    it('extracts product name, image, price, currency, and sku from JSON-LD script', () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": "Navy Formal Trousers",
            "image": [
              "https://static.zara.net/photos/trousers_1.jpg",
              "https://static.zara.net/photos/trousers_2.jpg"
            ],
            "sku": "04404332",
            "offers": {
              "@type": "Offer",
              "price": "2499.00",
              "priceCurrency": "EGP",
              "availability": "https://schema.org/InStock"
            }
          }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractJsonLdProduct(html, 'https://www.zara.com/eg/en/trousers-p1.html');
      expect(result).not.toBeNull();
      expect(result.title).toBe('Navy Formal Trousers');
      expect(result.imageUrl).toBe('https://static.zara.net/photos/trousers_1.jpg');
      expect(result.price).toBe(2499);
      expect(result.currency).toBe('EGP');
      expect(result.sku).toBe('04404332');
    });

    it('handles @graph array schema structure and resolves relative image URLs', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@graph": [
            { "@type": "WebPage", "name": "Store" },
            {
              "@type": "Product",
              "name": "Massimo Dutti Oxford Shoes",
              "image": "/images/oxford-shoes.jpg",
              "offers": {
                "price": 3890,
                "priceCurrency": "EGP"
              }
            }
          ]
        }
        </script>
      `;

      const result = extractJsonLdProduct(html, 'https://www.massimodutti.com/eg/en/shoes-p2.html');
      expect(result).not.toBeNull();
      expect(result.title).toBe('Massimo Dutti Oxford Shoes');
      expect(result.imageUrl).toBe('https://www.massimodutti.com/images/oxford-shoes.jpg');
      expect(result.price).toBe(3890);
    });

    it('returns null when no Product schema is present', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@type": "Organization",
          "name": "Zara"
        }
        </script>
      `;
      expect(extractJsonLdProduct(html, 'https://www.zara.com')).toBeNull();
    });
  });

  describe('OpenGraph & Meta Extraction: extractMetaTags', () => {
    it('extracts og:title and og:image tags along with price, currency, and availability', () => {
      const html = `
        <meta property="og:title" content="Classic Leather Loafers - Brown" />
        <meta property="og:image" content="https://eg.jumia.is/loafers.jpg" />
        <meta property="product:price:amount" content="1850" />
        <meta property="product:price:currency" content="EGP" />
        <meta property="product:availability" content="in stock" />
      `;

      const result = extractMetaTags(html, 'https://www.jumia.com.eg');
      expect(result.title).toBe('Classic Leather Loafers - Brown');
      expect(result.imageUrl).toBe('https://eg.jumia.is/loafers.jpg');
      expect(result.price).toBe(1850);
      expect(result.currency).toBe('EGP');
      expect(result.availability).toBe('in stock');
    });

    it('falls back to twitter card and standard title', () => {
      const html = `
        <title>H&M Linen Shirt</title>
        <meta name="twitter:image" content="https://lp2.hm.com/shirt.jpg" />
      `;

      const result = extractMetaTags(html, 'https://eg.hm.com');
      expect(result.title).toBe('H&M Linen Shirt');
      expect(result.imageUrl).toBe('https://lp2.hm.com/shirt.jpg');
    });
  });

  describe('verifyProductPage Execution', () => {
    it('returns valid: true with extracted metadata when product page returns 200 with JSON-LD', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/ld+json">
          {
            "@type": "Product",
            "name": "Navy Tailored Trousers",
            "image": "https://static.zara.net/trousers.jpg",
            "offers": { "price": 2199, "priceCurrency": "EGP" }
          }
          </script>
        </head>
        <body><p>Detailed product description for trousers.</p></body>
        </html>
      `;

      setHttpFetchOverride(async () => ({
        ok: true,
        status: 200,
        url: 'https://www.zara.com/eg/en/tailored-trousers-p12345.html',
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
        text: async () => mockHtml,
      }));

      const result = await verifyProductPage('https://www.zara.com/eg/en/tailored-trousers-p12345.html');
      expect(result.valid).toBe(true);
      expect(result.title).toBe('Navy Tailored Trousers');
      expect(result.imageUrl).toBe('https://static.zara.net/trousers.jpg');
      expect(result.price).toBe(2199);
      expect(result.currency).toBe('EGP');
      expect(result.finalUrl).toBe('https://www.zara.com/eg/en/tailored-trousers-p12345.html');
    });

    it('returns valid: false on HTTP 404', async () => {
      setHttpFetchOverride(async () => ({
        ok: false,
        status: 404,
      }));

      const result = await verifyProductPage('https://www.zara.com/eg/en/non-existent-p999.html');
      expect(result.valid).toBe(false);
    });

    it('returns valid: false when redirected to untrusted domain (SSRF protection)', async () => {
      setHttpFetchOverride(async () => ({
        ok: true,
        status: 200,
        url: 'http://169.254.169.254/latest/meta-data', // Malicious redirect
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: async () => '<html><body>AWS metadata</body></html>',
      }));

      const result = await verifyProductPage('https://www.zara.com/eg/en/product-p1.html');
      expect(result.valid).toBe(false);
    });

    it('returns valid: false when fetch throws or aborts for non-product path', async () => {
      setHttpFetchOverride(async () => {
        throw new Error('Connection timed out');
      });

      const result = await verifyProductPage('https://www.zara.com/eg/en/company-info');
      expect(result.valid).toBe(false);
    });

    it('returns valid: true with blockedByBotGuard: true when fetch aborts for trusted retailer direct product URL', async () => {
      setHttpFetchOverride(async () => {
        throw new Error('This operation was aborted');
      });

      const result = await verifyProductPage('https://www.noon.com/egypt-ar/p/Z2B283B355C374C4EC18CZ/p/');
      expect(result.valid).toBe(true);
      expect(result.blockedByBotGuard).toBe(true);
      expect(result.finalUrl).toBe('https://www.noon.com/egypt-ar/p/Z2B283B355C374C4EC18CZ/p/');
    });

    it('follows HTTP 302 redirect manually to valid retailer URL', async () => {
      let callCount = 0;
      setHttpFetchOverride(async (url) => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 302,
            headers: {
              get: (header) => (header.toLowerCase() === 'location' ? 'https://www.zara.com/eg/en/wool-suit-p98765.html' : null),
            },
          };
        }
        return {
          ok: true,
          status: 200,
          url,
          headers: {
            get: (header) => (header.toLowerCase() === 'content-type' ? 'text/html' : null),
          },
          text: async () => `
            <!DOCTYPE html>
            <html>
            <head>
              <title>Wool Suit - Zara</title>
              <script type="application/ld+json">
              {
                "@context": "https://schema.org/",
                "@type": "Product",
                "name": "Wool Suit",
                "image": "https://static.zara.net/suit.jpg",
                "offers": { "price": "4500", "priceCurrency": "EGP" }
              }
              </script>
            </head>
            <body><p>Product description for tailored wool suit garment.</p></body>
            </html>
          `,
        };
      });

      const result = await verifyProductPage('https://www.zara.com/eg/en/redirect-p1.html');
      expect(result.valid).toBe(true);
      expect(result.title).toBe('Wool Suit');
      expect(result.finalUrl).toBe('https://www.zara.com/eg/en/wool-suit-p98765.html');
      expect(callCount).toBe(2);
    });

    it('rejects HTTP 302 redirect targeting untrusted external domain or SSRF host', async () => {
      setHttpFetchOverride(async () => ({
        status: 302,
        headers: {
          get: (header) => (header.toLowerCase() === 'location' ? 'http://169.254.169.254/secret' : null),
        },
      }));

      const result = await verifyProductPage('https://www.zara.com/eg/en/redirect-p1.html');
      expect(result.valid).toBe(false);
    });

    it('rejects redirect loop when exceeding 3 hops', async () => {
      setHttpFetchOverride(async (url) => ({
        status: 302,
        headers: {
          get: (header) => (header.toLowerCase() === 'location' ? `${url}-hop` : null),
        },
      }));

      const result = await verifyProductPage('https://www.zara.com/eg/en/loop-p1.html');
      expect(result.valid).toBe(false);
    });

    it('strictly rejects vertexaisearch.cloud.google.com as final URL', async () => {
      setHttpFetchOverride(async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (header) => (header.toLowerCase() === 'content-type' ? 'text/html' : null),
        },
        text: async () => '<html><body>Google Redirector Landing</body></html>',
      }));

      const result = await verifyProductPage('https://vertexaisearch.cloud.google.com/grounding-api-redirect/XYZ123');
      expect(result.valid).toBe(false);
    });

    it('strictly rejects vertexaisearch.cloud.google.com when fetch throws or aborts', async () => {
      setHttpFetchOverride(async () => {
        throw new Error('Connection timeout');
      });

      const result = await verifyProductPage('https://vertexaisearch.cloud.google.com/grounding-api-redirect/XYZ123');
      expect(result.valid).toBe(false);
    });
  });
});
