#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting Screen Time Tasks App..."

# 1. Start Cloudflare Worker Backend in the background
echo "⚡ Starting Cloudflare Worker Backend (local mode)..."
cd backend
npx wrangler dev &
BACKEND_PID=$!
cd ..

# 2. Start React Frontend
echo "💻 Starting React Frontend..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

# Clean up processes on exit
cleanup() {
  echo "Stopping all services..."
  kill $BACKEND_PID || true
  kill $FRONTEND_PID || true
}
trap cleanup EXIT

# Keep script running
wait
