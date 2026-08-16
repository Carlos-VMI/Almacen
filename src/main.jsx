import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  Boxes,
  Building2,
  Cpu,
  Database,
  Eye,
  EyeOff,
  FileSpreadsheet,
  LayoutGrid,
  LogOut,
  PackagePlus,
  Pencil,
  Plus,
  Save,
  Search,
  Settings,
  ShieldCheck,
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
const ROUTING_MODES = {
  DIRECT: 'direct',
  ZIGZAG: 'zigzag',
};

const emptyWarehouse = { nombre: '', ubicacion: '', descripcion: '' };
const emptyAdmin = { username: '', email: '', activo: true, password: '' };
const emptyArticle = {
  codigo_articulo: '',
  codigo_cliente: '',
  sku: '',
  descripcion: '',
  sufijos: [{ sufijo: '01', capacidad: '' }],
};
const emptyOperator = { nombre: '', apellido: '', email: '', rol: 'operario', pin: '', activo: true };
const emptyController = { nombre: '', ip: '', tipo_tira: 'WS2812B', leds_por_metro: DEFAULT_LED_DENSITY };
const emptyBoxType = { codigo: '', nombre: '', ancho_cm: '' };
const suffixOptions = ['01', '02', '03', '04'];
const PAGE_SIZE = 15;

function toNumber(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatCm(value) {
  const numericValue = toNumber(value, 0);
  return Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(2);
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

function normalizeRoutingMode(value) {
  return value === ROUTING_MODES.ZIGZAG ? ROUTING_MODES.ZIGZAG : ROUTING_MODES.DIRECT;
}

function RoutingModeSelect({ value, disabled, muted, onChange }) {
  const currentValue = normalizeRoutingMode(value);

  return (
    <select
      className={muted ? 'muted-select' : ''}
      value={muted ? '' : currentValue}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      aria-label="Ruta de señal"
    >
      {muted ? <option value="">---</option> : null}
      <option value={ROUTING_MODES.ZIGZAG}>Zig-Zag</option>
      <option value={ROUTING_MODES.DIRECT}>Snake</option>
    </select>
  );
}

function useClickOutside(ref, onClickOutside, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;

    function handlePointerDown(event) {
      if (!ref.current || ref.current.contains(event.target)) return;
      onClickOutside(event);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [enabled, onClickOutside, ref]);
}

function BoxTypeMenu({ disabled, boxTypes, onAdd, label, menuId, openDropdownId, setOpenDropdownId, openDirection = 'down' }) {
  const open = openDropdownId === menuId;
  const menuRef = useRef(null);

  useClickOutside(menuRef, () => setOpenDropdownId(null), open);

  function addBox(event, boxTypeId) {
    event.preventDefault();
    event.stopPropagation();
    onAdd(boxTypeId);
  }

  return (
    <div ref={menuRef} className={`box-type-menu ${open ? 'open' : ''} ${openDirection === 'up' ? 'opens-up' : ''}`}>
      <button
        type="button"
        className="box-type-menu-trigger"
        aria-disabled={disabled}
        aria-expanded={open}
        onClick={(event) => {
          if (disabled) return;
          event.stopPropagation();
          setOpenDropdownId(open ? null : menuId);
        }}
      >
        <span className="box-type-menu-icon">{open ? '-' : '+'}</span>
        <span className="box-type-menu-label">{label}</span>
      </button>
      {!disabled && open && (
        <div className="box-type-menu-list" role="menu">
          {boxTypes.map((boxType) => (
            <button
              key={boxType.id}
              type="button"
              role="menuitem"
              onClick={(event) => addBox(event, boxType.id)}
            >
              <span>{boxType.codigo} · {formatCm(boxType.ancho_cm)} cm</span>
              <Plus size={15} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function calculateLedMap({
  cajones,
  shelfWidthCm,
  controller,
  channel,
  shelfNumber = 1,
  moduleBaseOffsetCm = 0,
  routingMode = ROUTING_MODES.DIRECT,
}) {
  const width = Math.max(1, toNumber(shelfWidthCm, DEFAULT_SHELF_WIDTH_CM));
  const density = Math.max(0, toNumber(controller?.leds_por_metro, DEFAULT_LED_DENSITY)) / 100;
  const normalizedRouting = normalizeRoutingMode(routingMode);
  const reverseShelf = normalizedRouting === ROUTING_MODES.ZIGZAG && shelfNumber % 2 === 0;
  const shelfOffsetCm = Math.max(0, toNumber(moduleBaseOffsetCm, 0))
    + (Math.max(0, toNumber(shelfNumber, 1) - 1) * width);
  let cursorCm = 0;

  return cajones.map((cajon, index) => {
    const anchoCm = Math.max(0, toNumber(cajon.ancho_cm, 0));
    const physicalStartCm = cursorCm;
    const logicalStartCm = reverseShelf
      ? Math.max(0, width - physicalStartCm - anchoCm)
      : physicalStartCm;
    const startLed = density > 0 ? Math.round((shelfOffsetCm + logicalStartCm) * density) : 0;
    const endLed = density > 0 ? Math.round((shelfOffsetCm + logicalStartCm + anchoCm) * density) : 0;
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
      routing_mode: normalizedRouting,
      startLed,
      endLed,
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
      routing_mode: normalizeRoutingMode(current.routing_mode ?? module?.routing_mode),
      startLed: toNumber(current.startLed, 0),
      endLed: toNumber(current.endLed, 0),
      ledCount: toNumber(current.ledCount, 0),
    };
  });

  return {
    cantidad_baldas: count,
    total_leds: toNumber(row?.total_leds, DEFAULT_TOTAL_LEDS),
    cajones,
  };
}

function buildShelfPayload(current, patch, shelfWidthCm, module = {}, controllersById = new Map(), shelfNumber = 1, moduleBaseOffsetCm = 0) {
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
    total_leds: Math.max(
      0,
      Math.round(width * (Math.max(0, toNumber(controllersById.get(module?.controlador_id)?.leds_por_metro, DEFAULT_LED_DENSITY)) / 100))
    ),
    cajones: calculateLedMap({
      cajones,
      shelfWidthCm: width,
      controller: controllersById.get(module?.controlador_id) ?? null,
      channel: module?.canal_led ?? 1,
      shelfNumber,
      moduleBaseOffsetCm,
      routingMode: module?.routing_mode,
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
  if (role === 'supervisor') return 'Supervisor';
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
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    const normalizedIdentifier = identifier.trim();
    let authEmail = normalizedIdentifier;

    if (!normalizedIdentifier.includes('@')) {
      const { data: adminUser, error: adminLookupError } = await supabase
        .from('almacen_admins')
        .select('email')
        .eq('username', normalizedIdentifier)
        .eq('activo', true)
        .maybeSingle();

      if (adminLookupError || !adminUser?.email) {
        setLoading(false);
        setError('Usuario o contraseña incorrectos.');
        return;
      }

      authEmail = adminUser.email;
    }

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email: authEmail,
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
          <span className="login-brand">Smart WMS</span>
          <h1>Bienvenidos</h1>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            Usuario o Correo electrónico
            <input
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="usuario o usuario@empresa.com"
              autoComplete="username"
              required
            />
          </label>

          <label>
            Contraseña
            <div className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Contraseña"
                autoComplete="current-password"
                required
              />
              <button
                className="password-toggle"
                type="button"
                onPointerDown={() => setShowPassword(true)}
                onPointerUp={() => setShowPassword(false)}
                onPointerCancel={() => setShowPassword(false)}
                onPointerLeave={() => setShowPassword(false)}
                onBlur={() => setShowPassword(false)}
                aria-label="Mantener presionado para ver contraseña"
              >
                <Eye size={17} />
              </button>
            </div>
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
          <span className="eyebrow">Smart WMS</span>
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
            <span className="eyebrow">NUEVA BASE DE DATOS</span>
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
          <button className="primary-button" type="submit">
            {editing ? <Save size={18} /> : <Plus size={18} />}
            {editing ? 'Guardar base' : 'Crear base'}
          </button>
        </form>
      </section>

      <section className="inventory-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DISPONIBLES</span>
            <h2>Base de datos activas</h2>
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
      apellido: form.apellido.trim(),
      email: form.email.trim() || null,
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
            Apellido
            <input value={form.apellido || ''} onChange={(event) => setForm({ ...form, apellido: event.target.value })} />
          </label>
          <label>
            Email
            <input type="email" value={form.email || ''} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </label>
          <label>
            Rol
            <select value={form.rol} onChange={(event) => setForm({ ...form, rol: event.target.value })}>
              <option value="administrador">Administrador</option>
              <option value="supervisor">Supervisor</option>
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
                  <td>{[operator.nombre, operator.apellido].filter(Boolean).join(' ')}</td>
                  <td>{operator.email || ''}</td>
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
            <input value={form.codigo} onChange={(event) => setForm({ ...form, codigo: event.target.value })} placeholder="P1" required />
          </label>
          <label>
            Nombre
            <input value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} placeholder="Pequeña" required />
          </label>
          <label>
            Ancho físico (cm)
            <input type="text" inputMode="decimal" value={form.ancho_cm} onChange={(event) => setForm({ ...form, ancho_cm: event.target.value.replace(/[^0-9.]/g, '') })} placeholder="12" required />
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
            <h2>Catálogo de cubetas</h2>
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

function AdminStatusBadge({ active }) {
  return (
    <span className={`status-badge ${active ? 'active' : 'inactive'}`}>
      {active ? 'Activo' : 'Inactivo'}
    </span>
  );
}

async function getFunctionErrorMessage(functionError, fallback) {
  if (!functionError) return fallback;

  try {
    const context = functionError.context;
    if (context?.json) {
      const body = await context.json();
      if (body?.error) return body.error;
    }
  } catch {
    // Supabase may expose only the generic FunctionsHttpError message.
  }

  return functionError.message || fallback;
}

function AdminEditModal({ open, mode, form, setForm, saving, error, onClose, onSave }) {
  const [showPassword, setShowPassword] = useState(false);
  const isCreate = mode === 'create';

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-edit-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">Acceso web</span>
            <h2 id="admin-edit-title">{isCreate ? 'Nuevo administrador' : 'Editar administrador'}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar edición">
            <X size={18} />
          </button>
        </div>

        <form className="stack-form" onSubmit={onSave}>
          <label>
            Nombre de usuario
            <input
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              placeholder="admin.madrid"
              autoComplete="username"
              required
            />
          </label>

          <label>
            Correo electrónico
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              disabled={!isCreate}
              placeholder="admin@empresa.com"
              autoComplete="email"
              required={isCreate}
            />
          </label>

          <label>
            {isCreate ? 'Contraseña' : 'Nueva contraseña'}
            <div className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                placeholder={isCreate ? 'Contraseña de acceso' : 'Dejar vacío para no cambiar'}
                autoComplete="new-password"
                required={isCreate}
              />
              <button
                className="password-toggle"
                type="button"
                onPointerDown={() => setShowPassword(true)}
                onPointerUp={() => setShowPassword(false)}
                onPointerCancel={() => setShowPassword(false)}
                onPointerLeave={() => setShowPassword(false)}
                onBlur={() => setShowPassword(false)}
                aria-label="Mantener presionado para ver contraseña"
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {!isCreate ? <small>Opcional. Si queda vacío, no cambia.</small> : null}
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={form.activo}
              onChange={(event) => setForm({ ...form, activo: event.target.checked })}
            />
            Administrador activo
          </label>

          {error ? <div className="error-box compact-error">{error}</div> : null}

          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button className="primary-button" type="submit" disabled={saving}>
              <Save size={18} />
              {saving ? 'Guardando...' : isCreate ? 'Crear administrador' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AdministrationManager({ warehouse }) {
  const [admins, setAdmins] = useState([]);
  const [selected, setSelected] = useState(null);
  const [adminModalMode, setAdminModalMode] = useState(null);
  const [adminForm, setAdminForm] = useState(emptyAdmin);
  const [notificationEmails, setNotificationEmails] = useState([]);
  const [notificationEmail, setNotificationEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [deletingEmailId, setDeletingEmailId] = useState(null);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    loadAdministration();
  }, [warehouse.id]);

  useEffect(() => {
    setAdminForm(selected && adminModalMode === 'edit' ? {
      username: selected.username || '',
      email: selected.email || '',
      activo: selected.activo !== false,
      password: '',
    } : emptyAdmin);
    setModalError('');
  }, [adminModalMode, selected]);

  function openCreateAdmin() {
    setSelected(null);
    setAdminForm(emptyAdmin);
    setAdminModalMode('create');
  }

  function openEditAdmin(admin) {
    setSelected(admin);
    setAdminModalMode('edit');
  }

  function closeAdminModal() {
    setSelected(null);
    setAdminForm(emptyAdmin);
    setAdminModalMode(null);
    setModalError('');
  }

  async function loadAdministration() {
    setLoading(true);
    setError('');
    setStatus('');

    const [{ data: adminData, error: adminError }, { data: emailData, error: emailError }] = await Promise.all([
      supabase
        .from('almacen_admins')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('almacen_notificacion_emails')
        .select('*')
        .eq('almacen_id', warehouse.id)
        .order('created_at', { ascending: false }),
    ]);

    setLoading(false);

    if (adminError || emailError) {
      setError(adminError?.message || emailError?.message);
      return;
    }

    setAdmins(adminData || []);
    setNotificationEmails(emailData || []);
  }

  async function saveAdmin(event) {
    event.preventDefault();

    setModalError('');
    setStatus('');
    setSavingAdmin(true);

    const username = adminForm.username.trim();
    const email = adminForm.email.trim().toLowerCase();
    const password = adminForm.password.trim();

    if (!username || !email) {
      setModalError('Completa usuario y correo electrónico.');
      setSavingAdmin(false);
      return;
    }

    if (adminModalMode === 'create' && !password) {
      setModalError('Indica una contraseña para el nuevo administrador.');
      setSavingAdmin(false);
      return;
    }

    try {
      const { data, error: functionError } = await supabase.functions.invoke('admin-upsert-user', {
        body: {
          action: adminModalMode === 'create' ? 'create' : 'update',
          id: adminModalMode === 'edit' ? selected?.id : undefined,
          username,
          email,
          activo: Boolean(adminForm.activo),
          password: password || undefined,
        },
      });

      if (functionError) {
        throw new Error(await getFunctionErrorMessage(functionError, 'No se pudo guardar el administrador.'));
      }

      if (data?.error) {
        throw new Error(data.error);
      }
    } catch (saveError) {
      const fallbackMessage = saveError?.message?.includes('FunctionsHttpError')
        ? 'No se pudo ejecutar la función segura admin-upsert-user. Despliega la Edge Function incluida en el proyecto.'
        : saveError?.message || 'No se pudo guardar el administrador.';
      setModalError(fallbackMessage);
      setSavingAdmin(false);
      return;
    }

    setSavingAdmin(false);
    closeAdminModal();
    setStatus(adminModalMode === 'create' ? 'Administrador creado.' : 'Administrador guardado.');
    loadAdministration();
  }

  async function deleteAdmin(admin) {
    if (!admin?.id) return;

    const confirmed = window.confirm(
      `¿Eliminar el administrador ${admin.email || admin.username}?\n\nSe revocará su acceso a la web de configuración.`
    );

    if (!confirmed) return;

    setError('');
    setStatus('');

    try {
      const { data, error: functionError } = await supabase.functions.invoke('admin-upsert-user', {
        body: {
          action: 'delete',
          id: admin.id,
        },
      });

      if (functionError) {
        throw new Error(await getFunctionErrorMessage(functionError, 'No se pudo eliminar el administrador.'));
      }

      if (data?.error) {
        throw new Error(data.error);
      }
    } catch (deleteError) {
      const fallbackMessage = deleteError?.message?.includes('FunctionsHttpError')
        ? 'No se pudo ejecutar la función segura admin-upsert-user. Vuelve a desplegar la Edge Function actualizada.'
        : deleteError?.message || 'No se pudo eliminar el administrador.';
      setError(fallbackMessage);
      return;
    }

    setStatus('Administrador eliminado.');
    loadAdministration();
  }

  async function saveNotificationEmail(event) {
    event.preventDefault();
    const email = notificationEmail.trim().toLowerCase();

    if (!email) {
      setError('Indica un correo de reposición.');
      return;
    }

    setSavingEmail(true);
    setError('');
    setStatus('');

    const { error: saveError } = await supabase
      .from('almacen_notificacion_emails')
      .upsert({
        almacen_id: warehouse.id,
        email,
      }, { onConflict: 'almacen_id,email' });

    setSavingEmail(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setNotificationEmail('');
    setStatus('Correo agregado.');
    loadAdministration();
  }

  async function deleteNotificationEmail(emailRow) {
    if (!emailRow?.id) return;

    setDeletingEmailId(emailRow.id);
    setError('');
    setStatus('');

    const { error: deleteError } = await supabase
      .from('almacen_notificacion_emails')
      .delete()
      .eq('id', emailRow.id);

    setDeletingEmailId(null);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setNotificationEmails((current) => current.filter((item) => item.id !== emailRow.id));
    setStatus('Correo eliminado.');
  }

  return (
    <div className="admin-grid">
      <section className="inventory-panel admin-list-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Administración</span>
            <h2>Gestión de administradores</h2>
          </div>
          <div className="heading-actions">
            <button className="primary-button" type="button" onClick={openCreateAdmin}>
              <Plus size={18} />
              Nuevo administrador
            </button>
            <ShieldCheck size={22} />
          </div>
        </div>

        <div className="panel-subheading">
          <p>Usuarios autorizados para ingresar al panel web de configuración.</p>
          <span className="counter-pill">{admins.length}</span>
        </div>

        {error && <div className="error-box">{error}</div>}
        {status && <div className="import-status">{status}</div>}
        {loading ? <div className="loading-box">Cargando administración...</div> : (
          admins.length ? (
            <div className="table-panel admin-table-panel">
              <table>
                <thead>
                  <tr>
                    <th>Nombre de usuario</th>
                    <th>Correo electrónico</th>
                    <th>Estado</th>
                    <th className="action-cell">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((admin) => (
                    <tr key={admin.id}>
                      <td>
                        <strong>{admin.username || 'Sin usuario'}</strong>
                      </td>
                      <td>{admin.email || 'Sin email'}</td>
                      <td><AdminStatusBadge active={admin.activo !== false} /></td>
                      <td className="action-cell">
                        <div className="admin-action-buttons">
                          <button className="icon-button" type="button" onClick={() => openEditAdmin(admin)} aria-label="Editar administrador">
                            <Pencil size={17} />
                          </button>
                          <button className="icon-button danger" type="button" onClick={() => deleteAdmin(admin)} aria-label="Eliminar administrador">
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty-inline">Todavía no hay administradores configurados.</div>
        )}
      </section>

      <section className="form-panel admin-settings-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Sistema</span>
            <h2>Configuración de esta base</h2>
          </div>
          <Settings size={22} />
        </div>
        <div className="settings-context">
          <span>Base activa</span>
          <strong>{warehouse.nombre}</strong>
        </div>
        <form className="stack-form" onSubmit={saveNotificationEmail}>
          <label>
            Correo de notificaciones de reposición
            <input
              type="email"
              value={notificationEmail}
              onChange={(event) => setNotificationEmail(event.target.value)}
              placeholder="compras@empresa.com"
            />
          </label>
          <div className="settings-actions">
            <button className="primary-button" type="submit" disabled={savingEmail}>
              <Save size={18} />
              {savingEmail ? 'Guardando...' : 'Agregar correo'}
            </button>
          </div>
        </form>
        <div className="notification-email-list">
          {notificationEmails.length ? notificationEmails.map((item) => (
            <div className="notification-email-row" key={item.id}>
              <strong>{item.email}</strong>
              <button
                className="icon-button danger"
                type="button"
                onClick={() => deleteNotificationEmail(item)}
                disabled={deletingEmailId === item.id}
                aria-label="Eliminar correo"
              >
                <Trash2 size={17} />
              </button>
            </div>
          )) : <div className="empty-inline">Sin correos configurados.</div>}
        </div>
      </section>

      <AdminEditModal
        open={Boolean(adminModalMode)}
        mode={adminModalMode}
        form={adminForm}
        setForm={setAdminForm}
        saving={savingAdmin}
        error={modalError}
        onClose={closeAdminModal}
        onSave={saveAdmin}
      />
    </div>
  );
}

function ShelvingManager({ warehouse }) {
  const [modules, setModules] = useState([]);
  const [shelves, setShelves] = useState({});
  const [controllers, setControllers] = useState([]);
  const [boxTypes, setBoxTypes] = useState([]);
  const [editingModuleIds, setEditingModuleIds] = useState([]);
  const [shelfAlerts, setShelfAlerts] = useState({});
  const [error, setError] = useState('');
  const [openDropdownId, setOpenDropdownId] = useState(null);

  useEffect(() => {
    loadLayout();
  }, [warehouse.id]);

  const controllersById = useMemo(() => new Map(controllers.map((controller) => [controller.id, controller])), [controllers]);

  function moduleShelfWidth(module) {
    return Math.max(1, toNumber(module.ancho_estante_cm, DEFAULT_SHELF_WIDTH_CM));
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
        .insert({ almacen_id: warehouse.id, nombre: 'Módulo 1', orden: 1, canal_led: '1', routing_mode: ROUTING_MODES.DIRECT })
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
    setEditingModuleIds((current) => current.filter((id) => currentModules.some((module) => module.id === id)));
    setShelves(
      (shelfData || []).reduce((acc, shelf) => {
        const module = currentModules.find((item) => item.id === shelf.modulo_id);
        acc[`${shelf.modulo_id}-${shelf.numero}`] = normalizeShelfRecord(
          shelf,
          module?.ancho_estante_cm || DEFAULT_SHELF_WIDTH_CM,
          module,
          loadedControllersById
        );
        return acc;
      }, {})
    );
    setError('');
  }

  async function addModule() {
    const { data: created, error: createError } = await supabase
      .from('almacen_modulos')
      .insert({
        almacen_id: warehouse.id,
        nombre: nextModuleName(modules.length),
        orden: modules.length + 1,
        canal_led: '1',
        routing_mode: ROUTING_MODES.DIRECT,
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

  function moduleBaseOffsetCm(moduleId, moduleList = modules) {
    const module = moduleList.find((item) => item.id === moduleId);
    if (!module?.controlador_id) return 0;
    const channel = toNumber(module.canal_led, 1);

    return [...moduleList]
      .filter((item) => (
        item.id !== module.id
        && item.controlador_id === module.controlador_id
        && toNumber(item.canal_led, 1) === channel
        && toNumber(item.orden, 0) < toNumber(module.orden, 0)
      ))
      .sort((a, b) => toNumber(a.orden, 0) - toNumber(b.orden, 0))
      .reduce((sum, item) => sum + (moduleShelfWidth(item) * 8), 0);
  }

  async function updateModuleWidth(moduleId, value) {
    if (!editingModuleIds.includes(moduleId)) return;
    const width = Math.max(1, toNumber(value, DEFAULT_SHELF_WIDTH_CM));
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

  async function updateModuleName(moduleId, value) {
    if (!editingModuleIds.includes(moduleId)) return;
    const nombre = value.trimStart();
    setModules((current) => current.map((module) => (
      module.id === moduleId ? { ...module, nombre } : module
    )));

    const { error: updateError } = await supabase
      .from('almacen_modulos')
      .update({ nombre: nombre.trim() || 'Módulo' })
      .eq('id', moduleId);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setError('');
  }

  async function updateModuleHardware(moduleId, patch) {
    if (!editingModuleIds.includes(moduleId)) return;
    const hasControllerPatch = Object.prototype.hasOwnProperty.call(patch, 'controlador_id');
    const controllerCleared = hasControllerPatch && !patch.controlador_id;
    const nextPatch = { ...patch };
    if (controllerCleared) {
      nextPatch.controlador_id = null;
      nextPatch.canal_led = '';
      nextPatch.routing_mode = ROUTING_MODES.DIRECT;
    }
    const record = {
      ...nextPatch,
      canal_led: controllerCleared
        ? ''
        : nextPatch.canal_led
          ? String(Math.min(4, Math.max(1, toNumber(nextPatch.canal_led, 1))))
          : nextPatch.canal_led,
      routing_mode: nextPatch.routing_mode ? normalizeRoutingMode(nextPatch.routing_mode) : nextPatch.routing_mode,
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

  async function removeModule(moduleId) {
    if (!moduleId) return;
    if (modules.length <= 1) {
      setError('Debe quedar al menos un módulo configurado.');
      return;
    }
    const module = modules.find((item) => item.id === moduleId);
    if (!window.confirm(`Quitar ${module?.nombre || 'este módulo'}? Se perderá su configuración de estantes.`)) return;
    const { error: shelfDeleteError } = await supabase.from('almacen_estantes').delete().eq('modulo_id', moduleId);
    if (shelfDeleteError) {
      setError(shelfDeleteError.message);
      return;
    }

    const { error: deleteError } = await supabase.from('almacen_modulos').delete().eq('id', moduleId);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setEditingModuleIds((current) => current.filter((id) => id !== moduleId));
    await normalizeModuleOrder();
    loadLayout();
  }

  async function saveShelf(moduleId, numero, patch, options = {}) {
    if (!options.force && !editingModuleIds.includes(moduleId)) return;
    const module = modules.find((item) => item.id === moduleId);
    const key = `${moduleId}-${numero}`;
    const current = shelves[key] || normalizeShelfRecord({ cantidad_baldas: 0 }, moduleShelfWidth(module || {}));
    let payload;

    try {
      payload = buildShelfPayload(
        current,
        patch,
        moduleShelfWidth(module || {}),
        module,
        controllersById,
        numero,
        moduleBaseOffsetCm(moduleId)
      );
    } catch (validationError) {
      const alertKey = `${moduleId}-${numero}`;
      setShelfAlerts((currentAlerts) => ({
        ...currentAlerts,
        [alertKey]: validationError.message,
      }));
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
    setShelfAlerts((currentAlerts) => {
      const nextAlerts = { ...currentAlerts };
      delete nextAlerts[key];
      return nextAlerts;
    });
    setError('');
  }

  function editModule(moduleId) {
    setEditingModuleIds((current) => Array.from(new Set([...current, moduleId])));
    setError('');
  }

  async function saveModule(moduleId) {
    const module = modules.find((item) => item.id === moduleId);
    if (!module) return;

    const relatedModules = modules
      .filter((item) => (
        item.controlador_id
        && item.controlador_id === module.controlador_id
        && toNumber(item.canal_led, 1) === toNumber(module.canal_led, 1)
      ))
      .sort((a, b) => toNumber(a.orden, 0) - toNumber(b.orden, 0));
    const modulesToSave = relatedModules.length ? relatedModules : [module];

    for (const moduleToSave of modulesToSave) {
      for (let numero = 1; numero <= 8; numero += 1) {
        const key = `${moduleToSave.id}-${numero}`;
        const current = shelves[key] || normalizeShelfRecord({ cantidad_baldas: 0 }, moduleShelfWidth(moduleToSave), moduleToSave, controllersById);
        await saveShelf(moduleToSave.id, numero, { cajones: current.cajones }, { force: true });
      }
    }
    setEditingModuleIds((current) => current.filter((id) => id !== moduleId));
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

  function exportLayout() {
    const rows = [];

    modules.forEach((module) => {
      const controller = controllersById.get(module.controlador_id);
      for (let numero = 1; numero <= 8; numero += 1) {
        const key = `${module.id}-${numero}`;
        const record = shelves[key] || normalizeShelfRecord({ cantidad_baldas: 0 }, moduleShelfWidth(module), module, controllersById);
        const widthLimit = moduleShelfWidth(module);
        const occupiedWidth = record.cajones.reduce((sum, item) => sum + toNumber(item.ancho_cm, 0), 0);

        record.cajones.forEach((cajon) => {
          rows.push({
            Modulo: module.nombre,
            Estante: `E${numero}`,
            Cubeta: cajon.cubeta_codigo,
            Nombre: cajon.nombre,
            AnchoCm: toNumber(cajon.ancho_cm, 0),
            Controlador: controller?.nombre || '',
            Puerto: module.canal_led || '',
            Ruta: normalizeRoutingMode(module.routing_mode) === ROUTING_MODES.ZIGZAG ? 'Zig-Zag' : 'Snake',
            StartLed: cajon.startLed,
            EndLed: cajon.endLed,
            LedCount: cajon.ledCount,
          });
        });

        const freeWidth = Math.max(0, widthLimit - occupiedWidth);
        if (freeWidth > 0) {
          rows.push({
            Modulo: module.nombre,
            Estante: `E${numero}`,
            Cubeta: 'Libre',
            Nombre: '',
            AnchoCm: freeWidth,
            Controlador: controller?.nombre || '',
            Puerto: module.canal_led || '',
            Ruta: normalizeRoutingMode(module.routing_mode) === ROUTING_MODES.ZIGZAG ? 'Zig-Zag' : 'Snake',
            StartLed: '',
            EndLed: '',
            LedCount: '',
          });
        }
      }
    });

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Layout');
    XLSX.writeFile(workbook, `layout-${warehouse.nombre || 'almacen'}.xlsx`);
  }

  return (
    <section className="inventory-panel">
      <div className="panel-heading inventory-heading">
        <div>
          <span className="eyebrow">Configuración de estantería</span>
          <h2>Layout de módulos y baldas</h2>
        </div>
        <button className="primary-button" type="button" onClick={exportLayout}>
          <FileSpreadsheet size={17} />
          Exportar Layout
        </button>
      </div>

      <div className="catalog-strip">
        <strong>Catálogo de cubetas</strong>
        {boxTypes.length ? boxTypes.map((boxType) => (
          <span key={boxType.id}>{boxType.codigo} - {boxType.ancho_cm}cm</span>
        )) : <span>Crea cubetas en el panel Catálogo antes de construir las baldas.</span>}
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="rack-grid">
        {modules.map((module, moduleIndex) => {
          const isEditing = editingModuleIds.includes(module.id);
          const hasController = Boolean(module.controlador_id);
          return (
          <article className={`rack-card ${isEditing ? 'editing' : 'locked'}`} key={module.id}>
            <div className="rack-title">
              <div className="rack-title-top">
                <input
                  className="module-name-input"
                  value={module.nombre || `Módulo ${moduleIndex + 1}`}
                  onChange={(event) => updateModuleName(module.id, event.target.value)}
                  disabled={!isEditing}
                  aria-label={`Nombre del módulo ${moduleIndex + 1}`}
                />
                <div className="module-card-actions">
                  {isEditing ? (
                    <button className="icon-button" type="button" onClick={() => saveModule(module.id)} aria-label={`Guardar ${module.nombre || `Módulo ${moduleIndex + 1}`}`}>
                      <Save size={17} />
                    </button>
                  ) : (
                    <button className="icon-button" type="button" onClick={() => editModule(module.id)} aria-label={`Editar ${module.nombre || `Módulo ${moduleIndex + 1}`}`}>
                      <Pencil size={17} />
                    </button>
                  )}
                  <button className="icon-button danger" type="button" onClick={() => removeModule(module.id)} disabled={modules.length <= 1} aria-label={`Quitar ${module.nombre || `Módulo ${moduleIndex + 1}`}`}>
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
              <div className="module-hardware-fields">
                <label className="module-width-field">
                  Ancho
                  <input
                    type="text"
                    inputMode="decimal"
                    value={module.ancho_estante_cm ?? ''}
                    onChange={(event) => updateModuleWidth(module.id, event.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder={`${DEFAULT_SHELF_WIDTH_CM}`}
                    disabled={!isEditing}
                  />
                  <span>cm</span>
                </label>
                <label>
                  Controlador
                  <select
                    value={module.controlador_id || ''}
                    onChange={(event) => updateModuleHardware(module.id, {
                      controlador_id: event.target.value || null,
                      canal_led: event.target.value ? (module.canal_led || '1') : '',
                      routing_mode: event.target.value ? normalizeRoutingMode(module.routing_mode) : ROUTING_MODES.DIRECT,
                    })}
                    disabled={!isEditing}
                  >
                      <option value="">Sin controlador</option>
                    {controllers.map((controller) => (
                      <option key={controller.id} value={controller.id}>{controller.nombre}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Puerto
                  <select
                    className={!hasController ? 'muted-select' : ''}
                    value={hasController ? (module.canal_led || '1') : ''}
                    onChange={(event) => updateModuleHardware(module.id, { canal_led: event.target.value })}
                    disabled={!isEditing || !hasController}
                  >
                    {!hasController ? <option value="">---</option> : null}
                    {[1, 2, 3, 4].map((channel) => <option key={channel} value={channel}>{channel}</option>)}
                  </select>
                </label>
                <label>
                  Ruta de señal
                  <RoutingModeSelect
                    value={normalizeRoutingMode(module.routing_mode)}
                    onChange={(nextMode) => updateModuleHardware(module.id, { routing_mode: nextMode })}
                    disabled={!isEditing || !hasController}
                    muted={!hasController}
                  />
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
                  <div className={`rack-row digital-row ${widthOk ? '' : 'invalid'} ${openDropdownId === key ? 'dropdown-active' : ''}`} key={key}>
                    <span>E{numero}</span>
                    {shelfAlerts[key] && (
                      <div className="shelf-toast" role="alert">
                        <span>{shelfAlerts[key]}</span>
                        <button
                          type="button"
                          onClick={() => setShelfAlerts((currentAlerts) => {
                            const nextAlerts = { ...currentAlerts };
                            delete nextAlerts[key];
                            return nextAlerts;
                          })}
                          aria-label="Cerrar alerta"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )}
                    <BoxTypeMenu
                      disabled={!isEditing || !boxTypes.length || value >= 8}
                      boxTypes={boxTypes}
                      label="Cubeta"
                      menuId={key}
                      openDropdownId={openDropdownId}
                      setOpenDropdownId={setOpenDropdownId}
                      openDirection={numero >= 7 ? 'up' : 'down'}
                      onAdd={(boxTypeId) => addBoxToShelf(module.id, numero, boxTypeId)}
                    />
                    <button
                      className="icon-button shelf-remove-box"
                      type="button"
                      onClick={() => removeLastBoxFromShelf(module.id, numero)}
                      disabled={!isEditing || !value}
                      aria-label={`Quitar última cubeta del estante ${numero}`}
                    >
                      <X size={15} />
                    </button>
                    <div className="shelf-preview physical-preview">
                      {record.cajones.map((cajon, shelfIndex) => (
                        <div
                          className="physical-cajon"
                          key={`${key}-${cajon.posicion}`}
                          style={{ flexBasis: `${Math.max(4, (toNumber(cajon.ancho_cm, 0) / widthLimit) * 100)}%` }}
                        >
                          <i>{cajon.cubeta_codigo || `C${shelfIndex + 1}`}</i>
                          <small>{formatCm(cajon.ancho_cm)} cm</small>
                        </div>
                      ))}
                      {freeWidth > 0 && (
                        <div className="physical-free-space" style={{ flexBasis: `${(freeWidth / widthLimit) * 100}%` }}>
                          <strong>Libre</strong>
                          <small>{formatCm(freeWidth)} cm</small>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        );
        })}
        <button className="rack-card add-module-card" type="button" onClick={addModule} aria-label="Añadir módulo">
          <Plus size={44} />
          <strong>Añadir módulo</strong>
        </button>
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
        <button className={tab === 'cubetas' ? 'active' : ''} onClick={() => setTab('cubetas')}>
          <Boxes size={17} />
          Catálogo cubetas
        </button>
        <button className={tab === 'iot' ? 'active' : ''} onClick={() => setTab('iot')}>
          <Cpu size={17} />
          Controladores IoT
        </button>
        <button className={tab === 'administracion' ? 'active' : ''} onClick={() => setTab('administracion')}>
          <Settings size={17} />
          Administración
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
      {tab === 'cubetas' && <BoxCatalogManager warehouse={warehouse} />}
      {tab === 'iot' && <IoTControllersManager warehouse={warehouse} />}
      {tab === 'administracion' && <AdministrationManager warehouse={warehouse} />}
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
