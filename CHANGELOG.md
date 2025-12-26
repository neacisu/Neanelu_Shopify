# Changelog

All notable changes to NEANELU Shopify Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project setup with pnpm monorepo
- PostgreSQL 18.1 database schema with RLS
- BullMQ Pro integration for queue management
- OpenTelemetry observability stack
- Shopify OAuth integration
- Webhook processing pipeline
- Bulk Operations streaming processor
- pgvector integration for semantic search
- OpenAI embeddings for products
- React Router 7 frontend with Polaris Web Components
- Comprehensive documentation suite

### Security

- AES-256-GCM encryption for Shopify tokens
- Row-Level Security for multi-tenant isolation
- HMAC verification for webhooks
- Session management with secure cookies

---

## [0.1.0] - 2025-12-26

### Added

- Project initialization
- Documentation framework
- Development environment setup

---

## Template for Future Releases

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added

- New features

### Changed

- Changes in existing functionality

### Deprecated

- Soon-to-be removed features

### Removed

- Removed features

### Fixed

- Bug fixes

### Security

- Security improvements and vulnerability fixes
```

---

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `style:` Formatting, no code change
- `refactor:` Code restructuring
- `perf:` Performance improvement
- `test:` Adding tests
- `chore:` Maintenance tasks
- `ci:` CI/CD changes

---

[Unreleased]: https://github.com/neacisu/Neanelu_Shopify/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/neacisu/Neanelu_Shopify/releases/tag/v0.1.0
