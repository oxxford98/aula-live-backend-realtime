# aula-live-backend-realtime

Backend de tiempo real para el proyecto **Aula Live**. Proporciona los servicios de comunicación en tiempo real mediante **WebSockets** y **WebRTC**, permitiendo la interacción entre los usuarios durante las sesiones.

## Tecnologías

- Node.js
- TypeScript
- Socket.IO (WebSockets)
- WebRTC (Señalización)
- Express
- Firebase Admin SDK
- AsyncAPI

---

## Requisitos

- Node.js 20 o superior
- npm
- Un proyecto de Firebase con credenciales de una cuenta de servicio

---

## Instalación

### 1. Clonar el repositorio

```bash
git clone <URL_DEL_REPOSITORIO>
cd aula-live-backend-realtime
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Crear un archivo `.env` en la raíz del proyecto con el siguiente contenido:

```env
PORT=3001

FIREBASE_PROJECT_ID=aula-live-xxxxxxxx

FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@aula-live-xxxxx.iam.gserviceaccount.com

FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nTU_CLAVE_PRIVADA\n-----END PRIVATE KEY-----\n"
```

> **Importante:** La variable `FIREBASE_PRIVATE_KEY` debe conservar los caracteres `\n` para representar correctamente los saltos de línea de la clave privada.

### 4. Ejecutar el proyecto

Modo desarrollo:

```bash
npm run dev
```

Compilar el proyecto:

```bash
npm run build
```

Ejecutar la versión compilada:

```bash
npm start
```

---

## Scripts disponibles

| Comando | Descripción |
|----------|-------------|
| `npm install` | Instala todas las dependencias del proyecto. |
| `npm run dev` | Inicia el servidor en modo desarrollo. |
| `npm run build` | Compila el proyecto TypeScript. |
| `npm start` | Ejecuta la aplicación compilada. |

---

# Documentación Realtime (AsyncAPI)

La documentación de los eventos WebSocket y del protocolo de comunicación se encuentra disponible mediante **AsyncAPI**.

## En entorno local

- Especificación YAML:
  ```
  http://localhost:3001/docs/asyncapi.yaml
  ```

- Visualización de la documentación:
  ```
  http://localhost:3001/docs
  ```

## En producción (Render)

- Especificación YAML:
  ```
  https://<tu-servicio>.onrender.com/docs/asyncapi.yaml
  ```

- Visualización:
  ```
  https://<tu-servicio>.onrender.com/docs
  ```

La ruta `/docs` redirige automáticamente a **AsyncAPI Studio**, utilizando la especificación pública hospedada por este mismo servicio.

---

# Integración Continua (CI)

El proyecto cuenta con un flujo de integración continua mediante **GitHub Actions** ubicado en:

```
.github/workflows/ci.yml
```

### Características

- Se ejecuta automáticamente al crear o actualizar un **Pull Request** hacia la rama `main`.
- Instala las dependencias utilizando:

```bash
npm ci
```

- Compila el proyecto utilizando:

```bash
npm run build
```

Este proceso verifica automáticamente que el proyecto compile correctamente antes de integrar cambios en la rama principal.
