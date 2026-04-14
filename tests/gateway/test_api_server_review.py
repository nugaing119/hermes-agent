import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from gateway.config import PlatformConfig
from gateway.platforms.api_server import APIServerAdapter, cors_middleware, security_headers_middleware


def _make_adapter(review_root: Path | None = None, api_key: str = "") -> APIServerAdapter:
    extra = {}
    if review_root is not None:
        extra["review_repo_root"] = str(review_root)
    if api_key:
        extra["key"] = api_key
    return APIServerAdapter(PlatformConfig(enabled=True, extra=extra))


def _create_app(adapter: APIServerAdapter) -> web.Application:
    mws = [mw for mw in (cors_middleware, security_headers_middleware) if mw is not None]
    app = web.Application(middlewares=mws)
    app["api_server_adapter"] = adapter
    app.router.add_get("/api/review/summary", adapter._handle_review_summary)
    app.router.add_get("/api/review/candidates", adapter._handle_review_candidates)
    app.router.add_get("/api/review/candidates/{candidate_id}", adapter._handle_review_candidate)
    app.router.add_get("/api/review/candidates/{candidate_id}/context", adapter._handle_review_candidate_context)
    app.router.add_get("/api/review/maintenance", adapter._handle_review_maintenance)
    app.router.add_get("/api/review/maintenance/{maintenance_id}/context", adapter._handle_review_maintenance_context)
    app.router.add_get("/api/review/overrides", adapter._handle_review_overrides)
    app.router.add_post("/api/review/actions/run", adapter._handle_review_action)
    return app


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


@pytest.fixture
def review_root(tmp_path: Path) -> Path:
    pending = tmp_path / "vault" / "_noosphere" / "pending"
    maintenance = tmp_path / "vault" / "_noosphere" / "maintenance"
    overrides = tmp_path / "vault" / "_noosphere" / "overrides"

    _write(
        pending / "cand-1.md",
        """---
candidate_id: cand-1
proposal_kind: literature
proposed_title: "Candidate One"
summary: "Candidate summary"
source_basis: internal
promotion_readiness: ready
status: pending
created_at: "2026-04-14T18:02:01"
assessed_at: "2026-04-14T18:05:10"
---

Candidate body
""",
    )
    _write(
        maintenance / "maint-1.md",
        """---
maintenance_id: "maint-1"
kind: relink
status: open
target_notes:
  - "art-1"
source_refs:
  - "drawer-1"
created_at: "2026-04-14T22:42:33"
created_by: "llm"
run_id: "run-1"
summary: "Maintenance summary"
suggested_action: "Review links"
rollback_supported: true
---

Maintenance body
""",
    )
    _write(
        overrides / "events.jsonl",
        """{"event_id":"ovr-1","event_type":"override","actor":"human","channel":"hermes","target":"maint-1","before_snapshot":null,"reason":"reviewed","created_at":"2026-04-14T22:43:00","related_session_id":"sess-1"}
{"event_id":"ovr-2","event_type":"lock","actor":"human","channel":"hermes","target":"art-1","before_snapshot":"/tmp/file.md","reason":"locked","created_at":"2026-04-14T22:44:00","related_session_id":"sess-2"}
""",
    )
    return tmp_path


@pytest.fixture
def adapter(review_root: Path) -> APIServerAdapter:
    adapter = _make_adapter(review_root=review_root)
    adapter._review_paths_cache = {
        "pending": review_root / "vault" / "_noosphere" / "pending",
        "maintenance": review_root / "vault" / "_noosphere" / "maintenance",
        "override-log": review_root / "vault" / "_noosphere" / "overrides" / "events.jsonl",
    }
    return adapter


class TestReviewSummary:
    @pytest.mark.asyncio
    async def test_summary_counts(self, adapter: APIServerAdapter):
        app = _create_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/review/summary")
            assert resp.status == 200
            data = await resp.json()
            assert data["ok"] is True
            assert data["candidates"]["all"] == 1
            assert data["candidates"]["ready"] == 1
            assert data["maintenance"]["all"] == 1
            assert data["maintenance"]["open"] == 1
            assert data["recent_overrides_count"] == 2


class TestReviewContexts:
    @pytest.mark.asyncio
    async def test_candidate_context(self, adapter: APIServerAdapter):
        app = _create_app(adapter)
        with patch.object(
            adapter,
            "_run_review_cmd",
            side_effect=[
                subprocess.CompletedProcess(args=[], returncode=0, stdout="show out", stderr=""),
                subprocess.CompletedProcess(args=[], returncode=0, stdout="preflight out", stderr=""),
            ],
        ):
            async with TestClient(TestServer(app)) as cli:
                resp = await cli.get("/api/review/candidates/cand-1/context")
                assert resp.status == 200
                data = await resp.json()
                assert data["ok"] is True
                assert data["item"]["candidate_id"] == "cand-1"
                assert data["context"]["show_output"] == "show out"
                assert data["context"]["preflight_output"] == "preflight out"

    @pytest.mark.asyncio
    async def test_maintenance_context(self, adapter: APIServerAdapter):
        app = _create_app(adapter)
        with patch.object(
            adapter,
            "_run_review_cmd",
            return_value=subprocess.CompletedProcess(args=[], returncode=0, stdout="maint show", stderr=""),
        ):
            async with TestClient(TestServer(app)) as cli:
                resp = await cli.get("/api/review/maintenance/maint-1/context")
                assert resp.status == 200
                data = await resp.json()
                assert data["ok"] is True
                assert data["item"]["maintenance_id"] == "maint-1"
                assert data["item"]["target_notes"] == ["art-1"]
                assert data["context"]["show_output"] == "maint show"
                assert data["context"]["trace_count"] == 1


class TestReviewActions:
    @pytest.mark.asyncio
    async def test_action_mapping_approve_literature(self, adapter: APIServerAdapter):
        app = _create_app(adapter)
        with patch.object(
            adapter,
            "_run_review_cmd",
            return_value=subprocess.CompletedProcess(args=[], returncode=0, stdout="approved", stderr=""),
        ) as mock_run:
            async with TestClient(TestServer(app)) as cli:
                resp = await cli.post(
                    "/api/review/actions/run",
                    json={
                        "action": "approve_literature",
                        "target_id": "cand-1",
                        "note": "operator note",
                        "session_id": "sess-1",
                    },
                )
                assert resp.status == 200
                data = await resp.json()
                assert data["ok"] is True
                assert data["stdout"] == "approved"
                called = mock_run.call_args.args[0]
                assert "--approve-literature" in called
                assert "cand-1" in called
                assert "--note" in called
                assert "--session-id" in called

    @pytest.mark.asyncio
    async def test_action_mapping_safe_batch_dry_run(self, adapter: APIServerAdapter):
        app = _create_app(adapter)
        with patch.object(
            adapter,
            "_run_review_cmd",
            return_value=subprocess.CompletedProcess(args=[], returncode=0, stdout="dry-run batch", stderr=""),
        ) as mock_run:
            async with TestClient(TestServer(app)) as cli:
                resp = await cli.post(
                    "/api/review/actions/run",
                    json={"action": "approve_safe_batch", "dry_run": True},
                )
                assert resp.status == 200
                data = await resp.json()
                assert data["ok"] is True
                called = mock_run.call_args.args[0]
                assert called[-1] == "--dry-run"

    @pytest.mark.asyncio
    async def test_action_rejects_missing_review_backend(self, review_root: Path):
        adapter = _make_adapter(review_root=None)
        app = _create_app(adapter)
        async with TestClient(TestServer(app)) as cli:
            resp = await cli.get("/api/review/summary")
            assert resp.status == 501
