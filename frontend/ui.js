// ui.js — Detail panel, search, filters, legend, tooltip
// Pure DOM + state; the scene-side code in main.js calls these and provides callbacks.

const EDGE_COLORS = {
  uses:       '#22d3ee', // cyan
  extends:    '#a78bfa', // violet
  enables:    '#34d399', // green
  constrains: '#f472b6', // pink
  feeds:      '#fbbf24', // amber
};

const EDGE_LABELS = {
  uses:       'uses',
  extends:    'extends',
  enables:    'enables',
  constrains: 'constrains',
  feeds:      'feeds',
};

export { EDGE_COLORS, EDGE_LABELS };

/**
 * UIController wires up the DOM panels around the scene.
 * It is given a `bridge` object exposing scene actions:
 *   bridge.selectById(id)       — focus a concept by id (camera + panel)
 *   bridge.deselect()           — clear selection and return to overview
 *   bridge.setSearchPredicate(fn|null)
 *   bridge.setCategoryFilter(activeSet)  // Set<string> of active category names
 */
export class UIController {
  constructor({ concepts, relationships, categories, bridge }) {
    this.concepts = concepts;
    this.byId = new Map(concepts.map((c) => [c.id, c]));
    this.relationships = relationships;
    this.categories = categories;
    this.bridge = bridge;

    // Precompute neighbors per concept, grouped by edge type/direction.
    this.neighbors = new Map(); // id -> { outgoing: {type: [{concept,desc}]}, incoming: {...} }
    for (const c of concepts) {
      this.neighbors.set(c.id, { outgoing: {}, incoming: {} });
    }
    for (const r of relationships) {
      const src = this.neighbors.get(r.source_id);
      const tgt = this.neighbors.get(r.target_id);
      if (src) {
        (src.outgoing[r.type] = src.outgoing[r.type] || []).push({
          id: r.target_id, description: r.description,
        });
      }
      if (tgt) {
        (tgt.incoming[r.type] = tgt.incoming[r.type] || []).push({
          id: r.source_id, description: r.description,
        });
      }
    }

    // Categories active set (mutated by chip toggle)
    this.activeCategories = new Set(categories.map((c) => c.name));

    this._mountSearch();
    this._mountCategoryChips();
    this._mountLegend();
    this._mountStats();
    this._mountDetailPanel();
    this._mountGlobalKeys();
  }

  // ---------- Tooltip ----------

  showTooltip(concept, clientX, clientY) {
    const el = document.getElementById('tooltip');
    el.innerHTML = `
      <div class="tt-name">${escapeHtml(concept.name)}</div>
      <div class="tt-cat" style="color:${concept.color}">${escapeHtml(concept.category)}</div>
      <div class="tt-summary">${escapeHtml(concept.summary || '')}</div>
    `;
    el.classList.add('visible');
    this.moveTooltip(clientX, clientY);
  }

  moveTooltip(clientX, clientY) {
    const el = document.getElementById('tooltip');
    if (!el.classList.contains('visible')) return;
    const pad = 14;
    const rect = el.getBoundingClientRect();
    let x = clientX + pad;
    let y = clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = clientY - rect.height - pad;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  hideTooltip() {
    document.getElementById('tooltip').classList.remove('visible');
  }

  // ---------- Search ----------

  _mountSearch() {
    const input = document.getElementById('search-input');
    const wrap = input.closest('.search-wrap');
    const clear = document.getElementById('search-clear');

    const apply = () => {
      const q = input.value.trim().toLowerCase();
      wrap.classList.toggle('has-text', q.length > 0);
      if (!q) {
        this.bridge.setSearchPredicate(null);
      } else {
        this.bridge.setSearchPredicate((c) =>
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.summary && c.summary.toLowerCase().includes(q)) ||
          (c.slug && c.slug.toLowerCase().includes(q)) ||
          (c.details && c.details.toLowerCase().includes(q))
        );
      }
    };

    input.addEventListener('input', apply);
    clear.addEventListener('click', () => {
      input.value = '';
      apply();
      input.focus();
    });
  }

  // ---------- Category filter chips ----------

  _mountCategoryChips() {
    const host = document.getElementById('category-filters');
    host.innerHTML = '';
    for (const cat of this.categories) {
      const chip = document.createElement('button');
      chip.className = 'cat-chip active';
      chip.style.color = cat.color;
      chip.innerHTML = `
        <span class="swatch" style="background:${cat.color}; color:${cat.color}"></span>
        <span style="color:var(--text)">${escapeHtml(cat.name)}</span>
        <span style="color:var(--text-faint); font-variant-numeric:tabular-nums;">${cat.count}</span>
      `;
      chip.addEventListener('click', () => {
        if (this.activeCategories.has(cat.name)) {
          if (this.activeCategories.size === 1) return;
          this.activeCategories.delete(cat.name);
          chip.classList.remove('active');
          chip.classList.add('inactive');
        } else {
          this.activeCategories.add(cat.name);
          chip.classList.add('active');
          chip.classList.remove('inactive');
        }
        this.bridge.setCategoryFilter(this.activeCategories);
      });
      host.appendChild(chip);
    }
  }

  // ---------- Legend ----------

  _mountLegend() {
    const edgesHost = document.getElementById('legend-edges');
    edgesHost.innerHTML = '';
    for (const type of Object.keys(EDGE_COLORS)) {
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML = `
        <span class="swatch-line" style="background:${EDGE_COLORS[type]}; color:${EDGE_COLORS[type]}"></span>
        <span>${type}</span>
      `;
      edgesHost.appendChild(row);
    }

    const catHost = document.getElementById('legend-categories');
    catHost.innerHTML = '';
    for (const cat of this.categories) {
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML = `
        <span class="swatch" style="background:${cat.color}; color:${cat.color}"></span>
        <span>${escapeHtml(cat.name)}</span>
        <span class="count">${cat.count}</span>
      `;
      catHost.appendChild(row);
    }
  }

  // ---------- Stats ----------

  _mountStats() {
    document.getElementById('stats').textContent =
      `${this.concepts.length} concepts · ${this.relationships.length} relationships`;
  }

  // ---------- Detail panel ----------

  _mountDetailPanel() {
    const close = document.getElementById('detail-close');
    close.addEventListener('click', () => this.bridge.deselect());
  }

  openDetail(concept) {
    const host = document.getElementById('detail-content');
    const panel = document.getElementById('detail-panel');
    const n = this.neighbors.get(concept.id) || { outgoing: {}, incoming: {} };

    const markdown = (typeof window.marked !== 'undefined' && concept.details)
      ? window.marked.parse(concept.details)
      : (concept.details ? `<p>${escapeHtml(concept.details)}</p>` : '');

    const keyPointsHtml = (concept.key_points && concept.key_points.length)
      ? `<div class="detail-section">
           <div class="detail-section-title">Key points</div>
           <ul class="key-points">
             ${concept.key_points.map((k) => `<li>${escapeHtml(k)}</li>`).join('')}
           </ul>
         </div>`
      : '';

    const examplesHtml = (concept.examples && concept.examples.length)
      ? `<div class="detail-section">
           <div class="detail-section-title">Examples</div>
           ${concept.examples.map((ex) => `
             <div class="example-card">
               <div class="example-title">${escapeHtml(ex.title || '')}</div>
               <div class="example-content">${escapeHtml(ex.content || '')}</div>
             </div>
           `).join('')}
         </div>`
      : '';

    const relatedHtml = this._renderRelated(n);

    host.innerHTML = `
      <span class="category-pill" style="color:${concept.color}">
        <span class="dot"></span>${escapeHtml(concept.category)}
      </span>
      <h1 class="detail-name">${escapeHtml(concept.name)}</h1>
      ${concept.summary ? `<div class="detail-summary">${escapeHtml(concept.summary)}</div>` : ''}
      ${markdown ? `<div class="detail-section">
         <div class="detail-markdown">${markdown}</div>
       </div>` : ''}
      ${keyPointsHtml}
      ${examplesHtml}
      ${relatedHtml}
    `;

    // Wire up related-pill clicks.
    host.querySelectorAll('[data-related-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-related-id');
        this.bridge.selectById(id);
      });
    });

    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    panel.querySelector('.detail-scroll').scrollTop = 0;
  }

  closeDetail() {
    const panel = document.getElementById('detail-panel');
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }

  _renderRelated(n) {
    const groups = [];
    for (const type of Object.keys(EDGE_COLORS)) {
      const out = n.outgoing[type] || [];
      const inc = n.incoming[type] || [];
      if (out.length) {
        groups.push({
          label: `${EDGE_LABELS[type]}`,
          arrow: '→',
          type,
          items: out,
        });
      }
      if (inc.length) {
        groups.push({
          label: `${EDGE_LABELS[type]} by`,
          arrow: '←',
          type,
          items: inc,
        });
      }
    }

    if (!groups.length) return '';

    const sections = groups.map((g) => {
      const pills = g.items.map((it) => {
        const c = this.byId.get(it.id);
        if (!c) return '';
        return `
          <button class="related-pill" data-related-id="${escapeAttr(c.id)}" title="${escapeAttr(it.description || '')}">
            <span class="dot" style="background:${c.color}; color:${c.color}"></span>
            ${escapeHtml(c.name)}
          </button>`;
      }).join('');
      return `
        <div class="related-group">
          <div class="related-group-title">
            <span class="arrow" style="color:${EDGE_COLORS[g.type]}">${g.arrow}</span>
            <span>${escapeHtml(g.label)}</span>
          </div>
          <div>${pills}</div>
        </div>`;
    }).join('');

    return `
      <div class="detail-section">
        <div class="detail-section-title">Related concepts</div>
        ${sections}
      </div>`;
  }

  // ---------- Global keys ----------

  _mountGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';

      if (e.key === 'Escape') {
        if (isTyping) {
          e.target.blur();
        } else {
          this.bridge.deselect();
        }
      } else if (e.key === '/' && !isTyping) {
        e.preventDefault();
        const i = document.getElementById('search-input');
        i.focus();
        i.select();
      } else if ((e.key === 'r' || e.key === 'R') && !isTyping && !e.metaKey && !e.ctrlKey) {
        this.bridge.resetView();
      }
    });
  }
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}
