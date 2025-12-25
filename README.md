# Distributed Collaborative Paint Canvas

A real-time, distributed collaborative drawing application built with React, Node.js, Redis, and Socket.IO. Designed for Kubernetes deployment.

## 🚀 Features

- **Real-time Collaboration**: Multiple users drawing simultaneously with low latency.
- **Distributed Architecture**: Stateless backend, Redis for pub/sub and storage.
- **Authentication**: JWT-based secure login and registration.
- **Beautiful UI**: Modern aesthetics using TailwindCSS and Framer Motion.
- **Fault Tolerant**: Auto-reconnection and state synchronization.

## 🛠️ Tech Stack

- **Frontend**: React (Vite), TailwindCSS, Framer Motion, Socket.IO Client
- **Backend**: Node.js, Express, Socket.IO, Redis (ioredis)
- **Infrastructure**: Docker, Kubernetes, Prometheus Metrics

## 🏃‍♂️ How to Run Locally

### Prerequisites
- Node.js 18+
- Redis (running locally or via Docker)

### Steps

1. **Start Redis**
   ```bash
   docker run -p 6379:6379 -d redis
   ```

2. **Backend Setup**
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   Server runs on `http://localhost:3001`

3. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   App runs on `http://localhost:5173`

4. **Open Browser**
   Navigate to the frontend URL. Register an account and start drawing! Open multiple tabs to test collaboration.

## ☸️ Kubernetes Deployment

1. **Build Images**
   ```bash
   docker build -t paint-backend ./backend
   docker build -t paint-frontend ./frontend
   ```

2. **Apply Manifests**
   ```bash
   kubectl apply -f k8s/manifests.yaml
   ```

## 🏗️ Architecture

- **Stroke Storage**: Strokes are stored in Redis Lists (`canvas:{id}:strokes`) for total ordering and persistence.
- **Concurrency**: Optimistic UI updates with eventual consistency guaranteed by the Redis log.
- **Scaling**: Socket.IO Redis Adapter (to be configured in production) allows broadcasting across multiple backend pods.

## 🎨 UI/UX

- **Dark Mode**: Default sleek dark theme.
- **Glassmorphism**: Floating toolbars and panels.
- **Animations**: Smooth transitions using Framer Motion.
