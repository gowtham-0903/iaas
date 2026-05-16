# IAAS Deployment Skill

## When This Skill Activates
- Modifying docker-compose.yml
- Modifying .github/workflows/deploy.yml
- Deploying to DigitalOcean
- Debugging CI/CD failures
- Adding new services or containers

## Infrastructure Overview
- Server: DigitalOcean droplet at /opt/iaas
- Registry: ghcr.io/gowtham-0903/
- Proxy: Nginx Proxy Manager (port 80/443/81)
- DB: MySQL 8.0 in Docker container iaas-db
- App files: /opt/iaas on the droplet

## CI/CD Pipeline — 3 Jobs in Order
1. test → runs pytest + vitest
2. build-and-push → builds Docker images
3. deploy → SSHes to droplet, pulls images, restarts

## Pipeline Rules
- test job must pass before build runs
- build must pass before deploy runs
- No || true anywhere — all failures must be loud
- set -e in all SSH scripts
- flask db upgrade runs after container restart
- sleep 15 after docker compose up before db upgrade

## Required GitHub Secrets
- DO_DROPLET_IP — DigitalOcean server IP
- DO_SSH_PRIVATE_KEY — SSH private key for iaas-deploy user
- GITHUB_TOKEN — auto-provided, used for ghcr.io login

## Docker Compose Services
- iaas-backend: Flask + Gunicorn, port 5000 internal
- iaas-frontend: React build served by nginx, port 3000 internal
- iaas-db: MySQL 8.0, port 3306 internal only
- nginx-proxy-manager: ports 80/443/81 public
- npm-db: MySQL for NPM config, internal only

## Deploy Command (manual if needed)
ssh to droplet then:
cd /opt/iaas
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f
sleep 15
docker exec iaas-backend flask db upgrade

## Nginx Configuration
- client_max_body_size 50M (required for bulk resume upload)
- SSL via Let's Encrypt auto-renewed by NPM
- Backend proxied at /api/* path
- Frontend proxied at / path

## Common Failure Patterns
- "password is empty" on docker login → check GITHUB_TOKEN permissions
- "flask db upgrade" fails → migration error, check logs with:
  docker logs iaas-backend
- Container unhealthy → check with:
  docker compose ps
  docker logs iaas-backend
- 413 Request Entity Too Large → nginx client_max_body_size too low
