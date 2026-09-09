# Foreman: aceptación por incrementos dentro de una tarea

> Roadmap canónico: Foundry/ROADMAP.jsonl. Las referencias operativas siguientes usan los IDs de Foundry; la sección histórica conserva los IDs locales originales. Ver el [mapa de reconciliación](https://github.com/V-Songbird/foundry/blob/main/docs/shared/validation/roadmap-reconciliation-2026-09-08.md).

Contrato canónico de implementación para Codex — 2026-09-08.

Este contrato consolida la [propuesta original](https://github.com/V-Songbird/foundry/blob/main/docs/foreman/research/NANOTASKS.md), el diseño de pausa selectiva recibido
el 2026-09-08 y sus dos revisiones. La petición posterior del usuario autoriza
continuar e implementar este contrato SOLO para Codex. Sustituye el diseño del
store independiente para V1; no acredita aceptación de resultados implementados
ni de la función integral. Claude Code queda pendiente de la evaluación Codex.
Los documentos anteriores quedan como antecedentes, no como instrucciones acumulativas.

La implementación Codex está disponible en este checkout. El informe
[NANOTASKS-DOGFOOD.md](https://github.com/V-Songbird/foundry/blob/main/docs/foreman/validation/NANOTASKS-DOGFOOD.md) recoge pruebas, decisiones reales,
ensayos controlados y limpieza. El usuario autorizó completar autónomamente las
entregas técnicas restantes, omitiendo sus revisiones intermedias en esta
ejecución. Esa excepción no cambia el comportamiento del producto ni concede
aceptación humana integral, que permanece separada.
Posteriormente se actualizó la instalación personal por petición del usuario;
el informe distingue esa instalación de las pruebas previas y conserva sus límites.

## 1. Acuerdo de producto

Foreman permite desarrollar **una tarea del roadmap por incrementos que la
persona pueda probar y aceptar**. La sesión que ejecuta conserva el objetivo,
presenta cada resultado y espera la decisión antes de construir el siguiente.

«Nanotarea» puede usarse en la conversación, pero no introduce otra categoría
que el usuario deba administrar. El incremento es un resultado significativo,
no cada paso de programación. Crear un componente puede ser un paso interno;
abrir y cerrar un modal accesible es un resultado revisable.

El comportamiento se solicita explícitamente, por ejemplo: «Haz esta tarea
por pasos y espera mi aprobación entre ellos». El split habitual conserva su
comportamiento. La preferencia se lleva en el encargo de esa ejecución, sin una
nueva configuración obligatoria del proyecto ni una pregunta por cada detalle.

El input transitorio del ensamblador la representa como
`reviewEachIncrement:true`, únicamente cuando recoge esa petición explícita.
Ausente o `false` conserva el comportamiento previo; el script no intenta
deducirla del texto libre. Con `true`, rechaza filas sin revisión y transporta
la obligación al prompt. Es una opción de ese encargo, no un nuevo campo del
roadmap ni una preferencia de proyecto que se active silenciosamente.

**En una ejecución así solicitada, cada incremento termina en aceptación
humana.** Los tests y las herramientas aportan evidencia, pero no reemplazan
la decisión de que el resultado corresponde a la intención del usuario.
No se exige que el aspecto revisado sea imposible de automatizar.

Esta decisión preserva la petición original. La alternativa «preguntar solo
cuando una herramienta no pueda verificarlo» sería un contrato de producto
distinto; no se declara equivalente mediante la palabra nanotarea.

## 2. Implementación mínima y alcance

V1 reutiliza las divisiones de `craft-handoff.js`, el ciclo del padre, sus notas
y los checkpoints existentes. No crea otro store, estados persistentes por
unidad, un grafo de propagación, un servidor ni ejecución de varios padres.

La exclusión de esquemas persistentes de aceptación y ejecución en `SCOPE.md`
también alcanza un archivo lateral. Se retira de V1 la propuesta
`.foreman/nanotasks/<parent>.json`. Guardar evidencia breve en `notes` no debe
convertirse en una base de eventos o un esquema completo escondido como texto.

La experiencia prometida es aceptación y continuidad asistida. No se promete
una máquina de estados que impida todo salto por cualquier cliente, ni una
reanudación automática exacta. Una limitación reproducida puede justificar
ampliar la implementación; no hace falta esperar dos incidentes reales.
Un cambio de alcance se justifica por separado antes de construirlo.

## 3. Unidad de trabajo y comprobaciones

Una fila del split representa **un incremento**, y puede combinar comprobaciones
automáticas y revisión humana. No crear dos filas sin trabajo distinto solo
porque el mismo resultado necesita un test y una inspección del usuario.

Contrato implementado del input transitorio del ensamblador:

```json
{
  "goal": "Abrir y cerrar el formulario de acceso",
  "files": ["src/Header.tsx", "src/LoginModal.tsx"],
  "run": "npm test -- LoginModal",
  "expected": "Pasan las comprobaciones de apertura, cierre y foco",
  "review": {
    "action": "Abre el acceso, ciérralo con Escape y vuelve a abrirlo",
    "expected": "El formulario se abre y cierra como esperas; todavía no autentica"
  }
}
```

El ejemplo define el contrato de filas; su entrega se registra en Foreman 303.
La disponibilidad y aceptación de cada capacidad se consultan mediante el CLI
del roadmap, sin inferirlas de este documento.
La verificación puede ser solo automática, solo humana o ambas. `run` y su
`expected` forman un par; `review.action` y `review.expected` forman otro.
Exigir al menos uno y validar los pares completos. La forma existente
`{run,expected,goal,files}` sigue siendo válida sin reinterpretar su significado.
En la ejecución con aceptación por incremento, todas las filas llevan `review`.

Se adopta del diseño `look` la distinción de comprobación humana, pero se usa
un campo de revisión adjunto a la fila para que conviva con `run`. Puede
renderizarse como `Look:` / `Expected:`. No hace falta mantener dos formatos
de entrada nuevos: `look` aún no está implementado en este checkout.

Solo los comandos pasan al resolvedor de comandos. El conteo para dividir y
ofrecer checkpoints cuenta incrementos con trabajo propio, no el número total
de comprobaciones. La recomendación de agente exige comprobaciones ejecutables
y las demás condiciones existentes. No inventar `run` para superar un validador.

Los tests que verifican estructura no acreditan que el texto proponga buenos
incrementos. La revisión del resultado y el dogfooding cubren esa parte.

## 4. Pausa, decisión y cierre

Secuencia de cada incremento:

1. Implementar únicamente su alcance y ejecutar sus comprobaciones requeridas.
2. Presentar el resultado, el modo de probarlo y lo que todavía no incluye.
3. Preguntar **Aceptar / Pedir cambios / Pausar** y esperar una respuesta real.
4. Registrar la decisión y la evidencia. Al aceptar, realizar el checkpoint
   cuando corresponda y continuar con el incremento siguiente.

Un fallo requerido no se presenta como éxito. Pedir cambios mantiene abierto
el incremento y conserva el feedback. Respetar el límite existente de dos
intentos fallidos de corrección; alcanzarlo significa informar y pausar, no
aceptar ni ampliar el alcance. Una nueva petición explícita puede reorientar
el trabajo. Un cambio de objetivo no se trata como un fallo de test.

Pausar conserva el trabajo y la decisión pendiente. No requiere una nueva
operación del roadmap. Terminar la sesión también puede pausar, pero debe dejar
una nota útil para retomar; no basta con suponer que la lista del host persistirá.

**No hay Skip automático.** La falta de una herramienta de preguntas usa la
conversación textual. Si no hay canal humano, detener el avance con el resultado
pendiente. Un cambio explícito del usuario para continuar sin revisión puede
modificar la instrucción de esa ejecución; se registra como comprobación omitida,
nunca como aceptación. No se añade una salida silenciosa por infraestructura.

Un worker devuelve el resultado al coordinador cuando ese canal existe. La
disponibilidad de background no implica que no haya persona ni permite asumir
que alguien contestará. V1 debe soportar primero la sesión actual y clipboard;
los demás destinos declaran sus límites y no sustituyen el destino elegido.

Los checkpoints siguen `safe-commit`, las restricciones de rama y la propiedad
de archivos. Un árbol previamente modificado puede continuar sin commits.
Registrar aceptación y crear un commit no son una transacción conjunta.

La aceptación intermedia no cierra el padre ni satisface sus dependientes.
Al terminar todos los incrementos, comprobar la integración completa y aplicar
la política existente de cierre del padre. `requireVerification` conserva su
significado de configuración general: no elimina una revisión intermedia que
la persona pidió expresamente. Tampoco se cambia su valor de forma implícita.
Cuando se requiere aceptación final, aceptar un incremento no la concede.
Si el resultado final y el último incremento se presentan juntos, una decisión
explícita puede aceptar ambos sin preguntar lo mismo dos veces.

## 5. Evidencia y recuperación honestas

Usar `roadmap.js annotate` para notas breves de aceptación, cambios solicitados,
omisión explícita o pausa. Un registro útil describe:

- El resultado y sus límites tal como se presentaron.
- La comprobación realizada y la decisión observada.
- La referencia disponible al artefacto revisado o al trabajo concreto.
- El punto pendiente y la siguiente acción, cuando corresponda.

No registrar secretos ni transcripciones enteras. `accepted:` puede distinguir
estas notas del aprendizaje de código, pero el prefijo no certifica nada por sí
solo. Si se filtra de `recallExcerpt`, el flujo de reanudación debe leer las
notas de la entrada directamente para no perder esa evidencia.

`task n/total` es una ayuda visual, no identidad estable entre planes reconstruidos.
Una nota escrita antes del checkpoint no está vinculada automáticamente al SHA
del commit posterior. Registrar la referencia real cuando exista; si el trabajo
no tiene commit, describir lo probado y declarar la limitación. No construir
manifiestos de hashes como requisito de V1.

Al retomar, leer las notas y el trabajo actual, contrastarlos y reconstruir el
siguiente incremento. **No omitir trabajo solo porque aparece `accepted:`.**
Si no se puede establecer qué resultado fue aceptado o si cambió después,
presentar la incertidumbre para revalidación antes de continuar. No volver a
implementar automáticamente lo ya existente. La misma regla cubre respuestas
tardías: una respuesta sobre una presentación anterior no acepta la nueva.

Una comprobación omitida y posteriormente resuelta conserva ambas notas. Al
cerrar, interpretar la evidencia de ese resultado concreto, sin borrar historia
ni suprimir cualquier `unverified:` por encontrar alguna aceptación distinta.

El `annotate` actual añade una línea en cada llamada; no es idempotente. Ante un
resultado incierto, releer antes de repetir. Probar duplicaciones e interrupciones;
no declarar que append más commit garantiza exactamente una escritura.
Un cliente antiguo puede leer el roadmap y desconocer el protocolo nuevo:
compatibilidad de formato no significa cumplimiento del comportamiento.

## 6. Ejemplo reconciliado

Tarea principal: «Añadir acceso de usuarios».

| Incremento | Trabajo y evidencia | Decisión humana |
| --- | --- | --- |
| Abrir y cerrar formulario | Botón, modal, campos, foco y tests correspondientes | ¿El acceso se presenta y se usa como esperas? Todavía no autentica |
| Autenticar y recuperarse de errores | Conexión, casos correctos e incorrectos, estado autenticado y tests | Probar credenciales válidas e inválidas; aceptar el comportamiento |
| Cerrar sesión y comprobar el conjunto | Salida, acceso actualizado y comprobación integral | Aceptar el resultado y, cuando se presente expresamente, la tarea completa |

Tres incrementos, tres decisiones; cada uno contiene tantos pasos técnicos como
necesite. Esta granularidad satisface la aprobación entre nanotareas sin pedir
confirmación por crear cada archivo o ejecutar cada comando.

## 7. Desarrollo y dogfooding

Entregas reconciliadas en este checkout; los IDs pertenecen a su inventario:

| Entrega | Resultado | Dependencia |
| --- | --- | --- |
| Contrato de filas (303) | Revisión humana junto a comandos, validación y renderizado, compatibilidad con Run existente | Continuación de diseño autorizada (302) |
| Pausa y registro (304) | Presentación, espera, feedback, notas y fallback textual en sesión actual y clipboard | Contrato de filas |
| Reanudación y cierre (306) | Reconstrucción asistida, revalidación de ambigüedad y tratamiento correcto de notas | Pausa y registro |
| Preparación y destinos (305) | El crafter construye incrementos útiles y conserva la petición de aprobación; recomendaciones honestas | Pausa y registro |
| Ensayos de recuperación (307) | Interrupciones, decisiones ambiguas y límites observados | Reanudación/cierre y preparación/destinos |
| Dogfooding y documentación (308) | Usar el recorrido completo para terminar documentación real y registrar evidencia | Ensayos de recuperación |
| Aceptación integral (301) | Decisión humana sobre la función Codex completa | Dogfooding y documentación |

La entrega de pausa se construye con el flujo actual. Tras implementarla y
verificarla se puede ensayar; no afirmar que funcionaba al seleccionar esa misma
tarea. El dogfooding nativo empieza en entregas posteriores que ya puedan usarla.

Checks requeridos antes de declarar disponible el contrato:

- Comandos existentes conservan su comportamiento; filas humanas y mixtas se
  renderizan correctamente; entradas incompletas son rechazadas.
- Tests y revisión del mismo incremento no crean filas adicionales vacías.
- Se espera una respuesta; feedback o falta de canal no desbloquean el siguiente.
- El clipboard incluye la pausa también para una sola fila revisable; no queda
  condicionado al umbral de dos filas usado por el embed de checkpoints actual.
- Notas repetidas, caída entre aceptación y commit, respuesta tardía y cambios
  posteriores no autorizan saltos por inferencia.
- Un cierre distingue lo aceptado, lo omitido y lo todavía pendiente.
- Prueba de reanudación con evidencia suficiente y con evidencia ambigua.

Ejecutar `node --test tests/*.test.js` para cambios de runtime y los validadores
instalados al editar skills o metadata. Las pruebas no instalan ni publican.
Usar los checks disponibles del checkout real; no heredar rutas inexistentes
ni supuestas autorizaciones históricas para tolerar fallos.

El dogfooding registra lo ocurrido. Una devolución espontánea que no sucedió
no se inventa; el camino de devolución debe probarse mediante un ensayo
identificado como tal. Separar pruebas de comportamiento, ensayos con el usuario
y uso espontáneo. Leer texto o comprobar que una frase existe no demuestra que
la ejecución se detenga. Una pausa real, su decisión y una reanudación real
forman parte de la evidencia de esta entrega.

## 8. Contexto histórico: dos checkouts, dos inventarios

La revisión de diseño se verificó inicialmente contra
`D:/Projects/Personal/SoftwareDevelopment/codex/foreman`, rama `codex/port`.
La implementación y sus pruebas se realizaron en
`C:/Users/Songbird/.codex/worktrees/9689/foreman`, rama `codex/nanotasks`,
conservando la fuente original. Ambos contienen `skills/roadmap/delivery.md` y
`hooks/codex-task.js`; las nuevas capacidades se documentan con la evidencia de
la rama de implementación. El adjunto histórico
describe otra copia y reporta otro significado para los IDs 294–299; esa copia
no se inspeccionó directamente en esta revisión. No hay que negar la existencia
de una porque no esté dentro del directorio de la otra.

Los IDs solo se interpretan junto con su repositorio o checkout. Su coincidencia
se vuelve un conflicto si se integran los historiales. No basta con renumerar
filas: primero inventariar entradas, notas, documentos, anchors y trailers.
No borrar ni reescribir commits históricos para resolverlo automáticamente.
Si se decide una numeración canónica, preparar un mapa explícito de correspondencia.

En la transferencia inicial, 294 esperaba aceptación y 295–301 estaban planificadas
alrededor del documento anterior. Aquel roadmap tenía ocho entradas y unos 7 KB, sin archivo de
entradas. La cifra de 278 entradas/820 KB del adjunto corresponde a su inventario
reportado, no a éste. El archivado existente es mantenimiento aparte; no es un
prerrequisito de esta función aquí. No se agrega una infraestructura de escala.

La sesión de implementación del 2026-09-08 reconcilió descripciones, superficies,
documentos y dependencias mediante el CLI, conservando IDs y notas. La instrucción
expresa de continuar resolvió 294 como decisión de diseño e inició únicamente 295.
Las entregas de implementación conservan su aceptación humana independiente.
Las aceptaciones efectivas de 295–297 y la posterior omisión autorizada de
revisiones intermedias están registradas en el informe de pruebas; no se infieren
del estado de una entrada ni se convierten en aceptación integral.
No importar los IDs de otro documento como si fueran referencias globales.

## 9. Decisión de acuerdo

La recomendación final es **aceptación por cada incremento significativo,
implementada sobre el split y las notas actuales, con recuperación asistida y
límites explícitos**. Se retiran tanto el store independiente de V1 como el
avance automático ante falta de respuesta.

Si se elige en cambio pausar solo en verificaciones exclusivamente humanas,
debe quedar como una modificación explícita de la petición original antes de
reescribir el documento o las tareas. Ninguno de los textos externos, sus
anotaciones de «declined» ni esta propuesta equivalen a esa decisión del usuario.
