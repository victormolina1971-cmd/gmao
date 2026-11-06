(() => {
  "use strict";

  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  const PALETTE = {
    navy: "#0b1d2e",
    blue: "#2f5bea",
    teal: "#12a594",
    amber: "#f59f0b",
    purple: "#7c4dcc",
    rose: "#e5484d",
    accent: "#ffc23d",
    slate: "#8e9cab",
    pale: "#eef2f6",
    border: "#dde4eb",
    ink: "#0f2233",
    muted: "#5b6b7b",
    white: "#ffffff",
  };
  const TYPE_COLORS = {
    Correctivo: PALETTE.rose,
    Preventivo: PALETTE.teal,
    Predictivo: PALETTE.blue,
  };
  const COLUMN_ALIASES = {
    ot: ["ot", "orden", "ordendetrabajo", "numeroorden", "norden"],
    created: ["fechacreacion", "fechaalta", "fechaaviso"],
    start: ["fechainicio", "fechacomienzo", "inicio"],
    end: ["fechafin", "fechatermino", "fechacierre", "fin"],
    equipment: ["equipo", "activo", "equipamiento"],
    area: ["area", "unidad", "planta", "ubicacion"],
    equipmentType: ["tipoequipo", "claseequipo", "familiaequipo"],
    criticality: ["criticidad", "criticidadsap", "clasecriticidad"],
    maintenanceType: ["tipomantenimiento", "tipodemantenimiento", "clasedemantenimiento"],
    planned: ["planificado", "planificada", "esplanificado"],
    failureMode: ["modofalla", "mododefalla", "fallamodo", "falladescrita"],
    cause: ["causa", "causafalla"],
    symptom: ["sintoma", "sintomafalla"],
    status: ["estado", "estadodelaorden", "status"],
    downtime: ["downtimeh", "downtime", "tiempodetencionh", "horasdetencion"],
    labor: ["horasmanoobra", "horasde manoobra", "horashombre", "hh", "horasmanoobra"],
    partsCost: ["costorepuestosclp", "costorepuestos", "costomaterialesclp"],
    externalCost: ["costoexternoclp", "costoexterno", "costoserviciosexternos"],
    totalCost: ["costototalclp", "costototal", "costodirectoclp", "costodirecto"],
    duration: ["duracionoth", "duracionot", "duracionh"],
    repairDuration: ["tiemporeparacionh", "tiemporeparacion"],
    waitDuration: ["tiempoesperah", "tiempoespera"],
  };

  const elements = {
    uploadPanel: document.getElementById("upload-panel"),
    fileInput: document.getElementById("file-input"),
    chooseFile: document.getElementById("choose-file"),
    replaceFile: document.getElementById("replace-file"),
    exportPdf: document.getElementById("export-pdf"),
    status: document.getElementById("status-message"),
    loading: document.getElementById("loading-overlay"),
    loadingText: document.getElementById("loading-text"),
    dataToolbar: document.getElementById("data-toolbar"),
    loadedName: document.getElementById("loaded-name"),
    loadedMeta: document.getElementById("loaded-meta"),
    filters: document.getElementById("filters"),
    year: document.getElementById("filter-year"),
    type: document.getElementById("filter-type"),
    area: document.getElementById("filter-area"),
    criticality: document.getElementById("filter-criticality"),
    clearFilters: document.getElementById("clear-filters"),
    filterCount: document.getElementById("filter-count"),
    periodLabel: document.getElementById("period-label"),
    footerDataset: document.getElementById("footer-dataset"),
    qualityFields: document.getElementById("quality-fields"),
    assetsBody: document.getElementById("assets-body"),
    insightText: document.getElementById("insight-text"),
  };

  const state = {
    rows: [],
    sourceName: "",
    columns: {},
    charts: {},
    filteredRows: [],
    duplicatesRemoved: 0,
  };

  function normalizeHeader(value) {
    return String(value ?? "")
      .replace(/^\uFEFF/, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function cleanValue(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim().replace(/^'+/, "").trim();
  }

  function mapColumns(headers) {
    const normalizedHeaders = headers.map((header) => ({
      original: header,
      normalized: normalizeHeader(header),
    }));
    const columns = {};
    for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
      const aliasSet = new Set(aliases.map(normalizeHeader));
      const found = normalizedHeaders.find((header) => aliasSet.has(header.normalized));
      if (found) columns[canonical] = found.original;
    }
    return columns;
  }

  function parseNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    let text = cleanValue(value).replace(/\s/g, "").replace(/[^\d,.-]/g, "");
    if (!text || !/\d/.test(text)) return null;

    const comma = text.lastIndexOf(",");
    const dot = text.lastIndexOf(".");
    if (comma >= 0 && dot >= 0) {
      const decimalSeparator = comma > dot ? "," : ".";
      const thousandsSeparator = decimalSeparator === "," ? "." : ",";
      text = text.split(thousandsSeparator).join("");
      if (decimalSeparator === ",") text = text.replace(",", ".");
    } else if (comma >= 0) {
      const decimalDigits = text.length - comma - 1;
      text = decimalDigits > 0 && decimalDigits <= 2
        ? text.replace(",", ".")
        : text.split(",").join("");
    } else if (dot >= 0 && text.length - dot - 1 === 3 && text.indexOf(".") === dot) {
      text = text.replace(".", "");
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const text = cleanValue(value);
    if (!text) return null;

    const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (dmy) {
      const [, day, month, year, hour = "0", minute = "0", second = "0"] = dmy;
      const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
      if (
        date.getFullYear() === Number(year)
        && date.getMonth() === Number(month) - 1
        && date.getDate() === Number(day)
      ) return date;
      return null;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function canonicalizeRows(rawRows, headers) {
    const columns = mapColumns(headers);
    if (!columns.maintenanceType) {
      throw new Error("No encontré la columna «Tipo_mantenimiento». Revisa que el archivo tenga los encabezados del dataset CMMS.");
    }
    const mapped = rawRows.map((raw) => {
      const row = {};
      for (const [canonical, original] of Object.entries(columns)) {
        row[canonical] = cleanValue(raw[original]);
      }
      const sourceValues = headers.map((header) => cleanValue(raw[header]));
      return { row, sourceValues };
    }).filter(({ row }) => Object.values(row).some(Boolean));
    const seen = new Set();
    let duplicatesRemoved = 0;
    const unique = mapped.filter(({ sourceValues }) => {
      const key = JSON.stringify(sourceValues);
      if (seen.has(key)) {
        duplicatesRemoved += 1;
        return false;
      }
      seen.add(key);
      return true;
    }).map(({ row }) => row);
    return { rows: unique, columns, duplicatesRemoved };
  }

  function parseCsv(file) {
    return new Promise((resolve, reject) => {
      if (!window.Papa) {
        reject(new Error("No se pudo cargar el lector CSV. Comprueba tu conexión y vuelve a cargar la página."));
        return;
      }
      window.Papa.parse(file, {
        header: true,
        skipEmptyLines: "greedy",
        dynamicTyping: false,
        transformHeader: (header) => String(header).replace(/^\uFEFF/, "").trim(),
        complete: (result) => {
          const headers = result.meta.fields || [];
          if (!headers.length) {
            reject(new Error("El archivo CSV está vacío o no contiene encabezados."));
            return;
          }
          const fatal = (result.errors || []).filter((item) => item.code !== "TooManyFields");
          if (fatal.length && !result.data.length) {
            reject(new Error(`No se pudo interpretar el CSV: ${fatal[0].message}`));
            return;
          }
          resolve(canonicalizeRows(result.data, headers));
        },
        error: (error) => reject(new Error(`No se pudo leer el CSV: ${error.message}`)),
      });
    });
  }

  async function parseSpreadsheet(file) {
    if (!window.XLSX) {
      throw new Error("No se pudo cargar el lector Excel. Comprueba tu conexión y vuelve a cargar la página.");
    }
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("El libro Excel no contiene hojas.");
    const sheet = workbook.Sheets[sheetName];
    const objects = window.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    if (!objects.length) throw new Error("La primera hoja de Excel no contiene registros.");
    return canonicalizeRows(objects, Object.keys(objects[0]));
  }

  async function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      showStatus("El archivo supera el límite de 50 MB. Guarda una versión más pequeña y vuelve a intentarlo.", "error");
      return;
    }
    const extension = file.name.split(".").pop().toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(extension)) {
      showStatus("Formato no compatible. Carga un archivo CSV, XLSX o XLS.", "error");
      return;
    }
    setLoading(true, "Leyendo y validando el dataset");
    hideStatus();
    try {
      const result = extension === "csv" ? await parseCsv(file) : await parseSpreadsheet(file);
      if (!result.rows.length) throw new Error("El archivo no contiene registros analizables.");
      state.rows = result.rows;
      state.columns = result.columns;
      state.sourceName = file.name;
      state.duplicatesRemoved = result.duplicatesRemoved;
      populateFilters();
      elements.dataToolbar.hidden = false;
      elements.filters.hidden = false;
      elements.exportPdf.disabled = false;
      elements.loadedName.textContent = file.name;
      elements.loadedMeta.textContent = `${formatInteger(result.rows.length)} filas válidas · ${formatBytes(file.size)} · duplicados exactos retirados: ${formatInteger(result.duplicatesRemoved)}`;
      elements.footerDataset.textContent = file.name;
      updateDashboard();
      if (result.duplicatesRemoved > 0) {
        showStatus(`Dataset procesado correctamente. Se omitieron ${formatInteger(result.duplicatesRemoved)} filas duplicadas exactas.`, "warning");
      } else {
        showStatus(`Dataset procesado: ${formatInteger(result.rows.length)} filas válidas. El archivo permanece en tu dispositivo.`, "success");
      }
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "No se pudo procesar el archivo.", "error");
    } finally {
      setLoading(false);
      elements.fileInput.value = "";
    }
  }

  function setLoading(active, text = "Procesando dataset") {
    elements.loading.hidden = !active;
    elements.loadingText.textContent = text;
  }

  function showStatus(message, kind = "success") {
    elements.status.hidden = false;
    elements.status.className = `status-message${kind === "error" ? " error" : kind === "warning" ? " warning" : ""}`;
    elements.status.textContent = message;
  }

  function hideStatus() {
    elements.status.hidden = true;
    elements.status.textContent = "";
  }

  function formatInteger(value) {
    return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(value || 0);
  }

  function formatDecimal(value, digits = 1) {
    return new Intl.NumberFormat("es-CL", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value || 0);
  }

  function formatCurrency(value) {
    if (!Number.isFinite(value)) return "—";
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `$${formatDecimal(value / 1_000_000_000, 2)} mil MM`;
    if (abs >= 1_000_000) return `$${formatDecimal(value / 1_000_000, 1)} MM`;
    if (abs >= 10_000) return `$${formatDecimal(value / 1_000, 0)} mil`;
    return `$${formatInteger(value)}`;
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${formatDecimal(bytes / 1024, 0)} KB`;
    return `${formatDecimal(bytes / (1024 * 1024), 1)} MB`;
  }

  function getValue(row, key) {
    return row[key] || "";
  }

  function normalizedCategory(value, fallback = "Sin clasificar") {
    const cleaned = cleanValue(value);
    if (!cleaned) return fallback;
    const normalized = cleaned.toLocaleLowerCase("es-CL").replace(/\s+/g, " ");
    if (["correctivo", "correctiva"].includes(normalized)) return "Correctivo";
    if (["preventivo", "preventiva"].includes(normalized)) return "Preventivo";
    if (["predictivo", "predictiva"].includes(normalized)) return "Predictivo";
    return cleaned;
  }

  function isClosed(value) {
    const normalized = cleanValue(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return ["cerrada", "cerrado", "closed", "finalizada", "finalizado"].includes(normalized);
  }

  function valueNumber(row, key) {
    return parseNumber(getValue(row, key));
  }

  function numberSum(rows, key) {
    return rows.reduce((total, row) => total + (valueNumber(row, key) ?? 0), 0);
  }

  function uniqueCount(rows, key) {
    const values = rows.map((row) => cleanValue(getValue(row, key))).filter(Boolean);
    return values.length ? new Set(values).size : rows.length;
  }

  function populateFilters() {
    const yearValues = [...new Set(state.rows.map((row) => {
      const date = parseDate(getValue(row, "created")) || parseDate(getValue(row, "start"));
      return date ? String(date.getFullYear()) : "";
    }).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    const types = uniqueCategories(state.rows, "maintenanceType");
    const areas = uniqueCategories(state.rows, "area");
    const criticalities = uniqueCategories(state.rows, "criticality");
    fillSelect(elements.year, yearValues, "Todos los periodos");
    fillSelect(elements.type, types, "Todos los tipos");
    fillSelect(elements.area, areas, "Todas las áreas");
    fillSelect(elements.criticality, criticalities, "Todas");
    const dateValues = state.rows.map((row) => parseDate(getValue(row, "created")) || parseDate(getValue(row, "start"))).filter(Boolean);
    if (dateValues.length) {
      const years = [...new Set(dateValues.map((date) => date.getFullYear()))];
      elements.periodLabel.innerHTML = `<span class="period-dot"></span> ${Math.min(...years)}${years.length > 1 ? `–${Math.max(...years)}` : ""}`;
    } else {
      elements.periodLabel.innerHTML = '<span class="period-dot"></span> Sin fechas disponibles';
    }
  }

  function uniqueCategories(rows, key) {
    const values = rows.map((row) => normalizedCategory(getValue(row, key))).filter((value) => value !== "Sin clasificar");
    return [...new Set(values)].sort((a, b) => a.localeCompare(b, "es"));
  }

  function fillSelect(select, values, placeholder) {
    select.replaceChildren(new Option(placeholder, ""));
    for (const value of values) select.add(new Option(value, value));
  }

  function getFilteredRows() {
    const selectedYear = elements.year.value;
    const selectedType = elements.type.value;
    const selectedArea = elements.area.value;
    const selectedCriticality = elements.criticality.value;
    return state.rows.filter((row) => {
      if (selectedYear) {
        const date = parseDate(getValue(row, "created")) || parseDate(getValue(row, "start"));
        if (!date || String(date.getFullYear()) !== selectedYear) return false;
      }
      if (selectedType && normalizedCategory(getValue(row, "maintenanceType")) !== selectedType) return false;
      if (selectedArea && normalizedCategory(getValue(row, "area")) !== selectedArea) return false;
      if (selectedCriticality && normalizedCategory(getValue(row, "criticality")) !== selectedCriticality) return false;
      return true;
    });
  }

  function updateDashboard() {
    if (!state.rows.length) return;
    const rows = getFilteredRows();
    state.filteredRows = rows;
    elements.filterCount.textContent = `${formatInteger(rows.length)} ${rows.length === 1 ? "registro" : "registros"}`;
    renderKpis(rows);
    renderCharts(rows);
    renderAssets(rows);
    renderQuality(rows);
  }

  function renderKpis(rows) {
    const orders = uniqueCount(rows, "ot");
    const labor = numberSum(rows, "labor");
    const downtime = numberSum(rows, "downtime");
    const cost = rows.reduce((sum, row) => {
      const direct = valueNumber(row, "totalCost");
      return sum + (direct ?? ((valueNumber(row, "partsCost") ?? 0) + (valueNumber(row, "externalCost") ?? 0)));
    }, 0);
    const correctives = rows.filter((row) => normalizedCategory(getValue(row, "maintenanceType")) === "Correctivo");
    const repairs = correctives
      .filter((row) => isClosed(getValue(row, "status")))
      .map((row) => {
        const start = parseDate(getValue(row, "start"));
        const end = parseDate(getValue(row, "end"));
        if (!start || !end) return null;
        const duration = (end.getTime() - start.getTime()) / 3_600_000;
        return duration > 0 ? duration : null;
      })
      .filter((value) => value !== null);
    const mttr = repairs.length ? repairs.reduce((sum, value) => sum + value, 0) / repairs.length : null;

    setText("kpi-orders", formatInteger(orders));
    setText("kpi-labor", `${formatDecimal(labor, 1)} h`);
    setText("kpi-downtime", `${formatDecimal(downtime, 1)} h`);
    setText("kpi-cost", formatCurrency(cost));
    setText("kpi-mttr", mttr === null ? "N/D" : `${formatDecimal(mttr, 1)} h`);
    setText("kpi-repairs", `${formatInteger(repairs.length)} reparaciones válidas`);
    renderInsight(rows, { orders, labor, downtime, cost, mttr });
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function renderInsight(rows, totals) {
    if (!rows.length) {
      elements.insightText.textContent = "Los filtros seleccionados no contienen registros. Ajusta los filtros para volver a mostrar indicadores.";
      return;
    }
    const correctives = rows.filter((row) => normalizedCategory(getValue(row, "maintenanceType")) === "Correctivo");
    const pct = (part, whole) => whole > 0 ? part / whole * 100 : 0;
    const laborPct = pct(numberSum(correctives, "labor"), totals.labor);
    const downPct = pct(numberSum(correctives, "downtime"), totals.downtime);
    const costOf = (row) => valueNumber(row, "totalCost") ?? ((valueNumber(row, "partsCost") ?? 0) + (valueNumber(row, "externalCost") ?? 0));
    const costPct = pct(correctives.reduce((sum, row) => sum + costOf(row), 0), totals.cost);
    const orderPct = pct(uniqueCount(correctives, "ot"), totals.orders);
    const dominant = Object.entries(groupCounts(rows, "maintenanceType"))
      .sort((a, b) => b[1] - a[1])[0];
    const lead = correctives.length
      ? `El correctivo concentra ${formatDecimal(orderPct, 1)}% de las OT, ${formatDecimal(laborPct, 1)}% del esfuerzo, ${formatDecimal(downPct, 1)}% del downtime y ${formatDecimal(costPct, 1)}% del costo registrado.`
      : `El tipo con mayor volumen es ${dominant ? dominant[0] : "no identificado"} (${formatInteger(dominant?.[1] || 0)} registros).`;
    elements.insightText.textContent = `${lead} Revisa los activos y modos de falla prioritarios, valida la calidad de las causas y sigue la evolución de MTTR, detenciones y costo.`;
  }

  function groupCounts(rows, key) {
    const grouped = {};
    for (const row of rows) {
      const category = normalizedCategory(getValue(row, key));
      grouped[category] = (grouped[category] || 0) + 1;
    }
    return grouped;
  }

  function groupBy(rows, getter, valueGetter, reducer = "sum") {
    const groups = new Map();
    rows.forEach((row) => {
      const key = cleanValue(getter(row)) || "Sin clasificar";
      const value = valueGetter(row);
      if (!groups.has(key)) groups.set(key, []);
      if (value !== null && value !== undefined && Number.isFinite(value)) groups.get(key).push(value);
    });
    return [...groups.entries()].map(([label, values]) => ({
      label,
      value: reducer === "mean"
        ? (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
        : values.reduce((sum, value) => sum + value, 0),
      count: values.length,
    }));
  }

  function categoryShares(rows, category, metric) {
    const types = uniqueCategories(rows, "maintenanceType");
    const total = metric === "orders"
      ? uniqueCount(rows, "ot")
      : rows.reduce((sum, row) => sum + metricValue(row, metric), 0);
    return types.map((type) => {
      const matching = rows.filter((row) => normalizedCategory(getValue(row, "maintenanceType")) === type);
      const value = metric === "orders"
        ? uniqueCount(matching, "ot")
        : matching.reduce((sum, row) => sum + metricValue(row, metric), 0);
      return total ? value / total * 100 : 0;
    });
  }

  function metricValue(row, metric) {
    if (metric === "labor") return valueNumber(row, "labor") ?? 0;
    if (metric === "downtime") return valueNumber(row, "downtime") ?? 0;
    if (metric === "cost") {
      return valueNumber(row, "totalCost")
        ?? ((valueNumber(row, "partsCost") ?? 0) + (valueNumber(row, "externalCost") ?? 0));
    }
    return 0;
  }

  function failureRanking(rows, metric, limit = 8) {
    const grouped = new Map();
    let rowIndex = 0;
    for (const row of rows) {
      const label = cleanValue(getValue(row, "failureMode"));
      if (!label) continue;
      if (!grouped.has(label)) grouped.set(label, { label, value: 0, ids: new Set() });
      const item = grouped.get(label);
      if (metric === "orders") {
        const id = cleanValue(getValue(row, "ot"));
        item.ids.add(id || `row-${rowIndex}`);
      } else {
        item.value += metricValue(row, metric);
      }
      rowIndex += 1;
    }
    const result = [...grouped.values()].map((item) => ({
      label: item.label,
      value: metric === "orders" ? item.ids.size : item.value,
    }));
    return result.sort((a, b) => b.value - a.value).slice(0, limit);
  }

  function repairByEquipment(rows) {
    const repairs = rows.filter((row) => {
      if (normalizedCategory(getValue(row, "maintenanceType")) !== "Correctivo" || !isClosed(getValue(row, "status"))) return false;
      const start = parseDate(getValue(row, "start"));
      const end = parseDate(getValue(row, "end"));
      return Boolean(start && end && end > start);
    });
    return groupBy(
      repairs,
      (row) => cleanValue(getValue(row, "equipmentType")) || "Sin tipo de equipo",
      (row) => {
        const start = parseDate(getValue(row, "start"));
        const end = parseDate(getValue(row, "end"));
        return (end.getTime() - start.getTime()) / 3_600_000;
      },
      "mean",
    ).filter((item) => item.count > 0).sort((a, b) => b.value - a.value).slice(0, 8);
  }

  function chartBaseOptions(axis = "x", valueFormatter = (value) => formatDecimal(value, 0)) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: PALETTE.navy,
          titleFont: { family: "Inter", size: 11, weight: "600" },
          bodyFont: { family: "Inter", size: 10 },
          padding: 10,
          displayColors: false,
          callbacks: { label: (context) => ` ${valueFormatter(context.parsed[axis])}` },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: "#5b6b7b", font: { family: "Inter", size: 11 }, maxRotation: 0, autoSkip: false },
        },
        y: {
          beginAtZero: true,
          grid: { color: "#e8edf2", drawBorder: false },
          border: { display: false, dash: [3, 3] },
          ticks: { color: "#8e9cab", font: { family: "Inter", size: 10 }, maxTicksLimit: 5, callback: valueFormatter },
        },
      },
    };
  }

  function chartColors(labels) {
    const palette = [PALETTE.blue, PALETTE.teal, PALETTE.amber, PALETTE.purple, PALETTE.rose, "#8e9cab"];
    return labels.map((label, index) => TYPE_COLORS[label] || palette[index % palette.length]);
  }

  function groupedMetric(rows, key, metric) {
    const grouped = new Map();
    rows.forEach((row, index) => {
      const rawLabel = cleanValue(getValue(row, key));
      if (!rawLabel) return;
      const label = key === "maintenanceType" ? normalizedCategory(rawLabel) : rawLabel;
      if (!grouped.has(label)) grouped.set(label, { label, value: 0, orders: new Set() });
      const item = grouped.get(label);
      if (metric === "orders") {
        const id = cleanValue(getValue(row, "ot"));
        item.orders.add(id || `row-${index}`);
      } else {
        item.value += metricValue(row, metric);
      }
    });
    return [...grouped.values()].map((item) => ({
      label: item.label,
      value: metric === "orders" ? item.orders.size : item.value,
    })).sort((a, b) => a.label.localeCompare(b.label, "es"));
  }

  function equipmentRanking(rows, metric) {
    return groupedMetric(rows, "equipment", metric)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .reverse();
  }

  function paretoRanking(rows, metric) {
    const ranked = failureRanking(rows, metric, Number.MAX_SAFE_INTEGER);
    const total = ranked.reduce((sum, item) => sum + item.value, 0);
    let accumulated = 0;
    return ranked.slice(0, 10).map((item) => {
      accumulated += total > 0 ? item.value / total * 100 : 0;
      return { ...item, accumulated };
    });
  }

  function jackKnifePoints(rows, categoryKey) {
    const groups = new Map();
    let rowIndex = 0;
    for (const row of rows) {
      if (normalizedCategory(getValue(row, "maintenanceType")) !== "Correctivo" || !isClosed(getValue(row, "status"))) {
        rowIndex += 1;
        continue;
      }
      const start = parseDate(getValue(row, "start"));
      const end = parseDate(getValue(row, "end"));
      const label = cleanValue(getValue(row, categoryKey));
      if (!start || !end || end <= start || !label) {
        rowIndex += 1;
        continue;
      }
      if (!groups.has(label)) groups.set(label, { label, orders: new Set(), downtime: 0 });
      const item = groups.get(label);
      const id = cleanValue(getValue(row, "ot"));
      item.orders.add(id || `row-${rowIndex}`);
      item.downtime += valueNumber(row, "downtime") ?? 0;
      rowIndex += 1;
    }

    const grouped = [...groups.values()].map((item) => ({
      ...item,
      failures: item.orders.size,
      mttr: item.orders.size ? item.downtime / item.orders.size : 0,
    })).filter((item) => item.failures > 0);
    const totalFailures = grouped.reduce((sum, item) => sum + item.failures, 0);
    const totalDowntime = grouped.reduce((sum, item) => sum + item.downtime, 0);
    if (!grouped.length || !totalFailures || totalDowntime <= 0) return [];

    const meanFailures = totalFailures / grouped.length;
    const meanMttr = totalDowntime / totalFailures;
    return grouped.filter((item) => item.mttr > 0).map((item) => {
      const frequency = item.failures / meanFailures;
      const mttrNormalized = item.mttr / meanMttr;
      const classification = frequency < 1
        ? (mttrNormalized < 1 ? "Bajo control" : "Agudo")
        : (mttrNormalized < 1 ? "Crónico" : "Grave");
      return { ...item, frequency, mttrNormalized, classification };
    });
  }

  function renderParetoChart(key, canvasId, rows, metric, formatter, color) {
    const items = paretoRanking(rows, metric);
    const options = chartBaseOptions("y", formatter);
    options.scales.x.ticks.maxRotation = 55;
    options.scales.x.ticks.minRotation = 25;
    options.scales.x.ticks.autoSkip = true;
    options.scales.yPercent = {
      type: "linear",
      position: "right",
      min: 0,
      max: 100,
      grid: { drawOnChartArea: false },
      border: { display: false },
      ticks: {
        color: "#8e9cab",
        font: { family: "Inter", size: 10 },
        callback: (value) => `${value}%`,
      },
    };
    options.plugins.legend = {
      display: true,
      position: "bottom",
      labels: { color: "#33475a", usePointStyle: true, pointStyle: "circle", boxWidth: 7, boxHeight: 7, padding: 14, font: { family: "Inter", size: 11 } },
    };
    options.plugins.tooltip.callbacks.label = (context) => context.dataset.yAxisID === "yPercent"
      ? ` Acumulado: ${formatDecimal(context.parsed.y, 1)}%`
      : ` ${formatter(context.parsed.y)}`;
    createOrUpdateChart(key, canvasId, {
      type: "bar",
      data: {
        labels: items.map((item) => shortLabel(item.label, 22)),
        datasets: [
          {
            label: metric === "orders" ? "OT" : metric === "downtime" ? "Downtime" : "Costo",
            data: items.map((item) => item.value),
            backgroundColor: color,
            borderRadius: 3,
            yAxisID: "y",
          },
          {
            type: "line",
            label: "Porcentaje acumulado",
            data: items.map((item) => item.accumulated),
            borderColor: PALETTE.navy,
            backgroundColor: PALETTE.navy,
            pointBackgroundColor: PALETTE.accent,
            pointBorderColor: PALETTE.navy,
            pointRadius: 3,
            tension: 0.2,
            yAxisID: "yPercent",
          },
        ],
      },
      options,
    });
  }

  function renderJackKnifeChart(key, canvasId, rows, categoryKey) {
    const points = jackKnifePoints(rows, categoryKey);
    const colors = {
      "Bajo control": PALETTE.teal,
      Agudo: PALETTE.amber,
      Crónico: PALETTE.blue,
      Grave: PALETTE.rose,
    };
    const values = points.flatMap((item) => [item.frequency, item.mttrNormalized]);
    const minPower = values.length ? Math.floor(Math.log10(Math.min(...values))) : -1;
    const maxPower = values.length ? Math.ceil(Math.log10(Math.max(...values))) : 1;
    const min = 10 ** Math.min(minPower, -1);
    const max = 10 ** Math.max(maxPower, 1);
    const curveX = Array.from({ length: 80 }, (_, index) => min * ((max / min) ** (index / 79)));
    const referenceDatasets = [
      {
        label: "Referencia (1×)",
        data: [{ x: 1, y: min }, { x: 1, y: max }],
        borderColor: "#9aa8b6",
        borderDash: [5, 4],
        borderWidth: 1,
        pointRadius: 0,
        showLine: true,
      },
      {
        label: "Referencia (1×)",
        data: [{ x: min, y: 1 }, { x: max, y: 1 }],
        borderColor: "#9aa8b6",
        borderDash: [5, 4],
        borderWidth: 1,
        pointRadius: 0,
        showLine: true,
      },
      ...[0.5, 1, 2, 4].map((risk) => ({
        label: `R*=${risk}`,
        data: curveX.map((x) => ({ x, y: risk / x })).filter((point) => point.y >= min && point.y <= max),
        borderColor: "#d3dce5",
        borderDash: [2, 4],
        borderWidth: 1,
        pointRadius: 0,
        showLine: true,
      })),
    ];
    const classes = ["Bajo control", "Agudo", "Crónico", "Grave"];
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: PALETTE.navy,
          titleFont: { family: "Inter", size: 11, weight: "600" },
          bodyFont: { family: "Inter", size: 10 },
          callbacks: {
            title: (items) => items[0]?.raw?.label || "",
            label: (context) => {
              const item = context.raw;
              if (!item.label) return "";
              return [
                ` ${item.classification}`,
                ` Frecuencia normalizada: ${formatDecimal(item.x, 2)}×`,
                ` MTTR normalizado: ${formatDecimal(item.y, 2)}×`,
                ` Fallas: ${formatInteger(item.failures)} · MTTR: ${formatDecimal(item.mttr, 1)} h`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          type: "logarithmic",
          min,
          max,
          title: { display: true, text: "Frecuencia normalizada (N / promedio)", color: "#33475a", font: { family: "Inter", size: 11 } },
          grid: { color: "#e8edf2" },
          border: { display: false },
          ticks: { color: "#5b6b7b", font: { family: "Inter", size: 10 }, callback: (value) => `${formatDecimal(value, 2)}×` },
        },
        y: {
          type: "logarithmic",
          min,
          max,
          title: { display: true, text: "MTTR normalizado (MTTR / promedio)", color: "#33475a", font: { family: "Inter", size: 11 } },
          grid: { color: "#e8edf2" },
          border: { display: false },
          ticks: { color: "#5b6b7b", font: { family: "Inter", size: 10 }, callback: (value) => `${formatDecimal(value, 2)}×` },
        },
      },
    };
    createOrUpdateChart(key, canvasId, {
      type: "scatter",
      data: {
        datasets: [
          ...classes.map((classification) => ({
            label: classification,
            data: points.filter((item) => item.classification === classification).map((item) => ({
              x: item.frequency,
              y: item.mttrNormalized,
              label: item.label,
              classification,
              failures: item.failures,
              mttr: item.mttr,
            })),
            backgroundColor: colors[classification],
            borderColor: colors[classification],
            pointRadius: 4,
            pointHoverRadius: 6,
          })),
          ...referenceDatasets,
        ],
      },
      options,
    });
  }

  function createOrUpdateChart(key, canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    if (state.charts[key]) {
      state.charts[key].destroy();
    }
    state.charts[key] = new window.Chart(canvas, config);
  }

  function renderCharts(rows) {
    const types = uniqueCategories(rows, "maintenanceType");
    const mixOptions = chartBaseOptions("y", (value) => `${formatDecimal(value, 1)}%`);
    mixOptions.scales.y.max = 100;
    mixOptions.scales.y.ticks.callback = (value) => `${value}%`;
    mixOptions.plugins.legend = {
      display: true,
      position: "bottom",
      labels: { color: "#33475a", usePointStyle: true, pointStyle: "circle", boxWidth: 7, boxHeight: 7, padding: 18, font: { family: "Inter", size: 11 } },
    };
    const createTypeBar = (key, canvasId, items, color, formatter, axisTitle) => {
      const options = chartBaseOptions("y", formatter);
      options.scales.y.title = { display: true, text: axisTitle, color: "#33475a", font: { family: "Inter", size: 11 } };
      createOrUpdateChart(key, canvasId, {
        type: "bar",
        data: {
          labels: items.map((item) => item.label),
          datasets: [{
            data: items.map((item) => item.value),
            backgroundColor: items.map((item, index) => TYPE_COLORS[item.label] || (items.length === 1 ? color : chartColors([item.label])[0])),
            borderRadius: 4,
            maxBarThickness: 38,
          }],
        },
        options,
      });
    };

    const typeOrders = groupedMetric(rows, "maintenanceType", "orders");
    const typeLabor = groupedMetric(rows, "maintenanceType", "labor");
    const typeDowntime = groupedMetric(rows, "maintenanceType", "downtime");
    const typeCost = groupedMetric(rows, "maintenanceType", "cost");
    createTypeBar("orders", "chart-orders", typeOrders, PALETTE.blue, formatInteger, "Órdenes únicas");
    createTypeBar("labor", "chart-labor", typeLabor, PALETTE.teal, (value) => `${formatDecimal(value, 0)} h`, "Horas-hombre");
    createTypeBar("downtimeType", "chart-downtime-type", typeDowntime, PALETTE.amber, (value) => `${formatDecimal(value, 0)} h`, "Downtime [h]");
    createTypeBar("cost", "chart-cost", typeCost, PALETTE.purple, (value) => `$${formatDecimal(value / 1_000_000, 1)} MM`, "Costo [millones de CLP]");
    if (state.charts.cost) {
      state.charts.cost.options.plugins.tooltip.callbacks.label = (context) => ` ${context.label}: ${formatCurrency(context.raw)}`;
      state.charts.cost.update();
    }

    const comparisonOptions = { ...mixOptions, scales: { ...mixOptions.scales } };
    comparisonOptions.scales.x = { ...mixOptions.scales.x, ticks: { ...mixOptions.scales.x.ticks, autoSkip: false } };
    createOrUpdateChart("ordersLabor", "chart-orders-labor", {
      type: "bar",
      data: {
        labels: types,
        datasets: [
          { label: "% OT", data: categoryShares(rows, "maintenanceType", "orders"), backgroundColor: PALETTE.blue, borderRadius: 3 },
          { label: "% Horas-hombre", data: categoryShares(rows, "maintenanceType", "labor"), backgroundColor: PALETTE.teal, borderRadius: 3 },
        ],
      },
      options: comparisonOptions,
    });
    createOrUpdateChart("mix", "chart-mix", {
      type: "bar",
      data: {
        labels: types,
        datasets: [
          { label: "OT", data: categoryShares(rows, "maintenanceType", "orders"), backgroundColor: PALETTE.blue, borderRadius: 3 },
          { label: "Horas-hombre", data: categoryShares(rows, "maintenanceType", "labor"), backgroundColor: PALETTE.teal, borderRadius: 3 },
          { label: "Downtime", data: categoryShares(rows, "maintenanceType", "downtime"), backgroundColor: PALETTE.amber, borderRadius: 3 },
          { label: "Costo", data: categoryShares(rows, "maintenanceType", "cost"), backgroundColor: PALETTE.purple, borderRadius: 3 },
        ],
      },
      options: mixOptions,
    });

    const equipmentDowntime = equipmentRanking(rows, "downtime");
    createOrUpdateChart("equipmentDowntime", "chart-equipment-downtime", {
      type: "bar",
      data: { labels: equipmentDowntime.map((item) => shortLabel(item.label, 20)), datasets: [{ data: equipmentDowntime.map((item) => item.value), backgroundColor: PALETTE.amber, borderRadius: 3, barThickness: 13 }] },
      options: horizontalBarOptions((value) => `${formatDecimal(value, 0)} h`),
    });
    const equipmentCost = equipmentRanking(rows, "cost");
    createOrUpdateChart("equipmentCost", "chart-equipment-cost", {
      type: "bar",
      data: { labels: equipmentCost.map((item) => shortLabel(item.label, 20)), datasets: [{ data: equipmentCost.map((item) => item.value / 1_000_000), backgroundColor: PALETTE.purple, borderRadius: 3, barThickness: 13 }] },
      options: horizontalBarOptions((value) => `$${formatDecimal(value, 1)} MM`),
    });

    const mttr = repairByEquipment(rows);
    createOrUpdateChart("mttr", "chart-mttr", {
      type: "bar",
      data: { labels: mttr.map((item) => shortLabel(item.label)), datasets: [{ data: mttr.map((item) => item.value), backgroundColor: PALETTE.teal, borderRadius: 3, barThickness: 13 }] },
      options: horizontalBarOptions((value) => `${formatDecimal(value, 1)} h`),
    });

    renderParetoChart("paretoFrequency", "chart-pareto-frequency", rows, "orders", formatInteger, PALETTE.blue);
    renderParetoChart("paretoDowntime", "chart-pareto-downtime", rows, "downtime", (value) => `${formatDecimal(value, 0)} h`, PALETTE.amber);
    renderParetoChart("paretoCost", "chart-pareto-cost", rows, "cost", (value) => `$${formatDecimal(value / 1_000_000, 1)} MM`, PALETTE.purple);
    renderJackKnifeChart("jackKnifeEquipment", "chart-jackknife-equipment", rows, "equipment");
    renderJackKnifeChart("jackKnifeFailure", "chart-jackknife-failure", rows, "failureMode");
  }

  function horizontalBarOptions(valueFormatter) {
    const options = chartBaseOptions("x", valueFormatter);
    options.indexAxis = "y";
    options.scales = {
      x: { beginAtZero: true, grid: { color: "#e8edf2", drawBorder: false }, border: { display: false }, ticks: { color: "#8e9cab", font: { family: "Inter", size: 10 }, maxTicksLimit: 5, callback: valueFormatter } },
      y: { grid: { display: false }, border: { display: false }, ticks: { color: "#33475a", font: { family: "Inter", size: 10 }, callback(value, index, ticks) { return shortLabel(ticks[index]?.label || value); } } },
    };
    options.plugins.tooltip.callbacks.label = (context) => ` ${valueFormatter(context.parsed.x)}`;
    return options;
  }

  function shortLabel(value, max = 24) {
    const label = String(value || "");
    return label.length > max ? `${label.slice(0, max - 1)}…` : label;
  }

  function renderAssets(rows) {
    const groups = new Map();
    for (const row of rows) {
      const label = cleanValue(getValue(row, "equipment"));
      if (!label) continue;
      if (!groups.has(label)) {
        groups.set(label, {
          label,
          type: cleanValue(getValue(row, "equipmentType")) || "—",
          criticality: cleanValue(getValue(row, "criticality")) || "—",
          orders: new Set(),
          downtime: 0,
          cost: 0,
        });
      }
      const item = groups.get(label);
      const id = cleanValue(getValue(row, "ot"));
      if (id) item.orders.add(id);
      else item.orders.add(`row-${item.orders.size}`);
      item.downtime += valueNumber(row, "downtime") ?? 0;
      item.cost += metricValue(row, "cost");
    }
    const top = [...groups.values()].sort((a, b) => b.downtime - a.downtime).slice(0, 10);
    if (!top.length) {
      elements.assetsBody.innerHTML = '<tr><td colspan="6" class="empty-table">No hay una columna de equipo o activos sin downtime en el filtro actual.</td></tr>';
      return;
    }
    elements.assetsBody.innerHTML = top.map((item) => `
      <tr>
        <td>${escapeHtml(item.label)}</td>
        <td>${escapeHtml(item.type)}</td>
        <td><span class="criticality-pill">${escapeHtml(item.criticality)}</span></td>
        <td>${formatInteger(item.orders.size)}</td>
        <td>${formatDecimal(item.downtime, 1)}</td>
        <td>${formatCurrency(item.cost)}</td>
      </tr>
    `).join("");
  }

  function renderQuality(rows) {
    const fields = [
      ["Orden de trabajo", "ot"],
      ["Tipo mantenimiento", "maintenanceType"],
      ["Equipo", "equipment"],
      ["Modo de falla", "failureMode"],
      ["Downtime", "downtime"],
      ["Costo", "totalCost"],
    ].filter(([, key]) => state.columns[key]);
    if (!fields.length) {
      elements.qualityFields.innerHTML = '<p class="empty-quality">No se encontraron campos analizables.</p>';
      return;
    }
    elements.qualityFields.innerHTML = fields.map(([label, key]) => {
      const present = rows.filter((row) => cleanValue(getValue(row, key)) !== "").length;
      const percent = rows.length ? Math.round(present / rows.length * 100) : 0;
      return `<div class="quality-row"><label>${escapeHtml(label)}</label><div class="quality-track"><span style="width:${percent}%"></span></div><span class="quality-value">${percent}%</span></div>`;
    }).join("");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function clearFilters() {
    elements.year.value = "";
    elements.type.value = "";
    elements.area.value = "";
    elements.criticality.value = "";
    updateDashboard();
  }

  function setNavActive() {
    const current = window.location.hash || "#inicio";
    document.querySelectorAll(".nav-link").forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === current || (current === "#inicio" && link.getAttribute("href") === "#inicio"));
    });
  }

  function rowPercentages(rows) {
    const types = uniqueCategories(rows, "maintenanceType");
    const metrics = [
      ["OT", "orders"],
      ["HH", "labor"],
      ["Downtime", "downtime"],
      ["Costo", "cost"],
    ];
    return { types, metrics: metrics.map(([label, metric]) => ({ label, values: categoryShares(rows, "maintenanceType", metric) })) };
  }

  function computePdfSummary(rows) {
    const orders = uniqueCount(rows, "ot");
    const labor = numberSum(rows, "labor");
    const downtime = numberSum(rows, "downtime");
    const cost = rows.reduce((sum, row) => sum + metricValue(row, "cost"), 0);
    const correctives = rows.filter((row) => normalizedCategory(getValue(row, "maintenanceType")) === "Correctivo");
    const repairRows = correctives.map((row) => {
      const start = parseDate(getValue(row, "start"));
      const end = parseDate(getValue(row, "end"));
      if (!isClosed(getValue(row, "status")) || !start || !end || end <= start) return null;
      return (end - start) / 3_600_000;
    }).filter((value) => value !== null);
    const mttr = repairRows.length ? repairRows.reduce((sum, value) => sum + value, 0) / repairRows.length : null;
    const percentile = (selector, total) => total ? selector / total * 100 : 0;
    const correctivesCost = correctives.reduce((sum, row) => sum + metricValue(row, "cost"), 0);
    return {
      orders,
      labor,
      downtime,
      cost,
      mttr,
      median: median(repairRows),
      repairCount: repairRows.length,
      correctives: {
        orders: percentile(uniqueCount(correctives, "ot"), orders),
        labor: percentile(numberSum(correctives, "labor"), labor),
        downtime: percentile(numberSum(correctives, "downtime"), downtime),
        cost: percentile(correctivesCost, cost),
      },
    };
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function exportPdf() {
    if (!state.filteredRows.length) {
      showStatus("No hay registros con los filtros actuales para incluir en el informe.", "error");
      return;
    }
    if (!window.jspdf?.jsPDF) {
      showStatus("No se pudo cargar el exportador PDF. Comprueba tu conexión y vuelve a intentarlo.", "error");
      return;
    }
    setLoading(true, "Preparando el informe ejecutivo PDF");
    window.setTimeout(() => {
      try {
        const doc = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
        doc.setProperties({ author: "Juan Pablo Sánchez Flores", title: "Informe Ejecutivo de Mantenimiento" });
        const rows = state.filteredRows;
        const summary = computePdfSummary(rows);
        const assets = computeAssets(rows).slice(0, 10);
        const totalsByType = computeTypeSummary(rows);
        const dateLabel = elements.periodLabel.textContent.trim();
        const pageWidth = 210;
        const margin = 17;
        const contentWidth = pageWidth - margin * 2;
        let pageNumber = 0;

        function newPage(title, eyebrow = "GMAO INSIGHTS · INFORME DE GESTIÓN") {
          if (pageNumber > 0) doc.addPage();
          pageNumber += 1;
          doc.setFillColor(11, 29, 46);
          doc.rect(0, 0, pageWidth, 24, "F");
          doc.setTextColor(255, 255, 255);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text(eyebrow, margin, 10);
          doc.setFontSize(16);
          doc.text(title, margin, 19);
          doc.setDrawColor(255, 194, 61);
          doc.setLineWidth(1.1);
          doc.line(margin, 27, margin + 19, 27);
          doc.setDrawColor(221, 228, 235);
          doc.setLineWidth(0.3);
          doc.line(margin, 285, pageWidth - margin, 285);
          doc.setTextColor(91, 107, 123);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.text(`${state.sourceName} · ${dateLabel}`, margin, 291);
          doc.text(`${pageNumber} / 10`, pageWidth - margin, 291, { align: "right" });
          doc.setTextColor(15, 34, 51);
        }

        function paragraph(text, y, options = {}) {
          const fontSize = options.fontSize || 10;
          const color = options.color || [51, 71, 90];
          const x = options.x || margin;
          const width = options.width || contentWidth;
          doc.setFont("helvetica", options.bold ? "bold" : "normal");
          doc.setFontSize(fontSize);
          doc.setTextColor(...color);
          const lines = doc.splitTextToSize(String(text), width);
          doc.text(lines, x, y);
          return y + lines.length * (fontSize * 0.44) + (options.gap ?? 3);
        }

        function heading(text, y) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(11, 29, 46);
          doc.text(text.toUpperCase(), margin, y);
          return y + 6;
        }

        function chartImage(key, x, y, width, height) {
          const chart = state.charts[key];
          if (!chart) return false;
          try {
            const image = chart.toBase64Image("image/png", 1);
            doc.addImage(image, "PNG", x, y, width, height, undefined, "FAST");
            return true;
          } catch (error) {
            console.warn(`No se pudo agregar el gráfico ${key} al PDF.`, error);
            return false;
          }
        }

        function addMetricCard(x, y, width, label, value, accent) {
          doc.setFillColor(238, 242, 246);
          doc.roundedRect(x, y, width, 24, 2, 2, "F");
          doc.setFillColor(...accent);
          doc.roundedRect(x, y, 2, 24, 1, 1, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(7);
          doc.setTextColor(91, 107, 123);
          doc.text(label.toUpperCase(), x + 5, y + 7);
          doc.setFontSize(13);
          doc.setTextColor(11, 29, 46);
          doc.text(value, x + 5, y + 17);
        }

        function addTable(headers, data, x, y, widths, options = {}) {
          const rowHeight = options.rowHeight || 8;
          const fontSize = options.fontSize || 7.4;
          let currentY = y;
          doc.setFillColor(11, 29, 46);
          doc.rect(x, currentY, widths.reduce((sum, width) => sum + width, 0), rowHeight + 1, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(fontSize);
          doc.setTextColor(255, 255, 255);
          let currentX = x;
          headers.forEach((header, index) => {
            doc.text(String(header), currentX + 2, currentY + 5.5, { maxWidth: widths[index] - 3 });
            currentX += widths[index];
          });
          currentY += rowHeight + 1;
          data.forEach((row, rowIndex) => {
            if (rowIndex % 2 === 0) {
              doc.setFillColor(244, 247, 250);
              doc.rect(x, currentY, widths.reduce((sum, width) => sum + width, 0), rowHeight, "F");
            }
            currentX = x;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(fontSize);
            doc.setTextColor(51, 71, 90);
            row.forEach((value, index) => {
              const lines = doc.splitTextToSize(String(value ?? "—"), widths[index] - 4);
              doc.text(lines.slice(0, 2), currentX + 2, currentY + 4.7, { maxWidth: widths[index] - 4 });
              currentX += widths[index];
            });
            currentY += rowHeight;
          });
          return currentY;
        }

        const correctives = `${formatDecimal(summary.correctives.orders, 1)}% de las OT, ${formatDecimal(summary.correctives.labor, 1)}% de las HH, ${formatDecimal(summary.correctives.downtime, 1)}% del downtime y ${formatDecimal(summary.correctives.cost, 1)}% del costo`;

        // 1. Portada ejecutiva
        pageNumber = 1;
        doc.setFillColor(11, 29, 46);
        doc.rect(0, 0, pageWidth, 297, "F");
        doc.setFillColor(255, 194, 61);
        doc.rect(0, 0, 210, 4, "F");
        doc.setTextColor(255, 194, 61);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text("GMAO INSIGHTS  /  REPORTE DE GESTIÓN", margin, 26);
        doc.setDrawColor(36, 64, 90);
        doc.line(margin, 33, pageWidth - margin, 33);
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(27);
        doc.text(["Informe Ejecutivo", "de Mantenimiento"], margin, 62);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.setTextColor(198, 214, 228);
        doc.text(["Diagnóstico operacional, activos prioritarios", "y oportunidades de mejora"], margin, 79);
        doc.setFontSize(9);
        doc.setTextColor(143, 165, 186);
        doc.text(`Dataset: ${state.sourceName}`, margin, 95);
        doc.text(`Periodo: ${dateLabel}   ·   Filtro: ${formatInteger(rows.length)} registros`, margin, 101);
        doc.text("Preparado por: Juan Pablo Sánchez Flores", margin, 107);

        addMetricCard(margin, 117, 55, "Órdenes de trabajo", formatInteger(summary.orders), [47, 91, 234]);
        addMetricCard(margin + 60, 117, 55, "Horas-hombre", `${formatDecimal(summary.labor, 0)} h`, [18, 165, 148]);
        addMetricCard(margin + 120, 117, 55, "Downtime", `${formatDecimal(summary.downtime, 0)} h`, [245, 159, 11]);
        addMetricCard(margin, 146, 55, "Costo directo", formatCurrency(summary.cost), [124, 77, 204]);
        addMetricCard(margin + 60, 146, 55, "MTTR correctivo", summary.mttr === null ? "N/D" : `${formatDecimal(summary.mttr, 1)} h`, [229, 72, 77]);
        addMetricCard(margin + 120, 146, 55, "Reparaciones", formatInteger(summary.repairCount), [255, 194, 61]);

        doc.setFillColor(17, 42, 64);
        doc.roundedRect(margin, 185, contentWidth, 42, 2, 2, "F");
        doc.setFillColor(255, 194, 61);
        doc.roundedRect(margin, 185, 2, 42, 1, 1, "F");
        doc.setTextColor(255, 194, 61);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("MENSAJE PARA LA GERENCIA", margin + 7, 194);
        doc.setTextColor(235, 242, 248);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(doc.splitTextToSize(`El mantenimiento correctivo concentra ${correctives}. Priorizar la revisión de activos y modos de falla de mayor impacto, validar causas y medir resultados con indicadores comparables.`, contentWidth - 15), margin + 7, 202);
        doc.setDrawColor(36, 64, 90);
        doc.line(margin, 264, pageWidth - margin, 264);
        doc.setTextColor(143, 165, 186);
        doc.setFontSize(8);
        doc.text("Análisis procesado localmente en el navegador. No se envió el dataset a un servidor.", margin, 272);
        doc.text("1 / 10", pageWidth - margin, 286, { align: "right" });

        // 2. Alcance, cobertura y método
        newPage("Alcance, datos y método");
        let y = 39;
        y = heading("Propósito del análisis", y);
        y = paragraph("Este reporte transforma las órdenes de trabajo disponibles en una lectura ejecutiva de actividad, esfuerzo, downtime, costo y reparación. Describe los registros incluidos en el archivo y los filtros seleccionados; no extrapola resultados a periodos o activos ausentes.", y);
        y = heading("Proceso analítico", y + 3);
        const steps = [
          "Normalización de categorías, limpieza de apóstrofos iniciales y descarte de duplicados exactos.",
          "Agrupación de órdenes, horas-hombre, downtime y costos por tipo de mantenimiento.",
          "MTTR calculado con reparaciones correctivas cerradas que tienen fechas válidas y duración positiva.",
          "Pareto de modos por frecuencia, downtime y costo; ranking de activos por impacto.",
        ];
        steps.forEach((step, index) => {
          doc.setFillColor(255, 246, 220);
          doc.circle(margin + 3, y - 1, 3, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(47, 91, 234);
          doc.text(String(index + 1).padStart(2, "0"), margin + 1.1, y + 1.6);
          y = paragraph(step, y, { x: margin + 10, width: contentWidth - 10, fontSize: 9, gap: 5 });
        });
        y = heading("Cobertura de los campos", y + 2);
        const quality = qualitySummary(rows);
        y = addTable(["CAMPO", "DISPONIBLE", "FILAS CON DATO"], quality, margin, y, [72, 42, 56], { fontSize: 8, rowHeight: 9 });
        y = heading("Limitaciones de interpretación", y + 9);
        paragraph("MTBF y disponibilidad requieren horas efectivas de operación y ventanas de tiempo confiables. Jack-Knife es una herramienta de priorización relativa, no una probabilidad de falla. El costo representa los campos registrados, no necesariamente el costo total de ciclo de vida.", y, { fontSize: 9 });

        // 3. Distribución del mantenimiento
        newPage("Distribución e impacto del mantenimiento");
        y = 39;
        y = paragraph("La comparación de participaciones muestra cómo se distribuye el trabajo y permite detectar tipos con un peso desproporcionado en recursos, downtime o costo.", y, { fontSize: 9 });
        const typeSummary = totalsByType;
        const typeRows = typeSummary.map((item) => [
          item.type,
          formatInteger(item.orders),
          `${formatDecimal(item.orderPct, 1)}%`,
          `${formatDecimal(item.laborPct, 1)}%`,
          `${formatDecimal(item.downtimePct, 1)}%`,
          `${formatDecimal(item.costPct, 1)}%`,
        ]);
        y = addTable(["TIPO", "OT", "% OT", "% HH", "% DOWN", "% COSTO"], typeRows, margin, y + 2, [43, 23, 25, 25, 28, 29], { fontSize: 7.5, rowHeight: 9 });
        chartImage("mix", margin + 3, y + 5, contentWidth - 6, 98);
        y += 111;
        paragraph(`Lectura ejecutiva: el correctivo concentra ${correctives}. Contrastar estas proporciones con la criticidad de los equipos ayuda a ordenar la investigación y evitar decisiones basadas solo en volumen.`, y, { fontSize: 9 });

        // 4. Esfuerzo y downtime
        newPage("Esfuerzo y downtime");
        y = 39;
        y = paragraph(`La base registra ${formatDecimal(summary.labor, 1)} horas-hombre y ${formatDecimal(summary.downtime, 1)} horas de downtime. El esfuerzo mide trabajo asignado; el downtime refleja detención reportada y no implica, por sí solo, una medida formal de disponibilidad.`, y, { fontSize: 9 });
        y = heading("Distribución relativa por categoría", y + 4);
        chartImage("mix", margin + 3, y, contentWidth - 6, 100);
        y += 108;
        y = heading("Puntos para revisar en terreno", y);
        y = paragraph("• Separar tiempo efectivo de reparación, espera de repuestos y coordinación.\n• Contrastar horas imputadas con volumen y complejidad de las intervenciones.\n• Revisar equipos donde downtime y esfuerzo se concentran simultáneamente.", y, { fontSize: 9 });
        y = heading("Indicadores del correctivo", y + 3);
        addTable(["INDICADOR", "PARTICIPACIÓN"], [
          ["Órdenes de trabajo", `${formatDecimal(summary.correctives.orders, 1)}%`],
          ["Horas-hombre", `${formatDecimal(summary.correctives.labor, 1)}%`],
          ["Downtime", `${formatDecimal(summary.correctives.downtime, 1)}%`],
        ], margin, y, [85, 70], { fontSize: 8, rowHeight: 9 });

        // 5. Costos
        newPage("Costos directos y focos económicos");
        y = 39;
        y = paragraph(`El costo directo acumulado en los registros filtrados es ${formatCurrency(summary.cost)}. La distribución por tipo y modo de falla sirve para decidir dónde validar datos y profundizar el análisis económico.`, y, { fontSize: 9 });
        y = heading("Costo por tipo de mantenimiento", y + 3);
        chartImage("cost", margin + 16, y, contentWidth - 32, 91);
        y += 98;
        const costsByType = totalsByType.map((item) => [item.type, formatCurrency(item.cost), `${formatDecimal(item.costPct, 1)}%`]);
        y = addTable(["TIPO", "COSTO REGISTRADO", "% COSTO"], costsByType, margin, y + 1, [66, 65, 45], { fontSize: 8, rowHeight: 9 });
        y = heading("Modos de falla de mayor costo", y + 9);
        chartImage("paretoCost", margin + 1, y, contentWidth - 2, 79);
        y += 82;
        paragraph("Validar las imputaciones, eventos extremos y costos por intervención antes de aprobar inversiones. Un monto alto no demuestra por sí solo que una acción preventiva sea rentable.", y, { fontSize: 8.5 });

        // 6. MTTR
        newPage("Desempeño de reparación y MTTR");
        y = 39;
        y = paragraph(summary.mttr === null
          ? "No hay suficientes reparaciones correctivas cerradas con fechas válidas en el filtro actual para calcular el MTTR."
          : `El MTTR es ${formatDecimal(summary.mttr, 1)} horas y la mediana ${formatDecimal(summary.median, 1)} horas, calculados sobre ${formatInteger(summary.repairCount)} reparaciones válidas. La mediana representa el caso central; el promedio puede elevarse por reparaciones excepcionalmente prolongadas.`,
        y, { fontSize: 9 });
        y = heading("MTTR medio por tipo de equipo", y + 4);
        chartImage("mttr", margin + 1, y, contentWidth - 2, 104);
        y += 111;
        y = heading("Buenas prácticas de registro", y);
        paragraph("• Registrar marcas de inicio, diagnóstico, espera, reparación y cierre.\n• Verificar consistencia entre fechas, duración declarada y estado de la OT.\n• Considerar el número de observaciones al comparar tipos de equipos.\n• Revisar casos extremos y tiempos de espera antes de proponer cambios.", y, { fontSize: 9 });

        // 7. Pareto de frecuencia
        newPage("Modos de falla: frecuencia");
        y = 39;
        y = paragraph("El ordenamiento por eventos permite reconocer modos recurrentes y focalizar análisis de causa raíz. El acumulado es empírico: no se presupone una proporción universal de Pareto.", y, { fontSize: 9 });
        y = heading("Top 10 modos de falla por OT", y + 4);
        chartImage("paretoFrequency", margin + 1, y, contentWidth - 2, 132);
        y += 138;
        const freq = failureRanking(rows, "orders");
        addTable(["MODO DE FALLA", "OT", "% DEL TOTAL"], freq.slice(0, 8).map((item) => [
          shortLabel(item.label, 39),
          formatInteger(item.value),
          `${formatDecimal(summary.orders ? item.value / summary.orders * 100 : 0, 1)}%`,
        ]), margin, y, [106, 30, 40], { fontSize: 7.5, rowHeight: 8 });
        y += 84;
        paragraph("Confirmar que las etiquetas sean consistentes y suficientemente específicas antes de modificar la estrategia de mantenimiento.", y, { fontSize: 8.5 });

        // 8. Pareto de downtime
        newPage("Modos de falla: downtime");
        y = 39;
        y = paragraph("La frecuencia no representa toda la consecuencia. Los modos con mayor downtime pueden ser poco frecuentes, pero su impacto operacional justifica revisión prioritaria.", y, { fontSize: 9 });
        y = heading("Top 10 por horas de downtime", y + 4);
        chartImage("paretoDowntime", margin + 1, y, contentWidth - 2, 125);
        y += 132;
        const down = failureRanking(rows, "downtime");
        addTable(["MODO DE FALLA", "DOWNTIME (H)", "% DOWN"], down.slice(0, 8).map((item) => [
          shortLabel(item.label, 39),
          formatDecimal(item.value, 1),
          `${formatDecimal(summary.downtime ? item.value / summary.downtime * 100 : 0, 1)}%`,
        ]), margin, y, [106, 38, 32], { fontSize: 7.5, rowHeight: 8 });
        y += 82;
        paragraph("Investigar causas, restricciones de repuestos, diagnóstico y procedimientos; validar las detenciones más largas con operaciones.", y, { fontSize: 8.5 });

        // 9. Activos prioritarios
        newPage("Activos prioritarios");
        y = 39;
        y = paragraph("Ranking indicativo de equipos por downtime acumulado en el dataset filtrado. Se debe complementar con criticidad, impacto en producción y contexto operacional antes de aprobar recursos.", y, { fontSize: 9 });
        y = heading("Top 10 equipos por downtime", y + 3);
        y = addTable(["EQUIPO", "TIPO", "CRIT.", "OT", "DOWN (H)", "COSTO"], assets.map((item) => [
          shortLabel(item.label, 24),
          shortLabel(item.type, 15),
          item.criticality,
          formatInteger(item.orders),
          formatDecimal(item.downtime, 1),
          formatCurrency(item.cost),
        ]), margin, y, [47, 34, 19, 18, 27, 31], { fontSize: 6.7, rowHeight: 10 });
        y = heading("Recomendación de uso", y + 11);
        paragraph("Cruzar estos equipos con modos de falla de alta frecuencia, downtime y costo. Para cada foco confirmado, documentar hipótesis causal, responsable, acción, fecha objetivo y KPI de verificación.", y, { fontSize: 9 });
        y = heading("Priorización práctica", y + 4);
        addTable(["SEÑAL", "ORIENTACIÓN DE ANÁLISIS"], [
          ["Alta recurrencia", "Investigar causas repetitivas y tareas preventivas."],
          ["Alto downtime", "Revisar mantenibilidad, espera, repuestos y respuesta."],
          ["Alto costo", "Validar eventos e imputación económica."],
        ], margin, y, [48, 128], { fontSize: 8, rowHeight: 10 });

        // 10. Plan de acción y limitaciones
        newPage("Plan de mejora y conclusiones");
        y = 39;
        y = heading("Plan de trabajo propuesto", y);
        const actions = [
          ["01 · VALIDAR", "Revisar duplicados, etiquetas de falla, fechas, estados y valores extremos; confirmar el alcance temporal."],
          ["02 · ANALIZAR", "Seleccionar activos y modos relevantes; revisar historial técnico, criticidad, repuestos y contexto operacional."],
          ["03 · INTERVENIR", "Probar acciones de causa raíz con responsables, plazos, recursos y criterios de éxito definidos."],
          ["04 · VERIFICAR", "Seguir frecuencia, downtime, costo y MTTR mensualmente; comparar periodos equivalentes y ajustar."],
        ];
        actions.forEach(([label, text]) => {
          doc.setFillColor(238, 242, 246);
          doc.roundedRect(margin, y - 4, contentWidth, 21, 2, 2, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(47, 91, 234);
          doc.text(label, margin + 4, y + 2);
          y = paragraph(text, y + 7, { x: margin + 4, width: contentWidth - 8, fontSize: 8.5, gap: 2 });
          y += 6;
        });
        y = heading("Conclusión ejecutiva", y + 1);
        y = paragraph(`El mantenimiento correctivo concentra ${correctives}. La respuesta recomendada combina calidad de datos, investigación de causas, intervención priorizada y seguimiento verificable de resultados.`, y, { fontSize: 9 });
        y = heading("Limitaciones", y + 4);
        paragraph("La lectura depende de la completitud del CMMS. No se dispone de horas de operación para estimar formalmente MTBF o disponibilidad, ni de datos para atribuir causalidad económica. Los rankings orientan la revisión; no sustituyen la validación técnica.", y, { fontSize: 8.5 });
        doc.save(`Informe_Ejecutivo_GMAO_${safeFilename(state.sourceName)}.pdf`);
        showStatus("Informe ejecutivo PDF exportado correctamente (10 páginas).", "success");
      } catch (error) {
        console.error("Error al exportar el informe PDF:", error);
        showStatus(`No se pudo generar el PDF: ${error instanceof Error ? error.message : "error inesperado"}`, "error");
      } finally {
        setLoading(false);
      }
    }, 100);
  }

  function computeAssets(rows) {
    const groups = new Map();
    for (const row of rows) {
      const label = cleanValue(getValue(row, "equipment"));
      if (!label) continue;
      if (!groups.has(label)) {
        groups.set(label, {
          label,
          type: cleanValue(getValue(row, "equipmentType")) || "—",
          criticality: cleanValue(getValue(row, "criticality")) || "—",
          orderIds: new Set(),
          downtime: 0,
          cost: 0,
        });
      }
      const item = groups.get(label);
      const ot = cleanValue(getValue(row, "ot"));
      if (ot) item.orderIds.add(ot);
      item.downtime += valueNumber(row, "downtime") ?? 0;
      item.cost += metricValue(row, "cost");
    }
    return [...groups.values()].map(({ orderIds, ...item }) => ({ ...item, orders: orderIds.size }))
      .sort((a, b) => b.downtime - a.downtime);
  }

  function computeTypeSummary(rows) {
    const types = uniqueCategories(rows, "maintenanceType");
    const orders = uniqueCount(rows, "ot");
    const labor = numberSum(rows, "labor");
    const downtime = numberSum(rows, "downtime");
    const cost = rows.reduce((sum, row) => sum + metricValue(row, "cost"), 0);
    return types.map((type) => {
      const subset = rows.filter((row) => normalizedCategory(getValue(row, "maintenanceType")) === type);
      const typeOrders = uniqueCount(subset, "ot");
      const typeLabor = numberSum(subset, "labor");
      const typeDowntime = numberSum(subset, "downtime");
      const typeCost = subset.reduce((sum, row) => sum + metricValue(row, "cost"), 0);
      return {
        type,
        orders: typeOrders,
        labor: typeLabor,
        downtime: typeDowntime,
        cost: typeCost,
        orderPct: orders ? typeOrders / orders * 100 : 0,
        laborPct: labor ? typeLabor / labor * 100 : 0,
        downtimePct: downtime ? typeDowntime / downtime * 100 : 0,
        costPct: cost ? typeCost / cost * 100 : 0,
      };
    });
  }

  function qualitySummary(rows) {
    const definitions = [
      ["OT", "ot"],
      ["Tipo mantenimiento", "maintenanceType"],
      ["Equipo", "equipment"],
      ["Modo de falla", "failureMode"],
      ["Downtime", "downtime"],
      ["Costo", "totalCost"],
      ["Fecha de inicio", "start"],
      ["Fecha de término", "end"],
    ];
    return definitions.filter(([, key]) => state.columns[key]).map(([label, key]) => {
      const filled = rows.filter((row) => cleanValue(getValue(row, key))).length;
      return [label, `${rows.length ? Math.round(filled / rows.length * 100) : 0}%`, `${formatInteger(filled)} / ${formatInteger(rows.length)}`];
    });
  }

  function safeFilename(value) {
    return String(value || "dataset").replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 70) || "dataset";
  }

  function handleDrop(event) {
    event.preventDefault();
    elements.uploadPanel.classList.remove("dragover");
    const file = event.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  }

  function bindEvents() {
    elements.chooseFile.addEventListener("click", () => elements.fileInput.click());
    elements.replaceFile.addEventListener("click", () => elements.fileInput.click());
    elements.fileInput.addEventListener("change", (event) => loadFile(event.target.files?.[0]));
    elements.exportPdf.addEventListener("click", exportPdf);
    elements.clearFilters.addEventListener("click", clearFilters);
    [elements.year, elements.type, elements.area, elements.criticality].forEach((select) => {
      select.addEventListener("change", updateDashboard);
    });
    elements.uploadPanel.addEventListener("dragover", (event) => {
      event.preventDefault();
      elements.uploadPanel.classList.add("dragover");
    });
    elements.uploadPanel.addEventListener("dragleave", (event) => {
      if (!elements.uploadPanel.contains(event.relatedTarget)) elements.uploadPanel.classList.remove("dragover");
    });
    elements.uploadPanel.addEventListener("drop", handleDrop);
    window.addEventListener("hashchange", setNavActive);
  }

  bindEvents();
  setNavActive();
})();
