# Componentes distribuidos

PromptExplorer incluye sin modificarlos componentes de terceros y conserva sus avisos en la carpeta de ejecución extraída. El archivo `components.json` especifica versiones, URLs oficiales y SHA-256 del runtime Node.js y MinGit.

- **Node.js 24.22.0**: licencia MIT y licencias de los componentes incluidos, detalladas en `node/LICENSE`. Fuente: https://nodejs.org/dist/v24.22.0/node-v24.22.0.tar.gz
- **Git for Windows / MinGit 2.56.0.windows.2**: Git se distribuye bajo GPLv2; los componentes de MinGit conservan sus respectivas licencias y avisos dentro de `git/`. Binarios y fuentes de la versión: https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.2 . Fuentes del conjunto y recetas de distribución: https://github.com/git-for-windows/build-extra y https://github.com/git-for-windows/MSYS2-packages .
- **.NET 8 y Windows Desktop Runtime**: licencias MIT y avisos de terceros de Microsoft. Fuente y licencias: https://github.com/dotnet/runtime y https://github.com/dotnet/winforms .
- **marked** y **DOMPurify**: versiones fijadas en `package-lock.json`; sus licencias originales se incluyen en `app/node_modules/marked` y `app/node_modules/dompurify`.

El lanzador extrae el paquete sin alterar sus componentes. El repositorio PromptExplorer contiene el código del lanzador y el script de compilación para reproducir la distribución. No se incluyen llaves SSH, credenciales, sesiones ni documentos personales.
