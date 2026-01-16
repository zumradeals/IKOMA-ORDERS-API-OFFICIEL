# Runbook de Déploiement - IKOMA Orders API

## 1. Préparation du VPS
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install docker.io docker-compose -y
```

## 2. Configuration DNS
- Créer un enregistrement A pour `api.ikomadigit.com` pointant vers l'IP du VPS.

## 3. Configuration Caddy
Installez Caddy :
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Configurez `/etc/caddy/Caddyfile` :
```caddy
api.ikomadigit.com {
    reverse_proxy localhost:3000
}
```

## 4. Déploiement de l'Application
```bash
git clone <repo_url> ikoma-orders-api
cd ikoma-orders-api
cp .env.example .env
# Éditez .env avec vos secrets
docker-compose up -d --build
```

## 5. Sauvegarde de la Base de Données
Pour sauvegarder la base Postgres :
```bash
docker exec -t ikoma-db pg_dumpall -c -U postgres > dump_`date +%d-%m-%Y"_"%H_%M_%S`.sql
```

## 6. Monitoring & Logs
```bash
docker logs -f ikoma-api
```
Les logs sont au format JSON structuré pour une meilleure observabilité.
