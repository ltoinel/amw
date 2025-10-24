# GitHub Environments Configuration

This document describes the GitHub environments used in the AMW project.

## 🌟 Production Environment

**Environment Name:** `production`
**Branch Protection:** `main` branch only
**Deployment Triggers:** 
- Git tags (`v*.*.*`)
- Manual deployment from `main` branch

**Required Reviewers:** 2
**Wait Timer:** 5 minutes
**Prevent Self-Review:** Enabled

**Environment Secrets:**
```
DEPLOY_HOST=production-server.example.com
DEPLOY_USER=amw-prod
DEPLOY_KEY=<production-ssh-key>
```

**Environment Variables:**
```
NODE_ENV=production
AMW_ENV=production
LOG_LEVEL=info
```

## 🚧 Staging Environment  

**Environment Name:** `staging`
**Branch Protection:** `develop` branch
**Deployment Triggers:**
- Push to `develop` branch
- Manual deployment

**Required Reviewers:** 1
**Wait Timer:** None
**Prevent Self-Review:** Disabled

**Environment Secrets:**
```
DEPLOY_HOST=staging-server.example.com
DEPLOY_USER=amw-staging
DEPLOY_KEY=<staging-ssh-key>
```

**Environment Variables:**
```
NODE_ENV=development
AMW_ENV=staging
LOG_LEVEL=debug
```

## 🔧 Setup Instructions

### 1. Create Environments in GitHub

Go to your repository → Settings → Environments

#### Production Environment
1. Click "New environment"
2. Name: `production`
3. Configure deployment branches: `main` only
4. Add protection rules:
   - Required reviewers: 2
   - Wait timer: 5 minutes
   - Prevent self-review: ✅

#### Staging Environment
1. Click "New environment"
2. Name: `staging`  
3. Configure deployment branches: `develop` only
4. Add protection rules:
   - Required reviewers: 1

### 2. Configure Environment Secrets

For each environment, add the following secrets:

#### Required Secrets
- `DEPLOY_HOST` - Server hostname/IP
- `DEPLOY_USER` - SSH username for deployment
- `DEPLOY_KEY` - SSH private key for deployment

#### Optional Secrets
- `SLACK_WEBHOOK` - For deployment notifications
- `DISCORD_WEBHOOK` - For deployment notifications

### 3. Server Setup

#### Production Server
```bash
# Create deployment user
sudo useradd -m -s /bin/bash amw-prod
sudo mkdir -p /home/amw-prod/.ssh
sudo mkdir -p /opt/amw

# Add SSH public key
echo "your-public-key" | sudo tee /home/amw-prod/.ssh/authorized_keys
sudo chmod 600 /home/amw-prod/.ssh/authorized_keys
sudo chown -R amw-prod:amw-prod /home/amw-prod/.ssh

# Setup deployment directory
sudo chown amw-prod:amw-prod /opt/amw
sudo chmod 755 /opt/amw

# Install Docker (if not already installed)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker amw-prod

# Deploy initial files
cd /opt/amw
sudo -u amw-prod git clone https://github.com/your-org/amw.git .
sudo -u amw-prod cp config/sample.yml config/production.yml
# Edit config/production.yml with your settings
```

#### Staging Server
```bash
# Similar setup as production but with different user
sudo useradd -m -s /bin/bash amw-staging
# Follow similar steps as production
```

### 4. Test Deployment

#### Manual Test
```bash
# Test SSH connection
ssh amw-prod@production-server.example.com "docker --version"

# Test deployment directory
ssh amw-prod@production-server.example.com "ls -la /opt/amw"
```

#### GitHub Actions Test
1. Create a test tag: `git tag v0.0.1-test && git push --tags`
2. Monitor the deployment in GitHub Actions
3. Verify the application is running: `curl http://your-server:8080/amw/health`

## 🚀 Deployment Flow

### Production Deployment
1. Create release tag: `git tag v1.0.0 && git push --tags`
2. GitHub Actions triggers `release.yml` workflow
3. Requires 2 approvals for production environment
4. Deploys to production server
5. Performs health checks
6. Creates GitHub release with changelog

### Staging Deployment  
1. Push to `develop` branch
2. Automatically deploys to staging
3. Requires 1 approval
4. Performs health checks

## 📋 Troubleshooting

### Common Issues

#### SSH Connection Failed
```bash
# Check SSH key format
ssh-keygen -l -f ~/.ssh/deploy_key

# Test SSH connection
ssh -i ~/.ssh/deploy_key -T user@server
```

#### Docker Permission Denied
```bash
# Add user to docker group
sudo usermod -aG docker your-user
# Logout and login again
```

#### Health Check Failed
- Check if AMW service is running: `docker-compose ps`
- Check logs: `docker-compose logs amw`
- Verify port is accessible: `curl http://localhost:8080/amw/health`

### Rollback Procedure

#### Quick Rollback
```bash
# SSH to server
ssh amw-prod@production-server.example.com

# Rollback to previous image
cd /opt/amw
docker-compose down
docker pull ghcr.io/your-org/amw:v1.0.0  # Previous version
# Update docker-compose.yml with previous version
docker-compose up -d
```

#### GitHub Rollback
1. Find previous successful deployment in GitHub Actions
2. Re-run that workflow
3. Or create new tag pointing to previous commit