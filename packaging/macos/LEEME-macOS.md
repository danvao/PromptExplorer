# PromptExplorer para Mac

1. Descarga el ZIP correspondiente a tu Mac: **arm64** para Apple Silicon (M1, M2, M3, M4 y posteriores) o **x64** para Intel.
2. Descomprime el ZIP. Abre **PromptExplorer.app** con doble clic; puedes guardarla en una carpeta de tu usuario o moverla a Aplicaciones.
3. Se abre la interfaz en el navegador predeterminado. Desde **Repositorio**, elige una carpeta Git local o una URL GitHub por SSH.
4. Para usar Chrome y Firefox al mismo tiempo, abre en ambos la dirección local que aparece en el navegador.

Requiere macOS 14 o posterior. No requiere instalar Node.js, Git, Homebrew ni las herramientas de desarrollo de Xcode. Incluye Node.js y una distribución portable de Git. SSH usa el cliente incorporado en macOS y tus llaves configuradas en esa computadora.

La app permanece activa con un icono en la barra superior del Mac. Desde ese menú puedes abrir la app, ver su carpeta de datos o **Salir**. Cerrar la pestaña del navegador no detiene la app. Si el puerto 4317 está ocupado, utiliza otro entre 4318 y 4346.

## Documentos y actualizaciones

Los datos y copias de prueba se guardan en `~/Library/Application Support/PromptExplorer/data`. Los repositorios locales elegidos permanecen en sus carpetas originales. El registro de errores es `~/Library/Application Support/PromptExplorer/PromptExplorer.log`.

Puedes reemplazar la app por una versión nueva sin borrar los documentos. Copiar la app a otra computadora no transfiere automáticamente los borradores ni las llaves SSH. Antes de borrar su carpeta de datos, conserva cualquier commit o borrador sin publicar.

El programa no instala servicios, no cambia tu configuración de Git ni requiere acceso de administrador. Los hooks de un repositorio pueden necesitar herramientas adicionales propias de ese proyecto.

## Firma y acceso

Este paquete tiene una firma local de integridad (ad hoc), **no una firma Developer ID ni notarización de Apple**. macOS o las políticas de tu empresa pueden impedir su ejecución. Solicita revisión o distribución autorizada a TI; no desactives las protecciones del equipo.

La autenticación SSH y la autorización SSO se preparan por computadora. La app no incluye llaves privadas, tokens ni sesiones de GitHub. El modo Local permite hacer pull/push desde otra herramienta autorizada.
