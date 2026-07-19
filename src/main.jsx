import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  Boxes,
  Building2,
  Database,
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
import { supabase } from './supabaseClient';
import './styles.css';

const emptyWarehouse = { nombre: '', ubicacion: '', descripcion: '' };
const emptyArticle = {
  codigo_articulo: '',
  codigo_cliente: '',
  sku: '',
  descripcion: '',
  sufijos: [{ sufijo: '01', capacidad: 1 }],
};
const emptyOperator = { nombre: '', email: '', rol: 'operador', pin: '', activo: true };
const suffixOptions = ['01', '02', '03', '04'];

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nextModuleName(count) {
  return `Módulo ${count + 1}`;
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

function cloneEmptyArticle() {
  return { ...emptyArticle, sufijos: normalizeSuffixes(emptyArticle.sufijos) };
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
        <div className="brand-mark">
          <Boxes size={30} />
        </div>
        <h1>Almacén</h1>
        <p>Acceso privado para configurar bases, estanterías, artículos y usuarios.</p>

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

function WarehouseList({ warehouses, onCreate, onOpen, onDelete, loading, error }) {
  const [form, setForm] = useState(emptyWarehouse);

  async function submit(event) {
    event.preventDefault();
    await onCreate(form);
    setForm(emptyWarehouse);
  }

  return (
    <div className="home-grid">
      <section className="form-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Nueva base</span>
            <h2>Crear almacén</h2>
          </div>
          <Database size={22} />
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
            <Plus size={18} />
            Crear base
          </button>
        </form>
      </section>

      <section className="inventory-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Disponibles</span>
            <h2>Bases creadas</h2>
          </div>
          <span className="counter-pill">{warehouses.length}</span>
        </div>

        {error && <div className="error-box">{error}</div>}
        {loading ? (
          <div className="loading-box">Cargando bases...</div>
        ) : (
          <div className="warehouse-grid">
            {warehouses.map((warehouse) => (
              <article className="warehouse-card" key={warehouse.id}>
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
                <button
                  className="icon-button danger warehouse-delete"
                  type="button"
                  onClick={() => onDelete(warehouse)}
                  aria-label={`Eliminar ${warehouse.nombre}`}
                >
                  <Trash2 size={17} />
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
        )}
      </section>
    </div>
  );
}

function ArticleManager({ warehouse }) {
  const [articles, setArticles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(cloneEmptyArticle);
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadArticles();
  }, [warehouse.id]);

  useEffect(() => {
    setForm(selected ? { ...selected, sufijos: normalizeSuffixes(selected.sufijos) } : cloneEmptyArticle());
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
    const visibleIds = filtered.map((article) => article.id);
    setSelectedIds((current) => (
      visibleIds.every((id) => current.includes(id))
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds]))
    ));
  }

  function updateSuffix(index, field, value) {
    setForm((current) => ({
      ...current,
      sufijos: normalizeSuffixes(current.sufijos).map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      )),
    }));
  }

  function addSuffix() {
    setForm((current) => {
      const currentSuffixes = normalizeSuffixes(current.sufijos);
      const used = currentSuffixes.map((item) => item.sufijo);
      const nextSuffix = suffixOptions.find((option) => !used.includes(option));
      if (!nextSuffix) return current;
      return {
        ...current,
        sufijos: [...currentSuffixes, { sufijo: nextSuffix, capacidad: 1 }],
      };
    });
  }

  function removeSuffix(index) {
    setForm((current) => {
      const currentSuffixes = normalizeSuffixes(current.sufijos);
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
              <button className="secondary-button suffix-add" type="button" onClick={addSuffix} disabled={normalizeSuffixes(form.sufijos).length >= suffixOptions.length}>
                <Plus size={17} />
                Sufijo
              </button>
            </div>
            <div className="suffix-list">
              {normalizeSuffixes(form.sufijos).map((suffix, index) => (
                <div className="suffix-row" key={`${suffix.sufijo}-${index}`}>
                  <label>
                    Sufijo
                    <select value={suffix.sufijo} onChange={(event) => updateSuffix(index, 'sufijo', event.target.value)}>
                      {suffixOptions.map((option) => (
                        <option value={option} key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Capacidad
                    <input
                      type="number"
                      min="0"
                      value={suffix.capacidad}
                      onChange={(event) => updateSuffix(index, 'capacidad', event.target.value)}
                      required
                    />
                  </label>
                  <button
                    className="icon-button danger suffix-remove"
                    type="button"
                    onClick={() => removeSuffix(index)}
                    aria-label="Quitar sufijo"
                    disabled={normalizeSuffixes(form.sufijos).length === 1}
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
            <div className="bulk-bar">
              <span>{selectedIds.length ? `${selectedIds.length} seleccionados` : 'Selecciona artículos para borrar varios'}</span>
              <button className="secondary-button danger-text" type="button" onClick={deleteSelectedArticles} disabled={!selectedIds.length}>
                <Trash2 size={17} />
                Eliminar seleccionados
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th className="select-cell">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((article) => selectedIds.includes(article.id))}
                      onChange={toggleAllArticles}
                      aria-label="Seleccionar artículos visibles"
                    />
                  </th>
                  <th>Código artículo</th>
                  <th>Código cliente</th>
                  <th>Descripción</th>
                  <th>SKU + sufijos</th>
                  <th>Capacidad total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((article) => (
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
                      <div className="sku-list">
                        {normalizeSuffixes(article.sufijos).map((suffix, index) => (
                          <span className="sku-pill" key={`${article.id}-${suffix.sufijo}-${index}`}>
                            {article.sku}-{suffix.sufijo}: {suffix.capacidad}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td><strong>{normalizeSuffixes(article.sufijos).reduce((sum, suffix) => sum + toNumber(suffix.capacidad, 0), 0)}</strong></td>
                    <td className="row-actions">
                      <button className="icon-button" type="button" onClick={() => setSelected(article)} aria-label="Editar"><Pencil size={17} /></button>
                      <button className="icon-button danger" type="button" onClick={() => deleteArticle(article)} aria-label="Eliminar"><Trash2 size={17} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
  const [error, setError] = useState('');

  useEffect(() => {
    loadOperators();
  }, [warehouse.id]);

  useEffect(() => {
    setForm(selected || emptyOperator);
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

  async function deleteOperator(operator) {
    if (!window.confirm(`Eliminar usuario "${operator.nombre}"? Esta acción no se puede deshacer.`)) return;
    const { error: deleteError } = await supabase.from('almacen_operadores').delete().eq('id', operator.id);
    if (deleteError) setError(deleteError.message);
    else loadOperators();
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
    const visibleIds = operators.map((operator) => operator.id);
    setSelectedIds((current) => (
      visibleIds.every((id) => current.includes(id))
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds]))
    ));
  }

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
              <option value="operador">Operador</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
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
          <span className="counter-pill">{operators.length}</span>
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="table-panel">
          <div className="bulk-bar">
            <span>{selectedIds.length ? `${selectedIds.length} seleccionados` : 'Selecciona usuarios para borrar varios'}</span>
            <button className="secondary-button danger-text" type="button" onClick={deleteSelectedOperators} disabled={!selectedIds.length}>
              <Trash2 size={17} />
              Eliminar seleccionados
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th className="select-cell">
                  <input
                    type="checkbox"
                    checked={operators.length > 0 && operators.every((operator) => selectedIds.includes(operator.id))}
                    onChange={toggleAllOperators}
                    aria-label="Seleccionar usuarios"
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
              {operators.map((operator) => (
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
                  <td>{operator.rol}</td>
                  <td>{operator.activo ? 'Activo' : 'Inactivo'}</td>
                  <td className="row-actions">
                    <button className="icon-button" type="button" onClick={() => setSelected(operator)} aria-label="Editar"><Pencil size={17} /></button>
                    <button className="icon-button danger" type="button" onClick={() => deleteOperator(operator)} aria-label="Eliminar"><Trash2 size={17} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!operators.length && <div className="empty-inline">Todavía no hay usuarios operativos.</div>}
        </div>
      </section>
    </div>
  );
}

function ShelvingManager({ warehouse }) {
  const [modules, setModules] = useState([]);
  const [shelves, setShelves] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    loadLayout();
  }, [warehouse.id]);

  async function loadLayout() {
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
        .insert({ almacen_id: warehouse.id, nombre: 'Módulo 1', orden: 1 })
        .select()
        .single();
      if (createError) {
        setError(createError.message);
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
    setShelves(
      (shelfData || []).reduce((acc, shelf) => {
        acc[`${shelf.modulo_id}-${shelf.numero}`] = shelf.cantidad_baldas;
        return acc;
      }, {})
    );
    setError('');
  }

  async function addModule() {
    const { error: createError } = await supabase.from('almacen_modulos').insert({
      almacen_id: warehouse.id,
      nombre: nextModuleName(modules.length),
      orden: modules.length + 1,
    });
    if (createError) setError(createError.message);
    else loadLayout();
  }

  async function saveShelf(moduleId, numero, cantidad) {
    const { error: saveError } = await supabase
      .from('almacen_estantes')
      .upsert(
        {
          modulo_id: moduleId,
          numero,
          cantidad_baldas: Math.min(8, Math.max(0, toNumber(cantidad, 0))),
        },
        { onConflict: 'modulo_id,numero' }
      );

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setShelves((current) => ({ ...current, [`${moduleId}-${numero}`]: Math.min(8, Math.max(0, toNumber(cantidad, 0))) }));
  }

  return (
    <section className="inventory-panel">
      <div className="panel-heading inventory-heading">
        <div>
          <span className="eyebrow">Configuración de estantería</span>
          <h2>Layout de módulos y baldas</h2>
        </div>
        <button className="primary-button" onClick={addModule}>
          <Plus size={18} />
          Añadir módulo
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="rack-grid">
        {modules.map((module, moduleIndex) => (
          <article className="rack-card" key={module.id}>
            <div className="rack-title">
              <strong>Módulo {moduleIndex + 1}</strong>
              <span>Configura cuántas baldas usará cada estante</span>
            </div>
            <div className="rack-frame">
              {Array.from({ length: 8 }, (_, index) => {
                const numero = index + 1;
                const key = `${module.id}-${numero}`;
                const value = Math.min(8, Math.max(0, shelves[key] ?? 0));
                return (
                  <div className="rack-row" key={key}>
                    <span>E{numero}</span>
                    <input
                      type="number"
                      min="0"
                      max="8"
                      value={value}
                      onChange={(event) => saveShelf(module.id, numero, event.target.value)}
                      aria-label={`Baldas estante ${numero}`}
                    />
                    <div className="shelf-preview" style={{ gridTemplateColumns: `repeat(${Math.max(value, 1)}, minmax(0, 1fr))` }}>
                      {Array.from({ length: value }, (_, shelfIndex) => (
                        <i key={shelfIndex} />
                      ))}
                    </div>
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

  return (
    <>
      <section className="warehouse-summary">
        <article>
          <span>Base activa</span>
          <strong>{warehouse.nombre}</strong>
        </article>
        <article>
          <span>Ubicación</span>
          <strong>{warehouse.ubicacion}</strong>
        </article>
        <article>
          <span>Trabajo actual</span>
          <strong>{tab === 'articulos' ? 'Artículos' : tab === 'usuarios' ? 'Usuarios' : 'Estantería'}</strong>
        </article>
      </section>

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
      </nav>

      {tab === 'articulos' && <ArticleManager warehouse={warehouse} />}
      {tab === 'usuarios' && <OperatorsManager warehouse={warehouse} />}
      {tab === 'estanteria' && <ShelvingManager warehouse={warehouse} />}
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
          onOpen={setSelectedWarehouse}
          onDelete={deleteWarehouse}
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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCheckingSession(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (checkingSession) {
    return <div className="boot-screen">Cargando almacén...</div>;
  }

  return session ? <Dashboard session={session} /> : <Login onLogin={setSession} />;
}

createRoot(document.getElementById('root')).render(<App />);
