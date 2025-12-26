# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously at NEANELU. If you discover a security vulnerability, please follow these steps:

### 1. Do NOT Create a Public Issue

Security vulnerabilities should **never** be reported via public GitHub issues.

### 2. Contact Us Directly

Send an email to: **<security@neanelu.shop>** (or your designated security email)

Include the following information:

- Type of vulnerability (e.g., XSS, SQL Injection, Authentication Bypass)
- Location of the affected code/endpoint
- Step-by-step instructions to reproduce
- Proof of concept (if available)
- Potential impact assessment

### 3. Response Timeline

| Action                   | Timeframe            |
| ------------------------ | -------------------- |
| Initial Response         | 24 hours             |
| Vulnerability Assessment | 72 hours             |
| Fix Development          | 7-14 days            |
| Security Advisory        | After fix deployment |

### 4. Responsible Disclosure

We kindly ask that you:

- Give us reasonable time to fix the issue before public disclosure
- Do not access or modify data that doesn't belong to you
- Do not perform denial of service attacks
- Do not social engineer our staff

## Security Measures

### Authentication & Authorization

- OAuth 2.0 with Shopify
- Session tokens with secure cookies
- HMAC verification for webhooks
- Row-Level Security (RLS) for multi-tenancy

### Data Protection

- AES-256-GCM encryption for sensitive tokens
- TLS 1.3 for all connections
- Secrets managed via OpenBAO (HashiCorp Vault fork)
- No sensitive data in logs

### Infrastructure

- Docker containers with minimal attack surface
- Non-root container execution
- Network isolation between services
- Regular security updates

## Scope

### In Scope

- NEANELU Shopify Manager application
- Associated APIs and webhooks
- Authentication and authorization mechanisms
- Data storage and encryption

### Out of Scope

- Third-party services (Shopify, OpenAI, etc.)
- Social engineering attacks
- Physical security
- Denial of service attacks

## Security Acknowledgments

We appreciate the security community's efforts in helping keep NEANELU secure. Reporters of valid vulnerabilities will be acknowledged in our security hall of fame (if desired).

---

**Last Updated:** 2025-12-26
