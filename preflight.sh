#!/bin/bash

# Script de vérification pré-vol pour Ikoma Orders API
# Contrôle les pré-requis système avant le build/déploiement.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}--- DÉBUT DU PREFLIGHT CHECK ---${NC}"

# 1. Vérification de l'OS (Ubuntu 22.04 recommandé)
if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo -e "OS détecté : $NAME $VERSION_ID"
    if [[ "$NAME" != *"Ubuntu"* ]] || [[ "$VERSION_ID" != "22.04" ]]; then
        echo -e "${YELLOW}[ATTENTION] Ce script est optimisé pour Ubuntu 22.04. Votre OS est $NAME $VERSION_ID.${NC}"
    fi
else
    echo -e "${RED}[ERREUR] Impossible de déterminer l'OS.${NC}"
    exit 1
fi

# 2. Vérification des ports (3000, 80, 443)
check_port() {
    local port=$1
    if sudo lsof -Pi :$port -sTCP:LISTEN -t >/dev/null ; then
        echo -e "${RED}[ERREUR] Le port $port est déjà utilisé.${NC}"
        return 1
    else
        echo -e "${GREEN}[OK] Port $port disponible.${NC}"
        return 0
    fi
}

PORT_ERROR=0
check_port 3000 || PORT_ERROR=1
check_port 80 || PORT_ERROR=1
check_port 443 || PORT_ERROR=1

if [ $PORT_ERROR -eq 1 ]; then
    echo -e "${RED}[ERREUR] Conflit de ports détecté. Veuillez libérer les ports nécessaires.${NC}"
    exit 1
fi

# 3. Vérification de Docker
if command -v docker &> /dev/null; then
    if sudo docker info &> /dev/null; then
        echo -e "${GREEN}[OK] Docker est installé et actif.${NC}"
    else
        echo -e "${RED}[ERREUR] Docker est installé mais le service n'est pas actif ou l'utilisateur n'a pas les droits.${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}[INFO] Docker n'est pas encore installé (sera géré par install.sh).${NC}"
fi

# 4. Vérification DNS pour api.ikomadigit.com
DOMAIN="api.ikomadigit.com"
echo -e "Vérification de la résolution DNS pour $DOMAIN..."
if command -v dig &> /dev/null; then
    DNS_RESOLVED=$(dig +short $DOMAIN)
elif command -v nslookup &> /dev/null; then
    DNS_RESOLVED=$(nslookup $DOMAIN | grep 'Address' | tail -n1 | awk '{print $2}')
else
    echo -e "${YELLOW}[ATTENTION] Outils DNS (dig/nslookup) absents. Vérification simplifiée via ping...${NC}"
    if ping -c 1 $DOMAIN &> /dev/null; then
        DNS_RESOLVED="resolved"
    fi
fi

if [ -z "$DNS_RESOLVED" ]; then
    echo -e "${RED}[ERREUR] Le domaine $DOMAIN ne pointe vers aucune IP. Configurez vos DNS avant de continuer.${NC}"
    exit 1
else
    echo -e "${GREEN}[OK] DNS résolu pour $DOMAIN.${NC}"
fi

# 5. Vérification de l'absence de conflit Caddy / Node local
if pgrep -x "caddy" > /dev/null && [ ! -f /etc/caddy/Caddyfile ]; then
    echo -e "${RED}[ERREUR] Un processus Caddy tourne sans configuration standard. Risque de conflit.${NC}"
    exit 1
fi

echo -e "${GREEN}--- PREFLIGHT CHECK RÉUSSI ---${NC}"
exit 0
