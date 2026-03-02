# AGENTS.md

## Repository Overview
Fork of [Twenty CRM](https://github.com/twentyhq/twenty) with Biji-Biji customizations. Modern CRM with custom data models, integration APIs, and branding.

## Upstream Sync
- Upstream: https://github.com/twentyhq/twenty
- Sync frequency: Monthly
- Last sync: {UPDATE_THIS}

## Custom Modifications
- Custom data models for Biji-Biji use cases
- Integration APIs for internal services
- Branding changes (logos, colors)
- Custom workspace configurations

## Core Commands
- Install: `pnpm install`
- Dev: `pnpm dev`
- Test: `pnpm test`
- Build: `pnpm build`
- Docker: `docker compose up -d`

## Environment Setup
- Node: 18.x or 20.x
- Package manager: pnpm
- Database: PostgreSQL
- Required: Configure `.env` from `.env.example`

## Project Structure
- `packages/twenty-server/` — Backend server
- `packages/twenty-front/` — Frontend application
- `packages/twenty-twenty/` — Core workspace logic

## Validation Requirements
Before marking work as complete:
- Run: `pnpm lint`
- Run: `pnpm test`
- Run: `pnpm build`
- Test database migrations on staging

## Deployment
- Platform: {UPDATE: GKE/VPS}
- Database migrations: Run before deployment
- Ask before: modifying deployment configuration

## Boundaries
- ✅ Always: Backup database before upgrades, test migrations on staging, document custom changes
- ⚠️ Ask First: Schema changes, upstream major version upgrades, new custom modules
- 🚫 Never: Skip database migrations, deploy without backup, force push to main

## Upstream Merge Process
1. Backup database
2. Fetch upstream: `git fetch upstream`
3. Create branch: `git checkout -b sync/upstream-{date}`
4. Merge: `git merge upstream/main`
5. Test migrations: `pnpm db:migrate`
6. Run full test suite
7. Create PR for review

---
Last updated: 2026-03-02
