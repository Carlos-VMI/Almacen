import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Boxes,
  ClipboardList,
  LogOut,
  PackagePlus,
  Pencil,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from './supabaseClient';
import './styles.css';

const emptyForm = {
  codigo_articulo: '',
  codigo_cliente: '',
  sku: '',
  descripcion: '',
  cantidad_baldas: 1,
  capacidad_balda: 1,
};

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
        <p>Acceso privado al control de artículos y capacidad de baldas.</p>

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

function ArticleForm({ selected, onCancel, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(selected || emptyForm);
    setError('');
  }, [selected]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');

    const record = {
      codigo_articulo: form.codigo_articulo.trim(),
      codigo_cliente: form.codigo_cliente.trim(),
      sku: form.sku.trim(),
      descripcion: form.descripcion.trim(),
      cantidad_baldas: Math.max(1, normalizeNumber(form.cantidad_baldas, 1)),
      capacidad_balda: Math.max(1, normalizeNumber(form.capacidad_balda, 1)),
    };

    const request = selected?.id
      ? supabase.from('articulos').update(record).eq('id', selected.id).select().single()
      : supabase.from('articulos').insert(record).select().single();

    const { error: saveError } = await request;
    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setForm(emptyForm);
    onSaved();
  }

  return (
    <section className="form-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Configuración</span>
          <h2>{selected ? 'Editar artículo' : 'Nuevo artículo'}</h2>
        </div>
        {selected && (
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Cancelar edición">
            <X size={18} />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="article-form">
        <label>
          Código de artículo
          <input
            value={form.codigo_articulo}
            onChange={(event) => updateField('codigo_articulo', event.target.value)}
            placeholder="ART-001"
            required
          />
        </label>

        <label>
          Código de cliente
          <input
            value={form.codigo_cliente}
            onChange={(event) => updateField('codigo_cliente', event.target.value)}
            placeholder="CLI-001"
          />
        </label>

        <label>
          SKU
          <input
            value={form.sku}
            onChange={(event) => updateField('sku', event.target.value)}
            placeholder="A1E1P1"
            required
          />
        </label>

        <label className="wide-field">
          Descripción
          <input
            value={form.descripcion}
            onChange={(event) => updateField('descripcion', event.target.value)}
            placeholder="DIN 912 M5"
            required
          />
        </label>

        <label>
          Cantidad de baldas
          <input
            type="number"
            min="1"
            value={form.cantidad_baldas}
            onChange={(event) => updateField('cantidad_baldas', event.target.value)}
            required
          />
        </label>

        <label>
          Capacidad por balda
          <input
            type="number"
            min="1"
            value={form.capacidad_balda}
            onChange={(event) => updateField('capacidad_balda', event.target.value)}
            required
          />
        </label>

        {error && <div className="error-box wide-field">{error}</div>}

        <button className="primary-button wide-field" type="submit" disabled={saving}>
          <Save size={18} />
          {saving ? 'Guardando...' : selected ? 'Guardar cambios' : 'Crear artículo'}
        </button>
      </form>
    </section>
  );
}

function InventoryTable({ articles, onEdit, onDelete }) {
  if (!articles.length) {
    return (
      <section className="empty-state">
        <ClipboardList size={32} />
        <h2>Sin artículos configurados</h2>
        <p>Crea el primer artículo para empezar a controlar la capacidad de tus baldas.</p>
      </section>
    );
  }

  return (
    <section className="table-panel">
      <table>
        <thead>
          <tr>
            <th>Código artículo</th>
            <th>Código cliente</th>
            <th>SKU</th>
            <th>Descripción</th>
            <th>Baldas</th>
            <th>Capacidad/balda</th>
            <th>Capacidad total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {articles.map((article) => {
            const total = article.cantidad_baldas * article.capacidad_balda;
            return (
              <tr key={article.id}>
                <td>{article.codigo_articulo}</td>
                <td>{article.codigo_cliente || '-'}</td>
                <td><span className="sku-pill">{article.sku}</span></td>
                <td>{article.descripcion}</td>
                <td>{article.cantidad_baldas}</td>
                <td>{article.capacidad_balda}</td>
                <td><strong>{total}</strong></td>
                <td className="row-actions">
                  <button className="icon-button" onClick={() => onEdit(article)} aria-label="Editar">
                    <Pencil size={17} />
                  </button>
                  <button className="icon-button danger" onClick={() => onDelete(article)} aria-label="Eliminar">
                    <Trash2 size={17} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Dashboard({ session }) {
  const [articles, setArticles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadArticles() {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('articulos')
      .select('*')
      .order('created_at', { ascending: false });

    if (loadError) {
      setError(loadError.message);
    } else {
      setArticles(data || []);
      setError('');
    }
    setLoading(false);
  }

  useEffect(() => {
    loadArticles();
  }, []);

  const filteredArticles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return articles;
    return articles.filter((article) =>
      [
        article.codigo_articulo,
        article.codigo_cliente,
        article.sku,
        article.descripcion,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle))
    );
  }, [articles, query]);

  const totals = useMemo(() => {
    return articles.reduce(
      (acc, article) => {
        acc.items += 1;
        acc.baldas += article.cantidad_baldas;
        acc.capacidad += article.cantidad_baldas * article.capacidad_balda;
        return acc;
      },
      { items: 0, baldas: 0, capacidad: 0 }
    );
  }, [articles]);

  async function deleteArticle(article) {
    const confirmed = window.confirm(`Eliminar ${article.descripcion}?`);
    if (!confirmed) return;

    const { error: deleteError } = await supabase
      .from('articulos')
      .delete()
      .eq('id', article.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    if (selected?.id === article.id) setSelected(null);
    loadArticles();
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <div className="brand-mark small">
            <Boxes size={22} />
          </div>
          <div>
            <span className="eyebrow">Sistema de stock</span>
            <h1>Almacén</h1>
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

      <section className="stats-grid">
        <article>
          <span>Artículos</span>
          <strong>{totals.items}</strong>
        </article>
        <article>
          <span>Baldas configuradas</span>
          <strong>{totals.baldas}</strong>
        </article>
        <article>
          <span>Capacidad total</span>
          <strong>{totals.capacidad}</strong>
        </article>
      </section>

      <div className="content-grid">
        <ArticleForm
          selected={selected}
          onCancel={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            loadArticles();
          }}
        />

        <section className="inventory-panel">
          <div className="panel-heading inventory-heading">
            <div>
              <span className="eyebrow">Inventario</span>
              <h2>Artículos configurados</h2>
            </div>
            <div className="search-box">
              <Search size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar artículo, cliente, SKU..."
              />
            </div>
          </div>

          {error && <div className="error-box">{error}</div>}
          {loading ? (
            <div className="loading-box">Cargando artículos...</div>
          ) : (
            <InventoryTable
              articles={filteredArticles}
              onEdit={setSelected}
              onDelete={deleteArticle}
            />
          )}
        </section>
      </div>

      <button className="floating-add" onClick={() => setSelected(null)} aria-label="Nuevo artículo">
        <PackagePlus size={22} />
      </button>
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
