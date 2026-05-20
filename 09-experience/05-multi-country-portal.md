# Case Study: Multi-Country Deployment

> **Industry:** Retail — E-commerce
> **Environment:** AWS (S3, CloudFront CDN, Lambda@Edge, Route 53)
> **Challenge:** Deploy a retail portal across 9 countries with per-country content, language, pricing, and compliance — from a single codebase

---

## The Problem

A retail company needed to launch in 9 countries simultaneously:
- Each country: different language, currency, tax rules, and legal disclaimers
- Compliance: GDPR (EU), LGPD (Brazil), local cookie consent laws
- Latency requirement: < 200ms TTFB globally
- Single engineering team — no per-country deployments
- Dev team wanted one codebase, one CI/CD pipeline

---

## The Solution Architecture

```
Single-codebase multi-country deployment

DNS: Route 53 with geo-routing
  es.brand.com  →  CloudFront distribution (origin: S3)
  br.brand.com  →  CloudFront distribution (origin: S3)
  de.brand.com  →  CloudFront distribution (origin: S3)
  (9 countries, 9 subdomains, same infrastructure)

CloudFront Edge:
  Lambda@Edge (viewer-request) → inject country context
  CloudFront Cache → serves static assets from nearest PoP
  Lambda@Edge (origin-request) → fetch country-specific config

Origin:
  S3 (static SPA bundle — identical for all countries)
  API Gateway → Lambda (dynamic content with country param)
  DynamoDB (product catalog with country-specific pricing)
```

---

## What Was Implemented

### 1. Lambda@Edge — Country Context Injection

```javascript
// edge/viewer-request.js
// Runs at CloudFront edge (~400 PoPs) — no cold start penalty
// Reads country from subdomain, injects as cookie + header

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const host    = request.headers.host[0].value;   // e.g. "es.brand.com"

  const countryCode = host.split('.')[0].toUpperCase();  // "ES"

  const COUNTRY_CONFIG = {
    ES: { lang: 'es', currency: 'EUR', timezone: 'Europe/Madrid',  gdpr: true  },
    BR: { lang: 'pt', currency: 'BRL', timezone: 'America/Sao_Paulo', lgpd: true },
    DE: { lang: 'de', currency: 'EUR', timezone: 'Europe/Berlin',  gdpr: true  },
    MX: { lang: 'es', currency: 'MXN', timezone: 'America/Mexico_City' },
    CO: { lang: 'es', currency: 'COP', timezone: 'America/Bogota' },
    PE: { lang: 'es', currency: 'PEN', timezone: 'America/Lima' },
    US: { lang: 'en', currency: 'USD', timezone: 'America/New_York' },
    UK: { lang: 'en', currency: 'GBP', timezone: 'Europe/London',  gdpr: true  },
    CA: { lang: 'en', currency: 'CAD', timezone: 'America/Toronto' },
  };

  const config = COUNTRY_CONFIG[countryCode] || COUNTRY_CONFIG['US'];

  // Inject as custom header — SPA reads it on first load
  request.headers['x-country-code']    = [{ key: 'X-Country-Code',    value: countryCode }];
  request.headers['x-country-currency'] = [{ key: 'X-Country-Currency', value: config.currency }];
  request.headers['x-country-lang']    = [{ key: 'X-Country-Lang',    value: config.lang }];
  request.headers['x-requires-gdpr']   = [{ key: 'X-Requires-Gdpr',   value: String(!!config.gdpr || !!config.lgpd) }];

  return request;
};
```

### 2. S3 + CloudFront Static Deployment

```bash
#!/bin/bash
# deploy/deploy-cdn.sh
# Single build, multi-country deploy

set -euo pipefail

BUCKET="brand-portal-static-prod"
DIST_IDS=("E1ABC123" "E2DEF456" "E3GHI789")   # CloudFront distribution IDs

echo "==> Building SPA..."
npm run build

echo "==> Uploading to S3..."
aws s3 sync dist/ "s3://${BUCKET}/" \
  --delete \
  --cache-control "max-age=31536000, immutable" \
  --exclude "index.html"

# index.html — no cache (must be fresh for country routing)
aws s3 cp dist/index.html "s3://${BUCKET}/index.html" \
  --cache-control "no-cache, no-store, must-revalidate"

echo "==> Invalidating CloudFront caches..."
for DIST_ID in "${DIST_IDS[@]}"; do
  aws cloudfront create-invalidation \
    --distribution-id "${DIST_ID}" \
    --paths "/*"
  echo "  Invalidated: ${DIST_ID}"
done

echo "==> Deploy complete."
```

### 3. Terraform — Multi-Country CloudFront

```hcl
# terraform/cloudfront-multi-country.tf

locals {
  countries = {
    es = { domain = "es.brand.com", certificate_arn = var.cert_es }
    br = { domain = "br.brand.com", certificate_arn = var.cert_br }
    de = { domain = "de.brand.com", certificate_arn = var.cert_de }
    mx = { domain = "mx.brand.com", certificate_arn = var.cert_mx }
    co = { domain = "co.brand.com", certificate_arn = var.cert_co }
    pe = { domain = "pe.brand.com", certificate_arn = var.cert_pe }
    us = { domain = "us.brand.com", certificate_arn = var.cert_us }
    uk = { domain = "uk.brand.com", certificate_arn = var.cert_uk }
    ca = { domain = "ca.brand.com", certificate_arn = var.cert_ca }
  }
}

resource "aws_cloudfront_distribution" "country" {
  for_each = local.countries

  origin {
    domain_name            = aws_s3_bucket.portal.bucket_regional_domain_name
    origin_id              = "portal-s3-${each.key}"
    origin_access_control_id = aws_cloudfront_origin_access_control.portal.id
  }

  aliases = [each.value.domain]

  default_cache_behavior {
    target_origin_id       = "portal-s3-${each.key}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    lambda_function_association {
      event_type   = "viewer-request"
      lambda_arn   = aws_lambda_function.edge_country_inject.qualified_arn
    }

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  viewer_certificate {
    acm_certificate_arn      = each.value.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  enabled             = true
  is_ipv6_enabled     = true
  price_class         = "PriceClass_All"
  http_version        = "http2and3"

  tags = { Country = each.key, Environment = "production" }
}
```

### 4. Country-Specific Pricing in DynamoDB

```python
# api/products.py
# Returns pricing in the requesting country's currency

import boto3
import json
import os

dynamodb = boto3.resource('dynamodb')
table    = dynamodb.Table(os.environ['PRODUCTS_TABLE'])

def lambda_handler(event, context):
    product_id   = event['pathParameters']['productId']
    country_code = event['headers'].get('X-Country-Code', 'US')

    resp = table.get_item(Key={'productId': product_id})
    product = resp.get('Item')
    if not product:
        return {'statusCode': 404, 'body': json.dumps({'error': 'Product not found'})}

    # pricing is stored per-country in DynamoDB
    # { "productId": "...", "name": "...", "pricing": { "US": 99.99, "ES": 89.99, ... } }
    pricing  = product.get('pricing', {})
    price    = pricing.get(country_code, pricing.get('US', 0))
    currency = CURRENCY_MAP.get(country_code, 'USD')

    return {
        'statusCode': 200,
        'body': json.dumps({
            'productId': product_id,
            'name':      product['name'],
            'price':     price,
            'currency':  currency,
        })
    }

CURRENCY_MAP = {
    'ES': 'EUR', 'DE': 'EUR', 'UK': 'GBP',
    'BR': 'BRL', 'MX': 'MXN', 'CO': 'COP',
    'PE': 'PEN', 'US': 'USD', 'CA': 'CAD',
}
```

---

## Results

| Metric | Before (Manual per-country) | After (CDN multi-country) |
|--------|-----------------------------|-----------------------------|
| Deploy to all 9 countries | 9 separate deploys, 4h total | 1 deploy, 12 minutes |
| TTFB (p95 global) | 1.2s | 85ms |
| CDN cache hit rate | N/A | 96% |
| GDPR consent coverage | 3/4 EU countries | 4/4 (auto via Lambda@Edge) |
| Pricing sync errors | Monthly | 0 (DynamoDB single source) |
| Engineering overhead | 1 FTE for country ops | 0 (infrastructure handles it) |

---

## How to Talk About This in an Interview

**Q: How do you handle a multi-region, multi-language deployment at scale?**

> "The goal was one codebase, one deploy, nine countries — with no per-country
> engineering overhead.
>
> We used CloudFront with Lambda@Edge to inject country context at the edge before
> the request ever reached origin. The SPA read the injected headers and loaded the
> correct language, currency, and cookie consent banner automatically.
>
> The key insight was separating content from infrastructure: the static bundle is
> identical for all countries. Country differences — pricing, legal copy, consent
> requirements — live in DynamoDB and are fetched at runtime.
>
> One deploy takes 12 minutes and simultaneously updates all 9 countries.
> Before, it was a 4-hour manual process with a spreadsheet to track each country."

---

[← Back to Section](./README.md)
