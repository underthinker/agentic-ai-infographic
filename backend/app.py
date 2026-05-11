"""FastAPI app for agentic AI 3D infographic."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .db import connect

app = FastAPI(title="Agentic AI Infographic API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _row_to_concept(row) -> dict:
    return {
        "id": row["id"],
        "slug": row["slug"],
        "name": row["name"],
        "category": row["category"],
        "color": row["color"],
        "summary": row["summary"],
        "details": row["details"],
        "key_points": json.loads(row["key_points_json"]),
        "examples": json.loads(row["examples_json"]),
        "position": {"x": row["pos_x"], "y": row["pos_y"], "z": row["pos_z"]},
    }


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/api/graph")
def get_graph():
    conn = connect()
    try:
        concepts = [_row_to_concept(r) for r in conn.execute(
            "SELECT * FROM concepts ORDER BY id"
        ).fetchall()]
        relationships = [
            {
                "source_id": r["source_id"],
                "target_id": r["target_id"],
                "type": r["type"],
                "description": r["description"],
            }
            for r in conn.execute(
                "SELECT source_id, target_id, type, description FROM relationships ORDER BY id"
            ).fetchall()
        ]
        return {"concepts": concepts, "relationships": relationships}
    finally:
        conn.close()


@app.get("/api/concepts/{concept_id}")
def get_concept(concept_id: int):
    conn = connect()
    try:
        row = conn.execute(
            "SELECT * FROM concepts WHERE id = ?", (concept_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Concept not found")
        return _row_to_concept(row)
    finally:
        conn.close()


@app.get("/api/categories")
def get_categories():
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT category, color FROM concepts"
        ).fetchall()
        counter: Counter = Counter()
        colors: dict[str, str] = {}
        for r in rows:
            counter[r["category"]] += 1
            colors[r["category"]] = r["color"]
        return [
            {"name": name, "color": colors[name], "count": count}
            for name, count in sorted(counter.items())
        ]
    finally:
        conn.close()


# Mount static frontend last, only if it exists.
_frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
if _frontend_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_dir), html=True), name="frontend")
