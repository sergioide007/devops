# Jenkins — CI/CD Automation Server

> Jenkins is the most widely used CI/CD tool in enterprises.
> It is open source, has 1800+ plugins, and runs on any server.
> If a company has legacy CI/CD, it is probably Jenkins.

---

## Install Jenkins

```bash
# Option 1: Install on Ubuntu server
sudo apt update
sudo apt install openjdk-17-jdk -y

# Add Jenkins repo
curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key | \
    sudo tee /usr/share/keyrings/jenkins-keyring.asc > /dev/null

echo deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] \
    https://pkg.jenkins.io/debian-stable binary/ | \
    sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null

sudo apt update
sudo apt install jenkins -y

sudo systemctl start jenkins
sudo systemctl enable jenkins

# Get initial admin password
sudo cat /var/lib/jenkins/secrets/initialAdminPassword

# Jenkins is now at: http://your-server:8080

# Option 2: Docker (for local development/testing)
docker run -d \
    --name jenkins \
    -p 8080:8080 \
    -p 50000:50000 \
    -v jenkins_home:/var/jenkins_home \
    -v /var/run/docker.sock:/var/run/docker.sock \
    jenkins/jenkins:lts-jdk17

# Option 3: Kubernetes (production)
helm repo add jenkins https://charts.jenkins.io
helm install jenkins jenkins/jenkins \
    --namespace jenkins \
    --create-namespace \
    -f jenkins-values.yaml
```

---

## Jenkinsfile — Pipeline as Code

```groovy
// Jenkinsfile — stored in your repository root
pipeline {
    agent {
        docker {
            image 'node:20-alpine'
            args '-v /var/run/docker.sock:/var/run/docker.sock'
        }
    }

    environment {
        APP_NAME = 'my-api'
        DOCKER_REGISTRY = 'myregistry.com'
        SONAR_HOST = 'http://sonarqube:9000'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                sh 'echo "Branch: ${BRANCH_NAME}"'
                sh 'echo "Commit: ${GIT_COMMIT}"'
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Unit Tests') {
            steps {
                sh 'npm test -- --coverage'
            }
            post {
                always {
                    junit 'test-results/*.xml'
                    publishHTML([
                        reportDir: 'coverage',
                        reportFiles: 'index.html',
                        reportName: 'Coverage Report'
                    ])
                }
            }
        }

        stage('Code Quality — SonarQube') {
            steps {
                withSonarQubeEnv('SonarQube') {
                    sh """
                        sonar-scanner \
                            -Dsonar.projectKey=${APP_NAME} \
                            -Dsonar.sources=src \
                            -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info
                    """
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }

        stage('Build Docker Image') {
            steps {
                script {
                    IMAGE_TAG = "${DOCKER_REGISTRY}/${APP_NAME}:${GIT_COMMIT[0..7]}"
                    sh "docker build -t ${IMAGE_TAG} ."
                }
            }
        }

        stage('Security Scan — Trivy') {
            steps {
                script {
                    sh """
                        trivy image \
                            --exit-code 1 \
                            --severity HIGH,CRITICAL \
                            ${IMAGE_TAG}
                    """
                }
            }
        }

        stage('Push to Registry') {
            when {
                branch 'main'
            }
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'docker-registry',
                    usernameVariable: 'DOCKER_USER',
                    passwordVariable: 'DOCKER_PASS'
                )]) {
                    sh """
                        echo ${DOCKER_PASS} | docker login ${DOCKER_REGISTRY} -u ${DOCKER_USER} --stdin
                        docker push ${IMAGE_TAG}
                        docker tag ${IMAGE_TAG} ${DOCKER_REGISTRY}/${APP_NAME}:latest
                        docker push ${DOCKER_REGISTRY}/${APP_NAME}:latest
                    """
                }
            }
        }

        stage('Deploy to Staging') {
            when {
                branch 'main'
            }
            steps {
                withKubeConfig([credentialsId: 'staging-kubeconfig']) {
                    sh """
                        kubectl set image deployment/${APP_NAME} \
                            ${APP_NAME}=${IMAGE_TAG} \
                            -n staging
                        kubectl rollout status deployment/${APP_NAME} \
                            -n staging \
                            --timeout=5m
                    """
                }
            }
        }

        stage('Smoke Test Staging') {
            when {
                branch 'main'
            }
            steps {
                sh """
                    for i in {1..10}; do
                        sleep 5
                        STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://staging.myapp.com/health)
                        if [ "$STATUS" = "200" ]; then
                            echo "Staging is healthy!"
                            exit 0
                        fi
                        echo "Attempt $i: got $STATUS"
                    done
                    echo "ERROR: Staging health check failed"
                    exit 1
                """
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            input {
                message "Deploy to production?"
                ok "Deploy"
                parameters {
                    string(name: 'CONFIRMED_BY', description: 'Your name')
                }
            }
            steps {
                echo "Production deployment approved by: ${CONFIRMED_BY}"
                withKubeConfig([credentialsId: 'production-kubeconfig']) {
                    sh """
                        kubectl set image deployment/${APP_NAME} \
                            ${APP_NAME}=${IMAGE_TAG} \
                            -n production
                        kubectl rollout status deployment/${APP_NAME} \
                            -n production \
                            --timeout=10m
                    """
                }
            }
        }
    }

    post {
        success {
            slackSend(
                channel: '#deployments',
                color: 'good',
                message: "✅ *${APP_NAME}* deployed to production by ${CONFIRMED_BY}\nVersion: `${GIT_COMMIT[0..7]}`"
            )
        }
        failure {
            slackSend(
                channel: '#deployments',
                color: 'danger',
                message: "❌ *${APP_NAME}* pipeline FAILED\nBranch: `${BRANCH_NAME}` | Commit: `${GIT_COMMIT[0..7]}`\nCheck: ${BUILD_URL}"
            )
        }
        always {
            cleanWs()   // clean workspace after build
        }
    }
}
```

---

## Jenkins — Multi-Branch Pipeline

```groovy
// This Jenkinsfile handles different branches differently

pipeline {
    agent any

    stages {
        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        stage('Deploy to Dev') {
            when {
                branch 'develop'
            }
            steps {
                sh 'helm upgrade --install my-app ./chart --namespace dev'
            }
        }

        stage('Deploy to Staging') {
            when {
                branch pattern: 'release/.*', comparator: 'REGEXP'
            }
            steps {
                sh 'helm upgrade --install my-app ./chart --namespace staging'
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            steps {
                sh 'helm upgrade --install my-app ./chart --namespace production'
            }
        }
    }
}
```

---

## Jenkins Shared Libraries — Reuse Pipeline Code

```groovy
// vars/buildDockerImage.groovy — shared library
def call(String imageName, String tag) {
    sh """
        docker build -t ${imageName}:${tag} .
        docker build -t ${imageName}:latest .
    """
}

// vars/deployToKubernetes.groovy
def call(Map config) {
    withKubeConfig([credentialsId: config.kubeCredentials]) {
        sh """
            kubectl set image deployment/${config.deploymentName} \
                ${config.containerName}=${config.image} \
                -n ${config.namespace}
            kubectl rollout status deployment/${config.deploymentName} \
                -n ${config.namespace} \
                --timeout=5m
        """
    }
}

// In Jenkinsfile — use shared library
@Library('my-shared-lib@main') _

pipeline {
    agent any

    stages {
        stage('Build') {
            steps {
                buildDockerImage('my-api', env.GIT_COMMIT[0..7])
            }
        }

        stage('Deploy') {
            steps {
                deployToKubernetes(
                    deploymentName: 'my-api',
                    containerName: 'my-api',
                    image: "registry.example.com/my-api:${env.GIT_COMMIT[0..7]}",
                    namespace: 'production',
                    kubeCredentials: 'prod-kube'
                )
            }
        }
    }
}
```

---

## Jenkins — Useful CLI Commands

```bash
# Jenkins CLI
wget http://jenkins-server:8080/jnlpJars/jenkins-cli.jar

# List jobs
java -jar jenkins-cli.jar -s http://jenkins-server:8080 list-jobs

# Trigger a build
java -jar jenkins-cli.jar -s http://jenkins-server:8080 \
    build my-pipeline -p BRANCH_NAME=main

# Get build log
java -jar jenkins-cli.jar -s http://jenkins-server:8080 \
    console my-pipeline 42

# Restart Jenkins
java -jar jenkins-cli.jar -s http://jenkins-server:8080 safe-restart

# Jenkins Job DSL — create jobs from code
job('my-pipeline') {
    scm {
        git {
            remote {
                url('git@github.com:company/my-app.git')
                credentials('github-ssh')
            }
            branches('*/main')
        }
    }
    triggers {
        githubPush()
    }
    definition {
        cpsScm {
            scm {
                git {
                    remote {
                        url('git@github.com:company/my-app.git')
                    }
                    branches('*/main')
                }
            }
            scriptPath('Jenkinsfile')
        }
    }
}
```

---

## Optimize Jenkins Performance

```bash
# 1. Use agents (don't run builds on master)
# jenkins-agent.yaml
apiVersion: v1
kind: Pod
metadata:
  labels:
    app: jenkins-agent
spec:
  containers:
  - name: jnlp
    image: jenkins/inbound-agent:latest
  - name: docker
    image: docker:24-dind
    securityContext:
      privileged: true
  - name: kubectl
    image: bitnami/kubectl:latest
    command: ['cat']
    tty: true

# 2. Archive only what you need
post {
    always {
        archiveArtifacts artifacts: 'dist/**', fingerprint: true
        // don't archive node_modules!
    }
}

# 3. Use parallel stages
stages {
    stage('Test') {
        parallel {
            stage('Unit Tests') {
                steps { sh 'npm run test:unit' }
            }
            stage('Integration Tests') {
                steps { sh 'npm run test:integration' }
            }
            stage('Lint') {
                steps { sh 'npm run lint' }
            }
        }
    }
}

# 4. Cache dependencies
stage('Install') {
    steps {
        cache(maxCacheSize: 500, caches: [
            arbitraryFileCache(
                path: 'node_modules',
                cacheValidityDecidingFile: 'package-lock.json'
            )
        ]) {
            sh 'npm ci'
        }
    }
}
```

---

## Interview Questions — Jenkins

**Q: How do you implement a multi-environment deployment in Jenkins?**
> "I use a multi-branch pipeline with environment-specific stages guarded by `when`
> conditions. Feature branches deploy only to dev. Release branches deploy to staging
> after tests pass. Main branch deploys to staging automatically, then requires an
> input approval before deploying to production. I use Jenkins credentials to store
> kubeconfig files for each environment. All configuration is in the Jenkinsfile
> committed to the repository — Pipeline as Code."

**Q: How do you handle secrets in Jenkins?**
> "I use Jenkins Credentials Store — never hardcode secrets in Jenkinsfiles.
> For AWS credentials, I use the AWS Credentials plugin with IAM roles or temporary
> credentials. For production, I prefer using the Jenkins integration with AWS Secrets
> Manager so secrets are managed centrally and rotated automatically."

**Q: What is a Jenkins shared library and why use it?**
> "A shared library is a repository of reusable Groovy functions that multiple
> Jenkinsfiles can import. It prevents copy-pasting the same pipeline logic across
> 50 repositories. When you need to update the deployment logic, you change it in
> one place. I use them for common tasks like building Docker images, deploying to
> Kubernetes, and sending Slack notifications."

---

[← Back to Section](./README.md) | [Next: GitHub Actions →](./02-github-actions.md)
