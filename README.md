# PromptExplorer — Local y GitHub por SSH

Editor Markdown ligero con dos modos: **Local**, que deja la sincronización a tu herramienta habitual, y **GitHub por SSH**, que permite descargar y publicar desde la app. Ambos crean commits locales con comentario. No requiere OAuth App, Client ID ni tokens GitHub.

## App y contenido separados

- **App:** https://github.com/danvao/PromptExplorer — código, interfaz, lanzadores y pruebas.
- **Contenido de prueba:** https://github.com/danvao/PromptExplorer-content — Markdown y prompts; se abre desde el selector Repositorio.

Descargar la app no conecta tu cuenta personal ni obliga a usar el repositorio de prueba. En otra computadora puedes elegir cualquier repositorio local o URL SSH del trabajo con sus propias credenciales. No guardes contenido de trabajo dentro del código de la app: usa un repositorio separado.

Puedes descargar el código de la app como ZIP, descomprimirlo y ejecutarlo sin conservar una copia Git del código. Si el repositorio es privado, descarga el ZIP con una cuenta que tenga acceso o usa una copia transferida por un medio permitido por tu empresa.

## Windows: ejecutable autónomo

La distribución `PromptExplorer.exe` se genera y prueba en Windows mediante el workflow **Windows portable**, y se adjunta a la release de la versión cuando las pruebas pasan. Descarga el EXE desde [Releases](https://github.com/danvao/PromptExplorer/releases).

No requiere instalar Node.js, Git ni .NET. Incluye esos componentes y abre la interfaz en el navegador predeterminado. Se cierra desde el icono junto al reloj → **Salir**. Puedes abrir la dirección local en Chrome y Firefox. El primer paquete es Windows x64, sin firma digital; su ejecución está sujeta a las políticas de TI.

Runtime y datos se guardan por usuario en `%LOCALAPPDATA%\PromptExplorer`, separados de los documentos de repositorios locales. Copiar el EXE a otra computadora no transfiere los borradores ni las credenciales SSH. Más detalles en [LEEME-Windows](packaging/windows/LEEME-Windows.md).

Para construir: Windows, Node.js, Git y .NET SDK 8; ejecuta `npm ci`, `npm test` y `pwsh ./packaging/windows/build.ps1`. El script descarga binarios oficiales con SHA-256 fijados, los empaqueta, construye el EXE y lo ejecuta sin Node/Git externos en PATH para verificar un commit real.

## Mac: app autónoma

En la misma release de Windows hay dos ZIP con **PromptExplorer.app**: **arm64** para Apple Silicon y **x64** para Intel. Requieren macOS 14 o posterior e incluyen Node.js y Git; no necesitas Homebrew ni Xcode para usarlos. Descomprime y abre la app. Puedes salir desde su icono en la barra superior.

Los documentos se conservan en sus carpetas originales. Las copias de prueba y configuración están en `~/Library/Application Support/PromptExplorer/data`. El paquete tiene firma ad hoc, no Developer ID ni notarización; las políticas del equipo pueden exigir revisión de TI. Detalles en [LEEME-macOS](packaging/macos/LEEME-macOS.md).

El código del empaquetado Mac está en la etiqueta `mac-v0.4.1-r1`; el workflow **macOS portable** compila y prueba cada arquitectura en su sistema, y agrega los ZIP a la release `v0.4.1`. Para construir desde el código: `npm ci`, `npm test` y `python3 packaging/macos/build.py --arch arm64` (o `x64` en Intel). El script verifica SHA-256 de los componentes oficiales, construye la app y ejecuta una prueba que crea un commit con su Git incluido.

## Abrir desde el código fuente

Requisitos: Node.js 22 o superior y Git. En Mac abre `start.command`; en Windows abre `start.bat`. También puedes ejecutar `npm install` la primera vez y `npm start`.

Mantén el servidor encendido y abre **http://127.0.0.1:4317** en Chrome o Firefox. Usa siempre esa misma dirección. Para detener el servidor: Ctrl+C. Windows incluye lanzador, pero su ejecución requiere validación en ese sistema.

## Usar tu repositorio

1. Descarga el repositorio con la herramienta autorizada de tu trabajo: VS Code, GitHub Desktop o terminal.
2. Abre **Repositorio** en PromptExplorer.
3. Pega la ruta absoluta de la carpeta raíz del repositorio, no la carpeta `.git`. En Finder puedes copiarla con ⌥⌘C; en Windows usa “Copiar como ruta”.
4. Pulsa **Abrir esta carpeta**. Los archivos se editan directamente ahí; no se copian a un espacio oculto.
5. Selecciona un Markdown en el explorador y cambia entre Lectura y Editar. Se guarda automáticamente después de una pausa. Cmd/Ctrl+S fuerza el guardado local.
6. Pulsa **Crear versión**, escribe un comentario y confirma para crear un commit local.
7. Haz pull/push desde tu herramienta Git habitual, en **esa misma carpeta**.
8. La app relee el estado al recuperar el foco o cada 10 segundos mientras está visible, si no tienes un borrador sin guardar ni un diálogo abierto. **Actualizar** fuerza la lectura.

La app respeta el nombre y correo Git del repositorio o del sistema, sus hooks y su configuración de firma de commits. Si un hook o la firma requiere interacción no disponible desde el servidor, crea ese commit desde tu herramienta habitual. La app no altera la identidad ni la configuración del repositorio.

Si un commit falla después de preparar los archivos, pueden quedar en el índice Git: revísalos y completa el commit o retíralos del área de preparación en tu herramienta habitual antes de reintentar.

## Conectar GitHub por SSH

1. Prepara una llave SSH en tu computadora. Añade **solo la llave pública (.pub)** en GitHub → Settings → SSH and GPG keys. La llave privada permanece en tu computadora.
2. Si tu organización usa SSO, usa **Configure SSO → Authorize** junto a la llave para autorizarla. Poder añadir la llave a tu cuenta no garantiza acceso al repositorio ni aprobación de la organización.
3. Carga la llave en ssh-agent o en el almacén seguro de tu sistema. Si está protegida con frase de paso, desbloquéala antes de usar la app.
4. En tu terminal prueba `ssh -T git@github.com`. Verifica la huella del host según la documentación de GitHub y que la respuesta mencione la cuenta correcta. En GitHub una autenticación correcta puede devolver código de salida 1 porque no ofrece acceso de shell.
5. Abre **Repositorio**, elige **GitHub · conectar por SSH** y pega la URL de Code → SSH, por ejemplo `git@github.com:danvao/PromptExplorer-content.git`.
6. Pulsa **Abrir GitHub por SSH**. Se descarga una copia propia de ese repositorio para este perfil y navegador. Volver a abrir la misma URL reutiliza esa copia y conserva borradores.
7. Edita y pulsa **Crear versión** con un comentario.
8. Pulsa **Sync GitHub** para descargar y publicar. Crear versión por sí solo no sube cambios.

También admite `git@dominio-enterprise:organizacion/repositorio.git` y alias como `git@github-trabajo:organizacion/repositorio.git`, configurados en tu SSH. Los puertos y la selección de IdentityFile pueden configurarse en el archivo SSH de tu sistema; la app no tiene un campo para pegar llaves privadas. Para varias cuentas, utiliza alias SSH distintos y confirma la identidad con `ssh -T git@ALIAS`.

El servidor usa SSH en modo no interactivo, con verificación estricta del host. No acepta hosts desconocidos, no pide frases de paso y no cambia tus llaves. Si necesitas aprobar el host o desbloquear una llave, hazlo en la terminal. Iniciar la app desde una terminal con el agente disponible puede ser necesario para que herede `SSH_AUTH_SOCK`. Git/SSH y los repositorios siguen sujetos a las políticas de tu empresa.

### Sincronización y divergencia

Sync requiere que no haya cambios sin commit ni operaciones Git pendientes. Descarga la rama y solo incorpora cambios por **fast-forward**. Si tu copia y la remota tienen commits distintos, se detiene sin forzar push ni hacer merges o rebases implícitos. Tus commits se conservan: abre la ruta mostrada en Repositorio con tu herramienta Git, combina las ramas, resuelve y confirma cualquier conflicto, y vuelve a sincronizar.

Sync publica todos los commits pendientes de esa rama, incluidos los creados desde otra herramienta. Comprueba la rama y el historial antes de publicar. Las reglas de GitHub siguen aplicándose; una rama protegida puede requerir un PR que debes crear desde tu herramienta habitual.

Si solo hay cambios remotos, Sync los descarga aunque no hayas creado un commit nuevo. Si otra persona publica entre la descarga y el push, Git rechaza ese push; vuelve a actualizar y resolver si hace falta. No hay force push.

Documentación:
- https://docs.github.com/en/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection
- https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/authorizing-an-ssh-key-for-use-with-single-sign-on

## Cinco perfiles

Ana, Luis, Sofía, Diego y Valeria recuerdan una carpeta por perfil y navegador. Los nombres organizan tus pruebas: **en repositorios reales no sustituyen al autor Git**.

- Puedes usar Ana en Chrome y Luis en Firefox, cada uno con una copia local diferente.
- Si abres la misma carpeta desde dos perfiles o navegadores, compartes los mismos archivos; no son dos copias independientes.
- Para probar conflictos, usa dos clones distintos del mismo repositorio. La app crea commits en cada uno y tu herramienta Git realiza la sincronización y la resolución.
- En el laboratorio integrado, cada perfil/navegador tiene su propia copia y un autor simulado. La ruta aparece en Repositorio; puedes abrirla con tu herramienta Git. El remoto del laboratorio está en tu computadora.

## Cambios pendientes y conflictos

La app detecta merges, rebases, cherry-picks, reverts, bloqueo del índice y archivos en conflicto. Pausa la edición, importación y creación de commits hasta que termines o canceles la operación en tu herramienta Git. Después vuelve a pulsar Actualizar.

Si otra herramienta o ventana cambió un archivo mientras tenías un borrador, la app rechaza sobrescribirlo. El borrador permanece en el editor: cópialo antes de recargar y concílialo con el archivo actualizado.

Crear versión incorpora cambios de archivos Markdown visibles del repositorio (incluidas eliminaciones hechas desde otra herramienta). No incorpora archivos de otros tipos. Si detecta archivos ya preparados en el índice por otra herramienta, pide terminar ese commit o retirarlos antes de continuar.

El contador de commits pendientes se calcula contra la referencia remota local **según la última descarga realizada por tu herramienta Git**. PromptExplorer no consulta GitHub para actualizar esa referencia.

## Archivos e historial

- Archivos `.md` y subcarpetas. Se excluyen carpetas ocultas, enlaces simbólicos y `node_modules`.
- **Nuevo archivo** acepta rutas como `Prompts/Idea.md`.
- **Importar carpeta** copia Markdown a la carpeta Git abierta, sin modificar la carpeta de origen ni sobrescribir archivos existentes. Máximo 200 archivos y 5 MB por importación; 2 MB por documento.
- El identificador visible es el hash corto del último commit del archivo, con autor y fecha. El historial muestra hasta 15 commits y sus comentarios. No usa números consecutivos inventados.
- El historial es de consulta: esta prueba no restaura versiones, elimina ni renombra archivos desde la interfaz.
- No incluye coedición en tiempo real, PRs ni aprobaciones.

## Datos anteriores

Los borradores, clones y laboratorio de la versión anterior permanecen en `.data/`. El login OAuth anterior fue retirado; el modo GitHub ahora usa SSH del sistema. La actualización no borra esas copias. La sesión anterior de GitHub estaba solo en memoria y se pierde al reiniciar. Puedes revocar la autorización anterior desde GitHub si ya no quieres conservarla.

Las rutas elegidas por navegador se guardan en `.data/sessions/`. Las cookies locales duran hasta 30 días y no son credenciales GitHub. No borres `.data/` si contiene versiones de prueba que quieras conservar.

## Pruebas

`npm test` usa repositorios temporales locales y comprueba apertura en el lugar, identidad Git, commits limitados a Markdown, ausencia de push automático, sincronización externa, conflictos, worktrees, protección contra escrituras obsoletas, importación y límites de acceso. Las pruebas no contactan GitHub ni acceden a tus llaves. Los flujos de sincronización se prueban con un transporte local que ejecuta Git real. La conexión SSH del trabajo debe validarse después de configurar y autorizar tu llave.
