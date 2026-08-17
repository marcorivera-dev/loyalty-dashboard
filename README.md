# Embudo de activación — programa de lealtad

Dashboard estático que mide qué tanto se usa el programa de lealtad de Loyverse
después del registro, sobre compras identificadas en caja.

## El hallazgo

Sobre 464 clientes registrados:

| Etapa | Clientes | % del total |
|---|---|---|
| Registrados | 464 | 100% |
| Activados (≥1 compra, incluye el mismo día del registro) | 250 | **53.9%** |
| Regresaron en día distinto al del registro | 110 | **23.7%** |
| Recurrentes (≥2 días distintos) | 73 | 15.7% |

La métrica de "activación" que se suele reportar (53.9%) cuenta como activo a
cualquier cliente con una compra después del registro — **incluyendo el mismo
día**. En la práctica esa primera compra casi siempre es el cobro del
descuento de bienvenida al inscribirse, así que el 53.9% mide sobre todo
gente canjeando un cupón de bienvenida una sola vez, no gente usando el
programa.

Cuando se exige que la compra sea en un **día calendario distinto** al del
registro — la única señal de que alguien de verdad volvió — la cifra cae a
**23.7%** (110 de 464). El programa, tal como se estaba operando, funcionaba
en la práctica como un cupón de un solo uso para la mayoría de los inscritos,
no como un mecanismo de retención.

Advertencia adicional: solo 11–15% de los recibos traen un cliente
identificado en caja, así que ambos números son un piso, no el comportamiento
real completo — alguien puede haber vuelto a comprar sin que lo capturen en
caja y aquí se ve como "0 compras".

## Cómo correrlo

```
node serve.js
```

Abre `http://localhost:5050`. Si no existe `data/funnel.json` (no has corrido
el fetch todavía), el dashboard cae automáticamente a
`data/funnel.sample.json`, que trae los mismos cuatro agregados de la tabla
de arriba — así se puede navegar la demo sin credenciales de Loyverse.

Para generar datos frescos:

```
railway run -- node fetch_loyverse_data.js   # trae clientes/recibos crudos a una carpeta temporal del SO
node compute_funnel.js                        # calcula el embudo, escribe data/funnel.json, borra lo crudo
```

## Seguridad de datos

- `LOYVERSE_TOKEN` se lee únicamente de la variable de entorno
  (`process.env.LOYVERSE_TOKEN` en `fetch_loyverse_data.js`) — no hay ningún
  valor hardcodeado en el repo, y así se ha verificado también sobre el
  historial completo de git, no solo el working tree.
- Los datos crudos de clientes (email, historial de compras) se escriben en
  una carpeta temporal del sistema operativo, nunca dentro del proyecto, y se
  borran en un `finally` al terminar `compute_funnel.js` pase lo que pase.
- Lo único que persiste en el repo es `data/funnel.json`: conteos agregados,
  sin PII. Aun así queda fuera de git vía `.gitignore` junto con
  `node_modules/`, `.env` y `.env.*` — la única excepción explícita es
  `data/funnel.sample.json`, que trae exclusivamente los cuatro agregados de
  este README.
