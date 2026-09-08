# Nanotareas Codex: evidencia de implementación y pruebas

Fecha: 2026-09-08. Rama: codex/nanotasks. Alcance: Codex. Las pruebas precedieron
a la instalación local autorizada posteriormente; no hubo publicación remota.

## Resultado

Implementados contrato de filas, preparación, pausa/feedback/registro, recuperación asistida y cierre integral por evidencia del resultado concreto. La ejecución usa el split y las notas existentes, sin store ni estados persistentes por incremento. El split habitual conserva su comportamiento.

## Uso real y decisiones

El usuario aceptó las entregas 295, 296 y 297. 297 se ejecutó con el recorrido de revisión ya implementado; 298 preparó dos incrementos y presentó el primero. Después el usuario autorizó expresamente completar la función de forma autónoma, ejecutar sesiones headless y limpiar sus rastros conservando resultados. Las revisiones intermedias restantes se registran como omitidas por esa instrucción, no como aceptaciones. La aceptación humana integral sigue separada. No se inventó feedback espontáneo.

## Pruebas headless controladas

Se usó el Codex incluido en la app, versión 0.153.4, con el modelo y esfuerzo configurados sin sobrescribirlos. El CLI global 0.145.0 rechazó gpt-6-astra por antigüedad; no se instaló ni actualizó software. Las ejecuciones usaron --ephemeral y --json, según la [documentación oficial](https://learn.chatgpt.com/docs/non-interactive-mode). La continuación entre procesos se reconstruyó desde notas y artefactos; no se afirma haber probado exec resume con un historial persistido.

Las decisiones de las siguientes fixtures son simuladas y están identificadas como pruebas. Se contrastaron las respuestas con archivos y notas reales.

| Caso | Estado observado del padre | Duración |
| --- | --- | --- |
| 01-initial-pause | in_progress | 149 s |
| 02-feedback | in_progress | 172 s |
| 03-explicit-pause | in_progress | 133 s |
| 04-resume-accepted | in_progress | 207 s |
| 05-last-not-whole | awaiting_acceptance | 220 s |
| 06-final-acceptance | done | 150 s |
| 07-no-channel | in_progress | 177 s |
| 08-late-changed | in_progress | 173 s |
| 09-omission-scope | awaiting_acceptance | 124 s |
| 10-explicit-waiver | awaiting_acceptance | 234 s |
| 11-required-failure | in_progress | 129 s |

Resultados: el primer resultado esperó; feedback corrigió solo su fila; Pausar conservó archivos; aceptación corroborada permitió avanzar sin rehacer el resultado; aceptar la última fila no cerró al padre; solo la aceptación integral explícita lo cerró. Sin canal quedó pendiente. Una aprobación tardía no aceptó contenido cambiado. Una omisión resuelta no reapareció como pendiente y una aceptación ajena no resolvió otra omisión. La instrucción explícita de continuar sin revisiones permitió completar técnicamente dejando aceptación final pendiente. Un check requerido fallido no permitió avanzar.

## Validación y corrección observada

Suite completa: **1.359 pruebas aprobadas, cero fallos y cero omitidas**. Validadores instalados de plugin-creator y skill-creator aprobados.

La validación detectó una carrera ENOENT en la publicación del lock. Se corrigió el reintento de ambas creaciones dentro del deadline existente, sin aumentar el timeout, con cuatro regresiones deterministas. Los tests concurrentes esperan que todos sus procesos terminen antes de limpiar. El timeout transitorio de una ejecución anterior se conserva como antecedente; no se usa como excepción.

## Datos conservados

- [Resultados y snapshots de los ensayos](test-results/nanotasks/evidence.json).
- [Log de la suite completa](test-results/nanotasks/node-tests.tap).

Los paths de fixtures dentro de los datos son referencias históricas; sus contenidos relevantes quedan recogidos como snapshots. Esos datos no son un store de ejecución.

## Límites

Son pruebas del protocolo ejecutado por Codex sobre documentación de fixture, no una interfaz de producto en funcionamiento ni una garantía de cumplimiento por clientes antiguos. No hay reanudación exacta automática ni idempotencia de annotate. El ejemplo de preparación conservó ciertos textos de persona/tono predeterminados; esa personalización no se acredita aquí. La instalación/activación en un plugin publicado y Claude Code no se probaron. El código queda listo para evaluación desde este checkout.

## Limpieza

Esta limpieza corresponde a las fixtures y sesiones de prueba. El paquete local
instalado y su respaldo de actualización se conservan para uso y recuperación.

Completada: fixtures, copia de runtime, harnesses, prompts de prueba y logs crudos eliminados. Se conservan este informe, evidence.json con snapshots y node-tests.tap. No quedan procesos headless identificados de estas pruebas; se comprobaron sus IDs de sesión sin tocar tareas ajenas. La configuración original del proyecto se conservó byte por byte.

## Instalación local posterior

Tras las pruebas, el usuario pidió actualizar la instalación de Foreman con esta
implementación. El 2026-09-08 se actualizó `foreman@personal` desde el worktree,
con paquete registrado en `C:/Users/Songbird/plugins/foreman`. La primera
instalación de esta implementación fue `3.0.0-codex.1+codex.20260908173747`.
Se verificaron su estado instalado/habilitado, la igualdad del paquete con su
caché y la generación de un prompt revisable mediante el ensamblador instalado.

Se conservó el launcher Windows que resuelve Node mediante fnm y un respaldo de
la versión anterior. No se cambió el marketplace ni la variante Claude. Las
actualizaciones documentales posteriores pueden cambiar el sufijo de caché;
`codex plugin list --marketplace personal --json` muestra la versión activa.
Una tarea nueva carga las skills actualizadas. Esta comprobación de instalación
no concede aceptación humana integral ni sustituye la evaluación de hooks en
una sesión nueva.

