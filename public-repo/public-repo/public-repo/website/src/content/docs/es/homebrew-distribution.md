---
title: "Distribución por Homebrew"
description: "Instala y actualiza s2s en macOS mediante el tap oficial de Homebrew, con documentación completa del pipeline de release para maintainers."
---

`s2s` se puede instalar en macOS mediante Homebrew usando el tap oficial.

## Instalación rápida

```bash
brew tap kiniuncorp/s2s
brew install s2s
```

## Actualización

```bash
brew upgrade s2s
```

## Convención de nombres de artefactos

Los assets de release siguen este esquema de nomenclatura:

| Asset | Patrón |
|-------|--------|
| Tarball arm64 | `s2s-{semver}-macos-arm64.tar.gz` |
| Tarball x64 | `s2s-{semver}-macos-x64.tar.gz` |
| Checksums | `sha256sums.txt` |
| Tag de release | `v{semver}` (p. ej. `v0.2.38`) |

Cada tarball contiene un único ejecutable llamado `s2s`.

---

## Workflow de release para maintainers

El pipeline de release está totalmente automatizado. Publicar un GitHub Release es
el único paso manual — el workflow construye los binarios y actualiza la fórmula de
Homebrew sin ninguna acción adicional requerida.

### Configuración única — HOMEBREW_TAP_TOKEN

El workflow necesita acceso de escritura al repositorio tap
`KiniunCorp/homebrew-s2s`. Este es un paso único por cuenta.

1. Ve a **GitHub.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Haz clic en **Generate new token**
3. Configura:
   - **Token name**: `homebrew-tap-writer`
   - **Expiration**: según tu preferencia (1 año es razonable)
   - **Repository access**: Only selected repositories → `KiniunCorp/homebrew-s2s`
   - **Permissions**: Repository permissions → Contents → **Read and write**
4. Haz clic en **Generate token** y copia el valor
5. Ve a **github.com/KiniunCorp/spec-to-ship → Settings → Secrets and variables → Actions**
6. Haz clic en **New repository secret**
   - **Name**: `HOMEBREW_TAP_TOKEN`
   - **Value**: pega el token
7. Haz clic en **Add secret**

Esto solo necesita hacerse una vez. El token sobrevive entre releases hasta que expire.

### Publicar una nueva versión

Una vez configurado el token, el proceso de release completo es:

**Paso 1 — Crear el tag y publicar el release**

```bash
# En el repo spec-to-ship, en main después de mergear todos los cambios
git tag v0.2.39
git push origin v0.2.39
```

Luego en GitHub: **Releases → Draft a new release** → selecciona el tag → agrega
notas de release → haz clic en **Publish release**.

**Paso 2 — Listo**

El workflow `.github/workflows/release-binaries.yml` se dispara automáticamente y:

1. Compila TypeScript → empaqueta via esbuild → genera binarios standalone via `@yao-pkg/pkg`
2. Crea `s2s-{version}-macos-arm64.tar.gz`, `s2s-{version}-macos-x64.tar.gz`, `sha256sums.txt`
3. Sube los tres como assets del release
4. Parsea los checksums y hace un commit en `KiniunCorp/homebrew-s2s` que actualiza `Formula/s2s.rb` con la nueva versión y los SHA256 reales

Monitorea la ejecución en: `https://github.com/KiniunCorp/spec-to-ship/actions`

Los usuarios que ejecuten `brew update && brew upgrade s2s` obtendrán la nueva versión
una vez que el commit de la fórmula llegue al tap (normalmente dentro de un minuto
después de que el workflow termine).

### Fallback manual

Si el job `update-formula` falla (p. ej. token expirado), actualiza la fórmula manualmente:

```bash
# Obtener los checksums del release
curl -sL https://github.com/KiniunCorp/spec-to-ship/releases/download/v0.2.39/sha256sums.txt
```

Luego edita `Formula/s2s.rb` en el repo `KiniunCorp/homebrew-s2s`:

```diff
-  version "0.2.38"
+  version "0.2.39"

   on_arm do
-    url ".../v0.2.38/s2s-0.2.38-macos-arm64.tar.gz"
-    sha256 "<anterior>"
+    url ".../v0.2.39/s2s-0.2.39-macos-arm64.tar.gz"
+    sha256 "<hash arm64 de sha256sums.txt>"
   end
   on_intel do
-    url ".../v0.2.38/s2s-0.2.38-macos-x64.tar.gz"
-    sha256 "<anterior>"
+    url ".../v0.2.39/s2s-0.2.39-macos-x64.tar.gz"
+    sha256 "<hash x64 de sha256sums.txt>"
   end
```

```bash
git add Formula/s2s.rb
git commit -m "chore: actualizar fórmula s2s a v0.2.39"
git push origin main
```

---

## Comandos de validación

```bash
# Verificación de sintaxis y estilo
brew audit s2s

# Auditoría estricta con verificaciones online (requiere release publicado)
brew audit --strict --new --online s2s

# Probar el binario instalado
brew test s2s

# Verificar la versión instalada
s2s --version
```

## Disparar el pipeline manualmente (para pruebas)

El workflow soporta `workflow_dispatch` para probar la construcción sin publicar un
release real. Nota: el job `update-formula` **no** se ejecuta en dispatch manual —
solo se ejecuta la construcción y subida del binario.

1. Crea un release **borrador** con el tag objetivo (p. ej. `v0.2.38`) en GitHub
2. Ve a `https://github.com/KiniunCorp/spec-to-ship/actions`
3. Selecciona **"Build and Upload Release Binaries"**
4. Haz clic en **"Run workflow"**, ingresa el tag de versión, ejecuta
5. Verifica los assets subidos en la página del release

## Resolución de problemas

**El job `update-formula` falla con "Bad credentials"**

El secret `HOMEBREW_TAP_TOKEN` falta, expiró o no tiene acceso de escritura a
`KiniunCorp/homebrew-s2s`. Regenera el token y actualiza el secret (ver
Configuración única arriba).

**La auditoría de la fórmula falla con "checksum mismatch"**

El SHA256 en la fórmula no coincide con el tarball descargado. Esto no debería
ocurrir con el workflow automatizado, pero si ocurre, vuelve a descargar y recalcula:

```bash
curl -L -O https://github.com/KiniunCorp/spec-to-ship/releases/download/v0.2.38/s2s-0.2.38-macos-arm64.tar.gz
shasum -a 256 s2s-0.2.38-macos-arm64.tar.gz
```

**`brew install s2s` reporta "no bottle available"**

La fórmula usa tarballs de binarios precompilados, no botellas de Homebrew. Este es
el comportamiento esperado. La línea `bin.install "s2s"` extrae el binario del
tarball y lo coloca en el directorio bin de Homebrew. No ocurre compilación.

**El pipeline de release falla en el paso de pkg**

Verifica que `bundle.cjs` fue generado por esbuild. Si esbuild falla, verifica que
`dist/cli.js` existe después de `npm run build`. El compilador TypeScript debe tener
éxito antes de que esbuild se ejecute.

**Binario no encontrado después de instalar**

Ejecuta `brew doctor` y verifica que el directorio bin de Homebrew esté en `PATH`:

```bash
echo $PATH | tr ':' '\n' | grep homebrew
```
