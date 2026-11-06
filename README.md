# GMAO Insights

Aplicación web estática para analizar exportaciones CMMS/GMAO, creada a partir de las dimensiones y métricas usadas en `GMAO_local.ipynb`.

## Funcionalidades

- Carga de archivos CSV, XLSX y XLS directamente desde el navegador.
- Filtros por periodo, tipo de mantenimiento, área y criticidad.
- Indicadores de OT únicas, horas-hombre, downtime, costos directos y MTTR.
- 14 gráficos dinámicos de actividad, esfuerzo, downtime, costos, activos prioritarios, MTTR, Pareto y Jack-Knife.
- Ranking de activos por downtime y resumen de completitud de campos.
- Exportación de un informe ejecutivo PDF de 10 páginas, con los filtros aplicados y gráficos visibles.
- Procesamiento local: los archivos seleccionados no se suben a un servidor.
- Identificación del autor en el dashboard y en la portada del informe PDF.

### Gráficos incluidos

1. Órdenes por tipo de mantenimiento.
2. Horas-hombre por tipo de mantenimiento.
3. Participación de OT frente a horas-hombre.
4. Downtime por tipo de mantenimiento.
5. Top 10 equipos por downtime.
6. Costo directo por tipo de mantenimiento.
7. Top 10 equipos por costo.
8. Comparación del impacto por tipo (OT, HH, downtime y costo).
9. MTTR por tipo de equipo.
10. Pareto de modos de falla por frecuencia.
11. Pareto de modos de falla por downtime.
12. Pareto de modos de falla por costo directo.
13. Jack-Knife normalizado por equipo.
14. Jack-Knife normalizado por modo de falla.

## Ejecutar localmente

Se puede abrir `index.html` directamente en un navegador moderno. La aplicación usa bibliotecas de JavaScript servidas desde CDN, por lo que se requiere conexión a Internet para cargar PapaParse, SheetJS, Chart.js y jsPDF. No requiere Python, Node.js ni servidor de aplicación.

Para probar la aplicación, carga un archivo `.csv`, `.xlsx` o `.xls` exportado desde el CMMS. Se admite el formato de columnas de `GMAO_local.ipynb`; los nombres más importantes incluyen:

| Columna | Uso |
| --- | --- |
| `Tipo_mantenimiento` | Comparación de estrategias |
| `OT` | Conteo de órdenes únicas |
| `Fecha_creación`, `Fecha_inicio`, `Fecha_fin` | Periodo y duración de reparación |
| `Equipo`, `Tipo_equipo`, `Área`, `Criticidad` | Filtros y ranking de activos |
| `Modo_falla` | Pareto de frecuencia, downtime y costo |
| `Estado` | Selección de reparaciones cerradas para MTTR |
| `Downtime_h`, `Horas_mano_obra` | Indicadores de impacto y esfuerzo |
| `Costo_total_CLP` | Costo directo; si falta, se suman repuestos y costos externos |

La columna `Tipo_mantenimiento` es obligatoria. Los demás campos son opcionales; los gráficos e indicadores asociados se muestran vacíos o como no disponibles cuando no hay datos suficientes. Para MTTR y Jack-Knife se requieren registros correctivos cerrados y fechas de inicio y término válidas. Jack-Knife usa downtime por falla como proxy de MTTR y sirve para priorizar de forma relativa, no para estimar probabilidades.

## Publicar en GitHub Pages

La carpeta es estática y puede publicarse en GitHub Pages. Si el repositorio usa GitHub Actions para publicar un subdirectorio, agrega este workflow en `.github/workflows/pages.yml` en la raíz del repositorio:

```yaml
name: Publicar GMAO Insights en GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - "webapp/**"
      - ".github/workflows/pages.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: webapp
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

En **Settings → Pages**, selecciona **GitHub Actions** como fuente. Al hacer push a `main`, GitHub publicará `webapp/index.html` en el sitio configurado.

## Consideraciones

- Se recomienda un máximo de 50 MB por archivo para evitar consumo excesivo de memoria del navegador.
- La aplicación trabaja sobre las columnas presentes en el dataset; no infiere MTBF ni disponibilidad porque requieren horas de operación.
- Los costos y los rankings deben validarse con el equipo técnico antes de usarlos para aprobar inversiones.
- Si no hay conexión a Internet, el navegador no puede descargar las bibliotecas CDN y las funciones de análisis no estarán disponibles.
