# Nanotareas: desarrollo guiado por aceptación incremental

Fecha: 2026-09-07. Estado: antecedente sustituido el 2026-09-08.
Entrada de diseño: Foreman 294. Implementación y evaluación: 295–301.

La referencia de implementación es [NANOTASKS-RECONCILED.md](NANOTASKS-RECONCILED.md).
La petición del 2026-09-08 autoriza implementar ese contrato SOLO para Codex.
El store independiente y los estados por nanotarea propuestos abajo se retiraron
de V1. Este texto conserva el antecedente; no añade requisitos al contrato vigente.
Los comandos, campos y archivos descritos abajo no acreditan capacidades disponibles.
El estado operativo de cada entrega se consulta en `ROADMAP.jsonl` mediante
`scripts/roadmap.js`. Aprobar este diseño no acepta futuras implementaciones.

## 1. Propósito y encaje en Foreman

Permitir que una persona pida: «Construyamos esta función por pasos; quiero
probar y aprobar cada avance antes de continuar». Foreman conserva el objetivo,
prepara el siguiente incremento, registra evidencia y espera la decisión.

Una **nanotarea** es la unidad más pequeña de resultado que la persona puede
comprobar y aceptar con sentido. Puede contener varios cambios técnicos.
El objetivo no es maximizar la cantidad de pasos, archivos o preguntas.

Esto fortalece las funciones actuales de Foreman: preparar trabajo, mantener
su continuidad, registrar comprobaciones y separar implementación de aceptación.
`SCOPE.md` exige bajo costo de atención y limita Foreman a una tarea a la vez.
Esta propuesta respeta ese límite: una tarea principal activa, una secuencia
local de incrementos y una decisión pendiente. La «sesión maestra» es la sesión
que coordina esa tarea, no un servidor, un agente permanente ni un ejecutor
de lotes de entradas del roadmap.

La aceptación del contrato debe confirmar esta interpretación acotada del
alcance. Si para implementar se necesita un framework de flujos, roles o
dependencias entre planes, hay que reducir el diseño antes de continuar.

## 2. Base existente y diferencia nueva

La inspección del checkout `codex/port` encontró estas bases:

- `scripts/roadmap.js`: formato 2, dependencias, bloqueo, escritura mediante
  temporal y renombrado, `archive`/`restore`, `awaiting_acceptance`.
- `scripts/craft-handoff.js`, `buildTaskRows`: división por comprobaciones;
  la primera fila lleva el prompt completo y la última lleva el cierre del padre.
- `skills/roadmap/delivery.md`: con `requireVerification:true`, la aceptación
  humana se separa de la implementación y de sus comprobaciones.
- `hooks/codex-task.js`: inicio y comprobación explícitos del ciclo de trabajo.
- `hooks/session-start.js`: aviso de archivo desde 20 entradas terminales,
  con separación de 7 días entre recordatorios; no es archivado automático.

La división actual no ofrece identidad durable, aceptación por incremento ni
reanudación de ese estado. Esas son las capacidades nuevas. La inspección del
código no demuestra que los hooks se activen en todos los hosts.

## 3. Experiencia y alcance de V1

El modo se elige en lenguaje natural al ejecutar una tarea del roadmap. Los
destinos existentes permanecen disponibles. El modo habitual no cambia por
instalar esta capacidad. V1 desarrolla primero ejecución guiada en la sesión
actual; un destino que aún no soporte el protocolo debe declararlo y ofrecer
una alternativa, sin sustituirlo silenciosamente.

Al elegir el modo guiado, la aceptación de cada incremento es obligatoria,
incluso si la configuración general tiene `requireVerification:false`.
Esta consecuencia se explica una vez al elegir el modo. No se añade una
configuración obligatoria ni se deduce aceptación de una opción preseleccionada.

Ejemplo de una tarea principal «Añadir login»:

| Incremento | Resultado para probar | Límite declarado |
| --- | --- | --- |
| Abrir y cerrar acceso | Botón, modal, cierre y retorno del foco | Todavía no autentica |
| Completar formulario | Campos, validaciones y mensajes comprensibles | Puede usar un servicio simulado |
| Entrar con credenciales válidas | Conexión real y estado autenticado | Se declara el entorno probado |
| Recuperarse de errores | Fallos comprensibles y reintento | Se enumeran los fallos cubiertos |
| Salir de la cuenta | Sesión cerrada y acceso actualizado | La integración completa se revisa al final |

«Crear un componente» puede ser un paso interno. Se convierte en nanotarea
solo si produce una decisión útil. Para cambios internos, la prueba puede ser
un comando, un antes/después reproducible o una decisión técnica documentada;
no necesita una interfaz visual.

Foreman muestra primero un plan breve con resultados y límites. Desarrolla
solo el incremento actual, presenta cómo probarlo y ofrece **aceptar**,
**pedir cambios** o **pausar**. Una pregunta debe identificar el resultado
concreto; «¿todo bien?» no establece qué se aceptó. Puede agrupar la aprobación
del plan y el inicio cuando la intención del usuario ya sea inequívoca.

Fuera de V1: planes anidados, grafos entre nanotareas de distintos padres,
ejecución paralela, aprobación masiva, saltos automáticos, puntuación del usuario,
dashboard, servicio externo, instalación automática y publicación automática.

## 4. Contrato de datos propuesto

Mantener `ROADMAP.jsonl` en formato 2. El padre conserva su identidad, objetivo,
dependencias, notas y referencias Git. Sus nanotareas no aparecen como nuevas
entradas del menú global. No incrustar el plan como JSON en `notes` ni convertir
`depends_on` en una relación de pertenencia.

Propuesta inicial: `.foreman/nanotasks/<parent-id>.json`, un snapshot versionado
por padre. La ruta se deriva de un ID válido; el cliente no elige una ruta
arbitraria. La existencia del archivo activa las comprobaciones del plan en un
cliente compatible. No crear una copia adicional de su estado dentro del padre.

| Dato | Contrato mínimo |
| --- | --- |
| `format` | Versión propia del store; versiones desconocidas fallan sin escribir |
| `parent_id` | ID del roadmap, resoluble en activo o archivo |
| `revision` | Entero monótono para rechazar escrituras obsoletas |
| `objective` | Resultado integral y criterios de aceptación del padre |
| `units[]` | Secuencia ordenada con identidad estable, por ejemplo `n001` |
| Identidad visible | Par padre/unidad, por ejemplo `299/n001`; no modifica IDs del roadmap |
| Contrato de unidad | Resultado, límites, superficie prevista, comprobaciones y prueba humana |
| Revisión de unidad | Versión del contenido revisable; cambia al alterar alcance o resultado |
| Evidencia | Comando o procedimiento, resultado real, fecha y referencia al artefacto probado |
| Aceptación | Unidad, revisión, evidencia revisada, fecha y decisión explícita del usuario |
| Historial | Devoluciones e invalidaciones preservadas con razones y referencias breves |

La revisión global serializa escrituras; una revisión posterior del plan no
invalida automáticamente unidades anteriores cuyo contrato no cambió.
Registrar el identificador del mensaje o sesión solo si el host lo proporciona.
Sin ese identificador, registrar el contexto disponible sin inventarlo.

El CLI valida la estructura y la vigencia de la aprobación registrada. No puede
demostrar por sí solo que una persona pulsó un botón si el host no proporciona
esa evidencia. La atribución de la decisión pertenece al protocolo de la sesión;
el registro no se presenta como una firma autenticada ni una barrera de seguridad.

Archivos y evidencias deben poder versionarse con el repositorio. Este checkout
ignora `.foreman/`: al activar planes nativos, añadir únicamente las excepciones
necesarias para planes durables, conservando excluidos los caches. No basta con
afirmar que un archivo local ignorado sobrevivirá a un cambio de máquina.
No registrar credenciales, respuestas de autenticación ni transcripciones enteras.

## 5. Estados, aceptación y cierre

Reutilizar el vocabulario `planned -> in_progress -> awaiting_acceptance -> done`
para unidades. `awaiting_acceptance` significa resultado implementado y evidencia
suficiente para el contrato de ese incremento; la aprobación humana sigue pendiente.
Un check requerido fallido o no ejecutado mantiene `in_progress` y expone el bloqueo.

Invariantes que deben vivir en código:

1. Como máximo una unidad está en ejecución o esperando aceptación por plan.
2. Solo se inicia la primera unidad pendiente; todas sus predecesoras deben
   estar aceptadas para su revisión vigente. El orden reemplaza un grafo en V1.
3. Aceptar exige una unidad pendiente de aceptación y referencias a la revisión
   y evidencia presentadas. Una respuesta retrasada no aprueba otro resultado.
4. Repetir la misma operación debe ser idempotente. Una operación diferente con
   revisión obsoleta devuelve conflicto, sin reintentar sobre el nuevo contenido.
5. Pedir cambios devuelve la unidad a `in_progress`, conserva el feedback y
   requiere presentar de nuevo el resultado. El silencio nunca libera el paso siguiente.
6. Pausar no acepta ni borra; conserva la unidad y su estado. La intención de
   pausa queda persistida y solo una petición de continuar permite retomar.
7. Cambiar una unidad ya aceptada, mientras el padre siga abierto, conserva su
   aceptación histórica pero invalida su vigencia y la del sufijo posterior.
   Se conserva el código y la evidencia; se revalida antes de volver a avanzar.
8. Un padre `done` no se reabre silenciosamente desde el store. Una corrección
   posterior se registra como trabajo nuevo relacionado, preservando el cierre.

El padre permanece `in_progress` durante el recorrido. Todas las unidades
aceptadas permiten ejecutar las comprobaciones integrales; no cierran el padre.
Solo después de comprobar el objetivo completo pasa a `awaiting_acceptance`.
La aceptación integral lleva a `done`. La persona puede aceptar explícitamente
el último incremento y el conjunto en una sola respuesta cuando ambos resultados
se hayan presentado; no exigir dos confirmaciones equivalentes.

## 6. Persistencia, coordinación y recuperación

Extender el CLI actual de `scripts/roadmap.js` con operaciones de plan y delegar
su lógica a un módulo, tentativamente `scripts/nanotasks.js`. Los nombres finales
de operaciones se fijan en la etapa B. Se necesitan crear/consultar plan,
iniciar unidad, registrar evidencia, solicitar aceptación, aceptar, devolver,
pausar, reanudar y revisar. Ninguno de esos verbos nuevos existe todavía.

El módulo debe ser Node.js sin dependencias externas. Reutilizar el bloqueo por
proyecto y la validación antes de escribir; operaciones internas no deben adquirir
por segunda vez el mismo bloqueo. Las mutaciones requieren `expected_revision`.
Escribir temporal y renombrar dentro del mismo volumen; después devolver un
resultado compacto que confirme la revisión persistida.

Las operaciones del padre y del plan comparten el bloqueo. Preferir transiciones
que escriban un solo archivo: primero aceptar la unidad, después evaluar el cierre
del padre como operación separada que vuelve a leer ambos estados. Una caída
entre esas operaciones deja un padre abierto recuperable. Nunca cerrar primero
el padre y prometer que el plan se actualizará después.

Al retomar, leer padre, resumen del plan y detalle de la unidad actual; contrastar
la revisión y el artefacto probado con los archivos actuales. Un SHA sin cambios
no demuestra igualdad si hay cambios sin commit: capturar hashes de la superficie
relevante y un manifiesto para artefactos sin commit, incluido añadido/eliminado.
Si la evidencia no permite establecer vigencia, solicitar revalidación.
Cambios ajenos al incremento no invalidan por sí solos su aprobación.

Una sesión puede terminar mientras espera. La siguiente reconstruye el punto
de revisión y reutiliza la decisión pendiente; no reinicia el plan ni inventa
aceptaciones. No depender de handles de subagentes, memoria del chat, señales
de contexto inferidas o eventos de ciclo de vida que el host no ofrece.

El coordinador conserva la decisión humana y las escrituras compartidas.
Finalizar un worker o un test no cierra una unidad. V1 no necesita delegación.

## 7. Integración y compatibilidad

- `craft-handoff`: entregar el objetivo global como contexto y restringir el
  trabajo ejecutable a la unidad actual. Evitar que el prompt completo de la
  primera fila autorice construir todos los incrementos antes de preguntar.
- Skills de selección/entrega: elegir el modo, mostrar estado y recoger decisiones
  con las herramientas reales del host; mantener una alternativa textual.
- `roadmap.js` y `codex-task.js`: comprobar planes activos en inicio, reanudación
  y cierre. El límite debe cubrir también llamadas directas a `update-status`.
- `doctor`: diagnosticar plan corrupto, padre ausente, revisión inválida y padre
  terminal incoherente; informar sin borrar ni reparar decisiones automáticamente.
- Checkpoints Git: seguir `safe-commit`, restricciones de rama y propiedad de
  archivos. No exigir un commit por unidad en un árbol previamente modificado.
- Desarrollo de skills: ejecutar sus validadores al modificarlas y mantener
  la interfaz en lenguaje natural; el usuario no administra este esquema.

**Compatibilidad crítica:** conservar formato 2 permite leer el roadmap antiguo,
pero un Foreman anterior desconoce el store y podría cerrar el padre por su ruta
habitual. No afirmar que un sidecar impide ese comportamiento. Antes del primer
dogfooding nativo, la etapa E debe reproducir ese caso y fijar una política
explícita: trabajar con una versión compatible para planes activos y detectar
incoherencias al regresar, o una protección adicional demostrada. No cambiar el
formato del roadmap sin autorización. Si se exige bloqueo garantizado incluso
con clientes antiguos y no puede lograrse, detener esa promesa y revisar el diseño.
Los proyectos sin plan deben conservar exactamente su comportamiento habitual.

## 8. Crecimiento y archivo

El lector actual analiza el JSONL completo y las mutaciones reescriben su archivo.
El archivo histórico también se consulta para ciertos IDs y operaciones.
Archivar reduce el conjunto activo, no elimina el crecimiento histórico.

En V1, mantener el plan en su ruta estable al archivar/restaurar al padre.
Resolver su identidad en ambos archivos y prohibir mutaciones si el padre está
archivado. No mover simultáneamente tres stores ni eliminar planes incompletos
cuando un padre se descarta. Un padre terminal conserva la evidencia que explica
por qué terminó. `doctor` detecta huérfanos; nunca los elimina automáticamente.

El menú general no carga todos los planes. La selección y el detalle de una
tarea cargan solo el suyo. Los resúmenes tienen límites documentados; logs y
evidencias voluminosas viven en artefactos referenciados. No truncar historia
de aceptación para cumplir esos límites.

Medir fixtures de 100, 1 000 y 10 000 tareas y planes con 5, 20 y 100 unidades:
bytes leídos, archivos abiertos, tamaño de salida y tiempo por operación.
Publicar entorno y repeticiones; no inventar un umbral de latencia universal.
El criterio estructural es que consultar una tarea no abra planes ajenos y que
el menú no crezca con el texto de sus evidencias. Comparar con la base previa.
No introducir SQLite, rotación automática o borrado de historial sin demostrar
primero un problema que esas medidas resuelvan.

## 9. Entregas registradas en el roadmap

La secuencia es deliberada para usar cada capacidad aceptada en la siguiente.
Cada entrada debe producir un resultado revisable; su detalle de ejecución se
descompone al comenzar, evitando un inventario anticipado de cambios técnicos.

| Etapa / ID | Entrega | Demostración para aceptar |
| --- | --- | --- |
| A / 294 | Este contrato y el roadmap | La persona revisa alcance, granularidad, cierre y adopción; pide cambios o acepta |
| B / 295 | Store y creación/consulta por CLI | Crear un plan, recargarlo; datos inválidos o escritura obsoleta no dañan el original |
| C / 296 | Ciclo de aceptación | El paso 2 no inicia antes de aprobar el 1; devolución y aprobación obsoleta conservan la trazabilidad |
| D / 297 | Recorrido guiado visible | Una tarea de muestra presenta un resultado, cómo probarlo y una sola decisión pendiente |
| E / 298 | Reanudación y protección del padre | Cerrar/reabrir sesión mientras espera; recuperar el punto exacto e impedir cierre prematuro por CLI |
| F / 299 | Lecturas acotadas y archivo | Desarrollar por nanotareas reales la conservación del plan al archivar/restaurar y la medición de lecturas |
| G / 300 | Dogfooding nativo documentado | Crear la guía de uso mediante al menos dos incrementos aceptados; registrar devolución y reanudación observadas |
| H / 301 | Evaluación integral | Revisar evidencia técnica y humana; aceptar, corregir o diferir la función completa |

Las dependencias actuales son 294 → 295 → 296 → 297 → 298 → 299 → 300 → 301.
No se autoejecuta esa cadena. Cada cierre depende de su aceptación; el usuario
puede elegir trabajo separado de forma explícita. Las tareas siguen siendo
entregas del roadmap, no una simulación de nanotareas nativas ya disponibles.

## 10. Dogfooding sin dependencia circular

**Arranque, etapas A–E:** utilizar el Foreman actual para documentar, entregar y
aceptar capacidades pequeñas. Conservar evidencia y feedback en la entrada.
El primer ejercicio es este documento: su entrega queda `awaiting_acceptance`,
sin empezar el runtime. Esto demuestra el ciclo existente, no el nuevo store.

**Adopción, etapas F–G:** después de aceptar E y su política de compatibilidad,
usar la implementación local de nanotareas para terminar trabajo real de Foreman.
No exige instalar una versión del plugin ni modificar un marketplace.
En 299, proponer primero un incremento que conserve un plan al archivar/restaurar;
después de aceptarlo, implementar el incremento de lecturas acotadas y su reporte.
La sesión ejecuta los CLIs locales y el protocolo propuesto; esa evidencia no
demuestra por sí sola activación automática de skills/hooks del plugin instalado.

En 300, redactar y validar la documentación de uso con el propio modo guiado.
Registrar en `NANOTASKS-DOGFOOD.md` solo hechos ocurridos:

- ID del padre y unidad, revisión y artefacto presentados.
- Instrucción de prueba y checks ejecutados con sus resultados.
- Decisión humana y cambios derivados de su feedback.
- Punto de interrupción y estado recuperado en la siguiente sesión.
- Preguntas innecesarias, confusiones, aceptación obsoleta o pérdida de estado.

Debe haber una devolución y una reanudación ejercitadas por la persona. Puede
ser un ensayo acordado; etiquetarlo como tal. No fabricar una devolución ni
atribuir al usuario una decisión para completar una lista. Una cobertura que
no ocurrió permanece pendiente y se informa en la evaluación integral.

No importar aprobaciones del arranque como aceptaciones de unidades nativas.
Si el prototipo falla, conservar sus archivos y continuar la reparación mediante
el ciclo actual. No relajar el bloqueo para poder afirmar que el dogfooding pasó.

## 11. Validación y criterio de finalización

Por cada cambio de runtime: `node --test tests/*.test.js` con Node preparado
mediante fnm. Ejecutar los validadores instalados de plugin-creator y skill-creator
al cambiar metadata o skills. Las pruebas no instalan el plugin ni publican.

Cobertura necesaria, además de las pruebas de cada etapa:

- Estados ilegales, duplicados, revisión obsoleta, escritura concurrente y caída
  entre aceptación de unidad y transición del padre.
- Plan inválido o de versión futura: error explícito, sin tratarlo como ausente.
- Feedback, pausa, respuesta tardía, reanudación y modificación posterior del
  artefacto, incluyendo cambios sin commit.
- Imposibilidad de cerrar el padre con unidades pendientes y separación entre
  aceptación de unidad y aceptación integral.
- Round trip de roadmaps formato 2 y registros legacy, archive/restore e IDs
  históricos preservados; proyectos sin plan conservan su comportamiento.
- Lecturas acotadas y ausencia de pérdida de evidencia al archivar.
- Demostración visible del protocolo humano y sus limitaciones por host.

La función está lista para aceptación cuando sus invariantes pasan, el recorrido
humano se ha ejercitado, el estado se recupera desde disco y los límites de
compatibilidad están documentados. Solo una decisión explícita del usuario
permite cerrar 301. Publicar, instalar o fusionar a una rama protegida queda
fuera de estas entregas.

## 12. Punto de continuación de esta propuesta

Se inició un roadmap local porque este checkout no tenía uno ni archivo de
entradas. El historial Git contiene trailers hasta Foreman 293; el primer `add`
usó `ids_after:"293"` para evitar reutilizar esos IDs. No se importó ni modificó
el roadmap de Foundry ni de otra copia del proyecto.

Se creó `.foreman/config.json` vacío: aplican los valores predeterminados,
incluida aceptación final. Está excluido de Git por la regla local existente;
las decisiones de esta propuesta no dependen de personalizar esa configuración.
`NANOTASKS.md` se guarda en la raíz porque `docs/*` también está excluido en
este checkout. El documento y `ROADMAP.jsonl` quedan disponibles para versionar.

La entrega de A prepara el contrato para revisión. El próximo paso es aceptar
294 o corregirlo; 295 no debe comenzar por el mero hecho de que este documento
exista. Las decisiones técnicas propuestas quedan sujetas a esa revisión y a
la evidencia de las entregas posteriores.
