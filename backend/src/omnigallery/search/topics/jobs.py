import threading
import time

_TOPIC_CLUSTER_JOBS: dict[str, dict] = {}


_TOPIC_CLUSTER_JOBS_LOCK = threading.Lock()


_TOPIC_CLUSTER_JOBS_MAX = 16


def _job_now() -> float:
    return time.time()


def _job_trim() -> None:
    # Keep only the most recent jobs in memory.
    with _TOPIC_CLUSTER_JOBS_LOCK:
        if len(_TOPIC_CLUSTER_JOBS) <= _TOPIC_CLUSTER_JOBS_MAX:
            return
        # sort by updated_at desc
        items = sorted(
            _TOPIC_CLUSTER_JOBS.items(), key=lambda kv: kv[1].get("updated_at") or 0, reverse=True
        )
        keep = dict(items[:_TOPIC_CLUSTER_JOBS_MAX])
        _TOPIC_CLUSTER_JOBS.clear()
        _TOPIC_CLUSTER_JOBS.update(keep)


def _job_get(job_id: str) -> dict | None:
    with _TOPIC_CLUSTER_JOBS_LOCK:
        j = _TOPIC_CLUSTER_JOBS.get(job_id)
        return dict(j) if isinstance(j, dict) else None


def get_cluster_job_status(job_id: str) -> dict | None:
    """Public function to get cluster job status."""
    return _job_get(job_id)


def _job_upsert(job_id: str, patch: dict) -> None:
    with _TOPIC_CLUSTER_JOBS_LOCK:
        cur = _TOPIC_CLUSTER_JOBS.get(job_id)
        if not isinstance(cur, dict):
            cur = {"job_id": job_id}
        cur.update(patch or {})
        cur["updated_at"] = _job_now()
        _TOPIC_CLUSTER_JOBS[job_id] = cur
    _job_trim()
