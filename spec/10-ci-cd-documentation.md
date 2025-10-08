# 🚀 AMW CI/CD Pipeline Documentation

## Vue d'ensemble

Le projet AMW dispose désormais d'un pipeline CI/CD complet utilisant GitHub Actions pour automatiser les tests, le build, le déploiement et la maintenance.

## 🔄 Workflows GitHub Actions

### 1. CI Pipeline (`ci.yml`)
**Déclencheurs:** Push sur toutes les branches, Pull Requests

**Fonctionnalités:**
- Tests automatisés avec Jest (100 tests)
- Analyse de la qualité du code avec ESLint
- Vérification de la compilation TypeScript
- Tests de sécurité avec `npm audit`
- Support multi-OS (Ubuntu, Windows, macOS)
- Support multi-versions Node.js (18, 20)
- Génération des rapports de couverture

### 2. Release Pipeline (`release.yml`)
**Déclencheurs:** Tags git (v*.*.*)

**Fonctionnalités:**
- Build automatique des images Docker
- Publication sur Docker Hub et GitHub Container Registry
- Création automatique des releases GitHub
- Support multi-plateformes (linux/amd64, linux/arm64)
- Génération des changelogs automatiques

### 3. Auto-Deploy Pipeline (`deploy.yml`)
**Déclencheurs:** Push sur branches main/production

**Fonctionnalités:**
- Déploiement automatique sur les environnements
- Tests de santé post-déploiement
- Rollback automatique en cas d'échec
- Notifications Slack des déploiements
- Support de déploiement par environnement

### 4. Maintenance Pipeline (`maintenance.yml`)
**Déclencheurs:** Planifié (cron), manuel

**Fonctionnalités:**
- Mise à jour automatique des dépendances
- Audits de sécurité hebdomadaires
- Nettoyage des artifacts anciens
- Tests de performance réguliers
- Rapports de santé du projet

## 🔐 Secrets GitHub Requis

Pour que les workflows fonctionnent correctement, configurez ces secrets dans votre repository GitHub :

### Secrets Docker
```
DOCKER_HUB_USERNAME     # Nom d'utilisateur Docker Hub
DOCKER_HUB_TOKEN        # Token d'accès Docker Hub
GHCR_TOKEN              # Token GitHub Container Registry
```

### Secrets de Déploiement
```
DEPLOY_HOST             # IP/Hostname du serveur de production
DEPLOY_USER             # Utilisateur SSH pour le déploiement
DEPLOY_KEY              # Clé privée SSH pour l'authentification
DEPLOY_PATH             # Chemin de déploiement sur le serveur
```

### Secrets de Configuration
```
AMAZON_ACCESS_KEY       # Clé d'accès Amazon PAAPI
AMAZON_SECRET_KEY       # Clé secrète Amazon PAAPI
AMAZON_PARTNER_TAG      # Tag partenaire Amazon
REDIS_URL               # URL de connexion Redis
```

### Secrets de Notification
```
SLACK_WEBHOOK_URL       # Webhook pour les notifications Slack
DISCORD_WEBHOOK_URL     # Webhook pour les notifications Discord (optionnel)
```

## 🌍 Configuration des Environnements

### Development
- **Branch:** `develop`
- **URL:** `https://dev.amw.example.com`
- **Deploy:** Automatique sur chaque push

### Staging
- **Branch:** `staging`
- **URL:** `https://staging.amw.example.com`
- **Deploy:** Automatique après validation des tests

### Production
- **Branch:** `main`
- **URL:** `https://amw.example.com`
- **Deploy:** Automatique après tag de release

## 📋 Templates et Guidelines

### Pull Request Template
Le template PR inclut :
- Checklist de validation
- Description des changements
- Tests effectués
- Impact sur les performances

### Issue Templates
- **Bug Report:** Template structuré pour les rapports de bugs
- **Feature Request:** Template pour les demandes de fonctionnalités

## 🚀 Guide de Déploiement

### 1. Déploiement de Développement
```bash
# Push sur la branche develop
git push origin develop
# Le CI/CD se déclenche automatiquement
```

### 2. Déploiement de Production
```bash
# Créer un tag de version
git tag v3.1.0
git push origin v3.1.0
# Le pipeline de release se déclenche
```

### 3. Déploiement Manuel
```bash
# Utiliser l'action manuelle dans GitHub Actions
# Aller dans Actions > Deploy > Run workflow
```

## 🔧 Scripts NPM Intégrés

Le `package.json` inclut de nouveaux scripts pour l'intégration CI/CD :

```json
{
  "scripts": {
    "ci:check": "npm run lint && npm run build && npm run test:ci",
    "docker:build": "docker build -t amw:latest .",
    "docker:dev": "docker-compose -f docker-compose.dev.yml up -d",
    "docker:prod": "docker-compose up -d",
    "release:patch": "npm version patch && git push origin --tags",
    "release:minor": "npm version minor && git push origin --tags",
    "release:major": "npm version major && git push origin --tags"
  }
}
```

## 📊 Monitoring et Métriques

### Métriques de Performance
- Temps d'exécution des tests
- Couverture de code
- Temps de build Docker
- Temps de déploiement

### Métriques de Qualité
- Nombre de vulnérabilités détectées
- Score ESLint
- Complexité du code
- Taux de réussite des déploiements

## 🛡️ Sécurité

### Scans de Sécurité
- Audit automatique des dépendances npm
- Scan des images Docker avec Trivy
- Vérification des secrets avec git-secrets
- Tests de pénétration automatisés

### Bonnes Pratiques
- Utilisation d'images Docker distroless
- Principe du moindre privilège
- Chiffrement des secrets GitHub
- Rotation automatique des tokens

## 🔍 Troubleshooting

### Problèmes Courants

1. **Échec du Build Docker**
   - Vérifier les secrets Docker Hub
   - Contrôler l'espace disque disponible

2. **Échec des Tests**
   - Vérifier les dépendances de test
   - Contrôler les variables d'environnement

3. **Échec de Déploiement**
   - Vérifier la connectivité SSH
   - Contrôler les permissions du serveur

### Logs et Debug
- Consultez l'onglet Actions dans GitHub
- Activez le mode debug avec `ACTIONS_STEP_DEBUG=true`
- Vérifiez les logs du serveur de déploiement

## 📈 Évolutions Futures

### Améliorations Prévues
- Integration avec Kubernetes
- Tests end-to-end avec Playwright
- Analyse de performance avec Lighthouse
- Déploiement multi-régions
- Monitoring avec Prometheus/Grafana

---

*Cette documentation CI/CD fait partie du projet AMW v3.0.0 - Amazon Modern Widgets*