# Distributed Collaborative Paint Canvas

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Status](https://img.shields.io/badge/status-stable-green.svg)
![Kubernetes](https://img.shields.io/badge/kubernetes-ready-blue.svg)

A real-time, distributed collaborative drawing application designed to demonstrate the principles of **Distributed Systems**, **High Availability**, and **Fault Tolerance**. Built with cloud-native technologies and deployed on Kubernetes.

## 🌟 Features

*   **Real-time Collaboration**: Multiple users drawing simultaneously with low latency using WebSockets.
*   **Distributed Architecture**: Stateless backend replicas coordinated via Redis Pub/Sub.
*   **High Availability**: Kubernetes deployment with auto-healing and load balancing.
*   **Strong Consistency**: Global sequencing of strokes using Redis Atomic operations.
*   **Scalability**: Horizontal Pod Autoscaling (HPA) based on CPU utilization.
*   **Observability**: Real-time Admin Dashboard for monitoring pod health and user activity.
*   **Secure**: JWT Authentication, RBAC, and SSL termination via Traefik.

## 🏗️ Architecture

The system is designed as a set of decoupled microservices:

*   **Ingress**: Traefik handles external traffic, SSL, and sticky routing.
*   **Frontend**: React application (Vite + TailwindCSS) for the user interface.
*   **Backend**: Node.js microservices handling WebSocket connections and logic.
*   **Data Layer**:
    *   **Redis**: Used for distributed locks, stroke sequencing, and pub/sub messaging.
    *   **PostgreSQL**: Persistent storage for user data and canvas history.

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | React, TypeScript, Fabric.js, TailwindCSS |
| **Backend** | Node.js, Express, Socket.IO, TypeScript |
| **Database** | PostgreSQL 15, Redis 7 |
| **Infrastructure** | Docker, Kubernetes, Traefik, CertManager |
| **Monitoring** | Prometheus, Grafana, Custom K8s Watcher |

## 🚀 Getting Started

### Prerequisites

*   Node.js 18+
*   Docker & Kubernetes (Minikube or Kind recommended)
*   Redis & PostgreSQL (for local non-k8s run)
*   *Optional*: Prometheus & Grafana (for full observability metrics)

### 💻 Local Development (Non-K8s)

1.  **Start Infrastructure Services**
    Ensure you have Redis and Postgres running locally or via Docker:
    ```bash
    docker run -d -p 6379:6379 redis:7
    docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=canvas_db postgres:15
    ```

2.  **Backend Setup**
    ```bash
    cd backend
    mv .env.example .env # Configure your DB credentials
    npm install
    npm run dev
    ```

3.  **Frontend Setup**
    ```bash
    cd frontend
    npm install
    npm run dev
    ```

4.  **Access App**
    Open `http://localhost:5173` to draw.
    Open `http://localhost:5173/admin` (after logging in as admin) to view the dashboard.

### ☸️ Kubernetes Deployment

1.  **Build Docker Images**
    ```bash
    docker build -t paint-backend:v19 ./backend
    docker build -t paint-frontend:v16 ./frontend
    ```

2.  **Deploy to Cluster**
    ```bash
    # Apply all manifests (ConfigMaps, Secrets, Deployments, Services)
    kubectl apply -f k8s/
    
    # NOTE: Prometheus & Grafana are expected to be installed via Helm
    # The ingress rule in k8s/monitor-ingress.yaml will route to the 'monitor-grafana' service
    ```

3.  **Access**
    The ingress is configured for `canvas.budd.codes`. Ensure this resolves to your cluster IP.

## 📊 Monitoring & Observability

The system uses a dual-layer monitoring strategy:

1.  **Infrastructure Level**: **Prometheus** scrapes metrics from the Kubernetes cluster, and **Grafana** provides long-term trend analysis and alerting.
2.  **Application Level**: A built-in "God Mode" for real-time operational visibility.

### 👮 Admin Panel (God Mode)

*   **Access**: Log in as a user with `role: admin`.
*   **Toggle Panel**: Click the floating "Admin" button on the right edge.
*   **Features**:
    *   **Infra Tab**: View live Kubernetes Pod status, IP addresses, and HPA autoscaling graphs.
    *   **Users Tab**: See connected users in real-time and ban abusive users.
    *   **Canvas Tab**: Emergency "Clear Canvas" functionality.

## 🧪 Load Testing

We include a specialized distributed load tester to simulate high concurrency scenarios.

```bash
cd tester
npm install

# Usage: node flood.js <image_url>
# Simulate 50 concurrent "bot" painters reproducing a Van Gogh painting
node flood.js https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg
```

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.
