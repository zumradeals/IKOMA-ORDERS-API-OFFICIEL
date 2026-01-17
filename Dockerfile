# Étape de build
FROM node:22-alpine AS builder

WORKDIR /app

# Utilisation de corepack pour garantir la version de pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
# Installation stricte avec frozen-lockfile
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Étape de runtime
FROM node:22-alpine

WORKDIR /app

# Installation de curl pour le healthcheck et netcat pour l'entrypoint
RUN apk add --no-cache curl netcat-openbsd

# Utilisation de corepack également au runtime pour pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/src/install-runner.sh.template ./src/install-runner.sh.template
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/docker-entrypoint.sh ./

# Installation des dépendances de production uniquement
RUN pnpm install --prod --frozen-lockfile

# Validation post-build : l'image ne se construit pas si les modules critiques manquent
RUN node -e "import('drizzle-orm/node-postgres')"
RUN node -e "import('pg')"

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
