# Arrow Garden

Un puzzle de flechas relajante para el navegador. Toca una flecha y se desliza en la dirección
a la que apunta hasta salir del tablero. Si otra flecha le bloquea el paso, rebota suavemente y
no pasa nada. Saca todas las flechas para completar el nivel.

Sin temporizador, sin vidas, sin prisa.

## Características

- **Pantalla de inicio** con Jugar, Tutorial, Ajustes y Cuenta.
- **Tutorial interactivo** en un tablero de 3×3 que enseña a mover, a rebotar y las flechas con curva.
- **10 niveles** generados proceduralmente, de 4×4 a 10×10. Las flechas son cada vez más
  largas (1 a 4 celdas) y algunas tienen curva.
- **Siempre hay solución**: el generador solo acepta un tablero si existe un orden válido para
  sacar todas las flechas.
- **Deshacer, pista y reiniciar**. La pista resalta una flecha que puedes sacar ahora.
- Contador de movimientos (se puede ocultar).
- Colores pastel, modo claro y oscuro (o automático según el sistema).
- Animaciones suaves y partículas al salir cada flecha. Respeta *reducir movimiento* del sistema.
- Sonidos suaves generados con Web Audio (sin archivos), que se pueden silenciar en Ajustes.
- Vibración corta al chocar, en móviles compatibles.
- Progreso guardado automáticamente en el dispositivo.
- **Cuentas opcionales y gratuitas** (Firebase) para seguir tu progreso en cualquier dispositivo.
- Atajos de teclado: `Z` deshacer, `H` pista, `R` reiniciar.

Hecho con HTML, CSS y JavaScript puro (módulos ES), sin frameworks y sin paso de compilación.

## Jugar en local

Los módulos ES no funcionan abriendo el archivo con doble clic (`file://`), así que necesitas un
servidor local. Cualquiera sirve:

```bash
python -m http.server 8000
# o
npx serve .
```

Luego abre <http://localhost:8000>.

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub y sube el proyecto:
   ```bash
   git remote add origin https://github.com/<tu-usuario>/arrow-garden.git
   git push -u origin main
   ```
2. En GitHub, ve a **Settings → Pages**.
3. En **Build and deployment → Source**, elige **Deploy from a branch**.
4. En **Branch**, elige `main` y la carpeta `/ (root)`. Pulsa **Save**.
5. En uno o dos minutos el juego estará en `https://<tu-usuario>.github.io/arrow-garden/`.

El archivo `.nojekyll` hace que GitHub Pages sirva los archivos tal cual, sin procesarlos.

## Cuentas para guardar el progreso en la nube (opcional, gratis)

Sin configurar nada, el progreso se guarda solo en el navegador de cada dispositivo. Si quieres
que los jugadores puedan crear una cuenta y seguir en cualquier dispositivo, conecta un proyecto
de **Firebase** con el plan gratuito **Spark**.

**¿Por qué es gratis?** El plan Spark no pide tarjeta y no tiene suscripción. Si algún día se
pasaran sus cuotas, el servicio se pausaría hasta el día siguiente: **nunca te cobra**. Las cuotas
sobran para este juego: 50 000 lecturas y 20 000 escrituras al día, y 1 GiB de datos. Cada jugador
usa un documento diminuto y solo escribe al pasar de nivel o al cambiar un ajuste. No actives el
plan *Blaze*: es el único que puede cobrar.

### Pasos (una sola vez)

1. Entra en <https://console.firebase.google.com> y pulsa **Crear un proyecto**. Google Analytics
   no hace falta, puedes desactivarlo.
2. **Registra la app web**: en *Configuración del proyecto → General → Tus apps*, pulsa el icono
   `</>`, ponle un nombre y regístrala (no hace falta Firebase Hosting).
   Copia los valores de `firebaseConfig` en [`js/firebase-config.js`](js/firebase-config.js):
   ```js
   export const firebaseConfig = {
     apiKey: 'AIza…',
     authDomain: 'tu-proyecto.firebaseapp.com',
     projectId: 'tu-proyecto',
     appId: '1:…:web:…',
   };
   ```
   Estos valores son **públicos por diseño**, no son una contraseña. Los datos los protegen las
   reglas de seguridad y la lista de dominios autorizados.
3. **Activa el inicio de sesión**: en *Compilación → Authentication → Comenzar → Método de
   inicio de sesión*, activa **Correo electrónico/contraseña** y **Google** (para Google, elige un
   correo de asistencia).
4. **Autoriza tu dominio**: en *Authentication → Configuración → Dominios autorizados*, añade
   `<tu-usuario>.github.io`. `localhost` ya viene incluido para probar en local.
5. **Crea la base de datos**: en *Compilación → Firestore Database → Crear base de datos*, elige
   una ubicación cercana y el **modo de producción**.
6. **Publica las reglas**: en la pestaña **Reglas** de Firestore, pega el contenido de
   [`firestore.rules`](firestore.rules) y pulsa **Publicar**. Con estas reglas, cada jugador solo
   puede leer y escribir su propio progreso.
7. Haz commit de `js/firebase-config.js` y súbelo. En **Ajustes** del juego aparecerá
   **Cuenta → Iniciar sesión**.

Cómo funciona la sincronización: el progreso siempre se guarda primero en el dispositivo, así que
el juego funciona igual sin conexión. Al iniciar sesión se combinan los datos del dispositivo y de
la cuenta: el nivel más alto alcanzado nunca se pierde, y en los ajustes gana el cambio más
reciente. El SDK de Firebase solo se descarga cuando alguien abre *Cuenta* o ya tenía la sesión
iniciada.

Opcional, para más seguridad: en Google Cloud Console → *APIs y servicios → Credenciales*, puedes
restringir la clave de API a los referentes HTTP `https://<tu-usuario>.github.io/*` y
`http://localhost:*/*`.

## Estructura

```
index.html              Página y diálogos
css/styles.css          Estilos y colores (claro/oscuro)
js/main.js              Arranque: conecta todas las piezas
js/game.js              Modelo del juego y solucionador
js/generator.js         Generador de niveles con solución garantizada
js/levels.js            Curva de dificultad
js/rng.js               Aleatoriedad con semilla (cada nivel es siempre igual)
js/render.js            Dibujo en Canvas, animaciones y partículas
js/input.js             Toques y clics
js/audio.js             Sonidos con Web Audio y vibración
js/storage.js           Guardado en localStorage y combinación con la nube
js/ui.js                Pantalla de inicio, botones, ajustes y nivel completado
js/tutorial.js          Tablero y pasos del tutorial
js/account.js           Diálogo de cuenta
js/cloud.js             Firebase Auth + Firestore (carga diferida)
js/firebase-config.js   Configuración pública de Firebase
js/theme-init.js        Aplica el tema antes de pintar la página
firestore.rules         Reglas de seguridad de Firestore
tools/check-levels.mjs  Verifica que todos los niveles tienen solución
```

## Comprobar los niveles

```bash
node tools/check-levels.mjs 30
```

Genera los niveles 1 a 30 y comprueba que todos tienen solución, que son deterministas y que las
flechas están bien formadas.
