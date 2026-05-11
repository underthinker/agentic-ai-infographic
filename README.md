# Agentic AI 3D Infographic

An interactive 3D infographic of agentic-AI concepts. Three.js frontend renders a
clustered 3D knowledge graph; FastAPI + SQLite backend serves the data and the
static scene from a single port.

## Quick start

```bash
./run.sh
```

That creates a venv, installs deps, seeds `data/agentic.db` (only if missing), and starts uvicorn
on `http://127.0.0.1:8787` with `--reload`.

## What you get

The scene loads at `http://127.0.0.1:8787/`.

- 30 concepts across 8 categories
- 54 typed relationships
- Click any node to inspect
- Search across concepts
- Filter by category
- Related-concept navigation

## Manual steps

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m backend.seed                             # (re)build data/agentic.db
uvicorn backend.app:app --host 127.0.0.1 --port 8787 --reload
```

## API

| Method | Path                    | Description                                     |
|--------|-------------------------|-------------------------------------------------|
| GET    | `/healthz`              | `{"ok": true}`                                  |
| GET    | `/api/graph`            | All concepts + relationships                    |
| GET    | `/api/concepts/{id}`    | Single concept (404 if missing)                 |
| GET    | `/api/categories`       | `[{name, color, count}]` — 8 entries            |

### Concept shape

```json
{
  "id": 1,
  "slug": "agent",
  "name": "Agent",
  "category": "core",
  "color": "#ff6b6b",
  "summary": "...",
  "details": "markdown ...",
  "key_points": ["...", "..."],
  "examples": [{"title": "...", "content": "..."}],
  "position": {"x": 6.83, "y": 7.12, "z": 5.91}
}
```

### Relationship shape

```json
{ "source_id": 1, "target_id": 5, "type": "uses", "description": "..." }
```

Relationship types: `uses` | `extends` | `enables` | `constrains` | `feeds`.

## Layout

```
backend/         FastAPI app, db helper, seed script
data/agentic.db  SQLite database (committed; regenerate via seed.py)
frontend/        Three.js scene + UI, served at /
```

CORS is open (`*`) for ease of local development. The static frontend mount is
conditional: if `./frontend` does not exist the backend still boots.

## Layout / positions

Positions are deterministic (RNG seed `42`). Each category centroid sits on a
cube vertex normalised to radius 12; concepts jitter ±2.5 around their
category's centroid, producing 8 visible 3D clusters.

## Stack

- Python 3.11+
- FastAPI
- SQLite (stdlib `sqlite3`)
- Three.js 0.160 via importmap (CDN)
- `marked` for markdown rendering
