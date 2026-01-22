# IKOMA Orders API

IKOMA Orders API est le cœur d’orchestration du système IKOMA Control Plane. Il gère les ordres systèmes, les runners et les serveurs.

## 🚀 First Install Checklist (Anti-Récidive)

Pour garantir une installation robuste sur n'importe quel VPS réinstallé, suivez cette checklist :

1.  **Environnement** : Copiez `.env.example` vers `.env` et configurez les variables.
    *   `DATABASE_URL` : URL de connexion PostgreSQL.
    *   `IKOMA_ADMIN_KEY` : Clé secrète pour l'accès admin.
2.  **Dépendances** : Installez les dépendances avec `pnpm install`.
3.  **Base de données** :
    *   **Automatique** : Les migrations sont appliquées automatiquement au démarrage du conteneur Docker.
    *   **Manuel** (si nécessaire) : `npm run db:migrate`
    *   (Debug uniquement) Seed ponctuel : `SEED=true npm run db:seed` (les seeds normaux passent par migration, pas par psql)
4.  **Validation** : Lancez le smoke test pour vérifier que tout le flow fonctionne :
    *   `npm run smoke` (Assurez-vous que le serveur tourne sur le port 3000)

## 🛠 Commandes Exactes

| Action | Commande |
| :--- | :--- |
| **Installation** | `pnpm install` |
| **Build** | `npm run build` |
| **Migrations** | `npm run db:migrate` |
| **Vérifier migrations** | `npm run db:verify` |
| **Seeding (debug)** | `SEED=true npm run db:seed` |
| **Démarrage** | `npm start` |
| **Smoke Test** | `npm run smoke` |

### 🧪 Smoke Test en détail

Le smoke test valide le cycle de vie complet d'une commande (Playbook -> Server -> Runner -> Order -> Claim -> Start -> Complete).

**Variables d'environnement :**
- `API_URL` : URL de l'API (par défaut : `http://localhost:3000/v1`)
- `IKOMA_ADMIN_KEY` : Clé admin configurée sur le serveur.

**Exemple de commande :**
```bash
# Depuis la racine du projet
API_URL="http://localhost:3000/v1" IKOMA_ADMIN_KEY="votre-cle-admin" bash ./scripts/smoke.sh
```

## 🔗 Relation Serveur ↔ Runner

La relation est possédée par `servers.runnerId`. 
- Pour associer un runner à un serveur, utilisez `PATCH /v1/servers/:serverId { "runnerId": "..." }`.
- L'endpoint `GET /v1/runners` expose `serverId` et `serverName` (dérivés de la table `servers`) pour permettre à l'UI de confirmer l'association dans les deux sens. Si aucun serveur n'est associé, ces champs sont `null`.

## 🔒 Sécurité & Robustesse

*   **Validation Zod** : Tous les IDs sont validés comme UUIDs. Les rapports de complétion suivent un schéma strict (`src/contracts/report.v1.ts`).
*   **Erreurs Diagnostiques** : En cas de conflit (ex: commande déjà prise), l'API retourne un code `409` avec une raison précise (`order_not_found`, `wrong_runner`, `invalid_status`).
*   **Middlewares Sécurisés** : Les accès Admin et Runner sont strictement contrôlés et stoppent l'exécution immédiatement en cas d'échec (401).
*   **Harmonisation** : La route `/servers/:id/attach-runner` accepte indifféremment `PATCH` et `POST`.

## 🗃️ Migrations & Drizzle (politique)

**NE PAS éditer `migrations/meta/_journal.json` à la main.** Ce fichier est géré par `drizzle-kit generate` en dev/CI uniquement.

- `db:migrate` doit fonctionner dans le conteneur de production **sans** `drizzle-kit`.
- `db:generate` est réservé au **dev/CI** (poste local ou container tools).
- Utilisez `npm run db:verify` pour vérifier que chaque entrée du journal a un fichier `.sql` correspondant (et inversement).
- Les seeds passent par migration (ex: `0004_seed_playbooks.sql`). Évitez les seeds “à la main” via `psql` en pipeline (debug uniquement).

## 🧭 Doctrine & Stratégie
Ce projet suit une doctrine de **Pure ESM** (ECMAScript Modules) pour garantir la cohérence entre le développement TypeScript, le runtime Node.js et les conteneurs Docker.
- **Runtime** : Node.js 22+
- **Module System** : ESM (`"type": "module"` dans package.json)
- **TypeScript** : Configuré en `NodeNext` pour une résolution de modules native.
- **Docker** : Build multi-étape optimisé avec validation post-build.

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

Le conteneur `api` attendra automatiquement que la base de données soit prête et appliquera les migrations avant de démarrer. Si les migrations échouent, le conteneur s'arrêtera (fail-fast).

### Installation Automatisée (VPS)

Pour une installation facile sur un VPS Ubuntu/Debian, utilisez le script fourni :

```bash
chmod +x install.sh
./install.sh
```

Ce script installe automatiquement Docker, Docker Compose, configure votre fichier `.env` avec une clé admin générée et lance les services.

### Déploiement sur VPS (Ubuntu 22.04)

1. **DNS**: Pointez `api.ikomadigit.com` vers l'IP de votre VPS.
2. **Caddy**: Le script `install.sh` s'occupe d'installer et de configurer Caddy automatiquement. Si vous souhaitez le faire manuellement, créez un fichier nommé `Caddyfile` dans `/etc/caddy/` avec le contenu suivant :
   ```caddy
   api.ikomadigit.com {
       reverse_proxy localhost:3000
   }
   ```
   Puis rechargez Caddy avec `sudo systemctl reload caddy`.
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
- `PATCH /v1/servers/:id`: Mettre à jour un serveur (incluant `runnerId` pour l'association).
- `PATCH /v1/servers/:id/attach-runner`: Attacher un runner à un serveur (Legacy).
- `POST /v1/servers/:id/attach-runner`: Attacher un runner à un serveur (Alias POST Legacy).
- `GET /v1/runners`: Liste des runners (inclut désormais `serverId` et `serverName`).
- `POST /v1/runners`: Créer un runner (retourne le token).
- `POST /v1/orders`: Créer un ordre.
- `GET /v1/orders/:id`: Détails d'un ordre (inclut le résumé du rapport et la version du contrat).

### Exemples de requêtes Admin

#### Récupérer les détails d'un ordre
```bash
curl -X GET http://localhost:3000/v1/orders/VOTRE_ORDER_ID \
  -H "x-ikoma-admin-key: VOTRE_CLE_ADMIN"
```

### Runner
- `POST /v1/runner/heartbeat`: Signal de vie du runner.
- `POST /v1/runner/orders/claim-next`: Récupérer le prochain ordre disponible (récupère toujours la commande éligible la plus ancienne de manière atomique).
- `POST /v1/runner/orders/:id/start`: Marquer un ordre comme démarré.
- `POST /v1/runner/orders/:id/complete`: Terminer un ordre avec un rapport.

## 📝 Contrats de Données

Le format des rapports est centralisé dans `src/contracts/report.v1.ts` et `src/contracts/report.v2.ts`.

- **Versionnement** : `report.version` est la source de vérité (`v1` ou `v2`).
- **Compatibilité** : le frontend peut parser **v1 + v2** (recommandé), ou **v2 only** si vous forcez l’envoi côté runner.

### Report v2 (contrat stable)

Champs minimaux attendus :

- `version: "v2"`
- `summary: string`
- `durationMs: number`
- `steps: []` (tableau, même vide)
- `errors: []` (tableau, même vide)

### Exemple réponse `POST /v1/orders`

```json
{
  "order": {
    "id": "uuid",
    "status": "QUEUED",
    "serverId": "uuid",
    "runnerId": "uuid",
    "playbookKey": "system.test_ping",
    "action": "run",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "reportContract": {
    "version": "v2",
    "compatibleVersions": ["v1", "v2"],
    "summary": "string",
    "durationMs": 123,
    "steps": [],
    "errors": []
  }
}
```

## 🔄 Système de Réconciliation
Un worker interne s'exécute toutes les 30 secondes pour :
- Re-mettre en file d'attente les ordres `CLAIMED` expirés.
- Marquer `STALE` les ordres `RUNNING` sans heartbeat.
- Appliquer les `TIMEOUT`.
- Gérer les tentatives de re-exécution (`retries`).
