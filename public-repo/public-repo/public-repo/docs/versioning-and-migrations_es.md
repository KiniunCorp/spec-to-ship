# s2s CLI - Versionado y Migraciones

## Estándar de versionado del CLI

`s2s` usa Semantic Versioning:

- `MAJOR.MINOR.PATCH`
- Ejemplos:
  - `0.1.0`
  - `0.1.1`
  - `0.1.2`
  - `1.0.0`
  - `2.0.0`
  - `0.1.0-rc.1`
  - `1.1.0-beta.2`

Versión actual: ver `package.json` o ejecutar `s2s --version`.

## Regla obligatoria de bump

Cada cambio mergeado debe incrementar la versión del CLI.

- Incremento mínimo obligatorio: `PATCH` (`0.1.0` -> `0.1.1`).
- Usa `MINOR` para nuevas capacidades compatibles.
- Usa `MAJOR` para cambios incompatibles.

En cada bump, actualizar todos estos puntos:

1. `package.json` (`version`)
2. `package-lock.json`
3. Constantes en `src/cli.ts` (`CLI_VERSION`, `TEMPLATE_VERSION`, `DEFAULT_MIN_CLI_VERSION` cuando aplique)
4. `CHANGELOG.md`

Enforcement del repositorio:

- `npm run check` ahora valida el self-versioning del producto antes del delivery.
- `npm run check` también valida que la entrada activa del changelog separe `Product Changes` de `Repo Governance Changes`.
- CI corre en `pull_request` y en `push` a `main`.
- Para forzar delivery solo vía PR hacia `main`, habilita branch protection en GitHub y exige CI.

## Campos de compatibilidad por proyecto

Cada proyecto guarda metadatos de compatibilidad en `.s2s/project.json`:

- `schemaVersion`: versión del contrato de esquema de proyecto
- `templateVersion`: versión de plantilla `.s2s`
- `minCliVersion`: versión mínima requerida de `s2s`
- `lastMigratedByCliVersion`: última versión de CLI que migró el proyecto

## Política de migraciones

1. Las migraciones se ejecutan automáticamente al correr comandos de proyecto.
2. Antes de aplicar cambios de migración se crea backup en:
   - `.s2s/backups/<timestamp>/`
3. Las migraciones son idempotentes y se registran en:
   - `.s2s/logs/migrations.log`
4. Si la versión actual del CLI es menor que `minCliVersion`, el comando se bloquea.

## Política de severidad de actualización de proyecto (soft/hard)

Cuando el CLI detecta archivos gestionados del proyecto desactualizados (`schemaVersion`, `templateVersion` o drift en `minCliVersion` del proyecto), clasifica la actualización como:

- `soft`: el usuario puede postergar; se guarda estado pendiente en `.s2s/project.local.json`
- `hard`: la actualización es obligatoria; la ejecución se bloquea hasta aplicar update

Comportamiento obligatorio:

1. Informar al usuario antes de actualizar archivos del proyecto.
2. Pedir confirmación en modo interactivo.
3. En modo no interactivo:
   - updates soft se postergan
   - updates hard fallan de inmediato

Bandera de build/release:

- `S2S_PROJECT_UPDATE_CLASS=soft|hard`
- valor por defecto: `soft`
- usar `hard` para releases que deben forzar actualización de proyecto antes de continuar.

## Flujo de actualización

Instalación:

```bash
brew tap kiniuncorp/s2s
brew install s2s
```

Actualizar:

```bash
brew upgrade s2s
```

Verificar:

```bash
s2s --version
```
