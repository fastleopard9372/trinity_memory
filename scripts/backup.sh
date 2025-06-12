#!/bin/bash

# Backup script for Trinity AI
BACKUP_DIR="/backups/trinity"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "🔄 Starting Trinity AI backup..."

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup database
echo "📊 Backing up database..."
pg_dump $DATABASE_URL > "$BACKUP_DIR/trinity_db_$TIMESTAMP.sql"

# Backup NAS files
echo "📁 Backing up NAS files..."
rclone sync nas:/trinity "$BACKUP_DIR/nas_$TIMESTAMP" --progress

# Create archive
echo "📦 Creating archive..."
tar -czf "$BACKUP_DIR/trinity_backup_$TIMESTAMP.tar.gz" \
    "$BACKUP_DIR/trinity_db_$TIMESTAMP.sql" \
    "$BACKUP_DIR/nas_$TIMESTAMP"

# Clean up old backups (keep last 7 days)
echo "🧹 Cleaning up old backups..."
find "$BACKUP_DIR" -name "trinity_backup_*.tar.gz" -mtime +7 -delete

echo "✅ Backup complete!"