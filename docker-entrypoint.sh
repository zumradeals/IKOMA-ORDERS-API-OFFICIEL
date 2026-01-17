#!/bin/sh
set -e

# Fonction pour attendre que la base de données soit prête
wait_for_db() {
  echo "⏳ Waiting for database to be ready..."
  until nc -z db 5432; do
    echo "   ... database is not ready yet, retrying in 1s"
    sleep 1
  done
  echo "✅ Database is up!"
}

# Attendre la DB
wait_for_db

# Exécuter les migrations
echo "🚀 Running database migrations..."
if pnpm db:migrate; then
  echo "✅ Migrations applied successfully"
else
  echo "❌ Migrations failed! Exiting."
  exit 1
fi

# Démarrer l'application
echo "🎬 Starting the API..."
exec pnpm start
