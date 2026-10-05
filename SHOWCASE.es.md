# FM-1 Pulses — Video de lanzamiento (5:00)

**Una sola toma partida, sin cortes.** OBS graba dos mitades en paralelo durante
los cinco minutos. Nada cambia de sitio: lo único que evoluciona es lo que se
hace en cada mitad.

---

## EL ENCUADRE (se define una vez y no se toca)

**Izquierda — 960x1080. Captura de ventana de Chrome en el escritorio.**
Ventana de Chrome a **960x960**: la app entra completa en 940x823 px, 1:1, sin
escalar y sin scroll — el rack de perillas y la grilla de 8x8 en el mismo
cuadro. Los ~250 px que sobran abajo de la app son la franja del rótulo (una
fuente de texto de OBS, siempre en el mismo lugar).

**Derecha — 960x1080. El teléfono fijo sobre el FM-1.** Encuadre fijo toda la
grabación: la pantalla del aparato y los LEDs, con el puerto USB adentro del
cuadro. El cable entrando y saliendo es un gesto del video, no un detalle: tiene
que verse.

**Audio — un solo camino, que sobreviva a los dos momentos sin cable.** La
salida de línea o de audífonos del FM-1 al **Scarlett 2i2**, y de ahí a OBS. Esa
es la fuente de los cinco minutos: primero el secuenciador del aparato, después
las notas que le manda la app, después su secuenciador otra vez. Una sola fuente
continua, nada que mezclar entre secciones.

> El FM-1 también aparece como tarjeta de audio por USB (`usb-4c4a_FM-1…`), y es
> tentador usarlo para tener el audio en digital. No sirve acá: ese camino se
> corta justo en las dos secciones que necesitas oír — la apertura y el cierre,
> cuando el cable está fuera. El analógico no se corta nunca.

El preview del navegador en **mute** de principio a fin (si no, todo suena
doble). Si el 2i2 no está, el micrófono del teléfono es el respaldo.

**Nada más.** Sin cortes, sin paneos, sin segunda cámara, sin tomas de mano, sin
grabar la pantalla del teléfono. Lo único que cambia entre secciones es **qué
perilla se mueve** a la izquierda y **qué hace el aparato** a la derecha.

---

## EL ARCO — cuatro estados del aparato

El video se sostiene sobre esto, y sólo se puede hacer con una toma fija:

1. **0:00–0:20 · solo.** Cable USB fuera. El FM-1 toca con su propio
   secuenciador un patrón congelado en una sesión anterior.
2. **0:20–4:00 · en vivo.** Entra el cable, se detiene el SEQ del aparato, y
   desde ahí todo lo que suena son notas que manda la app por USB. El SEQ se
   detiene aquí porque el firmware rechaza escribirle un patrón mientras toca.
3. **4:00–4:10 · congelado.** Freeze en la app: el patrón queda escrito adentro.
4. **4:10–5:00 · solo otra vez.** Sale el cable, SEQ de nuevo, y el aparato toca
   por su cuenta lo que acaba de recibir.

---

## LÍNEA DE TIEMPO

### 0:00–0:20 · APERTURA

**Izquierda:** el banco con el slot activo seleccionado y el cursor de la grilla
avanzando al ritmo del aparato.
**Derecha:** el FM-1 tocando solo, cable fuera, LEDs corriendo el patrón.
**Rótulo:** FM-1 PULSES — secuencias generativas para el M-VAVE FM-1

**VO:** "Estás escuchando un patrón que el FM-1 guardó hace un minuto. La
máquina que lo escribió es una página en el navegador, cerrada desde entonces."

### 0:20–0:50 · QUÉ ES

**Izquierda:** el mouse recorriendo el rack de arriba abajo — transport, las
cinco secciones de perillas, la grilla, la tira del banco. Todavía no toca nada.
**Derecha:** entra el cable USB y se detiene el SEQ. Desde este momento los LEDs
responden a las notas que llegan por USB.
**Rótulo:** corre en Chrome · nada que instalar

**VO:** "FM-1 Pulses es un secuenciador generativo para el M-VAVE FM-1. Corre en
Chrome, no hay nada que instalar, y escribe los dieciséis slots del banco a
partir de un puñado de perillas. La cadena de señal es la de un rack modular:
reloj, compuerta, LFO, cuantizador y un buffer con memoria de loop. Giras las
perillas y el banco se llena."

### 0:50–2:30 · LAS PERILLAS

**Izquierda:** una sección por turno — Rhythm, Global, Pitch, Shape, Memory —
moviendo cada perilla ~6 s, con el nombre de la perilla que se está tocando en
la franja del rótulo.
**Derecha:** nada que dirigir. El aparato suena lo que le llega; esta sección
existe para que se vea que las perillas de la izquierda son las que tocan.

**VO:** "Cinco secciones. Ritmo primero. Tempo define el reloj del navegador. El
BPM del FM-1 manda en el aparato y la app lo lee de vuelta, así que la perilla
siempre muestra lo que el aparato toca. Swing desplaza los tiempos pares:
cincuenta recto, setenta y cinco a tresillo. Gate es la densidad: cuántos pasos
disparan. Euclid es un degradado. En cero, la compuerta es una moneda por paso.
En cien, los golpes caen en las posiciones más parejas del ciclo, que es de
donde salen la clave y el tresillo. Rotate gira ese patrón. Grid snap elimina
cualquier nota que caiga entre las líneas de la grilla.

Global. Drift separa los dieciséis slots: el slot uno queda más cerca de tus
ajustes, el dieciséis más lejos. Seed es un número; todo lo demás deriva de él.
Note y Length definen el compás. Quantize pega las notas a la escala; valores
bajos dejan pasar cromatismos. Unipolar convierte la nota de Offset en un piso
en lugar de un centro.

Pitch. Wave elige el contorno: seno, triángulo, sierra, cuadrada, perlin y
cuatro formas aleatorias. Shape lo transforma: pliega el seno, curva las rampas,
estrecha la cuadrada hasta un pulso fino. Cycles repite el contorno a lo largo
de la frase. Amplitude abre el rango alrededor de la nota de Offset. Scale y
Root mantienen la melodía en la tonalidad.

Shape. Spread elige cómo se distribuye el azar: constante, campana, uniforme o
extremos. Bias lo inclina hacia el registro agudo o el grave. Humanize mueve la
velocidad nota a nota. Octave up y Root gravity empujan notas una octava arriba
o de vuelta a la raíz más cercana.

Memory. La región del loop es la banda teñida de la grilla; la frase que
contiene se repite a lo largo del patrón. Deja Vu define cuántas veces un paso
repite el loop en lugar de generar una nota nueva."

### 2:30–4:00 · LA DEMO — una melodía desde cero

**Izquierda:** el mouse construyendo el patch desde cero. La tira del banco se
llena a medida que el patch evoluciona y la grilla se redibuja en vivo.
**Derecha:** el aparato siguiendo cada cambio un paso después. Es el momento de
notar que lo que suena es el sintetizador, no un plugin.
**Rótulo:** una semilla, dieciséis patrones

**VO:** "Semilla nueva. Escala: pentatónica menor. Gate a 37, Loop en 8, Euclid
al máximo: eso es un tresillo, tres golpes repartidos en ocho pasos. Baja Euclid
a 40 y el ritmo se afloja pero conserva los mismos golpes. Wave a perlin, un
ciclo en toda la frase, un poco de Shape para el brillo de octava. Deja Vu a 40,
para que el loop de ocho pasos se repita a medias. Todo lo que escuchas deriva
de la semilla, o sea que este banco exacto vuelve cada vez que escribes el mismo
número. [solo música, 10–15s: mover Bias, Euclid y Wave mientras suena] El loop
sigue corriendo mientras giras, así que Bias, Euclid, Wave: cada cambio cae en
el paso siguiente."

### 4:00–4:40 · CONGELAR AL FM-1

**Izquierda:** se hace clic en **Freeze**. La línea de estado muestra lo que el
aparato guardó — la app lee de vuelta, no supone.
**Derecha:** los dedos entran al cuadro: el SEQ ya está detenido (si no, se ve
el rechazo del firmware y el rótulo lo explica), el congelado entra, y después se
saca el cable USB. A partir de ahí el aparato sigue tocando solo.
**Rótulo:** detén el secuenciador del FM-1 antes de congelar

**VO:** "El secuenciador ya está detenido: el firmware rechaza escribir un patrón
mientras el aparato toca, así que se detiene antes de empezar. Freeze. La app
manda el patrón y lee de vuelta lo que el aparato guardó, así que la línea de
estado muestra lo que quedó adentro de verdad. Ahora saco el cable. El aparato
toca el patrón por su cuenta."

### 4:40–5:00 · CIERRE

**Izquierda:** el rack quieto, con el banco completo a la vista. El rótulo con
la URL encima.
**Derecha:** el FM-1 tocando solo, cable fuera, sin manos en el cuadro. Se deja
correr tres segundos después del último corte de voz.
**Rótulo:** mene311.github.io/fm1-pulses

**VO:** "FM-1 Pulses corre en Chrome, en el teléfono o en el escritorio. Código
y app en el enlace bajo el video."

---

## SIN NARRACIÓN

Mismo encuadre, misma toma, mismos tiempos: borra la pista de voz y deja los
rótulos. Cada sección ya trae su frase, y los nombres de las perillas van
apareciendo en la franja mientras se mueven. Sin voz te sobran unos 40 segundos
en la demo: déjalos correr con música y mueve Bias, Euclid y Wave.

---

## NOTAS DE PRODUCCIÓN

- **Antes de grabar: congela un banco.** La apertura suena con el secuenciador
  del aparato, así que tiene que existir un patrón congelado de antes. Luego la
  toma es una sola pasada continua de 5:00 — es el punto del encuadre fijo.
- **Ventana de Chrome a 960x960, no a pantalla completa.** A pantalla completa
  (1920x1080) la app se ve, pero en el recorte de media pantalla entra en su
  disposición vertical: el rack arriba y la grilla abajo, 1405 px de alto, y se
  corta. Cuadrada, la app usa su disposición de rack (perillas a la izquierda,
  grilla a la derecha) y entra entera en 823 px.
- **La captura:** *Captura de ventana* de OBS sobre Chrome, con el zoom del
  navegador a 100% y la barra de marcadores oculta. Si entra la barra de título
  en el recorte, recórtala con el filtro *Recortar*: el cuadro útil es el
  viewport de 960x960.
- **El rechazo status-3 sirve como golpe de efecto si lo quieres:** intenta el
  congelado con SEQ tocando, deja que aparezca el rechazo, detén SEQ, congela de
  nuevo. Cabe dentro de los 40 segundos de la sección — pero entonces no lo
  uses también en el rótulo, o se repite.
- **Tempo:** define el BPM del aparato antes de grabar y deja que la línea
  "device holds N BPM" aparezca en cámara. Filmar un cambio de tempo en la app
  que el aparato ignora mostraría lo contrario de lo que la app dice hacer.
- **Regrabar una sección suelta** es barato: la toma es fija, así que una
  segunda pasada de la misma sección calza sin que se note el empalme, siempre
  que el patrón que suena sea el mismo. Si cambió el patrón, se nota.
