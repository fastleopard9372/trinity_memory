#!/bin/bash

echo "🚀 Deploying Trinity AI..."

# Build Docker image
echo "🐳 Building Docker image..."
docker build -t trinity-ai:latest .

# Run database migrations
echo "🗄️  Running production migrations..."
npm run prisma:deploy

# Start services with docker-compose
echo "🏃 Starting services..."
docker-compose up -d

# Check service health
echo "🏥 Checking service health..."
sleep 5
curl -f http://localhost:3000/health || exit 1

echo "✅ Deployment complete!"