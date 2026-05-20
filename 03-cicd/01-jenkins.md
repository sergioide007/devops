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

---

### Q: How do you implement a multi-environment deployment in Jenkins?
> "I use a multi-branch pipeline with environment-specific stages guarded by `when`
> conditions. Feature branches deploy only to dev. Release branches deploy to staging
> after tests pass. Main branch deploys to staging automatically, then requires an
> input approval before deploying to production. I use Jenkins credentials to store
> kubeconfig files for each environment. All configuration is in the Jenkinsfile
> committed to the repository — Pipeline as Code."

---

### Q: How do you handle secrets in Jenkins?
> "I use Jenkins Credentials Store — never hardcode secrets in Jenkinsfiles.
> For AWS credentials, I use the AWS Credentials plugin with IAM roles or temporary
> credentials. For production, I prefer using the Jenkins integration with AWS Secrets
> Manager so secrets are managed centrally and rotated automatically."

---

### Q: What is a Jenkins shared library and why use it?
> "A shared library is a repository of reusable Groovy functions that multiple
> Jenkinsfiles can import. It prevents copy-pasting the same pipeline logic across
> 50 repositories. When you need to update the deployment logic, you change it in
> one place. I use them for common tasks like building Docker images, deploying to
> Kubernetes, and sending Slack notifications."

---

### Q: ¿Cómo identificas un error de bloqueo (lock) en Jenkins? ¿Cómo entras y lo resuelves?

**Contexto:** El entrevistador quiere saber cómo detectas que un pipeline está bloqueado esperando un lock, y cómo lo resuelves.

**Primero — ¿qué es un lock en Jenkins?**

El plugin `Lockable Resources` permite que un pipeline "tome posesión" de un recurso (un ambiente de staging, un dispositivo físico, una base de datos de test) para que otros pipelines no lo usen al mismo tiempo.

```groovy
// Jenkinsfile con lock sobre un recurso compartido
pipeline {
    agent any
    stages {
        stage('Deploy to Staging') {
            steps {
                // Solo un pipeline puede tener este lock al mismo tiempo
                lock(resource: 'staging-environment', inversePrecedence: true) {
                    sh 'helm upgrade --install my-app ./chart -n staging'
                    sh 'npm run test:integration'
                }
            }
        }
    }
}
```

**Síntomas de un pipeline bloqueado por lock:**

```
# En la UI de Jenkins el build muestra:
[Pipeline] lock
Waiting for resource [staging-environment] to be available
Locked by: my-api » main #42 (since 3h 47m)
```

**Cómo diagnosticar y resolver:**

```bash
# ── PASO 1: Entrar a Jenkins (si es Docker) ────────────────────
docker ps | grep jenkins                         # encontrar el contenedor
docker exec -it jenkins-container bash           # entrar con bash
docker logs jenkins-container -f --tail=200      # ver logs del proceso Jenkins

# ── PASO 2: Entrar a Jenkins (si es Kubernetes) ────────────────
kubectl get pods -n jenkins                      # encontrar el Pod
kubectl exec -it jenkins-0 -n jenkins -- bash    # entrar al contenedor
kubectl logs jenkins-0 -n jenkins -f             # ver logs en tiempo real
kubectl logs jenkins-0 -n jenkins --previous     # si crasheó

# ── PASO 3: Dentro del contenedor — revisar logs de Jenkins ───
# Jenkins guarda logs en $JENKINS_HOME/logs/
ls /var/jenkins_home/logs/
cat /var/jenkins_home/logs/jenkins.log           # log principal
tail -f /var/jenkins_home/logs/jenkins.log       # seguir en tiempo real

# Ver qué jobs están corriendo ahora mismo
ls /var/jenkins_home/jobs/my-pipeline/builds/   # historial de builds
cat /var/jenkins_home/jobs/my-pipeline/builds/42/log  # log de un build específico

# ── PASO 4: Liberar el lock desde la UI ───────────────────────
# Jenkins UI → Manage Jenkins → Lockable Resources
# Encontrar el recurso bloqueado → "Unlock" (liberar manualmente)

# ── PASO 5: Liberar el lock desde la CLI ──────────────────────
# Descargar el CLI de Jenkins
wget http://jenkins-server:8080/jnlpJars/jenkins-cli.jar

# Listar recursos bloqueados con Groovy Script (Jenkins Console)
# Manage Jenkins → Script Console:
import org.jenkins.plugins.lockableresources.LockableResourcesManager
def lrm = LockableResourcesManager.get()
lrm.resources.each { resource ->
    println "${resource.name}: locked=${resource.isLocked()}, reservedBy=${resource.reservedBy}"
}

# Liberar un lock desde Script Console:
import org.jenkins.plugins.lockableresources.LockableResourcesManager
def lrm = LockableResourcesManager.get()
def resource = lrm.fromName('staging-environment')
lrm.unlock(resource, null)
println "Lock liberado"
```

**Respuesta de entrevista:**

> "Primero identifico el pipeline bloqueado en la UI — aparece como 'Waiting for resource'.
> Verifico quién tiene el lock y cuánto tiempo lleva bloqueado. Si el build que tiene el lock
> ya terminó pero no liberó (crash o kill forzado), entro a Jenkins via `docker exec` o
> `kubectl exec` según dónde corra. Reviso los logs en `/var/jenkins_home/logs/jenkins.log`.
> Luego voy a Manage Jenkins → Lockable Resources y libero manualmente el recurso. Si necesito
> automatizar la detección, uso un script en Groovy desde la Script Console de Jenkins."

---

### Q: ¿Qué es un bucle de bloqueo (deadlock) en Jenkins? ¿Cómo lo identificas y resuelves?

**Escenario:** Pipeline A espera el lock de staging para correr. Pipeline B tiene el lock de staging pero espera que Pipeline A libere el lock de la base de datos de test. Ninguno avanza — deadlock.

```
Pipeline A: [esperando lock: staging-env]  ←── bloqueado
Pipeline B: [tiene lock: staging-env]
            [esperando lock: test-database] ←── bloqueado
Pipeline A: [tiene lock: test-database]
                                           ↑
                          DEADLOCK — bucle infinito
```

**Cómo identificarlo:**

```bash
# En Jenkins UI: ambos pipelines están en estado "waiting" hace horas
# En los logs verás:
# [Pipeline A] Waiting for resource [staging-environment]...
# [Pipeline B] Waiting for resource [test-database]...

# Revisar el thread dump de Jenkins (Manage Jenkins → System Information)
# Buscar threads en estado WAITING o BLOCKED

# También desde Script Console:
Thread.allStackTraces.each { thread, stack ->
    if (thread.state == Thread.State.WAITING || thread.state == Thread.State.BLOCKED) {
        println "BLOQUEADO: ${thread.name}"
        stack.each { println "  ${it}" }
    }
}
```

**Cómo resolverlo:**

```bash
# Opción 1: Liberar todos los locks manualmente (Script Console)
import org.jenkins.plugins.lockableresources.LockableResourcesManager
def lrm = LockableResourcesManager.get()
lrm.resources.findAll { it.isLocked() }.each { resource ->
    println "Liberando: ${resource.name}"
    lrm.unlock(resource, null)
}

# Opción 2: Abortar los builds bloqueados
# Jenkins UI → el build → botón "Abort"
# O desde CLI:
java -jar jenkins-cli.jar -s http://jenkins:8080 stop-builds my-pipeline

# Opción 3: Reiniciar Jenkins de forma segura (espera builds activos)
java -jar jenkins-cli.jar -s http://jenkins:8080 safe-restart

# Opción 4 — PREVENCIÓN: siempre adquirir locks en el mismo orden
# Si todos los pipelines adquieren locks en el orden: staging → test-db
# nunca habrá deadlock
pipeline {
    stages {
        stage('Acquire Locks') {
            steps {
                lock(resource: 'staging-environment') {      // SIEMPRE primero
                    lock(resource: 'test-database') {         // SIEMPRE segundo
                        sh 'run tests'
                    }
                }
            }
        }
    }
}
```

**Respuesta de entrevista:**

> "Un deadlock en Jenkins ocurre cuando dos pipelines se esperan mutuamente.
> Lo identifico viendo que múltiples builds llevan horas en estado 'Waiting for resource'.
> Confirmo el deadlock desde la Script Console revisando threads en estado WAITING.
> La solución inmediata es liberar los locks manualmente y abortar los builds bloqueados.
> La solución permanente es establecer un orden fijo para adquirir locks — si todos los
> pipelines siempre toman el lock A antes que el B, el deadlock es imposible."

---

### Q: ¿Cómo revisas los logs de Jenkins para identificar el error exacto?

```bash
# ── DESDE LA UI ────────────────────────────────────────────────
# Jenkins → job → build número → Console Output
# Buscar: [ERROR], FAILED, Exception, exit code

# ── DESDE EL SISTEMA DE ARCHIVOS ───────────────────────────────
# (dentro del contenedor o servidor)
JENKINS_HOME=/var/jenkins_home

# Log del sistema Jenkins (arranque, plugins, configuración)
tail -f $JENKINS_HOME/logs/jenkins.log

# Log de un build específico (build #42 del job my-pipeline)
cat "$JENKINS_HOME/jobs/my-pipeline/branches/main/builds/42/log"

# Buscar ERROR en todos los builds recientes
grep -r "ERROR\|Exception\|FAILED" \
    $JENKINS_HOME/jobs/my-pipeline/builds/ \
    --include="log" -l

# ── DESDE LA CLI ───────────────────────────────────────────────
# Ver console output del último build
java -jar jenkins-cli.jar -s http://jenkins:8080 \
    console my-pipeline lastBuild

# Ver build específico
java -jar jenkins-cli.jar -s http://jenkins:8080 \
    console my-pipeline 42

# Ver solo las últimas 100 líneas
java -jar jenkins-cli.jar -s http://jenkins:8080 \
    console my-pipeline 42 -f -n 100

# ── IDENTIFICAR EL ERROR EXACTO ────────────────────────────────
# Patrón para leer un log de Jenkins:

# 1. Busca la primera línea con "FAILED" o "ERROR"
grep -n "FAILED\|ERROR\|Exception" build.log | head -20

# 2. El exit code te dice qué pasó:
# exit code 1  → error genérico del script
# exit code 2  → misuse of shell command
# exit code 126 → permiso denegado (no ejecutable)
# exit code 127 → comando no encontrado
# exit code 137 → killed (OOM o SIGKILL)
# exit code 143 → SIGTERM (Jenkins abortó el build)

# 3. Busca el stage donde falló
grep -n "stage\|Entering\|Leaving\|FAILED" build.log

# ── LOKI PARA LOGS CENTRALIZADOS ──────────────────────────────
# En producción con Grafana Loki:
# {namespace="jenkins"} |= "ERROR" | json
# {job="jenkins"} |~ "Exception" | line_format "{{.message}}"
```

**Respuesta de entrevista:**

> "Para identificar el error exacto en Jenkins voy directo a Console Output del build fallido.
> Busco el primer 'ERROR' o 'FAILED' — eso me dice el stage y el comando exacto que falló.
> El exit code es clave: 137 es OOM, 127 es comando no encontrado, 1 es error de aplicación.
> Si necesito buscar en múltiples builds, entro al contenedor y uso `grep -r` sobre el directorio
> de builds en `$JENKINS_HOME`. En entornos con Loki/Grafana centralizo todos los logs y busco
> desde Grafana."

---

### Q: ¿Cómo creas nuevos releases en Jenkins?

**Estrategia de versionado semántico automatizado:**

```groovy
// Jenkinsfile — release pipeline completo
pipeline {
    agent any

    environment {
        REGISTRY = 'registry.mycompany.com'
        APP = 'my-api'
    }

    stages {
        stage('Calculate Version') {
            steps {
                script {
                    // Obtener la última versión del tag de Git
                    def lastTag = sh(
                        script: 'git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0"',
                        returnStdout: true
                    ).trim()

                    // Incrementar versión según tipo de cambio
                    // BREAKING CHANGE → major, feat → minor, fix → patch
                    def commitMsg = sh(
                        script: 'git log -1 --pretty=%B',
                        returnStdout: true
                    ).trim()

                    def (major, minor, patch) = lastTag.replace('v','').tokenize('.')
                        .collect { it.toInteger() }

                    if (commitMsg.contains('BREAKING CHANGE')) {
                        major++; minor = 0; patch = 0
                    } else if (commitMsg.startsWith('feat')) {
                        minor++; patch = 0
                    } else {
                        patch++
                    }

                    env.NEW_VERSION = "v${major}.${minor}.${patch}"
                    env.IMAGE_TAG = "${REGISTRY}/${APP}:${env.NEW_VERSION}"
                    echo "New version: ${env.NEW_VERSION}"
                }
            }
        }

        stage('Build & Push Release Image') {
            steps {
                sh "docker build -t ${IMAGE_TAG} ."
                withCredentials([usernamePassword(
                    credentialsId: 'docker-registry',
                    usernameVariable: 'USER',
                    passwordVariable: 'PASS'
                )]) {
                    sh """
                        echo ${PASS} | docker login ${REGISTRY} -u ${USER} --stdin
                        docker push ${IMAGE_TAG}
                        docker tag ${IMAGE_TAG} ${REGISTRY}/${APP}:latest
                        docker push ${REGISTRY}/${APP}:latest
                    """
                }
            }
        }

        stage('Tag Git Release') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'github-credentials',
                    usernameVariable: 'GIT_USER',
                    passwordVariable: 'GIT_PASS'
                )]) {
                    sh """
                        git config user.email "jenkins@mycompany.com"
                        git config user.name "Jenkins"
                        git tag -a ${NEW_VERSION} -m "Release ${NEW_VERSION}"
                        git push https://${GIT_USER}:${GIT_PASS}@github.com/company/${APP}.git ${NEW_VERSION}
                    """
                }
            }
        }

        stage('Create GitHub Release') {
            steps {
                withCredentials([string(credentialsId: 'github-token', variable: 'GITHUB_TOKEN')]) {
                    sh """
                        curl -s -X POST \
                            -H "Authorization: token ${GITHUB_TOKEN}" \
                            -H "Content-Type: application/json" \
                            https://api.github.com/repos/company/${APP}/releases \
                            -d '{
                                "tag_name": "${NEW_VERSION}",
                                "name": "Release ${NEW_VERSION}",
                                "body": "Automated release by Jenkins build #${BUILD_NUMBER}",
                                "draft": false,
                                "prerelease": false
                            }'
                    """
                }
            }
        }

        stage('Deploy New Release') {
            steps {
                withKubeConfig([credentialsId: 'production-kubeconfig']) {
                    sh """
                        kubectl set image deployment/${APP} \
                            ${APP}=${IMAGE_TAG} \
                            -n production
                        kubectl rollout status deployment/${APP} \
                            -n production --timeout=10m
                    """
                }
            }
        }
    }

    post {
        success {
            slackSend(
                channel: '#releases',
                color: 'good',
                message: "🚀 *${APP}* ${NEW_VERSION} deployed to production\nBuild: ${BUILD_URL}"
            )
        }
    }
}
```

**Respuesta de entrevista:**

> "Para releases uso versionado semántico automatizado. El pipeline calcula la nueva versión
> basándose en los mensajes de commit: BREAKING CHANGE incrementa major, feat incrementa minor,
> fix incrementa patch. Construye la imagen Docker con ese tag, la empuja al registry, crea un
> tag Git y un Release en GitHub, y finalmente despliega a producción. Todo está en el Jenkinsfile
> — no hay clicks manuales. Integro con Slack para notificar al equipo."

---

### Q: ¿Cómo configuras un nuevo nodo (agent) de Jenkins desde cero?

**Jenkins llama a sus agentes 'nodes' o 'agents'. Los 'Cyber Agents' son agentes en Kubernetes:**

```bash
# ── OPCIÓN 1: Agente estático (servidor dedicado) ──────────────

# En el servidor que será el agente:
sudo apt install openjdk-17-jdk -y
sudo useradd -m -s /bin/bash jenkins
sudo mkdir /home/jenkins/.ssh
# Copiar la clave pública de Jenkins al agente

# En Jenkins UI:
# Manage Jenkins → Nodes → New Node
# Name: worker-node-01
# Remote root directory: /home/jenkins
# Launch method: SSH
# Host: 192.168.1.100
# Credentials: jenkins SSH key

# ── OPCIÓN 2: Agente dinámico en Kubernetes (más común hoy) ────
# Instala el plugin: Kubernetes
# Manage Jenkins → Clouds → New Cloud → Kubernetes

# Configuración del pod template:
# jenkins-agent-pod.yaml
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: jenkins
  containers:
  - name: jnlp
    image: jenkins/inbound-agent:latest-jdk17
    resources:
      requests:
        memory: "512Mi"
        cpu: "500m"
      limits:
        memory: "1Gi"
        cpu: "1"
  - name: docker
    image: docker:24-dind
    securityContext:
      privileged: true
    volumeMounts:
    - name: docker-sock
      mountPath: /var/run/docker.sock
  - name: kubectl
    image: bitnami/kubectl:1.30
    command: ['cat']
    tty: true
  volumes:
  - name: docker-sock
    hostPath:
      path: /var/run/docker.sock

# En el Jenkinsfile, usar el agente Kubernetes:
pipeline {
    agent {
        kubernetes {
            yaml """
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: maven
    image: maven:3.9-openjdk-17
    command: ['cat']
    tty: true
"""
            defaultContainer 'maven'
        }
    }
    stages {
        stage('Build') {
            steps {
                sh 'mvn clean package'
            }
        }
    }
}

# ── OPCIÓN 3: Jenkins desde cero en Kubernetes con Helm ────────
helm repo add jenkins https://charts.jenkins.io
helm repo update

# Crear values.yaml personalizado
cat > jenkins-values.yaml << 'EOF'
controller:
  adminPassword: "changeme123"
  resources:
    requests:
      cpu: "1"
      memory: "2Gi"
    limits:
      cpu: "2"
      memory: "4Gi"
  installPlugins:
    - kubernetes:latest
    - workflow-aggregator:latest
    - git:latest
    - configuration-as-code:latest
    - lockable-resources:latest
    - blueocean:latest
  JCasC:
    configScripts:
      welcome-message: |
        jenkins:
          systemMessage: "Jenkins — Production CI/CD"
persistence:
  enabled: true
  size: "50Gi"
  storageClass: "gp3"
EOF

helm install jenkins jenkins/jenkins \
    --namespace jenkins \
    --create-namespace \
    -f jenkins-values.yaml

# Obtener la contraseña de admin
kubectl exec --namespace jenkins -it svc/jenkins \
    -c jenkins -- /bin/cat /run/secrets/additional/chart-admin-password
```

**Respuesta de entrevista:**

> "Empiezo de cero instalando Jenkins con Helm en Kubernetes — es la forma más reproducible
> y mantenible. Defino todos los plugins en el values.yaml, así si recreo el cluster tengo
> la misma configuración. Para los agentes uso el plugin de Kubernetes — Jenkins crea Pods
> dinámicos por cada build y los destruye al terminar. Esto elimina la necesidad de mantener
> servidores agente dedicados. Toda la configuración de Jenkins la gestiono con JCasC
> (Jenkins Configuration as Code) para que sea reproducible y versionada en Git."

---

### Q: ¿Qué CI/CD estás usando? ¿Cómo lo integras con infraestructura en la nube?

**Respuesta completa para entrevista:**

> "Depende del contexto. Tengo experiencia con los tres principales:
>
> - **Jenkins**: para empresas legacy, on-premise, entornos con requerimientos estrictos de auditoría.
>   Máxima flexibilidad, 1800+ plugins, control total. Pero requiere mantenimiento.
>
> - **GitHub Actions**: para proyectos en GitHub. Zero maintenance — GitHub gestiona los runners.
>   Ideal para equipos pequeños/medianos. Integración nativa con el ecosistema GitHub.
>
> - **GitLab CI/CD**: para empresas que necesitan todo en una plataforma (código + CI + registry + monitoring).
>
> Para infraestructura en la nube, el patrón que uso:"

```yaml
# GitHub Actions — integración con AWS
name: Deploy to Production
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # Para OIDC — sin credenciales estáticas
      contents: read

    steps:
      - uses: actions/checkout@v4

      # Autenticación SIN secret keys — usando OIDC (la forma moderna)
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789:role/github-actions-deploy
          aws-region: us-east-1

      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push to ECR
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/my-api:$IMAGE_TAG .
          docker push $ECR_REGISTRY/my-api:$IMAGE_TAG

      - name: Deploy to EKS
        run: |
          aws eks update-kubeconfig --name production-cluster --region us-east-1
          kubectl set image deployment/my-api my-api=$ECR_REGISTRY/my-api:$IMAGE_TAG -n production
          kubectl rollout status deployment/my-api -n production --timeout=5m
```

```bash
# Jenkins — integración con AWS y Kubernetes
pipeline {
    agent { kubernetes { ... } }

    environment {
        AWS_REGION = 'us-east-1'
        EKS_CLUSTER = 'production-cluster'
        ECR_REGISTRY = '123456789.dkr.ecr.us-east-1.amazonaws.com'
    }

    stages {
        stage('Build & Push to ECR') {
            steps {
                withCredentials([[
                    $class: 'AmazonWebServicesCredentialsBinding',
                    credentialsId: 'aws-production',
                    accessKeyVariable: 'AWS_ACCESS_KEY_ID',
                    secretKeyVariable: 'AWS_SECRET_ACCESS_KEY'
                ]]) {
                    sh """
                        aws ecr get-login-password --region ${AWS_REGION} | \
                            docker login --username AWS --password-stdin ${ECR_REGISTRY}
                        docker build -t ${ECR_REGISTRY}/my-api:${GIT_COMMIT[0..7]} .
                        docker push ${ECR_REGISTRY}/my-api:${GIT_COMMIT[0..7]}
                    """
                }
            }
        }

        stage('Deploy to EKS') {
            steps {
                sh """
                    aws eks update-kubeconfig --name ${EKS_CLUSTER} --region ${AWS_REGION}
                    kubectl set image deployment/my-api \
                        my-api=${ECR_REGISTRY}/my-api:${GIT_COMMIT[0..7]} \
                        -n production
                    kubectl rollout status deployment/my-api -n production --timeout=10m
                """
            }
        }
    }
}
```

---

### Q: ¿Qué es Kafka y cómo mejora los despliegues? ¿Por qué a Kafka no le importan los servicios?

**Respuesta completa para entrevista:**

> "Apache Kafka es un sistema de mensajería distribuido basado en logs. Actúa como un bus
> de eventos central. La clave es que **Kafka desacopla productores de consumidores** —
> quien publica un evento NO sabe quién lo consume, ni cuántos consumidores hay, ni si
> están corriendo en ese momento.
>
> Cuando digo 'a Kafka no le importan los servicios' me refiero exactamente a eso:
> Kafka no sabe ni le importa si el servicio de notificaciones está caído, si el servicio
> de analytics acaba de desplegarse, o si hay 5 réplicas del procesador de pagos.
> Kafka solo retiene los mensajes en el topic. Cada servicio los consume a su ritmo."

```
SIN KAFKA — acoplamiento directo:
                                 → Servicio Notificaciones (¿está up?)
Payment API → HTTP calls directos → Servicio Fraude (¿está up?)
                                 → Servicio Analytics (¿está up?)
             Si uno falla → error en cadena
             Si uno está desplegando → pérdida de datos

CON KAFKA — desacoplamiento total:
                      ┌─────────────────────────────────────┐
Payment API ──────────▶  Topic: payment.processed            │
(producer)            │  [msg1][msg2][msg3][msg4][msg5]...   │
                      └──────────────────────────────────────┘
                               ▲           ▲           ▲
                               │           │           │
                     Notificaciones   Fraude       Analytics
                     (consume cuando  (consume      (consume
                     puede, offset=3)  offset=5)    offset=1)

Kafka retiene mensajes X días — si un servicio se cae y vuelve,
retoma desde donde quedó. ZERO pérdida de datos.
```

**Cómo impacta en despliegues:**

```bash
# Con Kafka puedes desplegar servicios consumidores SIN coordination
# El producer (Payment API) no necesita saber que estás desplegando el consumer

# Despliegue sin downtime de un consumer:
kubectl set image deployment/notification-service \
    notification-service=registry/notification-service:v2.1 \
    -n production
# Durante el rolling update:
# - Las réplicas viejas siguen consumiendo de Kafka
# - Las réplicas nuevas empiezan a consumir cuando están ready
# - Kafka retiene los mensajes no consumidos
# - NO HAY pérdida de eventos durante el despliegue

# Ver el lag (mensajes pendientes) de un consumer group
# Si el lag crece durante el despliegue → no hay problema, se pondrá al día
kafka-consumer-groups.sh \
    --bootstrap-server kafka:9092 \
    --group notification-service \
    --describe

# OUTPUT:
# GROUP                   TOPIC              PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# notification-service    payment.processed  0          1250            1258            8   ← 8 mensajes pendientes (normal)
# notification-service    payment.processed  1          980             980             0
```

**Respuesta de entrevista (cómo mejora despliegues):**

> "Kafka transforma los despliegues de dependientes a independientes. Antes, si necesitaba
> desplegar el servicio de notificaciones tenía que coordinarlo con el de pagos porque llamaban
> directamente. Con Kafka, el servicio de pagos publica eventos al topic y se olvida. Puedo
> desplegar, reiniciar, escalar o actualizar el servicio de notificaciones en cualquier momento
> sin afectar a pagos. Kafka retiene los mensajes hasta que notificaciones los procese.
>
> También mejora la resiliencia: si notificaciones se cae, los eventos se acumulan en Kafka
> y se procesan en orden cuando vuelve. Con llamadas HTTP directas, esos eventos se perderían.
>
> En entornos de CI/CD esto significa que los release trains de distintos equipos son completamente
> independientes — cada equipo despliega su servicio sin impactar a los demás."

```yaml
# Ejemplo: Kubernetes + Kafka — despliegue independiente de consumidores
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-processor
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: payment-processor
        image: registry/payment-processor:v3.2
        env:
        - name: KAFKA_BROKERS
          value: "kafka-0.kafka:9092,kafka-1.kafka:9092,kafka-2.kafka:9092"
        - name: KAFKA_GROUP_ID
          value: "payment-processor-v3"  # nuevo group ID en major versions
        - name: KAFKA_TOPIC
          value: "orders.created"
        # Kafka maneja el offset — si el pod muere y vuelve, retoma desde donde quedó
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
```

---

[← Section Overview](javascript:dvGo('overview')) | [Next: GitHub Actions →](javascript:dvGo('github-actions'))
