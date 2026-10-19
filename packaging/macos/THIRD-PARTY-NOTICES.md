# Componentes del paquete macOS

Las versiones, URLs oficiales y sumas SHA-256 están fijadas en `components.json`. Los archivos originales de licencia se conservan dentro de la app.

- **Node.js 24.22.0**, licencia MIT y avisos de los componentes incluidos: `Contents/Resources/node/LICENSE`. Fuente: https://nodejs.org/dist/v24.22.0/node-v24.22.0.tar.gz
- **Git portable / dugite-native 2.53.0-4**, distribución de GitHub Desktop. Git se distribuye bajo GPLv2 y sus dependencias conservan sus respectivas licencias. Binarios, código fuente y recetas: https://github.com/desktop/dugite-native/releases/tag/v2.53.0-4 y https://github.com/desktop/dugite-native . Fuentes de Git: https://github.com/git/git/tree/v2.53.0 . Se conserva el árbol de la distribución dentro de `Contents/Resources/git`.
- **marked** y **DOMPurify**, fijados en `package-lock.json`; licencias originales en `Contents/Resources/app/node_modules`.

El lanzador Swift y el proceso de compilación forman parte del repositorio PromptExplorer, etiqueta `mac-v0.4.1`. La firma ad hoc se aplica al paquete para verificar integridad local y no representa una firma de confianza de Apple.
