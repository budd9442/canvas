---
description: Rebuild and Deploy Admin Panel
---

1. Rebuild Backend
// turbo
docker build -t paint-backend:admin ./backend

2. Rebuild Frontend
// turbo
docker build -t paint-frontend:admin ./frontend

3. Load Images into Kind
// turbo
kind load docker-image paint-backend:admin
// turbo
kind load docker-image paint-frontend:admin

4. Update Kubernetes Deployments
// turbo
kubectl set image deployment/paint-backend backend=paint-backend:admin
// turbo
kubectl set image deployment/paint-frontend frontend=paint-frontend:admin

5. Restart Backend to ensure K8s Watcher starts cleanly
// turbo
kubectl rollout restart deployment paint-backend
