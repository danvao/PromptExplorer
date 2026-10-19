# PromptExplorer para Windows

1. Guarda `PromptExplorer.exe` en una carpeta y haz doble clic. No lo abras desde la vista previa de un ZIP.
2. La primera ejecución prepara los componentes incluidos; puede tardar unos segundos. Se abre el navegador predeterminado.
3. En **Repositorio** elige una carpeta Git local o una URL GitHub por SSH.
4. Edita, crea una versión con comentario y sincroniza según el modo elegido.

No necesitas instalar Node.js, Git ni .NET. Esta entrega es para Windows 10/11 de 64 bits (x64). La interfaz sigue siendo una página local: puedes copiar su dirección a Chrome y Firefox para probar perfiles distintos. Si el puerto 4317 está ocupado, el ejecutable elige otro entre 4318 y 4346.

El programa permanece activo en el área de notificación, junto al reloj. Haz clic derecho en el icono para abrir la app, ver la carpeta de datos o **Salir**. Cerrar la pestaña no detiene la app. Abrir el ejecutable otra vez recupera la instancia existente.

## Datos y actualizaciones

El programa se extrae en `%LOCALAPPDATA%\PromptExplorer\runtime\0.4.1`. Los datos y las copias de prueba se guardan por separado en `%LOCALAPPDATA%\PromptExplorer\data`. Los repositorios locales elegidos permanecen en sus carpetas originales. No se instalan servicios ni se cambia el registro o la configuración del sistema, y no se requieren permisos de administrador.

Puedes reemplazar el EXE por una versión nueva sin borrar tus documentos. Para retirar completamente la aplicación, primero cierra la app y conserva cualquier copia o commit sin publicar; después elimina el EXE y, si ya no necesitas su contenido, la carpeta `%LOCALAPPDATA%\PromptExplorer`. No borres esa carpeta mientras tengas borradores o commits locales pendientes.

Es un ejecutable autónomo sin instalador, con datos por usuario. No es un modo de almacenamiento en USB: mover el EXE a otra computadora no transfiere automáticamente los borradores.

## GitHub y SSH

Incluye Git y SSH. La llave privada, su frase de paso y la autorización SSO se configuran en cada computadora, fuera de la app. No compartas una llave privada ni la incluyas junto al EXE.

MinGit cubre las operaciones de esta app. Algunos hooks de tu empresa pueden requerir otras herramientas (por ejemplo, Python o Perl); esas dependencias de los repositorios no forman parte del ejecutable.

## Seguridad y soporte

Este primer paquete **no está firmado digitalmente**. Las políticas de tu empresa pueden bloquearlo; solicita revisión a TI. No desactives las protecciones del equipo. Una firma corporativa requiere el certificado y el proceso de distribución autorizados.

El archivo `SHA256SUMS.txt` identifica el binario publicado. No confiere confianza ni sustituye una firma digital.

Si no abre, revisa `%LOCALAPPDATA%\PromptExplorer\PromptExplorer.log`. La aplicación solo escucha en la interfaz local de la computadora.
