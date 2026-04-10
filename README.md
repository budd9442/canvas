# Distributed Collaborative Paint Canvas 🎨

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![AWS](https://img.shields.io/badge/AWS-EKS_1.30-orange.svg)
![Terraform](https://img.shields.io/badge/IaC-Terraform-blueviolet.svg)
![Status](https://img.shields.io/badge/status-production_ready-green.svg)

A real-time, distributed collaborative drawing application designed to demonstrate the principles of **Distributed Systems**, **High Availability**, and **GitOps-driven Cloud Orchestration**.

---

## 🏗 Choose Your Architecture

This project evolved from a single-node VPS deployment into a professional, multi-AZ AWS cloud infrastructure. You can deploy it in two ways:

### 1. **AWS Production Deployment **
*   **Infrastructure**: AWS EKS (Kubernetes), RDS (PostgreSQL), ElastiCache (Redis), Secrets Manager, ALB.
*   **Logic**: Fully automated via Terraform (IaC) and GitHub Actions (CI/CD).

### 2. **Local / VPS Deployment **
*   **Infrastructure**: Lightweight `k3s` cluster, Docker Compose, or manual Node.js.
*   **Logic**: Standard `kubectl apply` manifests.
*   **Location**: Legacy manifests are preserved in the [`k83-vps/`](./k83-vps/) directory.

---

## 🚀 AWS Enterprise Deployment (EKS)

### Prerequisites
*   AWS CLI configured with Admin permissions.
*   Terraform 1.5+
*   kubectl & Helm

### Step 1: Bootstrap the State
Before deploying the main resources, initialize the remote S3 backend and DynamoDB state lock:
```bash
cd terraform/bootstrap
terraform init && terraform apply
```

### Step 2: Provision Infrastructure
Update `terraform/main/provider.tf` with the S3 bucket name from the bootstrap step, then:
```bash
cd terraform/main
terraform init
terraform apply
```
*This will provision a custom VPC, EKS Cluster, RDS Postgres, and ElastiCache Redis (~15-20 mins).*

### Step 3: GitOps Rollout
1.  Add your `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` to GitHub Repository Secrets.
2.  Push a change to the `master` branch.
3.  The [Deployment Workflow](./.github/workflows/deploy.yaml) will automatically build the images, push to ECR, and deploy to EKS.

---

## 🐧 Legacy VPS Deployment (k3s)

If you are deploying to a standard Linux VPS using `k3s`:

1.  **Ensure k3s is installed**: `curl -sfL https://get.k3s.io | sh -`
2.  **Deploy Manifests**:
    ```bash
    kubectl apply -f k83-vps/
    ```
3.  **Config**: Update the `Ingress` in `k83-vps/ingress.yaml` with your VPS IP or public domain.

---

## 🛠 Tech Stack

| Component | AWS Technology | VPS/Local Technology |
|-----------|----------------|----------------------|
| **Kubernetes** | Amazon EKS (Managed) | k3s (Lightweight) |
| **Database** | Amazon RDS (PostgreSQL) | In-cluster Postgres Pod |
| **Cache** | Amazon ElastiCache (Redis) | In-cluster Redis Pod |
| **Ingress** | AWS Load Balancer (ALB) | Traefik / Nginx |
| **Secrets** | AWS Secrets Manager | K8s Secrets (Base64) |
| **Registry** | Amazon ECR | Docker Hub |
| **IaC** | Terraform | Manual Manifests |

---

## 📉 Stress Testing & HPA
The system is built to breathe. We’ve included a "Bot Army" tester to verify Horizontal Pod Autoscaling (HPA).

1.  **Install Tester**:
    ```bash
    cd tester
    npm install
    ```
2.  **Run "Starry Night" Attack**:
    ```bash
    # Simulates 250 concurrent bots drawing a Van Gogh painting
    CONCURRENCY=250 INTERVAL=10 node flood.js
    ```
3.  **Monitor Scaling**:
    ```bash
    kubectl get hpa paint-backend -w
    ```
    
---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
