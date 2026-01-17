# IKOMA Orders API — Runbook (MVP)

## Prérequis
- Ubuntu 22.04+
- Docker + Docker Compose v2
- Git

## Variables utiles
- `IKOMA_ADMIN_KEY` (clé admin)
- `API_URL` (ex: http://localhost:3000/v1)

## Install (fresh server)
```bash
sudo apt update -y
sudo apt install -y git

# Docker (si pas déjà installé)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

git clone https://github.com/zumradeals/IKOMA-ORDERS-API-OFFICIEL.git
cd IKOMA-ORDERS-API-OFFICIEL

docker compose up -d --build

# Migrations (obligatoire)
docker compose exec -T api pnpm db:migrate

# Smoke test (gate)
export IKOMA_ADMIN_KEY="__PUT_KEY__"
export API_URL="http://localhost:3000/v1"
bash ./scripts/smoke.sh

Redeploy (après un merge)
cd IKOMA-ORDERS-API-OFFICIEL
git pull --ff-only

docker compose down
docker compose build --no-cache
docker compose up -d

docker compose exec -T api pnpm db:migrate

export IKOMA_ADMIN_KEY="__PUT_KEY__"
export API_URL="http://localhost:3000/v1"
bash ./scripts/smoke.sh

Diagnostic rapide
docker compose ps
docker compose logs -n 150 --no-log-prefix api
docker compose exec -T db psql -U postgres -d ikoma_orders -c "\dt public.*"

Reset DB (DANGER: supprime les données)
docker compose down -v
docker compose up -d
docker compose exec -T api pnpm db:migrate


Ensuite :
```bash
git add RUNBOOK.md
git commit -m "docs(runbook): add MVP install/redeploy runbook"
git push
