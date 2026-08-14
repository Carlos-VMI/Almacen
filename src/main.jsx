import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  Boxes,
  Building2,
  Cpu,
  Database,
  FileSpreadsheet,
  LayoutGrid,
  LogOut,
  PackagePlus,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from './supabaseClient';
import './styles.css';

const DEFAULT_SHELF_WIDTH_CM = 100;
const DEFAULT_TOTAL_LEDS = 60;
const DEFAULT_LED_DENSITY = 60;

const emptyWarehouse = { nombre: '', ubicacion: '', descripcion: '', ancho_estante_cm: DEFAULT_SHELF_WIDTH_CM };
const emptyArticle = {
  codigo_articulo: '',
  codigo_cliente: '',
  sku: '',
  descripcion: '',
  sufijos: [{ sufijo: '01', capacidad: '' }],
};
const emptyOperator = { nombre: '', email: '', rol: 'operario', pin: '', activo: true };
const emptyController = { nombre: '', ip: '', tipo_tira: 'WS2812B', leds_por_metro: DEFAULT_LED_DENSITY };
const emptyBoxType = { codigo: '', nombre: '', ancho_cm: '' };
const suffixOptions = ['01', '02', '03', '04'];
const PAGE_SIZE = 15;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampShelfCount(value) {
  return Math.min(8, Math.max(0, toNumber(value, 0)));
}

function readJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function calculateLedLayout({ cajones, shelfWidthCm, controller, channel }) {
  const width = Math.max(1, toNumber(shelfWidthCm, DEFAULT_SHELF_WIDTH_CM));
  const density = Math.max(0, toNumber(controller?.leds_por_metro, DEFAULT_LED_DENSITY)) / 100;
  let cursorCm = 0;

  return cajones.map((cajon, index) => {
    const anchoCm = Math.max(0, toNumber(cajon.ancho_cm, 0));
    const startLed = density > 0 ? Math.round(cursorCm * density) : 0;
    const endLed = density > 0 ? Math.round((cursorCm + anchoCm) * density) : 0;
    cursorCm += anchoCm;

    return {
      posicion: index + 1,
      etiqueta: `C${index + 1}`,
      cubeta_id: cajon.cubeta_id ?? null,
      cubeta_codigo: cajon.cubeta_codigo ?? cajon.codigo ?? `C${index + 1}`,
      nombre: cajon.nombre ?? cajon.cubeta_nombre ?? '',
      ancho_cm: anchoCm,
      controlador_id: controller?.id ?? null,
      esp32_ip: String(controller?.ip || '').trim(),
      canal: toNumber(channel, 1),
      startLed,
      ledCount: Math.max(0, endLed - startLed),
    };
  });
}

function normalizeShelfRecord(row, shelfWidthCm, module = {}, controllersById = new Map()) {
  const count = clampShelfCount(row?.cantidad_baldas);
  const width = Math.max(1, toNumber(shelfWidthCm, DEFAULT_SHELF_WIDTH_CM));
  const existing = readJsonArray(row?.cajones);
  const fallbackWidth = count > 0 ? Math.floor((width / count) * 10) / 10 : 0;
  const controller = controllersById.get(module?.controlador_id) ?? null;
  const cajones = Array.from({ length: count }, (_, index) => {
    const current = existing.find((item) => toNumber(item.posicion) === index + 1) ?? existing[index] ?? {};
    return {
      posicion: index + 1,
      etiqueta: `C${index + 1}`,
      cubeta_id: current.cubeta_id ?? null,
      cubeta_codigo: current.cubeta_codigo ?? current.codigo ?? `C${index + 1}`,
      nombre: current.nombre ?? current.cubeta_nombre ?? '',
      ancho_cm: toNumber(current.ancho_cm, fallbackWidth),
      controlador_id: current.controlador_id ?? module?.controlador_id ?? null,
      esp32_ip: String(current.esp32_ip || controller?.ip || row?.esp32_ip || '').trim(),
      canal: toNumber(current.canal ?? module?.canal_led, 1),
      startLed: toNumber(current.startLed, 0),
      ledCount: toNumber(current.ledCount, 0),
    };
  });

  return {
    cantidad_baldas: count,
    total_leds: toNumber(row?.total_leds, DEFAULT_TOTAL_LEDS),
    cajones,
  };
}

function buildShelfPayload(current, patch, shelfWidthCm, module = {}, controllersById = new Map()) {
  const base = {
    ...current,
    ...patch,
    cantidad_baldas: clampShelfCount(patch.cantidad_baldas ?? current.cantidad_baldas),
  };
  const width = Math.max(1, toNumber(shelfWidthCm, DEFAULT_SHELF_WIDTH_CM));
  const count = clampShelfCount(base.cantidad_baldas);
  const existing = readJsonArray(base.cajones);
  const fallbackWidth = count > 0 ? Math.floor((width / count) * 10) / 10 : 0;
  const cajones = Array.from({ length: count }, (_, index) => {
    const currentCajon = existing.find((item) => toNumber(item.posicion) === index + 1) ?? existing[index] ?? {};
    return {
      posicion: index + 1,
      cubeta_id: currentCajon.cubeta_id ?? null,
      cubeta_codigo: currentCajon.cubeta_codigo ?? currentCajon.codigo ?? `C${index + 1}`,
      nombre: currentCajon.nombre ?? currentCajon.cubeta_nombre ?? '',
      ancho_cm: toNumber(currentCajon.ancho_cm, fallbackWidth),
    };
  });
  const totalWidth = cajones.reduce((sum, item) => sum + toNumber(item.ancho_cm, 0), 0);

  if (totalWidth > width) {
    throw new Error(`El ancho de los cajones (${totalWidth} cm) supera el ancho del estante (${width} cm).`);
  }

  return {
    cantidad_baldas: count,
    total_leds: Math.max(0, toNumber(base.total_leds, DEFAULT_TOTAL_LEDS)),
    cajones: calculateLedLayout({
      cajones,
      shelfWidthCm: width,
      controller: controllersById.get(module?.controlador_id) ?? null,
      channel: module?.canal_led ?? 1,
    }),
  };
}

function nextModuleName(count) {
  return `Módulo ${count + 1}`;
}

async function ensureDefaultShelves(moduleId) {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    modulo_id: moduleId,
    numero: index + 1,
    cantidad_baldas: 0,
    total_leds: DEFAULT_TOTAL_LEDS,
    cajones: [],
  }));

  return supabase
    .from('almacen_estantes')
    .upsert(rows, { onConflict: 'modulo_id,numero' });
}

function normalizeSuffixes(value) {
  if (Array.isArray(value) && value.length) {
    return value.map((item, index) => ({
      sufijo: suffixOptions.includes(String(item.sufijo).padStart(2, '0'))
        ? String(item.sufijo).padStart(2, '0')
        : suffixOptions[Math.min(index, suffixOptions.length - 1)],
      capacidad: Math.max(0, toNumber(item.capacidad ?? item.cantidad, 0)),
    }));
  }

  return [{ sufijo: '01', capacidad: 1 }];
}

function normalizeFormSuffixes(value) {
  if (Array.isArray(value) && value.length) {
    return value.map((item, index) => ({
      sufijo: suffixOptions.includes(String(item.sufijo).padStart(2, '0'))
        ? String(item.sufijo).padStart(2, '0')
        : suffixOptions[Math.min(index, suffixOptions.length - 1)],
      capacidad: item.capacidad === '' || item.capacidad === null || item.capacidad === undefined
        ? ''
        : Math.max(0, toNumber(item.capacidad ?? item.cantidad, 0)),
    }));
  }

  return [{ sufijo: '01', capacidad: '' }];
}

function cloneEmptyArticle() {
  return { ...emptyArticle, sufijos: normalizeFormSuffixes(emptyArticle.sufijos) };
}

function PaginationControls({ page, totalItems, pageSize = PAGE_SIZE, onPageChange, label = 'registros' }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);

  if (totalItems <= pageSize) {
    return totalItems ? (
      <div className="pagination-bar compact">
        <span>{totalItems} {label}</span>
      </div>
    ) : null;
  }

  return (
    <div className="pagination-bar">
      <span>
        {start}-{end} de {totalItems} {label}
      </span>
      <div className="pagination-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          Anterior
        </button>
        <strong>{page} / {totalPages}</strong>
        <button
          className="secondary-button"
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function formatRole(value) {
  const role = String(value || '').toLowerCase();
  if (role === 'operador') return 'operario';
  if (role === 'admin') return 'administrador';
  return role;
}

function roleLabel(value) {
  const role = formatRole(value);
  if (role === 'administrador') return 'Administrador';
  if (role === 'repositor') return 'Repositor';
  return 'Operario';
}

function normalizeImportKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function readImportCell(row, names) {
  const normalizedRow = Object.entries(row).reduce((acc, [key, value]) => {
    acc[normalizeImportKey(key)] = value;
    return acc;
  }, {});

  for (const name of names) {
    const value = normalizedRow[normalizeImportKey(name)];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return '';
}

function buildImportRecords(rows, warehouseId) {
  const grouped = new Map();

  rows.forEach((row) => {
    const codigoArticulo = readImportCell(row, ['codigo_articulo', 'codigo articulo', 'código artículo']);
    const codigoCliente = readImportCell(row, ['codigo_cliente', 'codigo cliente', 'código cliente']);
    const descripcion = readImportCell(row, ['descripcion', 'descripción']);
    const sku = readImportCell(row, ['sku']);
    const suffix = readImportCell(row, ['sufijo']) || '01';
    const capacidad = readImportCell(row, ['capacidad', 'cantidad']);

    if (!codigoArticulo || !descripcion || !sku) return;

    const key = sku;
    const current = grouped.get(key) || {
      almacen_id: warehouseId,
      codigo_articulo: codigoArticulo,
      codigo_cliente: codigoCliente,
      descripcion,
      sku,
      sufijos: [],
    };

    const normalizedSuffix = suffixOptions.includes(String(suffix).padStart(2, '0'))
      ? String(suffix).padStart(2, '0')
      : suffixOptions[Math.min(current.sufijos.length, suffixOptions.length - 1)];

    if (!current.sufijos.some((item) => item.sufijo === normalizedSuffix)) {
      current.sufijos.push({
        sufijo: normalizedSuffix,
        capacidad: Math.max(0, toNumber(capacidad, 0)),
      });
    }

    grouped.set(key, current);
  });

  return Array.from(grouped.values()).map((record) => ({
    ...record,
    sufijos: normalizeSuffixes(record.sufijos),
  }));
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (loginError) {
      setError('Usuario o contraseña incorrectos.');
      return;
    }

    onLogin(data.session);
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-welcome">
          <div className="brand-mark">
            <Boxes size={30} />
          </div>
          <h1>Bienvenidos</h1>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            Usuario
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="usuario@empresa.com"
              autoComplete="email"
              required
            />
          </label>

          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Contraseña"
              autoComplete="current-password"
              required
            />
          </label>

          {error && <div className="error-box">{error}</div>}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  );
}

function Topbar({ session, selectedWarehouse, onBack }) {
  async function logout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <header className="topbar">
      <div className="topbar-title">
        {selectedWarehouse && (
          <button className="icon-button" type="button" onClick={onBack} aria-label="Volver">
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="brand-mark small">
          <Boxes size={22} />
        </div>
        <div>
          <span className="eyebrow">Sistema de stock</span>
          <h1>{selectedWarehouse ? selectedWarehouse.nombre : 'Bases de datos'}</h1>
        </div>
      </div>
      <div className="user-area">
        <span>{session.user.email}</span>
        <button className="secondary-button" onClick={logout}>
          <LogOut size={17} />
          Salir
        </button>
      </div>
    </header>
  );
}

function WarehouseList({ warehouses, onCreate, onUpdate, onOpen, onDelete, onDeleteSelected, loading, error }) {
  const [form, setForm] = useState(emptyWarehouse);
  const [editing, setEditing] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);

  async function submit(event) {
    event.preventDefault();
    if (editing) {
      await onUpdate(editing.id, form);
      setEditing(null);
    } else {
      await onCreate(form);
    }
    setForm(emptyWarehouse);
  }

  function startEdit(warehouse) {
    setEditing(warehouse);
    setForm({
      nombre: warehouse.nombre || '',
      ubicacion: warehouse.ubicacion || '',
      descripcion: warehouse.descripcion || '',
      ancho_estante_cm: toNumber(warehouse.ancho_estante_cm, DEFAULT_SHELF_WIDTH_CM),
    });
  }

  function cancelEdit() {
    setEditing(null);
    setForm(emptyWarehouse);
  }

  function toggleWarehouse(id) {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  }

  async function deleteSelectedWarehouses() {
    if (!selectedIds.length) return;
    await onDeleteSelected(selectedIds);
    setSelectedIds([]);
  }

  function editSelectedWarehouse() {
    if (selectedIds.length !== 1) return;
    const warehouse = warehouses.find((item) => item.id === selectedIds[0]);
    if (warehouse) startEdit(warehouse);
  }

  return (
    <div className="home-grid">
      <section className="form-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Nueva base</span>
            <h2>{editing ? 'Editar almacén' : 'Crear almacén'}</h2>
          </div>
          {editing ? (
            <button className="icon-button" type="button" onClick={cancelEdit} aria-label="Cancelar edición">
              <X size={18} />
            </button>
          ) : (
            <Database size={22} />
          )}
        </div>

        <form className="stack-form" onSubmit={submit}>
          <label>
            Nombre
            <input
              value={form.nombre}
              onChange={(event) => setForm({ ...form, nombre: event.target.value })}
              placeholder="Almacén Sevilla"
              required
            />
          </label>
          <label>
            Ubicación
            <input
              value={form.ubicacion}
              onChange={(event) => setForm({ ...form, ubicacion: event.target.value })}
              placeholder="Nave 1, Planta baja"
              required
            />
          </label>
          <label>
            Descripción
            <input
              value={form.descripcion}
              onChange={(event) => setForm({ ...form, descripcion: event.target.value })}
              placeholder="Repuestos, consumibles, herramientas..."
            />
          </label>
          <label>
            Ancho estante común (cm)
            <input
              type="text"
              inputMode="decimal"
              value={form.ancho_estante_cm}
              onChange={(event) => setForm({ ...form, ancho_estante_cm: event.target.value.replace(/[^0-9.]/g, '') })}
              placeholder="100"
            />
          </label>
          <button className="primary-button" type="submit">
            {editing ? <Save size={18} /> : <Plus size={18} />}
            {editing ? 'Guardar base' : 'Crear base'}
          </button>
        </form>
      </section>

      <section className="inventory-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Disponibles</span>
            <h2>Base de datos creadas</h2>
          </div>
          <span className="counter-pill">{warehouses.length}</span>
        </div>

        {error && <div className="error-box">{error}</div>}
        {loading ? (
          <div className="loading-box">Cargando bases...</div>
        ) : (
          <>
            <div className="icon-toolbar">
              <span>{selectedIds.length ? `${selectedIds.length} seleccionadas` : ''}</span>
              <button className="icon-button" type="button" onClick={editSelectedWarehouse} disabled={selectedIds.length !== 1} aria-label="Editar base seleccionada">
                <Pencil size={17} />
              </button>
              <button className="icon-button danger" type="button" onClick={deleteSelectedWarehouses} disabled={!selectedIds.length} aria-label="Eliminar bases seleccionadas">
                <Trash2 size={17} />
              </button>
            </div>
            <div className="warehouse-grid">
              {warehouses.map((warehouse) => (
                <article className="warehouse-card" key={warehouse.id}>
                  <button className="warehouse-check" type="button" onClick={() => toggleWarehouse(warehouse.id)} aria-label={`Seleccionar ${warehouse.nombre}`}>
                    {selectedIds.includes(warehouse.id) && <span />}
                  </button>
                  <button className="warehouse-open" type="button" onClick={() => onOpen(warehouse)}>
                    <div className="warehouse-icon">
                      <Building2 size={26} />
                    </div>
                    <div>
                      <strong>{warehouse.nombre}</strong>
                      <span>{warehouse.ubicacion}</span>
                      <small>Ancho estante: {toNumber(warehouse.ancho_estante_cm, DEFAULT_SHELF_WIDTH_CM)} cm</small>
                      {warehouse.descripcion && <small>{warehouse.descripcion}</small>}
                    </div>
                  </button>
                </article>
              ))}
              {!warehouses.length && (
                <div className="empty-state compact">
                  <Database size={30} />
                  <h2>No hay bases creadas</h2>
                  <p>Crea la primera base para empezar a configurar artículos y estanterías.</p>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ArticleManager({ warehouse, refreshKey }) {
  const [articles, setArticles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(cloneEmptyArticle);
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadArticles();
  }, [warehouse.id, refreshKey]);

  useEffect(() => {
    setPage(1);
  }, [warehouse.id, query]);

  useEffect(() => {
    setForm(selected ? { ...selected, sufijos: normalizeFormSuffixes(selected.sufijos) } : cloneEmptyArticle());
  }, [selected]);

  async function loadArticles() {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('almacen_articulos')
      .select('*')
      .eq('almacen_id', warehouse.id)
      .order('created_at', { ascending: false });
    setLoading(false);

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setArticles(data || []);
    setError('');
  }

  async function saveArticle(event) {
    event.preventDefault();
    const suffixes = normalizeSuffixes(form.sufijos);
    const repeatedSuffix = suffixes.some((suffix, index) => (
      suffixes.findIndex((item) => item.sufijo === suffix.sufijo) !== index
    ));

    if (repeatedSuffix) {
      setError('No puedes repetir el mismo sufijo en un artículo.');
      return;
    }

    const record = {
      almacen_id: warehouse.id,
      codigo_articulo: form.codigo_articulo.trim(),
      codigo_cliente: form.codigo_cliente.trim(),
      sku: form.sku.trim(),
      descripcion: form.descripcion.trim(),
      sufijos: suffixes,
    };

    const request = selected?.id
      ? supabase.from('almacen_articulos').update(record).eq('id', selected.id)
      : supabase.from('almacen_articulos').insert(record);
    const { error: saveError } = await request;

    if (saveError) {
      setError(saveError.message);
      return;
    }
    setSelected(null);
    setForm(cloneEmptyArticle());
    loadArticles();
  }

  async function deleteArticle(article) {
    if (!window.confirm(`Eliminar el artículo "${article.descripcion}"? Esta acción no se puede deshacer.`)) return;
    const { error: deleteError } = await supabase.from('almacen_articulos').delete().eq('id', article.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    loadArticles();
  }

  async function deleteSelectedArticles() {
    if (!selectedIds.length) return;
    if (!window.confirm(`Eliminar ${selectedIds.length} artículos seleccionados? Esta acción no se puede deshacer.`)) return;
    const { error: deleteError } = await supabase.from('almacen_articulos').delete().in('id', selectedIds);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setSelectedIds([]);
    setSelected(null);
    loadArticles();
  }

  function toggleArticle(id) {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  }

  function toggleAllArticles() {
    const visibleIds = paginatedArticles.map((article) => article.id);
    setSelectedIds((current) => (
      visibleIds.every((id) => current.includes(id))
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds]))
    ));
  }

  function updateSuffix(index, field, value) {
    setForm((current) => ({
      ...current,
      sufijos: normalizeFormSuffixes(current.sufijos).map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      )),
    }));
  }

  function addSuffix() {
    setForm((current) => {
      const currentSuffixes = normalizeFormSuffixes(current.sufijos);
      const used = currentSuffixes.map((item) => item.sufijo);
      const nextSuffix = suffixOptions.find((option) => !used.includes(option));
      if (!nextSuffix) return current;
      return {
        ...current,
        sufijos: [...currentSuffixes, { sufijo: nextSuffix, capacidad: '' }],
      };
    });
  }

  function removeSuffix(index) {
    setForm((current) => {
      const currentSuffixes = normalizeFormSuffixes(current.sufijos);
      if (currentSuffixes.length === 1) return current;
      return { ...current, sufijos: currentSuffixes.filter((_, itemIndex) => itemIndex !== index) };
    });
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return articles;
    return articles.filter((article) =>
      [article.codigo_articulo, article.codigo_cliente, article.sku, article.descripcion]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle))
    );
  }, [articles, query]);
  const totalArticlePages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safeArticlePage = Math.min(page, totalArticlePages);
  const paginatedArticles = filtered.slice((safeArticlePage - 1) * PAGE_SIZE, safeArticlePage * PAGE_SIZE);

  return (
    <div className="content-grid">
      <section className="form-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Artículos</span>
            <h2>{selected ? 'Editar artículo' : 'Alta de artículo'}</h2>
          </div>
          {selected && (
            <button className="icon-button" type="button" onClick={() => setSelected(null)} aria-label="Cancelar">
              <X size={18} />
            </button>
          )}
        </div>

        <form className="article-form" onSubmit={saveArticle}>
          <label>
            Código de artículo
            <input value={form.codigo_articulo} onChange={(event) => setForm({ ...form, codigo_articulo: event.target.value })} required />
          </label>
          <label>
            Código de cliente
            <input value={form.codigo_cliente || ''} onChange={(event) => setForm({ ...form, codigo_cliente: event.target.value })} />
          </label>
          <label className="wide-field">
            Descripción
            <input value={form.descripcion} onChange={(event) => setForm({ ...form, descripcion: event.target.value })} required />
          </label>
          <div className="sku-suffix-panel">
            <div className="suffix-head">
              <label>
                SKU
                <input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} required />
              </label>
              <button className="secondary-button suffix-add" type="button" onClick={addSuffix} disabled={normalizeFormSuffixes(form.sufijos).length >= suffixOptions.length}>
                <Plus size={17} />
                Sufijo
              </button>
            </div>
            <div className="suffix-list">
              {normalizeFormSuffixes(form.sufijos).map((suffix, index) => (
                <div className="suffix-row" key={`${suffix.sufijo}-${index}`}>
                  <div className="suffix-fixed">
                    <span>Sufijo</span>
                    <strong>{suffix.sufijo}</strong>
                  </div>
                  <label>
                    Capacidad
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={suffix.capacidad}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => updateSuffix(index, 'capacidad', event.target.value.replace(/\D/g, ''))}
                      required
                    />
                  </label>
                  <button
                    className="icon-button danger suffix-remove"
                    type="button"
                    onClick={() => removeSuffix(index)}
                    aria-label="Quitar sufijo"
                    disabled={normalizeFormSuffixes(form.sufijos).length === 1}
                  >
                    <X size={17} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button className="primary-button wide-field" type="submit">
            <Save size={18} />
            {selected ? 'Guardar cambios' : 'Crear artículo'}
          </button>
        </form>
      </section>

      <section className="inventory-panel">
        <div className="panel-heading inventory-heading">
          <div>
            <span className="eyebrow">Inventario</span>
            <h2>Artículos configurados</h2>
          </div>
          <div className="search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar..." />
          </div>
        </div>
        {error && <div className="error-box">{error}</div>}
        {loading ? <div className="loading-box">Cargando artículos...</div> : (
          <div className="table-panel">
            <table>
              <thead>
                <tr>
                  <th className="select-cell">
                    <input
                      type="checkbox"
                      checked={paginatedArticles.length > 0 && paginatedArticles.every((article) => selectedIds.includes(article.id))}
                      onChange={toggleAllArticles}
                      aria-label="Seleccionar artículos de esta página"
                    />
                  </th>
                  <th>Código artículo</th>
                  <th>Código cliente</th>
                  <th>Descripción</th>
                  <th>SKU + sufijo</th>
                  <th>Capacidad</th>
                  <th>Total</th>
                  <th className="action-cell">
                    <button className="icon-button danger" type="button" onClick={deleteSelectedArticles} disabled={!selectedIds.length} aria-label="Eliminar artículos seleccionados">
                      <Trash2 size={17} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedArticles.map((article) => (
                  <tr key={article.id}>
                    <td className="select-cell">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(article.id)}
                        onChange={() => toggleArticle(article.id)}
                        aria-label={`Seleccionar ${article.descripcion}`}
                      />
                    </td>
                    <td>{article.codigo_articulo}</td>
                    <td>{article.codigo_cliente || '-'}</td>
                    <td>{article.descripcion}</td>
                    <td>
                      <div className="sku-lines">
                        {normalizeSuffixes(article.sufijos).map((suffix, index) => (
                          <span key={`${article.id}-${suffix.sufijo}-${index}`}>{article.sku}-{suffix.sufijo}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="capacity-lines">
                        {normalizeSuffixes(article.sufijos).map((suffix, index) => (
                          <span key={`${article.id}-cap-${suffix.sufijo}-${index}`}>{suffix.capacidad}</span>
                        ))}
                      </div>
                    </td>
                    <td><strong>{normalizeSuffixes(article.sufijos).reduce((sum, suffix) => sum + toNumber(suffix.capacidad, 0), 0)}</strong></td>
                    <td className="row-actions">
                      <button className="icon-button" type="button" onClick={() => setSelected(article)} aria-label="Editar"><Pencil size={17} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationControls
              page={safeArticlePage}
              totalItems={filtered.length}
              onPageChange={setPage}
              label="artículos"
            />
            {!filtered.length && <div className="empty-inline">No hay artículos para mostrar.</div>}
          </div>
        )}
      </section>
    </div>
  );
}

function OperatorsManager({ warehouse }) {
  const [operators, setOperators] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyOperator);
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    loadOperators();
  }, [warehouse.id]);

  useEffect(() => {
    setPage(1);
  }, [warehouse.id]);

  useEffect(() => {
    setForm(selected ? { ...selected, rol: formatRole(selected.rol) } : emptyOperator);
  }, [selected]);

  async function loadOperators() {
    const { data, error: loadError } = await supabase
      .from('almacen_operadores')
      .select('*')
      .eq('almacen_id', warehouse.id)
      .order('created_at', { ascending: false });

    if (loadError) setError(loadError.message);
    else {
      setOperators(data || []);
      setError('');
    }
  }

  async function saveOperator(event) {
    event.preventDefault();
    const record = {
      almacen_id: warehouse.id,
      nombre: form.nombre.trim(),
      email: form.email.trim(),
      rol: form.rol,
      pin: form.pin.trim(),
      activo: Boolean(form.activo),
    };

    const request = selected?.id
      ? supabase.from('almacen_operadores').update(record).eq('id', selected.id)
      : supabase.from('almacen_operadores').insert(record);
    const { error: saveError } = await request;

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setSelected(null);
    setForm(emptyOperator);
    loadOperators();
  }

  async function deleteSelectedOperators() {
    if (!selectedIds.length) return;
    if (!window.confirm(`Eliminar ${selectedIds.length} usuarios seleccionados? Esta acción no se puede deshacer.`)) return;
    const { error: deleteError } = await supabase.from('almacen_operadores').delete().in('id', selectedIds);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setSelectedIds([]);
    setSelected(null);
    loadOperators();
  }

  function toggleOperator(id) {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  }

  function toggleAllOperators() {
    const visibleIds = paginatedOperators.map((operator) => operator.id);
    setSelectedIds((current) => (
      visibleIds.every((id) => current.includes(id))
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds]))
    ));
  }

  const totalOperatorPages = Math.max(1, Math.ceil(operators.length / PAGE_SIZE));
  const safeOperatorPage = Math.min(page, totalOperatorPages);
  const paginatedOperators = operators.slice((safeOperatorPage - 1) * PAGE_SIZE, safeOperatorPage * PAGE_SIZE);

  return (
    <div className="content-grid">
      <section className="form-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Usuarios app local</span>
            <h2>{selected ? 'Editar usuario' : 'Alta de usuario'}</h2>
          </div>
          <UserPlus size={22} />
        </div>

        <form className="stack-form" onSubmit={saveOperator}>
          <label>
            Nombre
            <input value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} required />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </label>
          <label>
            Rol
            <select value={form.rol} onChange={(event) => setForm({ ...form, rol: event.target.value })}>
              <option value="administrador">Administrador</option>
              <option value="repositor">Repositor</option>
              <option value="operario">Operario</option>
            </select>
          </label>
          <label>
            PIN para app local
            <input value={form.pin} onChange={(event) => setForm({ ...form, pin: event.target.value })} placeholder="Opcional" />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={form.activo} onChange={(event) => setForm({ ...form, activo: event.target.checked })} />
            Usuario activo
          </label>
          <button className="primary-button" type="submit">
            <Save size={18} />
            Guardar usuario
          </button>
        </form>
      </section>

      <section className="inventory-panel">
        <div className="panel-heading inventory-heading">
          <div>
            <span className="eyebrow">Operación</span>
            <h2>Usuarios habilitados</h2>
          </div>
          <div className="heading-actions">
            <span className="counter-pill">{operators.length}</span>
            <button className="icon-button danger" type="button" onClick={deleteSelectedOperators} disabled={!selectedIds.length} aria-label="Eliminar usuarios seleccionados">
              <Trash2 size={17} />
            </button>
          </div>
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="table-panel">
          <table>
            <thead>
              <tr>
                <th className="select-cell">
                  <input
                    type="checkbox"
                    checked={paginatedOperators.length > 0 && paginatedOperators.every((operator) => selectedIds.includes(operator.id))}
                    onChange={toggleAllOperators}
                    aria-label="Seleccionar usuarios de esta página"
                  />
                </th>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paginatedOperators.map((operator) => (
                <tr key={operator.id}>
                  <td className="select-cell">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(operator.id)}
                      onChange={() => toggleOperator(operator.id)}
                      aria-label={`Seleccionar ${operator.nombre}`}
                    />
                  </td>
                  <td>{operator.nombre}</td>
                  <td>{operator.email}</td>
                  <td>{roleLabel(operator.rol)}</td>
                  <td>{operator.activo ? 'Activo' : 'Inactivo'}</td>
                  <td className="row-actions">
                    <button className="icon-button" type="button" onClick={() => setSelected(operator)} aria-label="Editar"><Pencil size={17} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationControls
            page={safeOperatorPage}
            totalItems={operators.length}
            onPageChange={setPage}
            label="usuarios"
          />
          {!operators.length && <div className="empty-inline">Todavía no hay usuarios operativos.</div>}
        </div>
      </section>
    </div>
  );
}

function IoTControllersManager({ warehouse }) {
  const [controllers, setControllers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyController);
  const [error, setError] = useState('');

  useEffect(() => {
    loadControllers();
  }, [warehouse.id]);

  useEffect(() => {
    setForm(selected ? {
      nombre: selected.nombre || '',
      ip: selected.ip || '',
      tipo_tira: selected.tipo_tira || 'WS2812B',
      leds_por_metro: selected.leds_por_metro || DEFAULT_LED_DENSITY,
    } : emptyController);
  }, [selected]);

  async function loadControllers() {
    const { data, error: loadError } = await supabase
      .from('almacen_iot_controladores')
      .select('*')
      .eq('almacen_id', warehouse.id)
      .order('created_at', { ascending: false });

    if (loadError) setError(loadError.message);
    else {
      setControllers(data || []);
      setError('');
    }
  }

  async function saveController(event) {
    event.preventDefault();
    const record = {
      almacen_id: warehouse.id,
      nombre: form.nombre.trim(),
      ip: form.ip.trim(),
      tipo_tira: form.tipo_tira,
      leds_por_metro: Math.max(1, toNumber(form.leds_por_metro, DEFAULT_LED_DENSITY)),
    };

    const request = selected?.id
      ? supabase.from('almacen_iot_controladores').update(record).eq('id', selected.id)
      : supabase.from('almacen_iot_controladores').insert(record);
    const { error: saveError } = await request;

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setSelected(null);
    setForm(emptyController);
    loadControllers();
  }

  async function deleteController(controller) {
    if (!window.confirm(`Eliminar el controlador "${controller.nombre}"? Los módulos que lo usen quedarán sin hardware asignado.`)) return;
    const { error: deleteError } = await supabase
      .from('almacen_iot_controladores')
      .delete()
      .eq('id', controller.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    if (selected?.id === controller.id) setSelected(null);
    loadControllers();
  }

  return (
    <div className="content-grid">
      <section className="form-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Hardware</span>
            <h2>{selected ? 'Editar controlador IoT' : 'Nuevo controlador IoT'}</h2>
          </div>
          <Cpu size={22} />
        </div>
        <form className="stack-form" onSubmit={saveController}>
          <label>
            ID / Nombre
            <input value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} placeholder="ESP32 - Pasillo A" required />
          </label>
          <label>
            IP de red
            <input value={form.ip} onChange={(event) => setForm({ ...form, ip: event.target.value })} placeholder="192.168.1.50" required />
          </label>
          <label>
            Tipo de tira LED
            <select value={form.tipo_tira} onChange={(event) => setForm({ ...form, tipo_tira: event.target.value })}>
              <option value="WS2812B">WS2812B</option>
              <option value="WS2815">WS2815</option>
            </select>
          </label>
          <label>
            Densidad LED
            <input type="text" inputMode="numeric" value={form.leds_por_metro} onChange={(event) => setForm({ ...form, leds_por_metro: event.target.value.replace(/\D/g, '') })} placeholder="60" required />
            <small>LEDs por metro. Cada controlador tiene 4 canales disponibles.</small>
          </label>
          <button className="primary-button" type="submit">
            <Save size={18} />
            {selected ? 'Guardar controlador' : 'Crear controlador'}
          </button>
        </form>
      </section>
      <section className="inventory-panel">
        <div className="panel-heading inventory-heading">
          <div>
            <span className="eyebrow">Controladores</span>
            <h2>Gestión de Controladores IoT</h2>
          </div>
          <span className="counter-pill">{controllers.length}</span>
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="cards-list">
          {controllers.map((controller) => (
            <article className="config-card" key={controller.id}>
              <div>
                <strong>{controller.nombre}</strong>
                <span>{controller.ip} · {controller.tipo_tira} · {controller.leds_por_metro} LED/m</span>
                <small>Canales disponibles: 1, 2, 3, 4</small>
              </div>
              <div className="row-actions">
                <button className="icon-button" type="button" onClick={() => setSelected(controller)} aria-label="Editar controlador"><Pencil size={17} /></button>
                <button className="icon-button danger" type="button" onClick={() => deleteController(controller)} aria-label="Eliminar controlador"><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
          {!controllers.length && <div className="empty-inline">Todavía no hay controladores configurados.</div>}
        </div>
      </section>
    </div>
  );
}

function BoxCatalogManager({ warehouse }) {
  const [boxTypes, setBoxTypes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyBoxType);
  const [error, setError] = useState('');

  useEffect(() => {
    loadBoxTypes();
  }, [warehouse.id]);

  useEffect(() => {
    setForm(selected ? {
      codigo: selected.codigo || '',
      nombre: selected.nombre || '',
      ancho_cm: selected.ancho_cm || '',
    } : emptyBoxType);
  }, [selected]);

  async function loadBoxTypes() {
    const { data, error: loadError } = await supabase
      .from('almacen_cubetas_catalogo')
      .select('*')
      .eq('almacen_id', warehouse.id)
      .order('codigo', { ascending: true });
    if (loadError) setError(loadError.message);
    else {
      setBoxTypes(data || []);
      setError('');
    }
  }

  async function saveBoxType(event) {
    event.preventDefault();
    const record = {
      almacen_id: warehouse.id,
      codigo: form.codigo.trim().toUpperCase(),
      nombre: form.nombre.trim(),
      ancho_cm: Math.max(1, toNumber(form.ancho_cm, 0)),
    };
    const request = selected?.id
      ? supabase.from('almacen_cubetas_catalogo').update(record).eq('id', selected.id)
      : supabase.from('almacen_cubetas_catalogo').insert(record);
    const { error: saveError } = await request;
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setSelected(null);
    setForm(emptyBoxType);
    loadBoxTypes();
  }

  async function deleteBoxType(boxType) {
    if (!window.confirm(`Eliminar la cubeta "${boxType.codigo}" del catálogo?`)) return;
    const { error: deleteError } = await supabase.from('almacen_cubetas_catalogo').delete().eq('id', boxType.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    if (selected?.id === boxType.id) setSelected(null);
    loadBoxTypes();
  }

  return (
    <div className="content-grid">
      <section className="form-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Catálogo</span>
            <h2>{selected ? 'Editar cubeta' : 'Nueva cubeta estándar'}</h2>
          </div>
          <Boxes size={22} />
        </div>
        <form className="stack-form" onSubmit={saveBoxType}>
          <label>
            ID
            <input value={form.codigo} onChange={(event) => setForm({ ...form, codigo: event.target.value })} placeholder="C1" required />
          </label>
          <label>
            Nombre
            <input value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} placeholder="Pequeña" required />
          </label>
          <label>
            Ancho físico
            <input type="text" inputMode="decimal" value={form.ancho_cm} onChange={(event) => setForm({ ...form, ancho_cm: event.target.value.replace(/[^0-9.]/g, '') })} placeholder="12" required />
            <small>cm</small>
          </label>
          <button className="primary-button" type="submit">
            <Save size={18} />
            {selected ? 'Guardar cubeta' : 'Crear cubeta'}
          </button>
        </form>
      </section>
      <section className="inventory-panel">
        <div className="panel-heading inventory-heading">
          <div>
            <span className="eyebrow">Cubetas</span>
            <h2>Catálogo de Cubetas/Cajas</h2>
          </div>
          <span className="counter-pill">{boxTypes.length}</span>
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="cards-list">
          {boxTypes.map((boxType) => (
            <article className="config-card" key={boxType.id}>
              <div>
                <strong>{boxType.codigo} · {boxType.nombre}</strong>
                <span>{boxType.ancho_cm} cm</span>
              </div>
              <div className="row-actions">
                <button className="icon-button" type="button" onClick={() => setSelected(boxType)} aria-label="Editar cubeta"><Pencil size={17} /></button>
                <button className="icon-button danger" type="button" onClick={() => deleteBoxType(boxType)} aria-label="Eliminar cubeta"><Trash2 size={17} /></button>
              </div>
            </article>
          ))}
          {!boxTypes.length && <div className="empty-inline">Crea cubetas estándar para construir las baldas.</div>}
        </div>
      </section>
    </div>
  );
}

function ShelvingManager({ warehouse }) {
  const [modules, setModules] = useState([]);
  const [shelves, setShelves] = useState({});
  const [controllers, setControllers] = useState([]);
  const [boxTypes, setBoxTypes] = useState([]);
  const [selectedModuleIds, setSelectedModuleIds] = useState([]);
  const [editingModuleIds, setEditingModuleIds] = useState([]);
  const [defaultWidthCm, setDefaultWidthCm] = useState(toNumber(warehouse.ancho_estante_cm, DEFAULT_SHELF_WIDTH_CM));
  const [error, setError] = useState('');

  useEffect(() => {
    setDefaultWidthCm(toNumber(warehouse.ancho_estante_cm, DEFAULT_SHELF_WIDTH_CM));
    loadLayout();
  }, [warehouse.id]);

  const controllersById = useMemo(() => new Map(controllers.map((controller) => [controller.id, controller])), [controllers]);

  function moduleShelfWidth(module) {
    return Math.max(1, toNumber(module.ancho_estante_cm, defaultWidthCm || DEFAULT_SHELF_WIDTH_CM));
  }

  async function loadLayout() {
    const [{ data: controllerData, error: controllerError }, { data: boxData, error: boxError }] = await Promise.all([
      supabase
        .from('almacen_iot_controladores')
        .select('*')
        .eq('almacen_id', warehouse.id)
        .order('nombre', { ascending: true }),
      supabase
        .from('almacen_cubetas_catalogo')
        .select('*')
        .eq('almacen_id', warehouse.id)
        .order('codigo', { ascending: true }),
    ]);

    if (controllerError || boxError) {
      setError(controllerError?.message || boxError?.message);
      return;
    }

    const loadedControllers = controllerData || [];
    setControllers(loadedControllers);
    setBoxTypes(boxData || []);
    const loadedControllersById = new Map(loadedControllers.map((controller) => [controller.id, controller]));

    const { data: moduleData, error: moduleError } = await supabase
      .from('almacen_modulos')
      .select('*')
      .eq('almacen_id', warehouse.id)
      .order('orden', { ascending: true });

    if (moduleError) {
      setError(moduleError.message);
      return;
    }

    let currentModules = moduleData || [];
    if (!currentModules.length) {
      const { data: created, error: createError } = await supabase
        .from('almacen_modulos')
        .insert({ almacen_id: warehouse.id, nombre: 'Módulo 1', orden: 1, canal_led: 1 })
        .select()
        .single();
      if (createError) {
        setError(createError.message);
        return;
      }
      const { error: shelfCreateError } = await ensureDefaultShelves(created.id);
      if (shelfCreateError) {
        setError(shelfCreateError.message);
        return;
      }
      currentModules = [created];
    }

    const moduleIds = currentModules.map((module) => module.id);
    const { data: shelfData, error: shelfError } = await supabase
      .from('almacen_estantes')
      .select('*')
      .in('modulo_id', moduleIds)
      .order('numero', { ascending: true });

    if (shelfError) {
      setError(shelfError.message);
      return;
    }

    setModules(currentModules);
    setSelectedModuleIds((current) => current.filter((id) => currentModules.some((module) => module.id === id)));
    setEditingModuleIds((current) => current.filter((id) => currentModules.some((module) => module.id === id)));
    setShelves(
      (shelfData || []).reduce((acc, shelf) => {
        const module = currentModules.find((item) => item.id === shelf.modulo_id);
        acc[`${shelf.modulo_id}-${shelf.numero}`] = normalizeShelfRecord(
          shelf,
          module?.ancho_estante_cm || defaultWidthCm,
          module,
          loadedControllersById
        );
        return acc;
      }, {})
    );
    setError('');
  }

  async function saveDefaultWidth() {
    const width = Math.max(1, toNumber(defaultWidthCm, DEFAULT_SHELF_WIDTH_CM));
    const { error: saveError } = await supabase
      .from('almacen_bases')
      .update({ ancho_estante_cm: width })
      .eq('id', warehouse.id);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setDefaultWidthCm(width);
    setError('');
  }

  async function addModule() {
    const { data: created, error: createError } = await supabase
      .from('almacen_modulos')
      .insert({
        almacen_id: warehouse.id,
        nombre: nextModuleName(modules.length),
        orden: modules.length + 1,
        canal_led: 1,
      })
      .select()
      .single();
    if (createError) {
      setError(createError.message);
      return;
    }

    const { error: shelfCreateError } = await ensureDefaultShelves(created.id);
    if (shelfCreateError) {
      setError(shelfCreateError.message);
      return;
    }
    loadLayout();
  }

  async function normalizeModuleOrder() {
    const { data, error: loadError } = await supabase
      .from('almacen_modulos')
      .select('*')
      .eq('almacen_id', warehouse.id)
      .order('orden', { ascending: true });

    if (loadError) {
      setError(loadError.message);
      return false;
    }

    for (const [index, module] of (data || []).entries()) {
      const { error: updateError } = await supabase
        .from('almacen_modulos')
        .update({ nombre: `Módulo ${index + 1}`, orden: index + 1 })
        .eq('id', module.id);

      if (updateError) {
        setError(updateError.message);
        return false;
      }
    }

    return true;
  }

  function toggleModule(id) {
    setSelectedModuleIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  }

  async function updateModuleWidth(moduleId, value) {
    if (!editingModuleIds.includes(moduleId)) return;
    const width = Math.max(1, toNumber(value, defaultWidthCm || DEFAULT_SHELF_WIDTH_CM));
    const { error: updateError } = await supabase
      .from('almacen_modulos')
      .update({ ancho_estante_cm: width })
      .eq('id', moduleId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setModules((current) => current.map((module) => (
      module.id === moduleId ? { ...module, ancho_estante_cm: width } : module
    )));
    setError('');
  }

  async function updateModuleHardware(moduleId, patch) {
    if (!editingModuleIds.includes(moduleId)) return;
    const record = {
      ...patch,
      canal_led: patch.canal_led ? Math.min(4, Math.max(1, toNumber(patch.canal_led, 1))) : patch.canal_led,
    };
    const { error: updateError } = await supabase
      .from('almacen_modulos')
      .update(record)
      .eq('id', moduleId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setModules((current) => current.map((module) => (
      module.id === moduleId ? { ...module, ...record } : module
    )));
    setError('');
  }

  async function removeModule() {
    if (!selectedModuleIds.length) return;
    if (selectedModuleIds.length >= modules.length) {
      setError('Debe quedar al menos un módulo configurado.');
      return;
    }
    if (!window.confirm(`Quitar ${selectedModuleIds.length} módulos seleccionados? Se perderá su configuración de estantes.`)) return;
    const { error: shelfDeleteError } = await supabase.from('almacen_estantes').delete().in('modulo_id', selectedModuleIds);
    if (shelfDeleteError) {
      setError(shelfDeleteError.message);
      return;
    }

    const { error: deleteError } = await supabase.from('almacen_modulos').delete().in('id', selectedModuleIds);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setSelectedModuleIds([]);
    setEditingModuleIds((current) => current.filter((id) => !selectedModuleIds.includes(id)));
    await normalizeModuleOrder();
    loadLayout();
  }

  async function saveShelf(moduleId, numero, patch) {
    if (!editingModuleIds.includes(moduleId)) return;
    const module = modules.find((item) => item.id === moduleId);
    const key = `${moduleId}-${numero}`;
    const current = shelves[key] || normalizeShelfRecord({ cantidad_baldas: 0 }, moduleShelfWidth(module || {}));
    let payload;

    try {
      payload = buildShelfPayload(current, patch, moduleShelfWidth(module || {}), module, controllersById);
    } catch (validationError) {
      setError(validationError.message);
      return;
    }

    const { error: saveError } = await supabase
      .from('almacen_estantes')
      .upsert(
        {
          modulo_id: moduleId,
          numero,
          ...payload,
        },
        { onConflict: 'modulo_id,numero' }
      );

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setShelves((currentShelves) => ({ ...currentShelves, [key]: payload }));
    setError('');
  }

  function editSelectedModules() {
    if (!selectedModuleIds.length) return;
    setEditingModuleIds((current) => Array.from(new Set([...current, ...selectedModuleIds])));
    setError('');
  }

  async function saveSelectedModules() {
    if (!selectedModuleIds.length) return;
    for (const moduleId of selectedModuleIds) {
      const module = modules.find((item) => item.id === moduleId);
      if (!module) continue;
      for (let numero = 1; numero <= 8; numero += 1) {
        const key = `${moduleId}-${numero}`;
        const current = shelves[key] || normalizeShelfRecord({ cantidad_baldas: 0 }, moduleShelfWidth(module), module, controllersById);
        await saveShelf(moduleId, numero, { cajones: current.cajones });
      }
    }
    setEditingModuleIds((current) => current.filter((id) => !selectedModuleIds.includes(id)));
    setSelectedModuleIds([]);
    setError('');
  }

  function addBoxToShelf(moduleId, numero, boxTypeId) {
    const boxType = boxTypes.find((item) => item.id === boxTypeId);
    if (!boxType) return;
    const module = modules.find((item) => item.id === moduleId);
    const key = `${moduleId}-${numero}`;
    const current = shelves[key] || normalizeShelfRecord({ cantidad_baldas: 0 }, moduleShelfWidth(module || {}), module, controllersById);
    const nextCajones = [
      ...current.cajones,
      {
        posicion: current.cajones.length + 1,
        cubeta_id: boxType.id,
        cubeta_codigo: boxType.codigo,
        nombre: boxType.nombre,
        ancho_cm: toNumber(boxType.ancho_cm, 0),
      },
    ].slice(0, 8);

    saveShelf(moduleId, numero, {
      cantidad_baldas: nextCajones.length,
      cajones: nextCajones,
    });
  }

  function removeLastBoxFromShelf(moduleId, numero) {
    const module = modules.find((item) => item.id === moduleId);
    const key = `${moduleId}-${numero}`;
    const current = shelves[key] || normalizeShelfRecord({ cantidad_baldas: 0 }, moduleShelfWidth(module || {}), module, controllersById);
    const nextCajones = current.cajones.slice(0, -1).map((item, index) => ({ ...item, posicion: index + 1 }));
    saveShelf(moduleId, numero, {
      cantidad_baldas: nextCajones.length,
      cajones: nextCajones,
    });
  }

  return (
    <section className="inventory-panel">
      <div className="panel-heading inventory-heading">
        <div>
          <span className="eyebrow">Configuración de estantería</span>
          <h2>Layout de módulos y baldas</h2>
        </div>
        <div className="module-actions">
          <label className="inline-setting">
            Ancho común
            <input
              type="text"
              inputMode="decimal"
              value={defaultWidthCm}
              onChange={(event) => setDefaultWidthCm(event.target.value.replace(/[^0-9.]/g, ''))}
            />
            <span>cm</span>
          </label>
          <button className="secondary-button" type="button" onClick={saveDefaultWidth}>
            <Save size={18} />
            Guardar ancho
          </button>
          <button className="secondary-button" type="button" onClick={editSelectedModules} disabled={!selectedModuleIds.length}>
            <Pencil size={18} />
            Editar
          </button>
          <button className="primary-button" type="button" onClick={saveSelectedModules} disabled={!selectedModuleIds.some((id) => editingModuleIds.includes(id))}>
            <Save size={18} />
            Guardar
          </button>
          <button className="primary-button" type="button" onClick={addModule}>
            <Plus size={18} />
            Añadir módulo
          </button>
          <button className="secondary-button danger-text" type="button" onClick={removeModule} disabled={!selectedModuleIds.length || modules.length <= 1}>
            <Trash2 size={18} />
            Quitar módulo
          </button>
        </div>
      </div>

      <div className="catalog-strip">
        <strong>Catálogo de cubetas</strong>
        {boxTypes.length ? boxTypes.map((boxType) => (
          <span key={boxType.id}>{boxType.codigo} · {boxType.nombre} · {boxType.ancho_cm} cm</span>
        )) : <span>Crea cubetas en el panel Catálogo antes de construir las baldas.</span>}
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="rack-grid">
        {modules.map((module, moduleIndex) => (
          <article className={`rack-card ${editingModuleIds.includes(module.id) ? 'editing' : 'locked'}`} key={module.id}>
            <button className="module-check" type="button" onClick={() => toggleModule(module.id)} aria-label={`Seleccionar Módulo ${moduleIndex + 1}`}>
              {selectedModuleIds.includes(module.id) && <span />}
            </button>
            <div className="rack-title">
              <strong>Módulo {moduleIndex + 1}</strong>
              <div className="module-hardware-fields">
                <label className="module-width-field">
                  Ancho total
                  <input
                    type="text"
                    inputMode="decimal"
                    value={module.ancho_estante_cm ?? ''}
                    onChange={(event) => updateModuleWidth(module.id, event.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder={`${defaultWidthCm}`}
                    disabled={!editingModuleIds.includes(module.id)}
                  />
                  <span>cm</span>
                </label>
                <label>
                  Controlador
                  <select
                    value={module.controlador_id || ''}
                    onChange={(event) => updateModuleHardware(module.id, { controlador_id: event.target.value || null })}
                    disabled={!editingModuleIds.includes(module.id)}
                  >
                    <option value="">Sin controlador</option>
                    {controllers.map((controller) => (
                      <option key={controller.id} value={controller.id}>{controller.nombre} · {controller.ip}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Canal
                  <select
                    value={module.canal_led || 1}
                    onChange={(event) => updateModuleHardware(module.id, { canal_led: event.target.value })}
                    disabled={!editingModuleIds.includes(module.id)}
                  >
                    {[1, 2, 3, 4].map((channel) => <option key={channel} value={channel}>Canal {channel}</option>)}
                  </select>
                </label>
              </div>
            </div>
            <div className="rack-frame">
              {Array.from({ length: 8 }, (_, index) => {
                const numero = index + 1;
                const key = `${module.id}-${numero}`;
                const record = shelves[key] || normalizeShelfRecord({ cantidad_baldas: 0 }, moduleShelfWidth(module));
                const value = clampShelfCount(record.cantidad_baldas);
                const totalWidth = record.cajones.reduce((sum, item) => sum + toNumber(item.ancho_cm, 0), 0);
                const widthLimit = moduleShelfWidth(module);
                const freeWidth = Math.max(0, widthLimit - totalWidth);
                const widthOk = totalWidth <= widthLimit;
                return (
                  <div className={`rack-row digital-row ${widthOk ? '' : 'invalid'}`} key={key}>
                    <span>E{numero}</span>
                    <select
                      className="box-type-select"
                      disabled={!editingModuleIds.includes(module.id) || !boxTypes.length || value >= 8}
                      value=""
                      onChange={(event) => {
                        addBoxToShelf(module.id, numero, event.target.value);
                        event.target.value = '';
                      }}
                      aria-label={`Agregar cubeta en estante ${numero}`}
                    >
                      <option value="">+ Cubeta</option>
                      {boxTypes.map((boxType) => (
                        <option key={boxType.id} value={boxType.id}>{boxType.codigo} · {boxType.ancho_cm} cm</option>
                      ))}
                    </select>
                    <button
                      className="icon-button shelf-remove-box"
                      type="button"
                      onClick={() => removeLastBoxFromShelf(module.id, numero)}
                      disabled={!editingModuleIds.includes(module.id) || !value}
                      aria-label={`Quitar última cubeta del estante ${numero}`}
                    >
                      <X size={15} />
                    </button>
                    <div className="shelf-preview physical-preview">
                      {record.cajones.map((cajon, shelfIndex) => (
                        <div
                          className="physical-cajon"
                          key={`${key}-${cajon.posicion}`}
                          style={{ width: `${Math.max(4, (toNumber(cajon.ancho_cm, 0) / widthLimit) * 100)}%` }}
                        >
                          <i>{cajon.cubeta_codigo || `C${shelfIndex + 1}`}</i>
                          <small>{cajon.ancho_cm} cm · LED {cajon.startLed}+{cajon.ledCount}</small>
                        </div>
                      ))}
                      {freeWidth > 0 && (
                        <div className="physical-free-space" style={{ width: `${(freeWidth / widthLimit) * 100}%` }}>
                          Libre: {freeWidth} cm
                        </div>
                      )}
                    </div>
                    <small className="row-measure">{totalWidth}/{widthLimit} cm</small>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function WarehouseWorkspace({ warehouse }) {
  const [tab, setTab] = useState('articulos');
  const [importStatus, setImportStatus] = useState('');
  const [articleRefreshKey, setArticleRefreshKey] = useState(0);
  const fileInputRef = useRef(null);

  async function importArticles(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImportStatus('Importando...');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const records = buildImportRecords(rows, warehouse.id);

    if (!records.length) {
      setImportStatus('El Excel no tiene artículos válidos.');
      return;
    }

    const { error: importError } = await supabase
      .from('almacen_articulos')
      .upsert(records, { onConflict: 'almacen_id,sku' });

    if (importError) {
      setImportStatus(importError.message);
      return;
    }

    setImportStatus(`${records.length} artículos importados.`);
    setArticleRefreshKey((current) => current + 1);
    setTab('articulos');
  }

  return (
    <>
      <nav className="tabs">
        <button className={tab === 'articulos' ? 'active' : ''} onClick={() => setTab('articulos')}>
          <PackagePlus size={17} />
          Artículos
        </button>
        <button className={tab === 'usuarios' ? 'active' : ''} onClick={() => setTab('usuarios')}>
          <Users size={17} />
          Usuarios app local
        </button>
        <button className={tab === 'estanteria' ? 'active' : ''} onClick={() => setTab('estanteria')}>
          <LayoutGrid size={17} />
          Configuración estantería
        </button>
        <button className={tab === 'iot' ? 'active' : ''} onClick={() => setTab('iot')}>
          <Cpu size={17} />
          Controladores IoT
        </button>
        <button className={tab === 'cubetas' ? 'active' : ''} onClick={() => setTab('cubetas')}>
          <Boxes size={17} />
          Catálogo cubetas
        </button>
        <button className="import-tab" type="button" onClick={() => fileInputRef.current?.click()}>
          <FileSpreadsheet size={17} />
          Importar
        </button>
        <input
          ref={fileInputRef}
          className="hidden-file"
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={importArticles}
        />
      </nav>

      {importStatus && <div className="import-status">{importStatus}</div>}

      {tab === 'articulos' && <ArticleManager warehouse={warehouse} refreshKey={articleRefreshKey} />}
      {tab === 'usuarios' && <OperatorsManager warehouse={warehouse} />}
      {tab === 'estanteria' && <ShelvingManager warehouse={warehouse} />}
      {tab === 'iot' && <IoTControllersManager warehouse={warehouse} />}
      {tab === 'cubetas' && <BoxCatalogManager warehouse={warehouse} />}
    </>
  );
}

function Dashboard({ session }) {
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadWarehouses();
  }, []);

  async function loadWarehouses() {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('almacen_bases')
      .select('*')
      .order('created_at', { ascending: false });
    setLoading(false);

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setWarehouses(data || []);
    setError('');
  }

  async function createWarehouse(form) {
    const { error: createError } = await supabase.from('almacen_bases').insert({
      nombre: form.nombre.trim(),
      ubicacion: form.ubicacion.trim(),
      descripcion: form.descripcion.trim(),
      ancho_estante_cm: Math.max(1, toNumber(form.ancho_estante_cm, DEFAULT_SHELF_WIDTH_CM)),
    });

    if (createError) {
      setError(createError.message);
      return;
    }

    loadWarehouses();
  }

  async function updateWarehouse(id, form) {
    const { error: updateError } = await supabase.from('almacen_bases').update({
      nombre: form.nombre.trim(),
      ubicacion: form.ubicacion.trim(),
      descripcion: form.descripcion.trim(),
      ancho_estante_cm: Math.max(1, toNumber(form.ancho_estante_cm, DEFAULT_SHELF_WIDTH_CM)),
    }).eq('id', id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    loadWarehouses();
  }

  async function deleteWarehouse(warehouse) {
    if (!window.confirm(`Eliminar la base "${warehouse.nombre}"? Se perderán todos sus datos: artículos, usuarios y configuración de estantería. Esta acción no se puede deshacer.`)) {
      return;
    }

    const { error: deleteError } = await supabase.from('almacen_bases').delete().eq('id', warehouse.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    if (selectedWarehouse?.id === warehouse.id) {
      setSelectedWarehouse(null);
    }
    loadWarehouses();
  }

  async function deleteSelectedWarehouses(ids) {
    if (!ids.length) return;
    if (!window.confirm(`Eliminar ${ids.length} bases seleccionadas? Se perderán todos sus datos: artículos, usuarios y configuración de estantería. Esta acción no se puede deshacer.`)) {
      return;
    }

    const { error: deleteError } = await supabase.from('almacen_bases').delete().in('id', ids);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    if (selectedWarehouse && ids.includes(selectedWarehouse.id)) {
      setSelectedWarehouse(null);
    }
    loadWarehouses();
  }

  return (
    <main className="app-shell">
      <Topbar
        session={session}
        selectedWarehouse={selectedWarehouse}
        onBack={() => setSelectedWarehouse(null)}
      />

      {selectedWarehouse ? (
        <WarehouseWorkspace warehouse={selectedWarehouse} />
      ) : (
        <WarehouseList
          warehouses={warehouses}
          onCreate={createWarehouse}
          onUpdate={updateWarehouse}
          onOpen={setSelectedWarehouse}
          onDelete={deleteWarehouse}
          onDeleteSelected={deleteSelectedWarehouses}
          loading={loading}
          error={error}
        />
      )}
    </main>
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      try {
        const { data } = await supabase.auth.getSession();
        if (mounted) setSession(data.session);
      } finally {
        if (mounted) setCheckingSession(false);
      }
    }

    initializeAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!mounted) return;
      setSession(currentSession);
      setCheckingSession(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (checkingSession) {
    return <div className="boot-screen">Cargando almacén...</div>;
  }

  return session ? <Dashboard session={session} /> : <Login onLogin={setSession} />;
}

createRoot(document.getElementById('root')).render(<App />);
