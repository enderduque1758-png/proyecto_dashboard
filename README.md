# Crypto Futures AI

Dashboard experimental para Binance USDⓈ-M Futures, publicado con GitHub Pages.

## Funciones

- Descubrimiento automático de contratos perpetuos activos.
- Datos públicos de Binance Futures en tiempo real.
- Señales LONG / SHORT / WATCH.
- PRE-LONG / PRE-SHORT anticipado.
- Confianza actual y confianza proyectada.
- Filtro configurable de confianza proyectada.
- Contadores **Cumplen** y **Ocultas**.
- Orden de mayor a menor confianza proyectada.
- Backtesting histórico basado en velas de 1 minuto.
- Desplazamientos conservador, base y agresivo.
- Simulador visual de apalancamiento 1x–75x.
- OI, funding, profundidad, flujo y contexto histórico.

## Desarrollo local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Cada push a `main` ejecuta `.github/workflows/deploy-pages.yml` y publica la carpeta `dist` en GitHub Pages.

> Este proyecto es experimental e informativo. No ejecuta órdenes y no garantiza resultados financieros.
