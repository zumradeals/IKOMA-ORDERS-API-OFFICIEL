#!/bin/bash

# Script d'installation robuste et idempotent pour Ikoma Orders API
# Cible : Ubuntu 22.04

set -e

# Couleurs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== DÉBUT DE L'INSTALLATION IKOMA ORDERS API ===${NC}"

# Fonction de log d'erreur
error_exit() {
    echo -e "${RED}[ERREUR CRITIQUE] $1${NC}" >&2
    exit 1
}

# 0. Vérification des privilèges
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}Ce script devrait idéalement être lancé avec sudo.${NC}"
fi

# 1. Exécution du Preflight Check
echo -e "${GREEN}[1/7] Exécution du Preflight Check...${NC}"
chmod +x preflight.sh
./preflight.sh || error_exit "Le Preflight Check a échoué."

# 2. Installation des dépendances système (Docker, Caddy)
echo -e "${GREEN}[2/7] Installation des dépendances système...${NC}"

# Attente du verrou apt
wait_for_apt() {
    while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
        echo -e "${YELLOW}Attente de la libération du verrou apt...${NC}"
        sleep 5
    done
}

wait_for_apt
apt-get update

# Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Installation de Docker...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
fi

# Docker Compose (Plugin)
if ! docker compose version &> /dev/null; then
    echo -e "${YELLOW}Installation de Docker Compose Plugin...${NC}"
    apt-get install -y docker-compose-plugin
fi

# Caddy
if ! command -v caddy &> /dev/null; then
    echo -e "${YELLOW}Installation de Caddy...${NC}"
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg || true
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
fi

# 3. Configuration de l'environnement
echo -e "${GREEN}[3/7] Configuration de l'environnement...${NC}"
if [ ! -f .env ]; then
    echo -e "${YELLOW}Création du fichier .env...${NC}"
    RANDOM_KEY=$(openssl rand -hex 16)
    cat > .env <<EOF
IKOMA_ADMIN_KEY=$RANDOM_KEY
DATABASE_URL=postgres://postgres:postgres@db:5432/ikoma_orders
NODE_ENV=production
EOF
fi

# 4. Configuration de Caddy
echo -e "${GREEN}[4/7] Configuration de Caddy...${NC}"
DOMAIN="api.ikomadigit.com"
cat > Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
}
EOF

# Application de la config Caddy
if [ -f /etc/caddy/Caddyfile ]; then
    mv /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak
fi
cp Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

# 5. Build et Lancement Docker
echo -e "${GREEN}[5/7] Build et lancement des conteneurs...${NC}"
# On force le build sans cache pour garantir la propreté si demandé, 
# mais par défaut on laisse Docker gérer pour l'idempotence rapide.
docker compose build --pull
docker compose up -d

# 6. Initialisation de la Base de Données
echo -e "${GREEN}[6/7] Initialisation de la base de données...${NC}"
# Attente que la DB soit prête (via le healthcheck docker-compose)
echo -e "${YELLOW}Attente que la base de données soit prête...${NC}"
MAX_WAIT=30
COUNT=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' ikoma-db)" == "healthy" ]; do
    if [ $COUNT -ge $MAX_WAIT ]; then
        error_exit "La base de données n'est pas devenue saine à temps."
    fi
    sleep 1
    COUNT=$((COUNT + 1))
done

echo -e "${YELLOW}Exécution des migrations...${NC}"
docker compose exec -T api pnpm run db:migrate || error_exit "Échec des migrations."

# 7. Validation finale
echo -e "${GREEN}[7/7] Validation finale...${NC}"
sleep 5 # Laisser un peu de temps à l'API pour démarrer après migration

# Test local
if curl -fsS http://127.0.0.1:3000/health > /dev/null; then
    echo -e "${GREEN}[OK] API fonctionnelle en local.${NC}"
else
    docker compose logs api
    error_exit "L'API ne répond pas sur le port 3000."
fi

echo -e "${BLUE}=== INSTALLATION RÉUSSIE ===${NC}"
echo -e "L'API est disponible sur : ${GREEN}https://$DOMAIN${NC}"
EOF
