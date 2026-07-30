# Reporte Consumo Horas Jira — JTC

Dashboard de seguimiento de horas consumidas en proyectos helpdesk, construido sobre datos de Jira Cloud.

## Archivos

| Archivo | Descripción |
|---|---|
| `atihd-resumen.html` | Dashboard principal — casos activos ATIHD con filtros por período, consultor y tipo de actividad |
| `jira-horas-dashboard.html` | Vista de detalle por caso individual (ATIHD-148) |
| `extract_worklogs.py` | Script Python para extraer worklogs de ATIFT via Jira API |

## Estructura de datos

```
ATIHD (Atica Soporte — casos helpdesk)
  └─ linked via "is caused by" →  ATIFT (Atica Soporte Factory)
                                       └─ worklogs: fecha, consultor, horas
```

Los consultores registran horas en los issues de **ATIFT**. El dashboard cruza esa información con los casos de **ATIHD** para mostrar el consumo real por caso de soporte.

## Funcionalidades

- Filtro por período (meses derivados de fechas reales de worklog)
- Filtro por rango de fechas — opera sobre la fecha de carga del worklog, no sobre la fecha del caso
- Filtro por estado, consultor y tipo de actividad
- KPIs dinámicos: horas totales, consultores activos, casos con actividad en período
- Ranking de consultores por horas
- Desglose por consultor dentro de cada caso
- Soporte light/dark mode (JTC BrandBook)

## Uso

Abre `atihd-resumen.html` directamente en el navegador — no requiere servidor ni dependencias externas.

---

*Proyecto: JTC · just time consulting group*
