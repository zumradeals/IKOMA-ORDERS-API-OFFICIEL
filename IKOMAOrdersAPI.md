# IKOMA Orders API

IKOMA Orders API est le cœur d’orchestration du système IKOMA Control Plane. Il gère les ordres systèmes, les runners et les serveurs.

## 🚀 Architecture

- **Framework**: Node.js + Fastify
- **Base de données**: PostgreSQL (via Drizzle ORM)
- **Conteneurisation**: Docker Compose
- **Reverse Proxy**: Caddy (recommandé pour la production)

## 🛠 Installation & Déploiement

### Pré-requis
- Docker & Docker Compose
- Node.js 22+ (pour le développement local)
- pnpm

### Déploiement rapide (Docker)

1. Clonez le dépôt.
2. Créez un fichier `.env` basé sur `.env.example`.
3. Lancez les services :
   ```bash
   docker-compose up -d
   ```

### Déploiement sur VPS (Ubuntu 22.04)

1. **DNS**: Pointez `api.ikomadigit.com` vers l'IP de votre VPS.
2. **Caddy**: Installez Caddy et configurez le `Caddyfile` :
   ```caddy
   api.ikomadigit.com {
       reverse_proxy localhost:3000
   }
   ```
3. **Variables d'environnement**:
   - `DATABASE_URL`: URL de connexion Postgres.
   - `IKOMA_ADMIN_KEY`: Clé secrète pour l'accès Admin.
   - `PORT`: 3000 (par défaut).

## 🔐 Authentification

### Admin / Frontend
Utilisez le header `x-ikoma-admin-key` avec la valeur définie dans vos variables d'environnement.

### Runner Agent
Utilisez les headers :
- `x-runner-id`: UUID du runner.
- `x-runner-token`: Token généré lors de la création du runner.

## 📖 API Endpoints (v1)

### Admin
- `GET /v1/servers`: Liste des serveurs.
- `POST /v1/servers`: Créer un serveur.
- `PATCH /v1/servers/:id/attach-runner`: Attacher un runner à un serveur.
- `GET /v1/runners`: Liste des runners.
- `POST /v1/runners`: Créer un runner (retourne le token).
- `POST /v1/orders`: Créer un ordre.
- `GET /v1/orders/:id`: Détails d'un ordre.

### Runner
- `POST /v1/runner/heartbeat`: Signal de vie du runner.
- `POST /v1/runner/orders/claim-next`: Récupérer le prochain ordre disponible.
- `POST /v1/runner/orders/:id/start`: Marquer un ordre comme démarré.
- `POST /v1/runner/orders/:id/complete`: Terminer un ordre avec un rapport.

## 🧪 Exemples de tests (curl)

### Créer un Runner (Admin)
```bash
curl -X POST http://localhost:3000/v1/runners \
  -H "x-ikoma-admin-key: super-secret-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "Runner-01", "scopes": ["platform.caddy"]}'
```

### Heartbeat (Runner)
```bash
curl -X POST http://localhost:3000/v1/runner/heartbeat \
  -H "x-runner-id: <RUNNER_ID>" \
  -H "x-runner-token: <RUNNER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"status": "ONLINE"}'
```

## 🔄 Système de Réconciliation
Un worker interne s'exécute toutes les 30 secondes pour :
- Re-mettre en file d'attente les ordres `CLAIMED` expirés.
- Marquer `STALE` les ordres `RUNNING` sans heartbeat.
- Appliquer les `TIMEOUT`.
- Gérer les tentatives de re-exécution (`retries`).
